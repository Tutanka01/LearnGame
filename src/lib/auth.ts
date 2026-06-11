import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import db, { User } from "./db";

const SESSION_COOKIE = "lg_session";
const SESSION_DAYS = 30;

/** Au-delà, scrypt devient coûteux : refusé AVANT tout calcul. */
export const PASSWORD_MAX_LENGTH = 256;

// Secret évalué paresseusement (pas au build) : en production, l'absence de
// SESSION_SECRET est une faute de configuration fatale — n'importe qui pourrait
// forger un cookie de session avec le secret de développement.
let cachedSecret: string | null = null;
function getSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return (cachedSecret = fromEnv);
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET doit être défini en production : sans lui, les sessions sont forgeables."
    );
  }
  return (cachedSecret = "dev-secret-change-me");
}

// --- Mots de passe (scrypt, pas de dépendance native supplémentaire) ---

export function hashPassword(password: string): string {
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Mot de passe trop long (maximum ${PASSWORD_MAX_LENGTH} caractères).`);
  }
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// --- Sessions (cookie signé HMAC : userId.expiry.signature) ---

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createSessionToken(userId: number): string {
  const expiry = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = `${userId}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiry, signature] = parts;
  const payload = `${userId}.${expiry}`;
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Date.now() > Number(expiry)) return null;
  return Number(userId);
}

export async function setSessionCookie(userId: number) {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
    // Cookie réservé au HTTPS en production. Déploiement en HTTP pur
    // (ex. réseau interne sans TLS) : mettre SESSION_SECURE_COOKIE=0.
    secure: process.env.NODE_ENV === "production" && process.env.SESSION_SECURE_COOKIE !== "0",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = parseSessionToken(token);
  if (userId === null) return null;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as User | undefined;
  return user ?? null;
}
