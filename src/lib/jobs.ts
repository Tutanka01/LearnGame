// Runner de jobs de génération, in-process (un seul process Node en
// déploiement standalone). Singleton sur globalThis — même pattern que db.ts —
// pour survivre au rechargement de modules en dev (HMR) : jamais deux runners.
//
// Garanties :
//  - verrou serveur : un seul job actif par utilisateur ET par jeu ;
//  - chaque événement est persisté (generation_events) PUIS diffusé aux
//    abonnés avec le même seq : le live et le replay voient la même séquence ;
//  - les deltas reasoning/chunk sont coalescés (~150 ms ou 2 Ko) : ~10² INSERT
//    par génération au lieu de ~10⁴ ;
//  - la génération continue si tous les clients se déconnectent ; l'annulation
//    est une décision explicite (cancelJob) ;
//  - au redémarrage du serveur, les jobs « running » orphelins sont clôturés
//    en erreur (sweepStaleJobs) avec un événement final rejouable.

import { randomUUID } from "crypto";
import db, { User, addGameMessage, withTransaction } from "./db";
import { ApiError } from "./errors";
import { GEN_PROTOCOL_VERSION, GenEvent } from "./genEvents";
import { runGenerationJob, GenerationJobInput, GenerationOutcome } from "./generation";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type JobPayload =
  | { type: "create"; topic: string; difficulty: string }
  | { type: "edit"; gameId: string; feedback: string };

export interface JobRow {
  id: string;
  user_id: number;
  game_id: string | null;
  type: "create" | "edit";
  status: JobStatus;
  payload: string;
  result: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** Forme renvoyée au client (payload décodé, jamais de données internes). */
export interface PublicJob {
  id: string;
  type: "create" | "edit";
  status: JobStatus;
  gameId: string | null;
  label: string;
  createdAt: string;
  result: { gameId: string; title: string; version: number; summary: string } | null;
  error: string | null;
}

export function toPublicJob(row: JobRow): PublicJob {
  const payload = JSON.parse(row.payload) as JobPayload;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    gameId: row.game_id ?? (payload.type === "edit" ? payload.gameId : null),
    label: payload.type === "create" ? payload.topic : payload.feedback,
    createdAt: row.created_at,
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
  };
}

type Listener = (seq: number, event: GenEvent) => void;

interface RunningJob {
  abort: AbortController;
  listeners: Set<Listener>;
  lastSeq: number;
  pending: { type: "reasoning" | "chunk"; text: string } | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const COALESCE_MS = 150;
const COALESCE_BYTES = 2048;
const FINISHED_JOB_TTL_MS = 24 * 3600 * 1000;

class JobRunner {
  private running = new Map<string, RunningJob>();
  private swept = false;

  // --- Lecture ----------------------------------------------------------------

  getJob(id: string): JobRow | null {
    this.ensureSwept();
    const row = db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(id) as unknown as
      | JobRow
      | undefined;
    return row ?? null;
  }

  getActiveJobForUser(userId: number): JobRow | null {
    this.ensureSwept();
    const row = db
      .prepare(
        `SELECT * FROM generation_jobs
         WHERE user_id = ? AND status IN ('queued', 'running')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId) as unknown as JobRow | undefined;
    return row ?? null;
  }

  /** Dernier job terminé récemment : permet de raccrocher un `done` raté. */
  getRecentFinishedJob(userId: number, maxAgeMinutes = 5): JobRow | null {
    this.ensureSwept();
    const row = db
      .prepare(
        `SELECT * FROM generation_jobs
         WHERE user_id = ? AND status IN ('done', 'error')
           AND finished_at >= datetime('now', ?)
         ORDER BY finished_at DESC LIMIT 1`
      )
      .get(userId, `-${maxAgeMinutes} minutes`) as unknown as JobRow | undefined;
    return row ?? null;
  }

  // --- Création / exécution ----------------------------------------------------

  createJob(user: User, payload: JobPayload): JobRow {
    this.ensureSwept();
    this.gcOldJobs();
    const id = randomUUID();

    const job = withTransaction(() => {
      // Verrou serveur : un job actif par utilisateur…
      const activeUser = db
        .prepare(
          "SELECT id FROM generation_jobs WHERE user_id = ? AND status IN ('queued','running') LIMIT 1"
        )
        .get(user.id);
      if (activeUser) {
        throw new ApiError(409, "Une génération est déjà en cours pour ton compte.");
      }
      // … et par jeu (deux créateurs ne peuvent pas exister, mais deux onglets si).
      if (payload.type === "edit") {
        const activeGame = db
          .prepare(
            "SELECT id FROM generation_jobs WHERE game_id = ? AND status IN ('queued','running') LIMIT 1"
          )
          .get(payload.gameId);
        if (activeGame) {
          throw new ApiError(409, "Une génération est déjà en cours sur ce jeu.");
        }
        // La demande de l'élève est persistée IMMÉDIATEMENT : même si la
        // génération échoue ou est annulée, elle reste visible dans le chat.
        addGameMessage(payload.gameId, user.id, "user", payload.feedback, null, "chat", id);
      }

      db.prepare(
        `INSERT INTO generation_jobs (id, user_id, game_id, type, status, payload)
         VALUES (?, ?, ?, ?, 'queued', ?)`
      ).run(
        id,
        user.id,
        payload.type === "edit" ? payload.gameId : null,
        payload.type,
        JSON.stringify(payload)
      );
      return db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(id) as unknown as JobRow;
    });

    // Lancement DÉTACHÉ : la requête HTTP qui a créé le job peut se terminer,
    // la génération continue. Le catch interne de runJob ne laisse rien fuir.
    void this.runJob(id);
    return job;
  }

  private async runJob(id: string): Promise<void> {
    const job = this.getJob(id);
    if (!job || job.status !== "queued") return;

    const run: RunningJob = {
      abort: new AbortController(),
      listeners: new Set(),
      lastSeq: 0,
      pending: null,
      flushTimer: null,
    };
    this.running.set(id, run);
    db.prepare(
      "UPDATE generation_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?"
    ).run(id);

    const payload = JSON.parse(job.payload) as JobPayload;
    const input: GenerationJobInput = {
      id: job.id,
      userId: job.user_id,
      type: job.type,
      payload,
    };

    const emit = (e: GenEvent) => this.emit(id, run, e);
    let outcome: GenerationOutcome;
    try {
      emit({
        type: "init",
        v: GEN_PROTOCOL_VERSION,
        jobType: job.type,
        gameId: job.game_id,
        label: payload.type === "create" ? payload.topic : payload.feedback,
      });
      outcome = await runGenerationJob(input, emit, run.abort.signal);
    } catch (err) {
      // runGenerationJob ne jette jamais ; ceinture et bretelles.
      console.error("Erreur inattendue du job de génération :", err);
      outcome = run.abort.signal.aborted
        ? { kind: "cancelled" }
        : { kind: "error", message: err instanceof Error ? err.message : "Erreur inconnue." };
    }
    this.finalize(id, run, outcome);
  }

  /** Statut final + événement final persisté/diffusé + nettoyage mémoire. */
  private finalize(id: string, run: RunningJob | null, outcome: GenerationOutcome): void {
    if (run) this.flushPending(id, run);

    const finalEvent: GenEvent =
      outcome.kind === "done"
        ? {
            type: "done",
            gameId: outcome.gameId,
            title: outcome.title,
            version: outcome.version,
            summary: outcome.summary,
          }
        : outcome.kind === "cancelled"
          ? { type: "cancelled" }
          : { type: "error", message: outcome.message };

    db.prepare(
      `UPDATE generation_jobs SET status = ?, result = ?, error = ?, game_id = COALESCE(?, game_id),
       finished_at = datetime('now') WHERE id = ?`
    ).run(
      outcome.kind === "done" ? "done" : outcome.kind === "cancelled" ? "cancelled" : "error",
      outcome.kind === "done"
        ? JSON.stringify({
            gameId: outcome.gameId,
            title: outcome.title,
            version: outcome.version,
            summary: outcome.summary,
          })
        : null,
      outcome.kind === "error" ? outcome.message : null,
      outcome.kind === "done" ? outcome.gameId : null,
      id
    );

    if (run) {
      this.persistAndBroadcast(id, run, finalEvent);
      this.running.delete(id);
      run.listeners.clear();
    } else {
      // Finalisation sans handle (annulation après crash, sweep) : seq depuis la DB.
      const { maxSeq } = db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM generation_events WHERE job_id = ?")
        .get(id) as { maxSeq: number };
      this.insertEvent(id, maxSeq + 1, finalEvent);
    }
  }

  // --- Abonnement (SSE) ---------------------------------------------------------

  /**
   * Rejoue les événements persistés (seq > fromSeq) puis raccroche au flux
   * live, avec déduplication par seq : ni trou, ni doublon. Tout est synchrone
   * entre le replay et l'abonnement (pas d'await) — aucun événement ne peut
   * s'intercaler. Retourne la fonction de désabonnement.
   */
  subscribe(jobId: string, fromSeq: number, onEvent: Listener): () => void {
    this.ensureSwept();
    let last = fromSeq;
    const rows = db
      .prepare(
        "SELECT seq, data FROM generation_events WHERE job_id = ? AND seq > ? ORDER BY seq"
      )
      .all(jobId, fromSeq) as unknown as { seq: number; data: string }[];
    for (const row of rows) {
      last = row.seq;
      onEvent(row.seq, JSON.parse(row.data) as GenEvent);
    }

    const run = this.running.get(jobId);
    if (!run) return () => {};

    const wrapped: Listener = (seq, e) => {
      if (seq > last) {
        last = seq;
        onEvent(seq, e);
      }
    };
    run.listeners.add(wrapped);
    return () => run.listeners.delete(wrapped);
  }

  // --- Annulation -----------------------------------------------------------------

  /** Annule un job actif (créateur uniquement, vérifié par la route). */
  cancelJob(id: string): boolean {
    const job = this.getJob(id);
    if (!job || (job.status !== "running" && job.status !== "queued")) return false;
    const run = this.running.get(id);
    if (run) {
      // Le runner finalisera (statut + événement cancelled + flux fermés).
      run.abort.abort();
      return true;
    }
    // Aucun handle en mémoire (job hérité d'un crash) : finalisation directe.
    this.finalize(id, null, { kind: "cancelled" });
    return true;
  }

  // --- Émission interne (coalescence + persistance + diffusion) --------------------

  private emit(id: string, run: RunningJob, e: GenEvent): void {
    if (e.type === "reasoning" || e.type === "chunk") {
      if (run.pending && run.pending.type === e.type) {
        run.pending.text += e.text;
      } else {
        this.flushPending(id, run);
        run.pending = { type: e.type, text: e.text };
      }
      if (run.pending.text.length >= COALESCE_BYTES) {
        this.flushPending(id, run);
      } else if (!run.flushTimer) {
        run.flushTimer = setTimeout(() => this.flushPending(id, run), COALESCE_MS);
      }
      return;
    }
    // Événement structurel : tout delta en attente part d'abord (ordre préservé).
    this.flushPending(id, run);
    this.persistAndBroadcast(id, run, e);
  }

  private flushPending(id: string, run: RunningJob): void {
    if (run.flushTimer) {
      clearTimeout(run.flushTimer);
      run.flushTimer = null;
    }
    if (!run.pending) return;
    const e: GenEvent =
      run.pending.type === "reasoning"
        ? { type: "reasoning", text: run.pending.text }
        : { type: "chunk", text: run.pending.text };
    run.pending = null;
    this.persistAndBroadcast(id, run, e);
  }

  private persistAndBroadcast(id: string, run: RunningJob, e: GenEvent): void {
    const seq = ++run.lastSeq;
    this.insertEvent(id, seq, e);
    for (const listener of run.listeners) {
      try {
        listener(seq, e);
      } catch (err) {
        console.error("Un abonné SSE a jeté une exception (ignorée) :", err);
      }
    }
  }

  private insertEvent(id: string, seq: number, e: GenEvent): void {
    try {
      db.prepare("INSERT INTO generation_events (job_id, seq, data) VALUES (?, ?, ?)").run(
        id,
        seq,
        JSON.stringify(e)
      );
    } catch (err) {
      console.error("Persistance d'un événement de génération impossible :", err);
    }
  }

  // --- Entretien --------------------------------------------------------------------

  /**
   * Au premier accès après un démarrage : tout job queued/running sans handle
   * en mémoire vient d'un process précédent (crash, redémarrage) → clôturé en
   * erreur, avec un événement final pour débloquer les clients qui raccrochent.
   */
  private ensureSwept(): void {
    if (this.swept) return;
    this.swept = true;
    const stale = db
      .prepare("SELECT id, type, game_id FROM generation_jobs WHERE status IN ('queued','running')")
      .all() as unknown as { id: string; type: string; game_id: string | null }[];
    for (const job of stale) {
      if (this.running.has(job.id)) continue;
      this.finalize(job.id, null, {
        kind: "error",
        message: "Génération interrompue par un redémarrage du serveur. Relance ta demande.",
      });
      if (job.type === "edit" && job.game_id) {
        try {
          addGameMessage(
            job.game_id,
            null,
            "assistant",
            "Génération interrompue par un redémarrage du serveur — le jeu n'a pas été modifié.",
            null,
            "error",
            job.id
          );
        } catch {
          // le jeu a pu être supprimé entre-temps
        }
      }
    }
  }

  /** Purge les jobs terminés depuis plus de 24 h (événements en cascade). */
  private gcOldJobs(): void {
    db.prepare(
      `DELETE FROM generation_jobs
       WHERE status IN ('done', 'error', 'cancelled')
         AND finished_at < datetime('now', ?)`
    ).run(`-${Math.round(FINISHED_JOB_TTL_MS / 1000)} seconds`);
  }
}

// Singleton global : un seul runner par process, y compris à travers le HMR.
const globalForJobs = globalThis as unknown as { __lgJobs?: JobRunner };
export const jobRunner = (globalForJobs.__lgJobs ??= new JobRunner());
