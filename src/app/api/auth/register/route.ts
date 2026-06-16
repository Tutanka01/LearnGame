import { NextRequest } from "next/server";
import db from "@/lib/db";
import { hashPassword, setSessionCookie, PASSWORD_MAX_LENGTH } from "@/lib/auth";
import { apiError, handleApi, readJson } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  return handleApi(async () => {
    const { username, password, code } = await readJson<{
      username: string;
      password: string;
      code: string;
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

    const requiredCode = process.env.REGISTRATION_CODE?.trim();
    if (requiredCode && code !== requiredCode) {
      return apiError(403, "Code d'inscription incorrect.");
    }

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
    if (existing) {
      return apiError(409, "Ce nom d'utilisateur est déjà pris.");
    }

    const result = db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(name, hashPassword(password));

    await setSessionCookie(Number(result.lastInsertRowid), req);
    return Response.json({ ok: true });
  });
}
