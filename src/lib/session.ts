// Noyau d'authentification — module PUR (aucune dépendance Next).
//
// Mots de passe : scrypt (node:crypto) au format VERSIONNÉ
//   `scrypt$N$r$p$saltHex$hashHex` — les paramètres voyagent avec le hash,
//   ce qui permet de durcir les coûts sans casser les comptes existants.
//   L'ancien format `saltHex:hashHex` reste vérifié et est re-haché
//   automatiquement à la prochaine connexion réussie (needsRehash).
//
// Sessions : tokens aléatoires stockés en base (table auth_sessions), SEULEMENT
//   sous forme de SHA-256 — la base ne permet pas de forger un cookie. Chaque
//   connexion crée une NOUVELLE session (pivot), chaque déconnexion la révoque
//   (DELETE), et une session dont le compte repasse « en attente » meurt
//   aussitôt. Durée fixe de 30 jours : pas de session éternelle, mais un
//   redémarrage serveur ne déconnecte personne (contrairement à un store
//   mémoire) et une fuite de base n'expose aucun token brut.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import db from "./db";
import { PASSWORD_MAX } from "./authValidate";

export const SESSION_COOKIE = "lg_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;

/** Coûts scrypt courants (défauts Node : N=16384, r=8, p=1, clé de 64 octets). */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// ---------------------------------------------------------------------------
// Mots de passe
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  if (password.length > PASSWORD_MAX) {
    throw new Error(`Mot de passe trop long (maximum ${PASSWORD_MAX} caractères).`);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (password.length > PASSWORD_MAX) return false;
  try {
    if (stored.startsWith("scrypt$")) {
      const [, n, r, p, saltHex, hashHex] = stored.split("$");
      if (!n || !r || !p || !saltHex || !hashHex) return false;
      const expected = Buffer.from(hashHex, "hex");
      const candidate = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      });
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    }
    // Format historique (salt:hash, coûts par défaut implicites).
    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const candidate = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/** Le hash stocké mérite-t-il une re-navigation (format ou coûts anciens) ? */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$`);
}

// Anti-énumération par timing : quand le compte n'existe pas, on paie quand
// même le coût d'un scrypt, pour que « compte inconnu » et « mot de passe
// faux » soient indiscernables à la mesure du temps de réponse.
const DUMMY_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"ab".repeat(16)}$${"cd".repeat(32)}`;
export function burnScryptTime(): void {
  verifyPassword("mot-de-passe-quelconque", DUMMY_HASH);
}

// ---------------------------------------------------------------------------
// Sessions en base
// ---------------------------------------------------------------------------

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Utilisateur tel que vu par le reste de l'app : JAMAIS de hash dedans. */
export interface SessionUser {
  id: number;
  username: string;
  role: string;
  status: string;
  created_at: string;
}

interface SessionRow {
  id: number;
  username: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: number;
  last_seen_at: number;
}

/**
 * Crée une session (token aléatoire, stocké hashé) et purge les sessions
 * expirées au passage — la table reste minuscule sans tâche de fond.
 * Retourne le token BRUT : il ne doit vivre que dans le cookie httpOnly.
 */
export function createSession(userId: number, userAgent = ""): { token: string; expiresAt: number } {
  const now = Date.now();
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_MS;
  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sha256(token), userId, now, now, expiresAt, userAgent.slice(0, 180));
  return { token, expiresAt };
}

/**
 * Valide un token et retourne l'utilisateur, ou null si la session est
 * inconnue, expirée, ou rattachée à un compte non approuvé (suspendue/en
 * attente) — dans le cas expiré, la ligne est purgée au passage.
 * L'horodatage d'activité est mis à jour au plus une fois par heure.
 */
export function getSessionUser(token: string): SessionUser | null {
  const sessionId = sha256(token);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.status, u.created_at,
              s.expires_at, s.last_seen_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(sessionId) as unknown as SessionRow | undefined;
  if (!row) return null;

  const now = Date.now();
  if (row.expires_at <= now) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
    return null;
  }
  if (row.status !== "approved") return null;

  if (now - row.last_seen_at > 3600_000) {
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(now, sessionId);
  }
  return { id: row.id, username: row.username, role: row.role, status: row.status, created_at: row.created_at };
}

/** Révoque une session précise (déconnexion). Idempotent. */
export function revokeSession(token: string): void {
  db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(sha256(token));
}

/** Révoque TOUTES les sessions d'un compte (changement de mot de passe, rejet). */
export function revokeAllUserSessions(userId: number): void {
  db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}
