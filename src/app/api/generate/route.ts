import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import db, { Game, archiveCurrentVersion, addGameMessage } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { streamChat, truncationMessage, ChatMessage } from "@/lib/llm";
import {
  GAME_SYSTEM_PROMPT,
  EDIT_SYSTEM_PROMPT,
  EDIT_FORMAT_REMINDER,
  buildGenerationPrompt,
  buildImprovementPrompt,
  buildEditPrompt,
  buildEditFailureFeedback,
  buildEditValidationFeedback,
  extractHtml,
  extractTitle,
  normalizeGameHtml,
} from "@/lib/prompts";
import { parseEditResponse, applyOps } from "@/lib/editor";
import { validateGameHtml } from "@/lib/validate";

export const maxDuration = 600;

const DIFFICULTIES = new Set(["débutant", "intermédiaire", "avancé"]);

type Send = (event: object) => void;

/**
 * Session d'édition agentique : le modèle émet des opérations CHERCHER/REMPLACER,
 * le serveur les applique et lui rapporte précisément chaque échec (ancre
 * introuvable, ambiguë, jeu devenu invalide…) pour qu'il corrige. Jusqu'à
 * 3 tours. Retourne null si la session n'aboutit pas (→ repli en régénération).
 */
async function runEditSession(
  existing: Game,
  feedback: string,
  send: Send,
  signal: AbortSignal
): Promise<{ html: string; summary: string } | null> {
  let current = existing.html;
  const conv: ChatMessage[] = [
    { role: "system", content: EDIT_SYSTEM_PROMPT },
    { role: "user", content: buildEditPrompt(existing.topic, current, feedback) },
  ];
  let summary = "";
  const MAX_ROUNDS = 3;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    send({
      type: "status",
      message:
        round === 1
          ? "Le modèle lit le jeu et prépare des modifications ciblées…"
          : `Échange ${round}/${MAX_ROUNDS} — le modèle corrige ses modifications…`,
    });

    let raw = "";
    try {
      for await (const event of streamChat(conv, signal)) {
        if (event.kind === "reasoning") send({ type: "reasoning", text: event.text });
        else if (event.kind === "text") {
          raw += event.text;
          send({ type: "chunk", text: event.text });
        }
      }
    } catch (err) {
      if (signal.aborted) throw err;
      return null; // erreur modèle/réseau : on repartira en régénération complète
    }

    send({ type: "phase", phase: "validating" });
    const parsed = parseEditResponse(raw);
    if (parsed.summary) summary = parsed.summary;

    // Cas exceptionnel : le modèle a choisi la refonte complète.
    if (parsed.rewriteHtml) {
      const html = normalizeGameHtml(parsed.rewriteHtml);
      const problem = validateGameHtml(html);
      if (!problem) return { html, summary };
      conv.push(
        { role: "assistant", content: raw },
        { role: "user", content: buildEditValidationFeedback(problem) }
      );
      continue;
    }

    if (parsed.ops.length === 0) {
      conv.push({ role: "assistant", content: raw }, { role: "user", content: EDIT_FORMAT_REMINDER });
      continue;
    }

    send({
      type: "status",
      message: `🔧 Application de ${parsed.ops.length} modification${parsed.ops.length > 1 ? "s" : ""}…`,
    });
    const result = applyOps(current, parsed.ops);
    current = result.html;

    if (result.failures.length > 0) {
      send({
        type: "status",
        message: `${result.applied} modification${result.applied > 1 ? "s" : ""} appliquée${result.applied > 1 ? "s" : ""}, ${result.failures.length} à corriger…`,
      });
      conv.push(
        { role: "assistant", content: raw },
        { role: "user", content: buildEditFailureFeedback(result.failures, result.applied) }
      );
      continue;
    }

    const html = normalizeGameHtml(current);
    const problem = validateGameHtml(html);
    if (!problem) return { html, summary };

    send({ type: "status", message: `Le jeu modifié est invalide (${problem}), correction…` });
    conv.push(
      { role: "assistant", content: raw },
      { role: "user", content: buildEditValidationFeedback(problem) }
    );
  }
  return null;
}

// Flux SSE : {type:"status"|"phase"|"reasoning"|"chunk"|"reset"|"done"|"error", ...}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Non connecté." }), { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 500) : "";
  const difficulty = DIFFICULTIES.has(body.difficulty) ? body.difficulty : "intermédiaire";
  const gameId = typeof body.gameId === "string" ? body.gameId : null;
  const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 1000) : "";

  let existing: Game | null = null;
  if (gameId) {
    existing = (db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as unknown as Game) ?? null;
    if (!existing) {
      return new Response(JSON.stringify({ error: "Jeu introuvable." }), { status: 404 });
    }
    if (!feedback) {
      return new Response(JSON.stringify({ error: "Décris l'amélioration souhaitée." }), { status: 400 });
    }
  } else if (topic.length < 3) {
    return new Response(JSON.stringify({ error: "Décris ce que tu veux apprendre (au moins 3 caractères)." }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (event) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      const saveImprovement = (game: Game, html: string, summary: string) => {
        const title = extractTitle(html, game.title);
        const newVersion = game.version + 1;
        archiveCurrentVersion(game.id);
        db.prepare(
          "UPDATE games SET html = ?, title = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?"
        ).run(html, title, game.id);
        addGameMessage(game.id, user.id, "user", feedback);
        addGameMessage(
          game.id,
          null,
          "assistant",
          summary ||
            `C'est fait ! J'ai mis à jour « ${title} » selon ta demande. Teste le résultat à droite — et dis-moi si tu veux ajuster autre chose.`,
          newVersion
        );
        send({ type: "done", id: game.id, title, version: newVersion });
      };

      try {
        // ====================== Amélioration : édition ciblée ======================
        if (existing) {
          send({ type: "status", message: "Amélioration du jeu en cours…" });
          const edited = await runEditSession(existing, feedback, send, req.signal);
          if (edited) {
            saveImprovement(existing, edited.html, edited.summary);
            controller.close();
            return;
          }
          send({
            type: "status",
            message: "Les modifications ciblées ont échoué — régénération complète du jeu…",
          });
          send({ type: "reset" });
        } else {
          send({ type: "status", message: "Conception du jeu en cours…" });
        }

        // ============ Création (et repli d'amélioration) : jeu complet =============
        const messages: ChatMessage[] = [
          { role: "system", content: GAME_SYSTEM_PROMPT },
          {
            role: "user",
            content: existing
              ? buildImprovementPrompt(existing.topic, existing.html, feedback)
              : buildGenerationPrompt(topic, difficulty),
          },
        ];

        // Jusqu'à 3 tentatives : un jeu invalide (réponse tronquée, erreur de
        // syntaxe JS, hors format…) n'atteint JAMAIS la base. À chaque relance,
        // on indique au modèle la raison précise du rejet précédent.
        const MAX_ATTEMPTS = 3;
        let html: string | null = null;
        let lastError = "";
        let wasTruncated = false;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !html; attempt++) {
          if (attempt > 1) {
            send({
              type: "status",
              message: `Tentative ${attempt}/${MAX_ATTEMPTS} — la réponse précédente était invalide (${lastError}).`,
            });
            send({ type: "reset" });
          }
          const attemptMessages: ChatMessage[] = lastError
            ? [
                messages[0],
                {
                  role: "user",
                  content:
                    `${messages[1].content}\n\nATTENTION : ta tentative précédente a été rejetée car ${lastError}. ` +
                    "Renvoie cette fois un document HTML COMPLET et valide, du <!DOCTYPE html> jusqu'au </html> final, sans aucune erreur de syntaxe JavaScript." +
                    (wasTruncated
                      ? " Sois nettement plus COMPACT : 4 niveaux maximum, code dense, pas de commentaires superflus, pour tenir dans le budget de tokens."
                      : ""),
                },
              ]
            : messages;

          let raw = "";
          let finishReason: string | null = null;
          let streamError = "";
          try {
            for await (const event of streamChat(attemptMessages, req.signal)) {
              if (event.kind === "reasoning") {
                send({ type: "reasoning", text: event.text });
              } else if (event.kind === "text") {
                raw += event.text;
                send({ type: "chunk", text: event.text });
              } else {
                finishReason = event.reason;
              }
            }
          } catch (err) {
            if (req.signal.aborted) throw err;
            streamError = err instanceof Error ? err.message : "erreur du modèle";
          }

          send({ type: "phase", phase: "validating" });
          send({ type: "status", message: "Vérification du code du jeu…" });

          // Même si le stream s'est mal terminé (coupure réseau, troncature),
          // on tente d'extraire un document complet de ce qu'on a reçu.
          html = extractHtml(raw);
          if (!html) {
            wasTruncated = finishReason === "length";
            lastError =
              streamError ||
              (wasTruncated
                ? truncationMessage()
                : "le modèle n'a pas renvoyé un document HTML complet (réponse tronquée ou hors format)");
            if (streamError && attempt === MAX_ATTEMPTS) {
              throw new Error(streamError);
            }
            continue;
          }
          html = normalizeGameHtml(html);
          const problem = validateGameHtml(html);
          if (problem) {
            lastError = problem;
            wasTruncated = false;
            html = null;
          }
        }

        if (!html) {
          send({
            type: "error",
            message: `Le modèle n'a pas réussi à produire un jeu valide (${lastError}). Réessaie, ou reformule ta demande.`,
          });
          controller.close();
          return;
        }

        if (existing) {
          saveImprovement(existing, html, "");
        } else {
          const title = extractTitle(html, topic);
          const id = randomUUID();
          db.prepare(
            "INSERT INTO games (id, user_id, topic, difficulty, title, html) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(id, user.id, topic, difficulty, title, html);
          addGameMessage(id, user.id, "user", topic);
          addGameMessage(
            id,
            null,
            "assistant",
            `J'ai créé « ${title} », un jeu ${difficulty} sur ce sujet. Joue-le à droite, puis dis-moi ce que tu veux améliorer : ajouter un niveau, changer la difficulté, corriger quelque chose…`,
            1
          );
          send({ type: "done", id, title, version: 1 });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur inconnue.";
        try {
          send({ type: "error", message });
        } catch {
          // le client a fermé la connexion
        }
      } finally {
        try {
          controller.close();
        } catch {
          // déjà fermé
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
