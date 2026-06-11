// Cœur de la génération de jeux, indépendant de HTTP : exécuté par le job
// runner (src/lib/jobs.ts), il émet des GenEvent via `emit` (qui ne jette
// JAMAIS — la disparition du client ne tue pas la génération, c'est le but)
// et écrit en base sous transaction. Extrait de l'ancienne route /api/generate.

import { randomUUID } from "crypto";
import db, { Game, addGameMessage, archiveCurrentVersion, withTransaction } from "./db";
import { streamChat, truncationMessage, ChatMessage } from "./llm";
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
} from "./prompts";
import { parseEditResponse, applyOps } from "./editor";
import { validateGameHtml } from "./validate";
import type { GenEvent, GenPhase } from "./genEvents";

export type Emit = (e: GenEvent) => void;

/** Ce que generation.ts a besoin de savoir d'un job (évite un import circulaire avec jobs.ts). */
export interface GenerationJobInput {
  id: string;
  userId: number;
  type: "create" | "edit";
  payload:
    | { type: "create"; topic: string; difficulty: string }
    | { type: "edit"; gameId: string; feedback: string };
}

export type GenerationOutcome =
  | { kind: "done"; gameId: string; title: string; version: number; summary: string }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

/**
 * Session d'édition agentique : le modèle émet des opérations CHERCHER/REMPLACER,
 * le serveur les applique et lui rapporte précisément chaque échec (ancre
 * introuvable, ambiguë, jeu devenu invalide…) pour qu'il corrige. Jusqu'à
 * 3 tours. Retourne null si la session n'aboutit pas (→ repli en régénération).
 */
async function runEditSession(
  existing: Game,
  feedback: string,
  emit: Emit,
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
    // Chaque tour repart en "thinking" : le client n'a plus rien à deviner.
    emit({ type: "phase", phase: "thinking", round });
    emit({
      type: "status",
      message:
        round === 1
          ? "Le modèle lit le jeu et prépare des modifications ciblées…"
          : `Échange ${round}/${MAX_ROUNDS} — le modèle corrige ses modifications…`,
    });

    let raw = "";
    let phase: GenPhase = "thinking";
    try {
      for await (const event of streamChat(conv, signal)) {
        if (event.kind === "reasoning") {
          emit({ type: "reasoning", text: event.text });
        } else if (event.kind === "text") {
          if (phase !== "coding") {
            phase = "coding";
            emit({ type: "phase", phase: "coding", round });
          }
          raw += event.text;
          emit({ type: "chunk", text: event.text });
        }
      }
    } catch (err) {
      if (signal.aborted) throw err;
      return null; // erreur modèle/réseau : on repartira en régénération complète
    }

    const parsed = parseEditResponse(raw);
    if (parsed.summary) summary = parsed.summary;

    // Cas exceptionnel : le modèle a choisi la refonte complète.
    if (parsed.rewriteHtml) {
      emit({ type: "phase", phase: "validating", round });
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

    emit({ type: "phase", phase: "applying", round });
    emit({
      type: "status",
      message: `Application de ${parsed.ops.length} modification${parsed.ops.length > 1 ? "s" : ""}…`,
    });
    const result = applyOps(current, parsed.ops);
    current = result.html;

    if (result.failures.length > 0) {
      emit({
        type: "status",
        message: `${result.applied} modification${result.applied > 1 ? "s" : ""} appliquée${result.applied > 1 ? "s" : ""}, ${result.failures.length} à corriger…`,
      });
      conv.push(
        { role: "assistant", content: raw },
        { role: "user", content: buildEditFailureFeedback(result.failures, result.applied) }
      );
      continue;
    }

    emit({ type: "phase", phase: "validating", round });
    const html = normalizeGameHtml(current);
    const problem = validateGameHtml(html);
    if (!problem) return { html, summary };

    emit({ type: "status", message: `Le jeu modifié est invalide (${problem}), correction…` });
    conv.push(
      { role: "assistant", content: raw },
      { role: "user", content: buildEditValidationFeedback(problem) }
    );
  }
  return null;
}

/**
 * Création d'un jeu complet (et repli d'une édition échouée) : jusqu'à
 * 3 tentatives — un jeu invalide n'atteint JAMAIS la base. À chaque relance,
 * la raison précise du rejet est renvoyée au modèle.
 */
async function runCreateFlow(
  emit: Emit,
  signal: AbortSignal,
  prompt: string
): Promise<{ html: string } | { error: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: GAME_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  const MAX_ATTEMPTS = 3;
  let html: string | null = null;
  let lastError = "";
  let wasTruncated = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !html; attempt++) {
    if (attempt > 1) {
      emit({
        type: "attempt",
        attempt,
        reason: `Tentative ${attempt}/${MAX_ATTEMPTS} — la réponse précédente était invalide (${lastError}).`,
      });
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
    let phase: GenPhase = "connect";
    try {
      for await (const event of streamChat(attemptMessages, signal)) {
        if (event.kind === "reasoning") {
          if (phase === "connect") {
            phase = "thinking";
            emit({ type: "phase", phase: "thinking" });
          }
          emit({ type: "reasoning", text: event.text });
        } else if (event.kind === "text") {
          if (phase !== "coding") {
            phase = "coding";
            emit({ type: "phase", phase: "coding" });
          }
          raw += event.text;
          emit({ type: "chunk", text: event.text });
        } else {
          finishReason = event.reason;
        }
      }
    } catch (err) {
      if (signal.aborted) throw err;
      streamError = err instanceof Error ? err.message : "erreur du modèle";
    }

    emit({ type: "phase", phase: "validating" });
    emit({ type: "status", message: "Vérification du code du jeu…" });

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
        return { error: streamError };
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
    return {
      error: `Le modèle n'a pas réussi à produire un jeu valide (${lastError}). Réessaie, ou reformule ta demande.`,
    };
  }
  return { html };
}

/**
 * Sauvegarde transactionnelle d'une amélioration : la version est RELUE sous
 * le verrou d'écriture (la génération a pu durer des minutes, une restauration
 * concurrente a pu passer) — le mapping message ↔ version reste exact.
 * NB : le message *utilisateur* a déjà été persisté à la création du job.
 */
function saveImprovement(
  game: Game,
  html: string,
  summary: string,
  jobId: string
): { title: string; version: number; summary: string } {
  const title = extractTitle(html, game.title);
  const finalSummary =
    summary ||
    `C'est fait ! J'ai mis à jour « ${title} » selon ta demande. Teste le résultat à droite — et dis-moi si tu veux ajuster autre chose.`;
  const version = withTransaction(() => {
    const fresh = db.prepare("SELECT version FROM games WHERE id = ?").get(game.id) as
      | { version: number }
      | undefined;
    if (!fresh) throw new Error("Le jeu a été supprimé pendant la génération.");
    archiveCurrentVersion(game.id);
    const v = fresh.version + 1;
    db.prepare(
      `UPDATE games SET html = ?, title = ?, version = ?, change_summary = ?,
       updated_at = datetime('now') WHERE id = ?`
    ).run(html, title, v, summary || "Amélioration demandée par le créateur.", game.id);
    addGameMessage(game.id, null, "assistant", finalSummary, v, "chat", jobId);
    return v;
  });
  return { title, version, summary: finalSummary };
}

/** Création transactionnelle d'un nouveau jeu + messages initiaux du chat. */
function saveCreation(
  userId: number,
  topic: string,
  difficulty: string,
  html: string,
  jobId: string
): { gameId: string; title: string; version: number; summary: string } {
  const title = extractTitle(html, topic);
  const summary = `J'ai créé « ${title} », un jeu ${difficulty} sur ce sujet. Joue-le à droite, puis dis-moi ce que tu veux améliorer : ajouter un niveau, changer la difficulté, corriger quelque chose…`;
  const gameId = randomUUID();
  withTransaction(() => {
    db.prepare(
      "INSERT INTO games (id, user_id, topic, difficulty, title, html, change_summary) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(gameId, userId, topic, difficulty, title, html, "Création du jeu.");
    addGameMessage(gameId, userId, "user", topic, null, "chat", jobId);
    addGameMessage(gameId, null, "assistant", summary, 1, "chat", jobId);
  });
  return { gameId, title, version: 1, summary };
}

/**
 * Exécute un job de bout en bout. Ne jette jamais : retourne toujours un
 * GenerationOutcome (le runner persiste le statut et émet l'événement final).
 * Sur échec/annulation d'une édition, un message assistant kind='error' ou
 * 'cancelled' est persisté dans le chat — la demande reste visible après refresh.
 */
export async function runGenerationJob(
  job: GenerationJobInput,
  emit: Emit,
  signal: AbortSignal
): Promise<GenerationOutcome> {
  const editGameId = job.payload.type === "edit" ? job.payload.gameId : null;

  const persistFailureMessage = (kind: "error" | "cancelled", message: string) => {
    if (!editGameId) return; // en création, il n'y a pas (encore) de chat
    try {
      addGameMessage(editGameId, null, "assistant", message, null, kind, job.id);
    } catch (err) {
      console.error("Impossible de consigner l'échec dans le chat :", err);
    }
  };

  try {
    // ====================== Amélioration : édition ciblée ======================
    if (job.payload.type === "edit") {
      const game = db.prepare("SELECT * FROM games WHERE id = ?").get(job.payload.gameId) as
        | Game
        | undefined;
      if (!game) return { kind: "error", message: "Jeu introuvable." };

      emit({ type: "status", message: "Amélioration du jeu en cours…" });
      const edited = await runEditSession(game, job.payload.feedback, emit, signal);
      if (edited) {
        const saved = saveImprovement(game, edited.html, edited.summary, job.id);
        return { kind: "done", gameId: game.id, ...saved };
      }

      // Repli : régénération complète. Le client bascule en mode create
      // (aperçu live pertinent) grâce à l'événement `mode`.
      emit({
        type: "status",
        message: "Les modifications ciblées ont échoué — régénération complète du jeu…",
      });
      emit({ type: "mode", mode: "create" });
      const result = await runCreateFlow(
        emit,
        signal,
        buildImprovementPrompt(game.topic, game.html, job.payload.feedback)
      );
      if ("error" in result) {
        persistFailureMessage("error", `La génération a échoué : ${result.error}`);
        return { kind: "error", message: result.error };
      }
      const saved = saveImprovement(game, result.html, "", job.id);
      return { kind: "done", gameId: game.id, ...saved };
    }

    // ============================== Création ====================================
    emit({ type: "status", message: "Conception du jeu en cours…" });
    const result = await runCreateFlow(
      emit,
      signal,
      buildGenerationPrompt(job.payload.topic, job.payload.difficulty)
    );
    if ("error" in result) return { kind: "error", message: result.error };
    const saved = saveCreation(
      job.userId,
      job.payload.topic,
      job.payload.difficulty,
      result.html,
      job.id
    );
    return { kind: "done", ...saved };
  } catch (err) {
    if (signal.aborted) {
      persistFailureMessage("cancelled", "Génération annulée — le jeu n'a pas été modifié.");
      return { kind: "cancelled" };
    }
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    persistFailureMessage("error", `La génération a échoué : ${message}`);
    return { kind: "error", message };
  }
}
