// Moteur d'édition chirurgicale des jeux : le modèle ne réécrit plus tout le
// fichier, il émet des opérations CHERCHER/REMPLACER (façon Aider) que le
// serveur exécute. Chaque échec est rapporté au modèle avec un extrait du
// passage le plus proche pour qu'il corrige son ancrage — boucle agentique.

import { extractHtml } from "./prompts";

export interface EditOp {
  search: string;
  replace: string;
}

export interface OpFailure {
  op: EditOp;
  reason: string;
  /** Extrait du fichier proche de l'ancre ratée, pour aider le modèle à corriger. */
  hint: string | null;
}

export interface ParsedEditResponse {
  summary: string;
  ops: EditOp[];
  /** Réécriture complète si le modèle a choisi cette voie (cas exceptionnel). */
  rewriteHtml: string | null;
}

const OPEN_LINE = /^[ \t]*<{4,}[ \t]*CHERCHER[ \t]*$/;
const SEP_LINE = /^[ \t]*={4,}[ \t]*$/;
const CLOSE_LINE = /^[ \t]*>{4,}[ \t]*REMPLACER[ \t]*$/;

/**
 * Analyse la réponse du modèle en mode édition : résumé + opérations (ou réécriture).
 * Parseur ligne à ligne : tolère les sections vides (= suppression), les fences
 * markdown autour des blocs et les fins de ligne Windows.
 */
export function parseEditResponse(raw: string): ParsedEditResponse {
  const summaryMatch = raw.match(/RÉSUMÉ\s*:\s*(.+?)(?:\r?\n|$)/iu);
  const summary = summaryMatch ? summaryMatch[1].trim().slice(0, 500) : "";

  const ops: EditOp[] = [];
  const lines = raw.split("\n").map((l) => l.replace(/\r$/, ""));
  let mode: "idle" | "search" | "replace" = "idle";
  let search: string[] = [];
  let replace: string[] = [];

  for (const line of lines) {
    if (mode === "idle") {
      if (OPEN_LINE.test(line)) {
        mode = "search";
        search = [];
        replace = [];
      }
    } else if (mode === "search") {
      if (SEP_LINE.test(line)) mode = "replace";
      else if (OPEN_LINE.test(line)) {
        // bloc mal fermé : on repart sur un nouveau bloc
        search = [];
      } else search.push(line);
    } else {
      if (CLOSE_LINE.test(line)) {
        ops.push({ search: search.join("\n"), replace: replace.join("\n") });
        mode = "idle";
      } else replace.push(line);
    }
  }

  // Réécriture complète : uniquement si AUCUNE opération n'est proposée
  // (sinon le document complet serait celui du prompt recopié, pas une réponse).
  const rewriteHtml = ops.length === 0 ? extractHtml(raw) : null;

  return { summary, ops, rewriteHtml };
}

export interface ApplyResult {
  html: string;
  applied: number;
  failures: OpFailure[];
}

/** Applique les opérations dans l'ordre. Les succès sont conservés même si d'autres échouent. */
export function applyOps(html: string, ops: EditOp[]): ApplyResult {
  let current = html;
  let applied = 0;
  const failures: OpFailure[] = [];

  for (const op of ops) {
    if (op.search.trim().length === 0) {
      failures.push({
        op,
        reason: "le bloc CHERCHER est vide — copie un passage exact du fichier",
        hint: null,
      });
      continue;
    }
    if (op.search === op.replace) {
      applied++; // aucune modification : on l'ignore silencieusement
      continue;
    }

    const found = locate(current, op.search);
    if (found.kind === "unique") {
      current = current.slice(0, found.start) + op.replace + current.slice(found.end);
      applied++;
    } else if (found.kind === "ambiguous") {
      failures.push({
        op,
        reason: `le passage CHERCHER apparaît ${found.count} fois dans le fichier — ajoute des lignes de contexte pour le rendre unique`,
        hint: null,
      });
    } else {
      failures.push({
        op,
        reason:
          "le passage CHERCHER est introuvable dans le fichier (il doit être une copie EXACTE, indentation comprise)",
        hint: nearestExcerpt(current, op.search),
      });
    }
  }

  return { html: current, applied, failures };
}

type Location =
  | { kind: "unique"; start: number; end: number }
  | { kind: "ambiguous"; count: number }
  | { kind: "none" };

/** Localise `search` dans `html` : correspondance exacte, puis tolérante aux espaces. */
function locate(html: string, search: string): Location {
  // 1. Exact.
  const exact = allIndexesOf(html, search);
  if (exact.length === 1) return { kind: "unique", start: exact[0], end: exact[0] + search.length };
  if (exact.length > 1) return { kind: "ambiguous", count: exact.length };

  // 2. Par lignes, en ignorant les espaces de fin puis de début/fin de ligne.
  for (const norm of [(s: string) => s.replace(/\s+$/, ""), (s: string) => s.trim()]) {
    const found = locateByLines(html, search, norm);
    if (found.kind !== "none") return found;
  }
  return { kind: "none" };
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

function locateByLines(html: string, search: string, norm: (s: string) => string): Location {
  const searchLines = search.split("\n").map(norm);
  // Lignes du fichier avec leurs offsets de début.
  const htmlLines = html.split("\n");
  const offsets: number[] = new Array(htmlLines.length);
  let acc = 0;
  for (let i = 0; i < htmlLines.length; i++) {
    offsets[i] = acc;
    acc += htmlLines[i].length + 1;
  }

  const matches: { start: number; end: number }[] = [];
  outer: for (let i = 0; i + searchLines.length <= htmlLines.length; i++) {
    for (let j = 0; j < searchLines.length; j++) {
      if (norm(htmlLines[i + j]) !== searchLines[j]) continue outer;
    }
    const last = i + searchLines.length - 1;
    matches.push({ start: offsets[i], end: offsets[last] + htmlLines[last].length });
    if (matches.length > 1) break;
  }

  if (matches.length === 1) return { kind: "unique", ...matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
  return { kind: "none" };
}

/**
 * Pour aider le modèle à corriger une ancre ratée : retrouve la ligne la plus
 * distinctive du bloc CHERCHER dans le fichier et renvoie le passage autour.
 */
function nearestExcerpt(html: string, search: string): string | null {
  const candidates = search
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 8)
    .sort((a, b) => b.length - a.length);

  const htmlLines = html.split("\n");
  for (const line of candidates) {
    const idx = htmlLines.findIndex((l) => l.includes(line));
    if (idx !== -1) {
      const from = Math.max(0, idx - 3);
      const to = Math.min(htmlLines.length, idx + 4);
      return htmlLines.slice(from, to).join("\n");
    }
  }
  return null;
}
