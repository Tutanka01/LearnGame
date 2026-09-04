import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { setSessionCookie } from "@/lib/auth";
import { isSafeLocalPath } from "@/lib/authValidate";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import {
  consumeOidcFlow,
  finishOidcLogin,
  isOidcEnabled,
  OIDC_FLOW_COOKIE,
  OidcLoginError,
  redirectOrigin,
  verifyFlowCookie,
} from "@/lib/oidc";

export const dynamic = "force-dynamic";

/**
 * Callback du SSO : l'université renvoie ici le navigateur avec code + state.
 * Toujours une redirection navigateur — vers la destination d'origine en cas
 * de succès, vers /login?error=<code fermé> sinon (jamais de texte libre venu
 * de l'IdP dans l'URL : les détails sont journalisés côté serveur).
 */
export async function GET(req: NextRequest) {
  const loginError = async (code: string) => {
    const store = await cookies();
    store.delete(OIDC_FLOW_COOKIE); // repartir propre, même en échec
    return new Response(null, {
      status: 307,
      headers: {
        Location: new URL(`/login?error=${code}`, redirectOrigin(req)).toString(),
        "Cache-Control": "no-store",
      },
    });
  };

  // Fenêtre large (salle de classe) : sans TRUST_PROXY la clé est globale.
  if (!rateLimit(`oidc-cb:${clientIp(req)}`, 120, 60_000)) {
    return loginError("oidc_trop_de_tentatives");
  }
  if (!isOidcEnabled()) return loginError("oidc_indisponible");

  const params = req.nextUrl.searchParams;
  const state = params.get("state");

  // Erreur renvoyée par l'IdP (annulation, compte refusé côté université…) :
  // on journalise et on reste générique côté URL.
  if (params.get("error")) {
    console.error(
      "SSO OIDC : l'IdP a renvoyé une erreur.",
      params.get("error"),
      params.get("error_description")
    );
    return loginError("oidc_refus_idp");
  }
  if (!params.get("code") || !state) {
    return loginError("oidc_etat_invalide");
  }

  // Anti login-CSRF : le callback doit venir du navigateur qui A LANCÉ le
  // flux (cookie posé au départ). Une URL de callback obtenue par un tiers
  // (identification faite par l'attaquant) est refusée ici.
  const flowCookie = req.cookies.get(OIDC_FLOW_COOKIE)?.value;
  if (!verifyFlowCookie(flowCookie, state)) {
    console.error("SSO OIDC : cookie de binding absent ou incohérent avec le state.");
    return loginError("oidc_etat_invalide");
  }

  // Single-use : le flux est supprimé À LA LECTURE — un callback rejoué ou un
  // state forgé échoue ici avant tout échange réseau avec l'IdP.
  const flow = consumeOidcFlow(state);
  if (!flow) return loginError("oidc_etat_invalide");

  try {
    const result = await finishOidcLogin(flow, state, params);

    // Un compte lié peut être « en attente » (inscription locale non encore
    // validée) : le SSO ne contourne pas le flux d'approbation.
    if (result.status !== "approved") {
      console.error(`SSO OIDC : compte ${result.username} non approuvé (SSO refusé).`);
      return loginError("oidc_compte_en_attente");
    }

    await setSessionCookie(result.userId, req);
    const store = await cookies();
    store.delete(OIDC_FLOW_COOKIE);

    return new Response(null, {
      status: 307,
      headers: {
        Location: new URL(isSafeLocalPath(flow.next_path), redirectOrigin(req)).toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof OidcLoginError) {
      console.error("SSO OIDC :", err.message);
      return loginError(err.code);
    }
    console.error("SSO OIDC : erreur inattendue.", err);
    return loginError("oidc_echec");
  }
}
