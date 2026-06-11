// Protocole v2 des événements de génération — module PUR (aucun import Next,
// DB ou réseau) : partagé entre le serveur (émission, persistance) et le client
// (réduction en état d'affichage), et testable directement avec npx tsx.
//
// Le serveur est la SOURCE DE VÉRITÉ : phases, tentatives et bascule de mode
// sont des événements explicites, le client ne déduit plus rien. Chaque
// événement reçoit un `seq` croissant (l'id SSE) : après une reconnexion, le
// client rejoue les événements manquants dans reduceGenEvent et retrouve
// exactement le même état — y compris l'aperçu live (fullCode).

export const GEN_PROTOCOL_VERSION = 2;

export type GenJobType = "create" | "edit";

export type GenPhase = "connect" | "thinking" | "coding" | "applying" | "validating";

export type GenEvent =
  /** Premier événement du flux : identité du job. */
  | { type: "init"; v: number; jobType: GenJobType; gameId: string | null; label: string }
  /** Bascule d'affichage (repli édition → régénération complète). */
  | { type: "mode"; mode: GenJobType }
  /** Phase courante ; `round` = tour de la session d'édition (1 à 3). */
  | { type: "phase"; phase: GenPhase; round?: number }
  /** Nouvelle tentative de création (le serveur porte le compteur). */
  | { type: "attempt"; attempt: number; reason: string }
  | { type: "status"; message: string }
  | { type: "reasoning"; text: string }
  | { type: "chunk"; text: string }
  | { type: "done"; gameId: string; title: string; version: number; summary: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export type GenResult = { gameId: string; title: string; version: number; summary: string };

export interface GenSnapshot {
  jobType: GenJobType;
  gameId: string | null;
  label: string;
  /** Mode d'affichage courant : peut passer de edit à create (repli). */
  mode: GenJobType;
  phase: GenPhase;
  round: number;
  attempt: number;
  statusMsg: string;
  reasoningTail: string;
  codeTail: string;
  counts: { reasoning: number; code: number };
  /** Code complet reçu (aperçu live en mode create). */
  fullCode: string;
  result: GenResult | null;
  error: string;
  cancelled: boolean;
  /** true dès qu'un événement final (done/error/cancelled) est passé. */
  terminal: boolean;
}

const TAIL_REASONING = 3000;
const TAIL_CODE = 6000;

export function initialSnapshot(): GenSnapshot {
  return {
    jobType: "create",
    gameId: null,
    label: "",
    mode: "create",
    phase: "connect",
    round: 1,
    attempt: 1,
    statusMsg: "",
    reasoningTail: "",
    codeTail: "",
    counts: { reasoning: 0, code: 0 },
    fullCode: "",
    result: null,
    error: "",
    cancelled: false,
    terminal: false,
  };
}

/** Buffers de texte remis à zéro (nouvelle tentative, bascule de mode). */
function clearedBuffers(s: GenSnapshot): GenSnapshot {
  return {
    ...s,
    reasoningTail: "",
    codeTail: "",
    counts: { reasoning: 0, code: 0 },
    fullCode: "",
  };
}

export function reduceGenEvent(s: GenSnapshot, e: GenEvent): GenSnapshot {
  switch (e.type) {
    case "init":
      return { ...s, jobType: e.jobType, mode: e.jobType, gameId: e.gameId, label: e.label };
    case "mode":
      // Repli édition → régénération : le flux devient un document complet,
      // l'aperçu live redevient pertinent, les retouches affichées sont caduques.
      return { ...clearedBuffers(s), mode: e.mode, phase: "connect" };
    case "phase":
      return { ...s, phase: e.phase, round: e.round ?? s.round };
    case "attempt":
      return { ...clearedBuffers(s), attempt: e.attempt, phase: "connect", statusMsg: e.reason };
    case "status":
      return { ...s, statusMsg: e.message };
    case "reasoning":
      return {
        ...s,
        reasoningTail: (s.reasoningTail + e.text).slice(-TAIL_REASONING),
        counts: { ...s.counts, reasoning: s.counts.reasoning + e.text.length },
      };
    case "chunk":
      return {
        ...s,
        fullCode: s.fullCode + e.text,
        codeTail: (s.codeTail + e.text).slice(-TAIL_CODE),
        counts: { ...s.counts, code: s.counts.code + e.text.length },
      };
    case "done":
      return {
        ...s,
        result: { gameId: e.gameId, title: e.title, version: e.version, summary: e.summary },
        terminal: true,
      };
    case "error":
      return { ...s, error: e.message, terminal: true };
    case "cancelled":
      return { ...s, cancelled: true, terminal: true };
  }
}

/** Rejoue une séquence complète (reconnexion) : events.reduce(...). */
export function replayEvents(events: GenEvent[]): GenSnapshot {
  return events.reduce(reduceGenEvent, initialSnapshot());
}
