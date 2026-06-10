import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import db, { Game } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { streamChat, ChatMessage } from "@/lib/llm";
import {
  GAME_SYSTEM_PROMPT,
  buildGenerationPrompt,
  buildImprovementPrompt,
  extractHtml,
  extractTitle,
} from "@/lib/prompts";
import { validateGameHtml } from "@/lib/validate";

export const maxDuration = 600;

const DIFFICULTIES = new Set(["débutant", "intermédiaire", "avancé"]);

// Flux SSE : {type:"status"|"chunk"|"done"|"error", ...}
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

  const messages: ChatMessage[] = [
    { role: "system", content: GAME_SYSTEM_PROMPT },
    {
      role: "user",
      content: existing
        ? buildImprovementPrompt(existing.topic, existing.html, feedback)
        : buildGenerationPrompt(topic, difficulty),
    },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        send({
          type: "status",
          message: existing ? "Amélioration du jeu en cours…" : "Conception du jeu en cours…",
        });

        // Jusqu'à 3 tentatives : un jeu invalide (réponse tronquée, erreur de
        // syntaxe JS, hors format…) n'atteint JAMAIS la base. À chaque relance,
        // on indique au modèle la raison précise du rejet précédent.
        const MAX_ATTEMPTS = 3;
        let html: string | null = null;
        let lastError = "";

        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !html; attempt++) {
          if (attempt > 1) {
            send({
              type: "status",
              message: `La réponse précédente était invalide (${lastError}), nouvelle tentative…`,
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
                    "Renvoie cette fois un document HTML COMPLET et valide, du <!DOCTYPE html> jusqu'au </html> final, sans aucune erreur de syntaxe JavaScript.",
                },
              ]
            : messages;
          let raw = "";
          try {
            for await (const event of streamChat(attemptMessages, req.signal)) {
              if (event.kind === "reasoning") {
                send({ type: "reasoning", text: event.text });
              } else {
                raw += event.text;
                send({ type: "chunk", text: event.text });
              }
            }
          } catch (err) {
            if (req.signal.aborted) throw err;
            lastError = err instanceof Error ? err.message : "erreur du modèle";
            if (attempt === MAX_ATTEMPTS) throw err;
            continue;
          }
          html = extractHtml(raw);
          if (!html) {
            lastError = "le modèle n'a pas renvoyé un document HTML complet (réponse tronquée ou hors format)";
            continue;
          }
          const problem = validateGameHtml(html);
          if (problem) {
            lastError = problem;
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

        const title = extractTitle(html, existing ? existing.title : topic);
        let id: string;
        if (existing) {
          id = existing.id;
          db.prepare(
            "UPDATE games SET html = ?, title = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?"
          ).run(html, title, id);
        } else {
          id = randomUUID();
          db.prepare(
            "INSERT INTO games (id, user_id, topic, difficulty, title, html) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(id, user.id, topic, difficulty, title, html);
        }

        send({ type: "done", id, title });
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
