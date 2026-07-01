import { NextRequest } from "next/server";
import db from "@/lib/db";
import { hashPassword, setSessionCookie, PASSWORD_MAX_LENGTH } from "@/lib/auth";
import { apiError, handleApi, readJson } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  return handleApi(async () => {
    const { username, password } = await readJson<{
      username: string;
      password: string;
    }>(req);

    if (typeof username !== "string" || typeof password !== "string") {
      return apiError(400, "Requête invalide.");
    }
    if (!rateLimit(`register:${clientIp(req)}`, 5, 60_000)) {
      return apiError(429, "Trop de créations de compte. Réessaie dans une minute.");
    }

    const name = username.trim();
    if (name.length < 3 || name.length > 32 || !/^[\p{L}\p{N}_.-]+$/u.test(name)) {
      return apiError(400, "Nom d'utilisateur : 3 à 32 caractères (lettres, chiffres, _ . -).");
    }
    if (password.length < 6) {
      return apiError(400, "Le mot de passe doit faire au moins 6 caractères.");
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      return apiError(400, `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`);
    }

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
    if (existing) {
      return apiError(409, "Ce nom d'utilisateur est déjà pris.");
    }

    const adminUsernames = (process.env.ADMIN_USERNAMES ?? "")
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = adminUsernames.includes(name.toLowerCase());
    const role = isAdmin ? "admin" : "user";
    const status = isAdmin ? "approved" : "pending";

    const result = db
      .prepare("INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)")
      .run(name, hashPassword(password), role, status);

    const pending = status === "pending";
    if (!pending) {
      await setSessionCookie(Number(result.lastInsertRowid), req);
    }
    return Response.json({ ok: true, pending });
  });
}
