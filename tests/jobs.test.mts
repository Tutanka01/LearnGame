// Test de bout en bout du runner de jobs (jobs.ts + generation.ts) avec un
// mock LLM SSE local — sans Next, sans navigateur.
// IMPORTANT : à exécuter depuis un répertoire temporaire (base fraîche) :
//   cd "$(mktemp -d)" && npx -y tsx /chemin/du/projet/tests/jobs.test.ts

import http from "http";
import path from "path";
import fs from "fs";
import type { GenEvent } from "../src/lib/genEvents";

if (fs.existsSync(path.join(process.cwd(), "data", "learngame.db"))) {
  console.error("Refus : une base existe déjà ici. Lancer depuis un répertoire temporaire vide.");
  process.exit(1);
}

// --- Mock LLM : endpoint OpenAI-compatible en SSE ---------------------------------

const GAME_HTML = `<!DOCTYPE html>
<html>
<head><title>Jeu Test TCP</title></head>
<body>
<button id="b">OK</button>
<script>
const total = 3;
function fin(){ parent.postMessage({type:"learngame:complete", score: 3, maxScore: total}, "*"); }
</script>
</body>
</html>`;

const EDIT_RESPONSE = `RÉSUMÉ : J'ai renommé le bouton principal.

<<<<<<< CHERCHER
<button id="b">OK</button>
=======
<button id="b">Allez !</button>
>>>>>>> REMPLACER
`;

let requestCount = 0;
let slowMode = false; // pour le test d'annulation : réponse qui ne finit jamais

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requestCount++;
    const isEdit = body.includes("CHERCHER");
    res.writeHead(200, { "Content-Type": "text/event-stream" });

    const sse = (delta: object) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);

    if (slowMode) {
      // Un chunk puis silence : le test annule le job pendant ce silence.
      sse({ reasoning_content: "hmm…" });
      return; // la connexion reste ouverte jusqu'à l'abort du client
    }

    const text = isEdit ? EDIT_RESPONSE : GAME_HTML;
    sse({ reasoning_content: "Je conçois le jeu…" });
    // Découpe en morceaux pour streamer comme un vrai modèle.
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += 80) parts.push(text.slice(i, i + 80));
    let i = 0;
    const timer = setInterval(() => {
      if (i < parts.length) {
        sse({ content: parts[i++] });
      } else {
        clearInterval(timer);
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }, 15);
    // NB : sur IncomingMessage, "close" fire dès la fin du corps — c'est la
    // RÉPONSE qu'il faut surveiller pour détecter une déconnexion du client.
    res.on("close", () => clearInterval(timer));
  });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.OPENAI_MODEL = "mock";
process.env.OPENAI_REASONING_EFFORT = "default";

// --- Imports après la config (db paresseuse, llm lit l'env à l'appel) --------------

const { default: db } = await import("../src/lib/db");
const { jobRunner } = await import("../src/lib/jobs");
type CapturedEvent = { seq: number; event: GenEvent };

let failures = 0;
function assert(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`✗ ${name}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

/** S'abonne et résout à l'événement terminal (avec tous les événements reçus). */
function collectUntilTerminal(jobId: string, fromSeq = 0): Promise<CapturedEvent[]> {
  return new Promise((resolve, reject) => {
    const events: CapturedEvent[] = [];
    let finished = false;
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => reject(new Error(`timeout sur le job ${jobId}`)), 15_000);
    // L'événement terminal peut arriver PENDANT le replay synchrone de
    // subscribe() : unsubscribe n'est pas encore affecté à ce moment-là.
    unsubscribe = jobRunner.subscribe(jobId, fromSeq, (seq, event) => {
      if (process.env.DEBUG_JOBS) console.log(`   [${jobId.slice(0, 8)}] seq ${seq} : ${event.type}`);
      events.push({ seq, event });
      if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
        finished = true;
        clearTimeout(timeout);
        unsubscribe?.();
        resolve(events);
      }
    });
    if (finished) unsubscribe();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Données -----------------------------------------------------------------------

db.prepare("INSERT INTO users (username, password_hash) VALUES ('test', 'x:y')").run();
const user = db.prepare("SELECT * FROM users WHERE username = 'test'").get() as never;

// ====================== 1. Création : flux complet + reprise =========================

const createJob = jobRunner.createJob(user, {
  type: "create",
  topic: "Le protocole TCP/IP",
  difficulty: "débutant",
});
assert("création : job en file", createJob.status === "queued" || createJob.status === "running");

const livePromise = collectUntilTerminal(createJob.id, 0);
await sleep(120); // laisse passer quelques événements puis « se reconnecte »
const resumed = collectUntilTerminal(createJob.id, 2); // reprise depuis seq 2
const live = await livePromise;
const resumedEvents = await resumed;

const seqs = live.map((e) => e.seq);
assert(
  "live : seq strictement croissants sans trou (1..N)",
  seqs.every((s, i) => s === i + 1)
);
const finalLive = live[live.length - 1].event;
assert("live : se termine par done", finalLive.type === "done");

const liveBySeq = new Map(live.map((e) => [e.seq, JSON.stringify(e.event)]));
assert(
  "reprise depuis seq 2 : mêmes événements, ni trou ni doublon",
  resumedEvents.length === live.length - 2 &&
    resumedEvents.every((e, i) => e.seq === i + 3 && liveBySeq.get(e.seq) === JSON.stringify(e.event))
);

const doneEvent = finalLive as Extract<GenEvent, { type: "done" }>;
const game = db.prepare("SELECT * FROM games WHERE id = ?").get(doneEvent.gameId) as {
  id: string;
  title: string;
  version: number;
  html: string;
} | null;
assert("le jeu est en base, v1, titre extrait", game !== null && game.version === 1 && game.title === "Jeu Test TCP");
const jobRow = jobRunner.getJob(createJob.id);
assert("job done avec result", jobRow?.status === "done" && jobRow.result !== null);
const persisted = db
  .prepare("SELECT COUNT(*) AS n, MAX(seq) AS m FROM generation_events WHERE job_id = ?")
  .get(createJob.id) as { n: number; m: number };
assert("événements persistés = diffusés", persisted.n === live.length && persisted.m === live.length);

// Reconnexion APRÈS la fin : tout l'historique est rejouable (run = null).
const replayAfter = await new Promise<CapturedEvent[]>((resolve) => {
  const events: CapturedEvent[] = [];
  jobRunner.subscribe(createJob.id, 0, (seq, event) => {
    events.push({ seq, event });
    if (event.type === "done") resolve(events);
  });
});
assert("replay post-mortem complet", replayAfter.length === live.length);

// ====================== 2. Édition : message persisté, version 2 =====================

const editJob = jobRunner.createJob(user, {
  type: "edit",
  gameId: doneEvent.gameId,
  feedback: "Renomme le bouton, s'il te plaît !",
});
const userMsg = db
  .prepare("SELECT * FROM game_messages WHERE job_id = ? AND role = 'user'")
  .get(editJob.id) as { content: string; kind: string } | null;
assert(
  "édition : demande persistée dès la création du job",
  userMsg !== null && userMsg.kind === "chat" && userMsg.content.includes("Renomme")
);

// Verrou : un second job pendant le premier doit être refusé.
let lockError = "";
try {
  jobRunner.createJob(user, { type: "create", topic: "Autre sujet", difficulty: "avancé" });
} catch (err) {
  lockError = err instanceof Error ? err.message : "";
}
assert("verrou serveur : 2e job refusé pendant le 1er", lockError.includes("déjà en cours"));

const editEvents = await collectUntilTerminal(editJob.id, 0);
const editDone = editEvents[editEvents.length - 1].event as Extract<GenEvent, { type: "done" }>;
assert("édition : done v2 avec résumé", editDone.version === 2 && editDone.summary.includes("renommé"));
const after = db.prepare("SELECT html, version, change_summary FROM games WHERE id = ?").get(doneEvent.gameId) as {
  html: string;
  version: number;
  change_summary: string;
};
assert("édition : op appliquée au HTML", after.html.includes("Allez !") && after.version === 2);
const archive = db
  .prepare("SELECT version, summary FROM game_versions WHERE game_id = ?")
  .get(doneEvent.gameId) as { version: number; summary: string };
assert("édition : v1 archivée avec le summary de création", archive.version === 1 && archive.summary === "Création du jeu.");
const phases = editEvents.filter((e) => e.event.type === "phase").map((e) => (e.event as { phase: string }).phase);
assert(
  "édition : phases serveur thinking → coding → applying → validating",
  JSON.stringify(phases) === JSON.stringify(["thinking", "coding", "applying", "validating"])
);

// ====================== 3. Annulation en plein stream ================================

slowMode = true;
const cancelJobRow = jobRunner.createJob(user, {
  type: "edit",
  gameId: doneEvent.gameId,
  feedback: "Une demande qui sera annulée.",
});
const cancelPromise = collectUntilTerminal(cancelJobRow.id, 0);
await sleep(150); // le mock est en train de « réfléchir »
assert("annulation acceptée", jobRunner.cancelJob(cancelJobRow.id));
const cancelEvents = await cancelPromise;
assert(
  "événement final cancelled diffusé et persisté",
  cancelEvents[cancelEvents.length - 1].event.type === "cancelled"
);
assert("statut du job : cancelled", jobRunner.getJob(cancelJobRow.id)?.status === "cancelled");
const cancelMsg = db
  .prepare("SELECT kind FROM game_messages WHERE job_id = ? AND role = 'assistant'")
  .get(cancelJobRow.id) as { kind: string } | null;
assert("message d'annulation dans le chat", cancelMsg?.kind === "cancelled");
const gameUntouched = db.prepare("SELECT version FROM games WHERE id = ?").get(doneEvent.gameId) as {
  version: number;
};
assert("le jeu n'a pas été modifié par le job annulé", gameUntouched.version === 2);

server.close();
console.log(`\n(${requestCount} requêtes reçues par le mock LLM)`);
if (failures > 0) {
  console.error(`${failures} échec(s).`);
  process.exit(1);
}
console.log("Tous les tests jobs.ts passent.");
process.exit(0);
