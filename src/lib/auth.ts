import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import db, { User } from "./db";

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const SESSION_COOKIE = "lg_session";
const SESSION_DAYS = 30;

// --- Mots de passe (scrypt, pas de dépendance native supplémentaire) ---

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// --- Sessions (cookie signé HMAC : userId.expiry.signature) ---

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
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
