// Utilitaires partagés par toutes les routes API : un seul format d'erreur
// JSON ({ error: string }), des gardes réutilisables (connexion, propriété)
// et les réponses HTML des endpoints /play (servis dans une iframe).

import db, { Game, User } from "./db";
import { getCurrentUser } from "./auth";
import { ApiError } from "./errors";

export { ApiError };

export function apiError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Lit le corps JSON sans jeter : un corps invalide devient un objet vide. */
export async function readJson<T extends object>(req: Request): Promise<Partial<T>> {
  return (await req.json().catch(() => ({}))) as Partial<T>;
}

/** Utilisateur connecté, sinon ApiError 401. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Non connecté.");
  return user;
}

/** Jeu existant (ligne complète), sinon ApiError 404. */
export function requireGame(id: string): Game {
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as unknown as
    | Game
    | undefined;
  if (!game) throw new ApiError(404, "Jeu introuvable.");
  return game;
}

/** Jeu existant ET appartenant à l'utilisateur, sinon ApiError 404/403. */
export function requireOwnedGame(id: string, userId: number, action = "modifier ce jeu"): Game {
  const game = requireGame(id);
  if (game.user_id !== userId) {
    throw new ApiError(403, `Seul le créateur du jeu peut ${action}.`);
  }
  return game;
}

/** Enveloppe un handler : les ApiError deviennent des réponses JSON propres. */
export async function handleApi(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return apiError(err.status, err.message);
    console.error("Erreur API inattendue :", err);
    return apiError(500, "Erreur serveur inattendue. Réessaie.");
  }
}

// --- Réponses des endpoints /play (HTML servi dans une iframe sandboxée) ---

// CSP stricte : aucune ressource externe, aucun appel réseau depuis le jeu.
const GAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; " +
  "frame-ancestors 'self'";

/** Sert le HTML d'un jeu avec la CSP stricte de la sandbox. */
export function gameHtmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": GAME_CSP,
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "no-store",
    },
  });
}

/** Page d'erreur minimaliste pour les iframes (pas de JSON dans un <iframe>). */
export function gameHtmlError(status: number, message: string): Response {
  const page = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>LearnGame</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0c13;color:#98a0b8;font-family:system-ui,sans-serif;font-size:15px;text-align:center;padding:24px">
<p>🎮 ${message}</p>
</body></html>`;
  return new Response(page, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
