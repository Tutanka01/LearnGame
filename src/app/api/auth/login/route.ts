import { NextRequest } from "next/server";
import db, { User } from "@/lib/db";
import { verifyPassword, setSessionCookie, PASSWORD_MAX_LENGTH } from "@/lib/auth";
import { apiError, handleApi, readJson } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  return handleApi(async () => {
    const { username, password } = await readJson<{ username: string; password: string }>(req);

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      return apiError(400, "Requête invalide.");
    }

    const name = username.trim();
    // Anti force brute : 10 tentatives par minute, par IP et par compte visé.
    if (!rateLimit(`login:${clientIp(req)}:${name.toLowerCase()}`, 10, 60_000)) {
      return apiError(429, "Trop de tentatives. Réessaie dans une minute.");
    }

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(name) as unknown as
      | User
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return apiError(401, "Nom d'utilisateur ou mot de passe incorrect.");
    }

    await setSessionCookie(user.id);
    return Response.json({ ok: true });
  });
}
