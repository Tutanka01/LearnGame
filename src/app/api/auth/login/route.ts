import { NextRequest } from "next/server";
import db, { User } from "@/lib/db";
import { verifyPassword, needsRehash, hashPassword, burnScryptTime, setSessionCookie } from "@/lib/auth";
import { assertSameOrigin, apiError, handleApi, readJson } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { PASSWORD_MAX } from "@/lib/authValidate";

export async function POST(req: NextRequest) {
  return handleApi(async () => {
    assertSameOrigin(req);

    const { username, password } = await readJson<{ username: string; password: string }>(req);
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      password.length > PASSWORD_MAX
    ) {
      return apiError(400, "Requête invalide.");
    }

    const name = username.trim();
    const ip = clientIp(req);
    // Anti force brute, deux fenêtres complémentaires : par adresse (attaque
    // distribuée sur plein de comptes) et par couple (adresse, compte visé).
    if (!rateLimit(`login-ip:${ip}`, 20, 60_000) || !rateLimit(`login:${ip}:${name.toLowerCase()}`, 10, 60_000)) {
      return apiError(429, "Trop de tentatives. Réessaie dans une minute.");
    }

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(name) as unknown as
      | User
      | undefined;

    // Message unique quel que soit le cas, et coût scrypt payé même quand le
    // compte n'existe pas : impossible de distinguer les deux au chrono.
    if (!user) {
      burnScryptTime();
      return apiError(401, "Nom d'utilisateur ou mot de passe incorrect.");
    }
    if (!verifyPassword(password, user.password_hash)) {
      return apiError(401, "Nom d'utilisateur ou mot de passe incorrect.");
    }

    // Compte créé avant le format versionné : re-hachage transparent.
    if (needsRehash(user.password_hash)) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id);
    }

    if (user.status !== "approved") {
      return apiError(403, "Ton compte est en attente d'approbation par un enseignant.");
    }

    await setSessionCookie(user.id, req);
    return Response.json({ ok: true });
  });
}
