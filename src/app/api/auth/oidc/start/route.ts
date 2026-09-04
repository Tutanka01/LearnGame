import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSafeLocalPath } from "@/lib/authValidate";
import { shouldUseSecureCookie } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import {
  beginOidcLogin,
  deriveCallbackUri,
  isOidcEnabled,
  OIDC_FLOW_COOKIE,
  oidcSettings,
  redirectOrigin,
} from "@/lib/oidc";

export const dynamic = "force-dynamic";

/**
 * Départ du flux SSO : crée le flux (state/nonce/PKCE persistés en base) puis
 * redirige vers la page d'identification de l'université. Toujours une
 * redirection navigateur — même les erreurs ramènent à /login?error=…
 */
export async function GET(req: NextRequest) {
  const loginError = (code: string) =>
    new Response(null, {
      status: 307,
      headers: {
        Location: new URL(`/login?error=${code}`, redirectOrigin(req)).toString(),
        "Cache-Control": "no-store",
      },
    });

  // Navigation navigateur : les erreurs sont des redirections, pas du JSON.
  // Fenêtre large (salle de classe entière qui clique dans la même minute) :
  // sans TRUST_PROXY la clé est globale, pas par adresse.
  if (!rateLimit(`oidc-start:${clientIp(req)}`, 120, 60_000)) {
    return loginError("oidc_trop_de_tentatives");
  }
  if (!isOidcEnabled()) return loginError("oidc_indisponible");

  const nextPath = isSafeLocalPath(req.nextUrl.searchParams.get("next"));

  try {
    // Priorité à l'URI de rappel déclarée (production) ; sinon déduite de
    // l'origine des redirections. L'IdP validera le redirect_uri contre celui
    // enregistré pour le client.
    const redirectUri = oidcSettings().redirectUri ?? deriveCallbackUri(redirectOrigin(req));
    const { authorizeUrl, flowCookie } = await beginOidcLogin(nextPath, redirectUri);

    // Binding flux ↔ navigateur (anti login-CSRF) : le callback exigera ce
    // cookie en regard du state. Même politique de `secure` que la session.
    const store = await cookies();
    store.set(OIDC_FLOW_COOKIE, flowCookie, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600, // aligné sur la durée de vie du flux (10 min)
      secure: shouldUseSecureCookie(req),
    });
    return NextResponse.redirect(authorizeUrl, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("SSO OIDC : démarrage du flux impossible.", err);
    return loginError("oidc_indisponible");
  }
}
