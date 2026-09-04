// Messages d'erreur du flux SSO (OIDC) — module PUR, partagé par la route de
// callback (codes dans l'URL de redirection) et le formulaire de connexion
// (affichage). AUCUNE importation serveur ici : ce fichier est chargé aussi
// côté client, et le bundle navigateur ne doit jamais tirer openid-client/db.
//
// Le callback ne redirige JAMAIS avec un texte libre de l'IdP : uniquement des
// codes de cet ensemble fermé (détails techniques journalisés côté serveur).

export const OIDC_ERROR_CODES = [
  "oidc_indisponible",
  "oidc_echec",
  "oidc_etat_invalide",
  "oidc_compte_en_attente",
  "oidc_compte_non_autorise",
  "oidc_refus_idp",
  "oidc_trop_de_tentatives",
] as const;

export type OidcErrorCode = (typeof OIDC_ERROR_CODES)[number];

const MESSAGES: Record<OidcErrorCode, string> = {
  oidc_indisponible:
    "La connexion via l'université n'est pas disponible actuellement.",
  oidc_echec:
    "La connexion via l'université a échoué. Réessaie ou utilise ton compte local.",
  oidc_etat_invalide:
    "Session de connexion expirée ou déjà utilisée. Reprends la connexion depuis le début.",
  oidc_compte_en_attente:
    "Ton compte est en attente d'approbation par un enseignant.",
  oidc_compte_non_autorise:
    "Ce compte n'est pas autorisé à se connecter sur cette plateforme.",
  oidc_refus_idp:
    "Le SSO de l'université a refusé la connexion. Vérifie ton identification ou réessaie plus tard.",
  oidc_trop_de_tentatives:
    "Trop de tentatives de connexion. Réessaie dans une minute.",
};

/** Message français d'un code d'erreur SSO ; inconnu → message générique. */
export function oidcErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return (MESSAGES as Record<string, string>)[code] ?? MESSAGES.oidc_echec;
}
