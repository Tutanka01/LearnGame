// Test ad hoc du protocole v2 (réducteur) — npx -y tsx tests/genEvents.test.ts

import {
  GEN_PROTOCOL_VERSION,
  GenEvent,
  initialSnapshot,
  reduceGenEvent,
  replayEvents,
} from "../src/lib/genEvents";

let failures = 0;
function assert(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`✗ ${name}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// --- Flux de création nominal ----------------------------------------------------
const createFlow: GenEvent[] = [
  { type: "init", v: GEN_PROTOCOL_VERSION, jobType: "create", gameId: null, label: "Le TCP/IP" },
  { type: "status", message: "Conception du jeu en cours…" },
  { type: "phase", phase: "thinking" },
  { type: "reasoning", text: "je réfléchis…" },
  { type: "phase", phase: "coding" },
  { type: "chunk", text: "<!DOCTYPE html>" },
  { type: "chunk", text: "<html></html>" },
  { type: "phase", phase: "validating" },
  { type: "done", gameId: "g1", title: "Jeu TCP", version: 1, summary: "Créé." },
];
let s = replayEvents(createFlow);
assert("création : mode create, label porté", s.mode === "create" && s.label === "Le TCP/IP");
assert("création : fullCode accumulé", s.fullCode === "<!DOCTYPE html><html></html>");
assert("création : compteurs exacts", s.counts.code === 28 && s.counts.reasoning === 13);
assert("création : terminal avec résultat", s.terminal && s.result?.gameId === "g1");

// --- Nouvelle tentative : buffers remis à zéro, compteur serveur ------------------
const retryFlow: GenEvent[] = [
  ...createFlow.slice(0, 7),
  { type: "attempt", attempt: 2, reason: "Tentative 2/3 — réponse invalide." },
  { type: "phase", phase: "thinking" },
  { type: "chunk", text: "<!DOCTYPE html>v2" },
];
s = replayEvents(retryFlow);
assert("tentative : attempt = 2 (serveur autoritaire)", s.attempt === 2);
assert("tentative : buffers vidés puis ré-accumulés", s.fullCode === "<!DOCTYPE html>v2");
assert("tentative : statusMsg = raison", s.statusMsg.includes("Tentative 2/3"));

// --- Édition avec repli en régénération -------------------------------------------
const editFallback: GenEvent[] = [
  { type: "init", v: GEN_PROTOCOL_VERSION, jobType: "edit", gameId: "g1", label: "Plus dur !" },
  { type: "phase", phase: "thinking", round: 1 },
  { type: "chunk", text: "<<<<<<< CHERCHER…" },
  { type: "phase", phase: "applying", round: 1 },
  { type: "phase", phase: "thinking", round: 2 },
  { type: "mode", mode: "create" },
  { type: "chunk", text: "<!DOCTYPE html>complet" },
];
s = replayEvents(editFallback);
assert("édition : jobType edit conservé", s.jobType === "edit" && s.gameId === "g1");
assert("repli : mode passe à create", s.mode === "create");
assert("repli : les retouches caduques sont purgées", s.fullCode === "<!DOCTYPE html>complet");
assert("rounds suivis", replayEvents(editFallback.slice(0, 5)).round === 2);

// --- Annulation / erreur ------------------------------------------------------------
s = replayEvents([
  { type: "init", v: 2, jobType: "create", gameId: null, label: "x" },
  { type: "cancelled" },
]);
assert("cancelled : terminal sans résultat", s.terminal && s.cancelled && s.result === null);
s = replayEvents([
  { type: "init", v: 2, jobType: "create", gameId: null, label: "x" },
  { type: "error", message: "boum" },
]);
assert("error : terminal avec message", s.terminal && s.error === "boum");

// --- Reprise : rejouer une moitié puis l'autre = tout rejouer ------------------------
const full = replayEvents(createFlow);
const resumed = createFlow.slice(5).reduce(reduceGenEvent, replayEvents(createFlow.slice(0, 5)));
assert(
  "reconnexion : replay partiel + suite = replay complet",
  JSON.stringify(full) === JSON.stringify(resumed)
);
assert(
  "snapshot initial stable",
  JSON.stringify(initialSnapshot()) === JSON.stringify(initialSnapshot())
);

if (failures > 0) {
  console.error(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log("\nTous les tests genEvents.ts passent.");
