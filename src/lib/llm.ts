// Client minimaliste pour tout endpoint compatible OpenAI (chat/completions en streaming SSE).
// Gère les trois façons dont les modèles à raisonnement renvoient leur "réflexion" :
//   1. delta.reasoning           (OpenRouter)
//   2. delta.reasoning_content   (vLLM, SGLang, DeepSeek, Qwen…)
//   3. balises <think>…</think> incrustées dans delta.content (gateways qui ne
//      séparent pas le raisonnement — c'est ce qui cassait le parsing des jeux).

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "finish"; reason: string | null };

function config() {
  const baseUrl = process.env.OPENAI_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!baseUrl || !model) {
    throw new Error(
      "Configuration IA manquante : définissez OPENAI_BASE_URL et OPENAI_MODEL dans le fichier .env"
    );
  }
  return { baseUrl, apiKey, model };
}

// --- Séparation du raisonnement incrusté dans le contenu -------------------
// Certains serveurs renvoient la réflexion DANS delta.content, entre balises
// <think>…</think>. Ce splitter est stateful : une balise peut arriver coupée
// en deux chunks SSE, on retient donc tout suffixe qui pourrait en être le début.

const OPEN_TAGS = ["<think>", "<thinking>", "<thought>"];
const CLOSE_TAGS = ["</think>", "</thinking>", "</thought>"];

function longestTagPrefixAtEnd(s: string, tags: string[]): number {
  let best = 0;
  const lower = s.toLowerCase();
  for (const t of tags) {
    const max = Math.min(t.length - 1, s.length);
    for (let k = max; k > best; k--) {
      if (lower.endsWith(t.slice(0, k))) {
        best = k;
        break;
      }
    }
  }
  return best;
}

export class ThinkTagSplitter {
  private inThink = false;
  private pending = "";

  push(chunk: string): { text: string; reasoning: string } {
    let buf = this.pending + chunk;
    this.pending = "";
    let text = "";
    let reasoning = "";

    while (buf.length > 0) {
      const tags = this.inThink ? CLOSE_TAGS : OPEN_TAGS;
      const lower = buf.toLowerCase();
      let idx = -1;
      let tag = "";
      for (const t of tags) {
        const i = lower.indexOf(t);
        if (i !== -1 && (idx === -1 || i < idx)) {
          idx = i;
          tag = t;
        }
      }
      if (idx !== -1) {
        const before = buf.slice(0, idx);
        if (this.inThink) reasoning += before;
        else text += before;
        this.inThink = !this.inThink;
        buf = buf.slice(idx + tag.length);
        continue;
      }
      // Pas de balise complète : on émet tout sauf un éventuel début de balise
      // en fin de buffer (il sera complété par le chunk suivant).
      const hold = longestTagPrefixAtEnd(buf, tags);
      const out = buf.slice(0, buf.length - hold);
      if (this.inThink) reasoning += out;
      else text += out;
      this.pending = hold > 0 ? buf.slice(buf.length - hold) : "";
      buf = "";
    }
    return { text, reasoning };
  }

  flush(): { text: string; reasoning: string } {
    const out = this.pending;
    this.pending = "";
    return this.inThink ? { text: "", reasoning: out } : { text: out, reasoning: "" };
  }
}

// --- Paramètres de désactivation du raisonnement ---------------------------
// OPENAI_REASONING_EFFORT : none (désactivé) | low/medium/high | default (rien).
// Pour "none" on envoie À LA FOIS le format OpenRouter et le format vLLM/Qwen ;
// si le serveur rejette ces champs inconnus (HTTP 400/422), on retente sans.

function reasoningParams(baseUrl: string): Record<string, unknown> {
  const effort =
    process.env.OPENAI_REASONING_EFFORT?.toLowerCase() ||
    (baseUrl.includes("openrouter.ai") ? "none" : "default");
  if (effort === "default") return {};
  if (effort === "none" || effort === "off") {
    return {
      reasoning: { enabled: false }, // OpenRouter
      chat_template_kwargs: { enable_thinking: false }, // vLLM / SGLang (Qwen, GLM…)
    };
  }
  return { reasoning: { effort } };
}

/** Stream les deltas du modèle : réflexion (reasoning), texte, puis fin de stream. */
export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const { baseUrl, apiKey, model } = config();
  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS || 40000);
  const temperature = Number(process.env.OPENAI_TEMPERATURE || 0.6);

  const baseBody = {
    model,
    messages,
    stream: true,
    max_tokens: maxTokens,
    temperature,
  };
  const extras = reasoningParams(baseUrl);

  const doFetch = async (body: object) => {
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (signal?.aborted) throw err; // annulation : ne pas maquiller
      // "fetch failed" nu est inexploitable : on remonte l'URL et la cause
      // (ECONNREFUSED, ETIMEDOUT, ENOTFOUND…). Cas typique : gateway
      // universitaire joignable uniquement depuis le réseau de la fac / VPN.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code || cause?.message || (err instanceof Error ? err.message : "");
      throw new Error(
        `Impossible de joindre l'endpoint IA (${baseUrl})${detail ? ` : ${detail}` : ""}. ` +
          "Vérifie ta connexion réseau (VPN universitaire ?) et la variable OPENAI_BASE_URL."
      );
    }
  };

  let res = await doFetch({ ...baseBody, ...extras });
  // Champs de contrôle du raisonnement inconnus du serveur : on retente sans.
  if (!res.ok && Object.keys(extras).length > 0 && (res.status === 400 || res.status === 422)) {
    res = await doFetch(baseBody);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Erreur du modèle IA (HTTP ${res.status}) : ${detail.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const splitter = new ThinkTagSplitter();
  let buffer = "";
  let finishReason: string | null = null;

  const emitContent = function* (raw: string): Generator<StreamEvent> {
    const { text, reasoning } = splitter.push(raw);
    if (reasoning) yield { kind: "reasoning", text: reasoning };
    if (text) yield { kind: "text", text };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue; // ignore les keep-alive ": PROCESSING"
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        const rest = splitter.flush();
        if (rest.reasoning) yield { kind: "reasoning", text: rest.reasoning };
        if (rest.text) yield { kind: "text", text: rest.text };
        yield { kind: "finish", reason: finishReason };
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        const reasoningDelta =
          typeof delta?.reasoning === "string"
            ? delta.reasoning
            : typeof delta?.reasoning_content === "string"
              ? delta.reasoning_content
              : "";
        if (reasoningDelta) yield { kind: "reasoning", text: reasoningDelta };
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          yield* emitContent(delta.content);
        }
      } catch {
        // ligne SSE incomplète : ignorer
      }
    }
  }
  const rest = splitter.flush();
  if (rest.reasoning) yield { kind: "reasoning", text: rest.reasoning };
  if (rest.text) yield { kind: "text", text: rest.text };
  yield { kind: "finish", reason: finishReason };
}

/** Message d'erreur lisible quand la réponse a été coupée par le budget de tokens. */
export function truncationMessage(maxTokens?: number): string {
  const budget = maxTokens ?? Number(process.env.OPENAI_MAX_TOKENS || 40000);
  return (
    `la réponse a été coupée à la limite de ${budget} tokens avant la fin du jeu ` +
    "(le raisonnement du modèle consomme une partie de ce budget)"
  );
}
