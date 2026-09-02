import { NextRequest } from "next/server";
import db from "@/lib/db";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { assertSameOrigin, apiError, handleApi, readJson } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { validateUsername, validatePassword } from "@/lib/authValidate";

export async function POST(req: NextRequest) {
  return handleApi(async () => {
    assertSameOrigin(req);

    // Fenêtre AVANT tout parsing : aucun travail coûteux payé par un client
    // en excès (le corps peut être arbitrairement gros).
    if (!rateLimit(`register:${clientIp(req)}`, 15, 60_000)) {
      return apiError(429, "Trop de créations de compte. Réessaie dans une minute.");
    }

    const { username, password } = await readJson<{
      username: string;
      password: string;
    }>(req);
    if (typeof username !== "string" || typeof password !== "string") {
      return apiError(400, "Requête invalide.");
    }

    // Validation par le module partagé avec le formulaire (messages identiques).
    const name = username.trim();
    const usernameError = validateUsername(name);
    if (usernameError) return apiError(400, usernameError);
    const passwordError = validatePassword(password);
    if (passwordError) return apiError(400, passwordError);

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
    if (existing) {
      return apiError(409, "Ce nom d'utilisateur est déjà pris.");
    }

    // Approbation : les comptes de ADMIN_USERNAMES naissent admin ; les autres
    // attendent la validation d'un enseignant avant leur première connexion.
    const adminUsernames = (process.env.ADMIN_USERNAMES ?? "")
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = adminUsernames.includes(name.toLowerCase());
    const role = isAdmin ? "admin" : "user";
    const status = isAdmin ? "approved" : "pending";

    try {
      const result = db
        .prepare("INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)")
        .run(name, hashPassword(password), role, status);
      const pending = status === "pending";
      if (!pending) {
        await setSessionCookie(Number(result.lastInsertRowid), req);
      }
      return Response.json({ ok: true, pending });
    } catch (err) {
      // Course entre deux inscriptions du même nom : la contrainte UNIQUE
      // tranche — on répond 409 plutôt qu'une erreur serveur brutale.
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        return apiError(409, "Ce nom d'utilisateur est déjà pris.");
      }
      throw err;
    }
  });
}
