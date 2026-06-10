// Client minimaliste pour tout endpoint compatible OpenAI (chat/completions en streaming SSE).
// Gère aussi les modèles à raisonnement (OpenRouter : delta.reasoning) qui "réfléchissent"
// avant d'écrire — sinon l'interface semble figée pendant de longues secondes.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string };

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

/** Stream les deltas du modèle : réflexion (reasoning) puis texte final. */
export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const { baseUrl, apiKey, model } = config();
  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS || 40000);

  // Contrôle du raisonnement (les modèles type DeepSeek/Gemini peuvent
  // "réfléchir" plusieurs minutes sinon — DeepSeek ignore même l'effort "low").
  // none = désactivé (rapide, recommandé) | low/medium/high = effort limité |
  // default = ne pas envoyer le paramètre (endpoints non-OpenRouter qui le refusent).
  const effort =
    process.env.OPENAI_REASONING_EFFORT?.toLowerCase() ||
    (baseUrl.includes("openrouter.ai") ? "none" : "default");
  const reasoningParam =
    effort === "default"
      ? {}
      : effort === "none" || effort === "off"
        ? { reasoning: { enabled: false } }
        : { reasoning: { effort } };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: maxTokens,
      temperature: 0.7,
      ...reasoningParam,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Erreur du modèle IA (HTTP ${res.status}) : ${detail.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason: string | null = null;

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
        assertNotTruncated(finishReason, maxTokens);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        if (typeof delta?.reasoning === "string" && delta.reasoning.length > 0) {
          yield { kind: "reasoning", text: delta.reasoning };
        }
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          yield { kind: "text", text: delta.content };
        }
      } catch {
        // ligne SSE incomplète : ignorer
      }
    }
  }
  assertNotTruncated(finishReason, maxTokens);
}

function assertNotTruncated(finishReason: string | null, maxTokens: number) {
  if (finishReason === "length") {
    throw new Error(
      `Le modèle a atteint sa limite de ${maxTokens} tokens avant de finir le jeu. ` +
        "Augmentez OPENAI_MAX_TOKENS dans .env, ou choisissez un modèle avec un budget de sortie plus grand."
    );
  }
}
