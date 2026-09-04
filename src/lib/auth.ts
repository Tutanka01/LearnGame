// Couche auth côté Next : lecture/écriture du cookie de session.
// Toute la logique (crypto, base) vit dans session.ts — module pur et testable.
// Ce fichier ne fait que coller le cookie httpOnly sur le noyau.

import { cookies } from "next/headers";
import { createSession, getSessionUser, revokeSession, SESSION_COOKIE } from "./session";
import type { SessionUser } from "./session";

// Ré-exports : les modules existants importent le noyau depuis "@/lib/auth".
export {
  hashPassword,
  verifyPassword,
  needsRehash,
  burnScryptTime,
  createSession,
  getSessionUser,
  revokeSession,
  revokeAllUserSessions,
} from "./session";
export type { SessionUser } from "./session";
export { SESSION_COOKIE } from "./session";

/**
 * Faut-il marquer le cookie de session `secure` (réservé HTTPS) ?
 *
 * Un cookie `secure` envoyé sur une connexion HTTP pure est **silencieusement
 * jeté par le navigateur** : l'utilisateur reste alors déconnecté sans erreur.
 * On auto-détecte donc le protocole effectif au lieu de se fier à NODE_ENV :
 *   - `SESSION_SECURE_COOKIE=0` force le cookie non-secure (HTTP assumé) ;
 *   - `SESSION_SECURE_COOKIE=1` force le cookie secure (HTTPS assumé) ;
 *   - sinon : `x-forwarded-proto` (reverse-proxy TLS) puis le protocole de la
 *     requête. Sans requête disponible, on retombe sur NODE_ENV.
 *
 * Exporté : le cookie de binding du flux SSO (oidc) applique la même règle.
 */
export function shouldUseSecureCookie(req?: Request): boolean {
  const override = process.env.SESSION_SECURE_COOKIE?.trim();
  if (override === "0") return false;
  if (override === "1") return true;

  if (req) {
    const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (forwarded) return forwarded === "https";
    try {
      return new URL(req.url).protocol === "https:";
    } catch {
      /* URL inexploitable : on retombe sur le défaut ci-dessous */
    }
  }
  return process.env.NODE_ENV === "production";
}

/**
 * Ouvre une session : création en base (token neuf à chaque connexion) puis
 * pose du cookie httpOnly. La durée du cookie reflète celle de la session.
 */
export async function setSessionCookie(userId: number, req?: Request) {
  const userAgent = req?.headers.get("user-agent") ?? "";
  const { token, expiresAt } = createSession(userId, userAgent);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
    secure: shouldUseSecureCookie(req),
  });
}

/**
 * Déconnexion complète : révocation de la session en base (le cookie volé ne
 * vaut plus rien) puis suppression du cookie. Idempotent.
 */
export async function clearSessionCookie() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) revokeSession(token);
  store.delete(SESSION_COOKIE);
}

/** Utilisateur courant (jamais de hash de mot de passe dans l'objet retourné). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
}
