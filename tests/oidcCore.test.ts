// Test ad hoc du SSO OIDC : oidcMessages (pur), helpers purs d'oidc.ts
// (chemins sûrs, candidats de pseudo, filtre de domaine), flux persistés
// (state single-use) et résolution de compte (création / rattachement e-mail).
// oidc.ts touche la base via db.ts, qui ouvre process.cwd()/data/learngame.db
// — exécuter depuis un répertoire VIDE :
//   cd "$(mktemp -d)" && npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/oidcCore.test.ts

import path from "path";
import fs from "fs";
import assert from "assert";
import { createHash } from "crypto";
import { Configuration } from "openid-client";
import {
  sanitizeUsernameCandidate,
  usernameCandidates,
  emailDomainAllowed,
  emailVerifiable,
  extractIdentity,
  beginOidcLogin,
  consumeOidcFlow,
  resolveOidcAccount,
  oidcClientCache,
  deriveCallbackUri,
  verifyFlowCookie,
  assertIdTokenAlgAllowed,
  OidcLoginError,
  declaredOrigin,
  redirectOrigin,
  oidcSettings,
} from "../src/lib/oidc";
import { isSafeLocalPath } from "../src/lib/authValidate";
import { OIDC_ERROR_CODES, oidcErrorMessage } from "../src/lib/oidcMessages";
import { hashPassword } from "../src/lib/session";
import db from "../src/lib/db";

// Garde-fou : refuser de toucher une vraie base (db.ts ouvre le cwd).
const dataDir = path.join(process.cwd(), "data");
if (fs.existsSync(path.join(dataDir, "learngame.db"))) {
  console.error("Refus : une base existe déjà ici. Lancer depuis un répertoire temporaire vide.");
  process.exit(1);
}

// --- Harnais maison ------------------------------------------------------------

let total = 0;
let failures = 0;

function attendu(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function verifie(name: string, fn: () => void | Promise<void>): void {
  total++;
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`✓ ${name}`))
    .catch((err) => {
      failures++;
      console.error(`✗ ${name} → ${err instanceof Error ? err.message : String(err)}`);
    });
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

// --- Environnement : un IdP de test, sans aucun accès réseau -------------------
// Le client openid-client est pré-chargé dans le cache (le même que la prod
// utilise après sa découverte) via des métadonnées inline.

const ISSUER = "https://sso.test/cas/oidc";
const CLIENT_ID = "client-test";
const CLIENT_SECRET = "secret-test";
const REDIRECT_URI = "https://app.test/api/auth/oidc/callback";

process.env.OIDC_ISSUER = ISSUER;
process.env.OIDC_CLIENT_ID = CLIENT_ID;
process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
delete process.env.OIDC_ALLOWED_DOMAINS;
delete process.env.OIDC_REDIRECT_URI;

const testConfig = new Configuration(
  {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oidcAuthorize`,
    token_endpoint: `${ISSUER}/oidcAccessToken`,
    userinfo_endpoint: `${ISSUER}/oidcProfile`,
    jwks_uri: `${ISSUER}/jwks`,
    code_challenge_methods_supported: ["plain", "S256"],
  },
  CLIENT_ID,
  CLIENT_SECRET
);
oidcClientCache.set(`${ISSUER}|${CLIENT_ID}|${REDIRECT_URI}`, Promise.resolve(testConfig));

// --- Messages (module partagé client/serveur) ----------------------------------

verifie("oidcMessages : codes fermés et messages français", () => {
  for (const code of OIDC_ERROR_CODES) {
    attendu(oidcErrorMessage(code) !== null, `message manquant pour ${code}`);
    assert(typeof oidcErrorMessage(code) === "string");
  }
  attendu(oidcErrorMessage("code_inconnu") === oidcErrorMessage("oidc_echec"), "code inconnu doit tomber sur le message générique");
  attendu(oidcErrorMessage(null) === null, "pas de code → pas de message");
  attendu(oidcErrorMessage("") === null, "code vide → pas de message");
});

// --- Chemins de destination post-login ------------------------------------------

verifie("isSafeLocalPath : chemins locaux uniquement", () => {
  attendu(isSafeLocalPath("/games/abc") === "/games/abc", "chemin local doit passer");
  attendu(isSafeLocalPath("/") === "/", "racine doit passer");
  attendu(isSafeLocalPath(null) === "/", "null → racine");
  attendu(isSafeLocalPath("") === "/", "vide → racine");
  attendu(isSafeLocalPath("https://evil.com/x") === "/", "URL absolue refusée");
  attendu(isSafeLocalPath("//evil.com") === "/", "protocol-relative refusé");
  attendu(isSafeLocalPath("/\\evil.com") === "/", "backslash-hôte refusé");
  attendu(isSafeLocalPath("games") === "/", "sans slash initial refusé");
  attendu(isSafeLocalPath("/ok\u0000x") === "/", "caractère de contrôle refusé");
  attendu(isSafeLocalPath("/api/auth/oidc/start") === "/", "chemin d'API refusé (boucle)");
  attendu(isSafeLocalPath("/%2f%2fevil.com") !== "", "chemin encodé reste local (pas de confusion d'hôte)");
});

// --- Candidats de pseudo ---------------------------------------------------------

verifie("sanitizeUsernameCandidate : conforme aux règles du projet", () => {
  attendu(sanitizeUsernameCandidate("Marie.Dupont!") === "Marie.Dupont", "ponctuation finale → retirée");
  attendu(sanitizeUsernameCandidate("prénom.éè") === "prénom.éè", "accents conservés");
  attendu(sanitizeUsernameCandidate("jean ** dup") === "jean-dup", "espaces → tirets");
  attendu(sanitizeUsernameCandidate("-.abc-.") === "abc", "séparateurs aux extrémités → retirés");
  attendu(sanitizeUsernameCandidate("ab") === "", "trop court → vide");
  attendu(sanitizeUsernameCandidate("x".repeat(40)).length === 32, "tronqué à USERNAME_MAX");
  attendu(sanitizeUsernameCandidate("-".repeat(40)) === "", "que des séparateurs → vide");
});

verifie("usernameCandidates : priorité et déduplication", () => {
  assert.deepStrictEqual(
    usernameCandidates({ sub: "s", preferredUsername: "marie", email: "m@univ-pau.fr", name: "Marie" }),
    ["marie", "Marie"],
    "ordre : pseudo, e-mail, nom (parties trop courtes écartées)"
  );
  assert.deepStrictEqual(
    usernameCandidates({ sub: "s", preferredUsername: "marie!", email: "marie@univ-pau.fr" }),
    ["marie"],
    "doublons dédupliqués après normalisation"
  );
  assert.deepStrictEqual(usernameCandidates({ sub: "s", preferredUsername: ".." }), ["etudiant"], "rien de recueillable → base générique");
  assert.deepStrictEqual(usernameCandidates({ sub: "s", email: "x" }), ["etudiant"], "e-mail sans @ → rien de recueillable");
});

// --- Filtre de domaine e-mail -----------------------------------------------------

verifie("emailDomainAllowed : libellés complets, sous-domaines inclus", () => {
  attendu(emailDomainAllowed("a@univ-pau.fr", []) === true, "liste vide → tout passe");
  attendu(emailDomainAllowed(undefined, []) === true, "liste vide → même sans e-mail");
  const d = ["univ-pau.fr"];
  attendu(emailDomainAllowed("a@univ-pau.fr", d) === true, "domaine exact");
  attendu(emailDomainAllowed("a@etu.univ-pau.fr", d) === true, "sous-domaine accepté");
  attendu(emailDomainAllowed("a@evil-univ-pau.fr", d) === false, "lookalike refusé");
  attendu(emailDomainAllowed("a@gmail.com", d) === false, "hors domaine refusé");
  attendu(emailDomainAllowed(undefined, d) === false, "sans e-mail → refusé si filtre actif");
  attendu(emailDomainAllowed("a@UNIV-PAU.FR", d) === true, "insensible à la casse");
});

verifie("emailVerifiable : refus seulement si explicitement non vérifié", () => {
  attendu(emailVerifiable(true) === true, "true → exploitable");
  attendu(emailVerifiable(undefined) === true, "absent → exploitable (IdP institutionnel)");
  attendu(emailVerifiable(false) === false, "false → refusé");
  attendu(emailVerifiable("false") === false, "« false » textuel → refusé");
});

verifie("extractIdentity : champs utiles, sans confiance aveugle", () => {
  const id = extractIdentity(
    { sub: "user-1", email: "userinfo@univ-pau.fr", preferred_username: "marie" },
    { sub: "user-1", name: "Marie D" }
  );
  attendu(id.sub === "user-1", "sub obligatoire");
  attendu(id.email === "userinfo@univ-pau.fr", "userinfo prime sur le ID token");
  attendu(id.preferredUsername === "marie", "pseudo lu");
  const id2 = extractIdentity({}, { sub: "user-2", mail: "fallback@univ-pau.fr", nickname: "nick" });
  attendu(id2.email === "fallback@univ-pau.fr", "repli sur « mail » (CAS)");
  attendu(id2.preferredUsername === "nick", "repli sur nickname");
});

verifie("extractIdentity : email_verified à TROIS états (le CAS l'omet souvent)", () => {
  attendu(extractIdentity({}, { sub: "s", email_verified: true }).emailVerified === true, "true → true");
  attendu(extractIdentity({}, { sub: "s" }).emailVerified === undefined, "absent → inconnu (PAS false)");
  attendu(extractIdentity({}, { sub: "s", email_verified: false }).emailVerified === false, "false → false");
  attendu(extractIdentity({}, { sub: "s", email_verified: "false" }).emailVerified === false, "« false » → false");
});

verifie("assertIdTokenAlgAllowed : allowlist stricte d'asymétriques", () => {
  const jwt = (alg: string) =>
    `${Buffer.from(JSON.stringify({ alg, kid: "k" })).toString("base64url")}.${Buffer.from("{}").toString("base64url")}.sig`;
  for (const alg of ["RS256", "PS256", "ES256", "ES384"]) {
    assertIdTokenAlgAllowed(jwt(alg)); // ne jette pas
  }
  for (const alg of ["none", "HS256", "HS384", "HS512"]) {
    attendu(
      (() => {
        try {
          assertIdTokenAlgAllowed(jwt(alg));
          return false;
        } catch (err) {
          return err instanceof OidcLoginError && err.code === "oidc_echec";
        }
      })(),
      `alg ${alg} doit être refusé`
    );
  }
  attendu(
    (() => {
      try {
        assertIdTokenAlgAllowed("pas-un-jwt");
        return false;
      } catch (err) {
        return err instanceof OidcLoginError;
      }
    })(),
    "token malformé refusé"
  );
  attendu(
    (() => {
      try {
        assertIdTokenAlgAllowed("a.b"); // header non décodable
        return false;
      } catch (err) {
        return err instanceof OidcLoginError;
      }
    })(),
    "header inexploitable refusé"
  );
});

verifie("verifyFlowCookie : binding temps constant state ↔ cookie", () => {
  const state = "state-de-test-123";
  const value = createHash("sha256").update(state).digest("hex");
  attendu(verifyFlowCookie(value, state) === true, "cookie correct accepté");
  attendu(verifyFlowCookie(undefined, state) === false, "cookie absent refusé");
  attendu(verifyFlowCookie("a".repeat(64), state) === false, "cookie incohérent refusé");
  attendu(verifyFlowCookie("court", state) === false, "longueur différente refusée");
});

// --- Début / consommation du flux (state single-use) -----------------------------

verifie("deriveCallbackUri : suffixe propre même avec slash final", () => {
  attendu(deriveCallbackUri("https://app.test") === REDIRECT_URI, "origine nue");
  attendu(deriveCallbackUri("https://app.test/") === REDIRECT_URI, "slash final retiré");
});

verifie("APP_DOMAIN + HTTPS_MODE : origine déclarée du déploiement Docker", () => {
  delete process.env.OIDC_REDIRECT_URI;
  delete process.env.TRUST_PROXY;
  const req = { headers: new Headers({ host: "autre.test" }) } as unknown as Request;

  // off : le protocole est connu (http) → l'origine déclarée prime sur
  // l'en-tête Host (forgable par le client). L'URI de rappel SSO n'est PAS
  // dérivée (une URI http n'est en pratique pas déclarable à l'université).
  process.env.APP_DOMAIN = "learngame.univ-pau.fr";
  process.env.HTTPS_MODE = "off";
  attendu(declaredOrigin() === "http://learngame.univ-pau.fr", "off → http://domaine");
  attendu(oidcSettings().redirectUri === undefined, "pas d'URI de rappel dérivée en off");
  attendu(redirectOrigin(req) === "http://learngame.univ-pau.fr", "origine déclarée > Host forgable");

  // self et certs → https://APP_DOMAIN, URI de rappel dérivée.
  process.env.HTTPS_MODE = "self";
  attendu(declaredOrigin() === "https://learngame.univ-pau.fr", "self → https://domaine");
  process.env.HTTPS_MODE = "certs";
  attendu(declaredOrigin() === "https://learngame.univ-pau.fr", "certs → https://domaine");
  attendu(
    oidcSettings().redirectUri === "https://learngame.univ-pau.fr/api/auth/oidc/callback",
    "URI de rappel dérivée du domaine déclaré"
  );
  attendu(
    redirectOrigin(req) === "https://learngame.univ-pau.fr",
    "origine déclarée prioritaire sur les en-têtes"
  );

  // L'override explicite OIDC_REDIRECT_URI gagne sur la dérivation.
  process.env.OIDC_REDIRECT_URI = "https://app-de-test.univ-pau.fr/cb";
  attendu(redirectOrigin(req) === "https://app-de-test.univ-pau.fr", "override > APP_DOMAIN");
  attendu(oidcSettings().redirectUri === "https://app-de-test.univ-pau.fr/cb", "override > dérivation");
  delete process.env.OIDC_REDIRECT_URI;

  // Domaine invalide (chemin, port, nom incomplet) → ignoré, repli en-têtes.
  for (const invalide of ["foo/bar", "host:8443", "a b.fr"]) {
    process.env.APP_DOMAIN = invalide;
    attendu(declaredOrigin() === undefined, `domaine invalide ignoré (« ${invalide} »)`);
  }
  attendu(redirectOrigin(req) === "http://autre.test", "repli sur Host si domaine invalide");

  // « localhost » est valide (tests en LAN), aligné sur le garde-fou du proxy.
  process.env.APP_DOMAIN = "localhost";
  process.env.HTTPS_MODE = "self";
  attendu(declaredOrigin() === "https://localhost", "localhost accepté");

  // Sans déploiement déclaré : TRUST_PROXY → x-forwarded-* (règle clientIp).
  delete process.env.APP_DOMAIN;
  process.env.HTTPS_MODE = "off";
  process.env.TRUST_PROXY = "1";
  const reqProxy = {
    headers: new Headers({
      "x-forwarded-host": "public.univ-pau.fr",
      "x-forwarded-proto": "https",
    }),
  } as unknown as Request;
  attendu(redirectOrigin(reqProxy) === "https://public.univ-pau.fr", "TRUST_PROXY → x-forwarded-*");
  // Repli IPv6 littéral accepté (LAN en IPv6).
  const reqV6 = { headers: new Headers({ host: "[fd42::5]:3000" }) } as unknown as Request;
  attendu(redirectOrigin(reqV6) === "http://[fd42::5]:3000", "hôte IPv6 accepté");
  delete process.env.TRUST_PROXY;
  delete process.env.HTTPS_MODE;
});

verifie("beginOidcLogin : URL d'autorisation complète (PKCE S256, state, nonce)", async () => {
  const { authorizeUrl } = await beginOidcLogin("/games", REDIRECT_URI);
  const url = new URL(authorizeUrl);
  attendu(url.origin + url.pathname === `${ISSUER}/oidcAuthorize`, "redirige vers l'IdP");
  attendu(url.searchParams.get("client_id") === CLIENT_ID, "client_id");
  attendu(url.searchParams.get("redirect_uri") === REDIRECT_URI, "redirect_uri");
  attendu(url.searchParams.get("response_type") === "code", "authorization code flow");
  attendu(url.searchParams.get("scope") === "openid profile email", "scopes");
  attendu(url.searchParams.get("code_challenge_method") === "S256", "PKCE S256, pas plain");
  const challenge = url.searchParams.get("code_challenge") ?? "";
  attendu(/^[A-Za-z0-9_-]{43}$/.test(challenge), "challenge = SHA-256 base64url (43 car.)");
  attendu((url.searchParams.get("state") ?? "").length >= 16, "state aléatoire présent");
  attendu((url.searchParams.get("nonce") ?? "").length >= 16, "nonce aléatoire présent");
});

verifie("consumeOidcFlow : single-use, inconnu et expiré refusés", async () => {
  const { authorizeUrl } = await beginOidcLogin("/studio", REDIRECT_URI);
  const flowState = new URL(authorizeUrl).searchParams.get("state") ?? "";

  const flow = consumeOidcFlow(flowState);
  attendu(flow !== null, "flux consommable une fois");
  attendu(flow?.next_path === "/studio", "destination conservée");
  attendu(flow?.redirect_uri === REDIRECT_URI, "redirect_uri conservé");
  attendu(flow?.nonce === new URL(authorizeUrl).searchParams.get("nonce"), "nonce = celui de la demande");
  attendu(consumeOidcFlow(flowState) === null, "REJOUÉ → refusé (single-use)");
  attendu(consumeOidcFlow("state-forgé") === null, "state inconnu → refusé");

  // Expiration : un flux en base mais périmé est refusé (et supprimé).
  const { authorizeUrl: url2 } = await beginOidcLogin("/", REDIRECT_URI);
  const expiredState = new URL(url2).searchParams.get("state") ?? "";
  db.prepare("UPDATE oidc_flows SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, sha256(expiredState));
  attendu(consumeOidcFlow(expiredState) === null, "flux expiré → refusé");
});

// --- Résolution de compte : création, reconnexion, rattachement -------------------

verifie("resolveOidcAccount : création approuvée, sans mot de passe local", () => {
  const res = resolveOidcAccount(ISSUER, {
    sub: "sub-marie",
    preferredUsername: "marie.dupont",
    email: "marie.dupont@univ-pau.fr",
    emailVerified: true,
  });
  attendu(res.action === "cree", "première connexion → création");
  attendu(res.status === "approved", "compte SSO approuvé d'office");
  attendu(res.username === "marie.dupont", "pseudo dérivé du preferred_username");
  const row = db
    .prepare("SELECT username, password_hash, role, status, email, oidc_issuer, oidc_sub FROM users WHERE id = ?")
    .get(res.userId) as { password_hash: string; role: string; email: string; oidc_issuer: string; oidc_sub: string };
  attendu(row.password_hash === "", "aucun mot de passe local");
  attendu(row.role === "user", "rôle par défaut");
  attendu(row.email === "marie.dupont@univ-pau.fr", "e-mail conservé");
  attendu(row.oidc_issuer === ISSUER && row.oidc_sub === "sub-marie", "identité fédérée liée");
});

verifie("resolveOidcAccount : même identité → même compte, e-mail mis à jour", () => {
  const res = resolveOidcAccount(ISSUER, { sub: "sub-marie", preferredUsername: "marie.dupont", email: "nouveau@univ-pau.fr" });
  attendu(res.action === "reconnu", "identité déjà liée");
  attendu(res.username === "marie.dupont", "même compte");
  const email = (db.prepare("SELECT email FROM users WHERE id = ?").get(res.userId) as { email: string }).email;
  attendu(email === "nouveau@univ-pau.fr", "e-mail rafraîchi depuis l'IdP");
  attendu((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 1, "toujours un seul compte");
});

verifie("resolveOidcAccount : collision de pseudo → suffixe, pas d'usurpation", () => {
  const res = resolveOidcAccount(ISSUER, { sub: "sub-autre", preferredUsername: "marie.dupont", email: "autre@univ-pau.fr" });
  attendu(res.action === "cree", "nouvelle identité");
  attendu(res.username === "marie.dupont-2", "pseudo suffixé, compte distinct");
  attendu(
    (db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'marie.dupont'").get() as { n: number }).n === 1,
    "le compte initial est intact"
  );
});

verifie("resolveOidcAccount : rattachement au compte local par e-mail vérifié", () => {
  // Compte local préexistant (même personne, inscription classique).
  const localId = Number(
    db
      .prepare("INSERT INTO users (username, password_hash, status, email) VALUES (?, ?, 'approved', ?)")
      .run("jean", hashPassword("mot-de-passe-solide"), "jean@univ-pau.fr").lastInsertRowid
  );
  const res = resolveOidcAccount(ISSUER, {
    sub: "sub-jean",
    preferredUsername: "jdupont",
    email: "jean@univ-pau.fr",
    emailVerified: true,
  });
  attendu(res.action === "rattache", "e-mail identique → rattachement");
  attendu(res.userId === localId, "LE compte local existant, pas un doublon");
  attendu(res.username === "jean", "pseudo local conservé");
  const row = db.prepare("SELECT password_hash, oidc_sub FROM users WHERE id = ?").get(localId) as { password_hash: string; oidc_sub: string };
  attendu(row.password_hash.startsWith("scrypt$"), "le mot de passe local reste utilisable");
  attendu(row.oidc_sub === "sub-jean", "identité fédérée posée");
});

verifie("resolveOidcAccount : rattachement insensible à la casse de l'e-mail", () => {
  db.prepare("INSERT INTO users (username, password_hash, status, email) VALUES (?, ?, 'approved', ?)").run("claire", hashPassword("mot-de-passe-solide"), "Claire.Dupont@Univ-Pau.fr");
  const res = resolveOidcAccount(ISSUER, {
    sub: "sub-claire",
    preferredUsername: "cdupont",
    email: "claire.dupont@univ-pau.fr", // IdP en minuscules, compte avec majuscules
    emailVerified: true,
  });
  attendu(res.action === "rattache", "casse différente → rattachement quand même");
  attendu(res.username === "claire", "bon compte local retrouvé");
});

verifie("resolveOidcAccount : e-mail vérifié absent (CAS) → rattachement quand même", () => {
  db.prepare("INSERT INTO users (username, password_hash, status, email) VALUES (?, ?, 'approved', ?)").run("noelie", hashPassword("mot-de-passe-solide"), "noelie@univ-pau.fr");
  // Chaîne complète : extractIdentity sans le claim → resolveOidcAccount.
  const identity = extractIdentity({ sub: "sub-noelie", email: "noelie@univ-pau.fr", preferred_username: "ndupont" }, { sub: "sub-noelie" });
  attendu(identity.emailVerified === undefined, "claim absent → inconnu");
  const res = resolveOidcAccount(ISSUER, identity);
  attendu(res.action === "rattache", "l'absence du claim ne doit pas tuer le rattachement");
  attendu(res.username === "noelie", "bon compte local");
});

verifie("resolveOidcAccount : e-mail explicitement non vérifié → pas de rattachement", () => {
  db.prepare("INSERT INTO users (username, password_hash, status, email) VALUES (?, ?, 'approved', ?)").run("paul", hashPassword("mot-de-passe-solide"), "paul@univ-pau.fr");
  const res = resolveOidcAccount(ISSUER, {
    sub: "sub-inconnu",
    preferredUsername: "pauldup",
    email: "paul@univ-pau.fr",
    emailVerified: false,
  });
  attendu(res.action === "cree", "pas de rattachement sans e-mail vérifié");
  attendu(res.username === "pauldup", "compte distinct créé");
  const paul = db.prepare("SELECT oidc_sub FROM users WHERE username = 'paul'").get() as { oidc_sub: string | null };
  attendu(paul.oidc_sub === null, "le compte local n'a pas été lié");
});

verifie("resolveOidcAccount : un compte lié garde son statut (pending reste pending)", () => {
  db.prepare("INSERT INTO users (username, password_hash, status, email) VALUES (?, ?, 'pending', ?)").run("lea", hashPassword("mot-de-passe-solide"), "lea@univ-pau.fr");
  const res = resolveOidcAccount(ISSUER, {
    sub: "sub-lea",
    preferredUsername: "leadup",
    email: "lea@univ-pau.fr",
    emailVerified: true,
  });
  attendu(res.action === "rattache", "rattachée par e-mail");
  attendu(res.status === "pending", "le SSO ne contourne pas l'approbation");
});

verifie("resolveOidcAccount : ADMIN_USERNAMES s'applique au nom final (création SSO)", () => {
  process.env.ADMIN_USERNAMES = "prof-admin";
  try {
    const res = resolveOidcAccount(ISSUER, { sub: "sub-prof", preferredUsername: "prof-admin" });
    attendu(res.action === "cree", "créé");
    const role = (db.prepare("SELECT role, status FROM users WHERE id = ?").get(res.userId) as { role: string; status: string }).role;
    attendu(role === "admin", "promu admin à la création, comme en inscription locale");
  } finally {
    delete process.env.ADMIN_USERNAMES;
  }
});

verifie("resolveOidcAccount : ADMIN_USERNAMES ne s'applique pas au nom suffixé", () => {
  // « marie.dupont » existe déjà : le suffixe -2 NE doit PAS être promu.
  process.env.ADMIN_USERNAMES = "marie.dupont";
  try {
    const res = resolveOidcAccount(ISSUER, { sub: "sub-autre-2", preferredUsername: "marie.dupont" });
    attendu(res.username === "marie.dupont-3", "suffixé (marie.dupont-2 est déjà pris)");
    const role = (db.prepare("SELECT role FROM users WHERE id = ?").get(res.userId) as { role: string }).role;
    attendu(role === "user", "seul le nom exact est promu");
  } finally {
    delete process.env.ADMIN_USERNAMES;
  }
});

verifie("resolveOidcAccount : identités différentes (issuers) → comptes séparés", () => {
  const res = resolveOidcAccount("https://autre-idp.example", { sub: "sub-marie", preferredUsername: "marie2" });
  attendu(res.action === "cree", "autre émetteur → autre identité, autre compte");
});

verifie("resolveOidcAccount : seconde identité sur un e-mail déjà fédéré → compte séparé", () => {
  // marie.dupont (sub-marie) est déjà liée avec son e-mail ; une AUTRE
  // identité qui annonce le même e-mail ne doit pas prendre son compte.
  const countBefore = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  const res = resolveOidcAccount(ISSUER, {
    sub: "sub-imposteur",
    preferredUsername: "imposteur",
    email: "nouveau@univ-pau.fr", // e-mail actuel de marie (mis à jour plus haut)
    emailVerified: true,
  });
  attendu(res.action === "cree", "e-mail déjà porté par un compte fédéré → création");
  attendu(res.username === "imposteur", "compte distinct créé");
  const marie = db.prepare("SELECT oidc_sub, id FROM users WHERE username = 'marie.dupont'").get() as { oidc_sub: string };
  attendu(marie.oidc_sub === "sub-marie", "le rattachement initial de marie est intact");
  attendu((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === countBefore + 1, "exactement un compte ajouté");
});

// --- Fin ------------------------------------------------------------------------

// Les vérifications asynchrones s'exécutent en tâche de fond : laisser le
// micro-tâche s'aplanir avant le bilan.
setTimeout(() => {
  console.log(`\n${total - failures}/${total} vérifications réussies`);
  process.exit(failures > 0 ? 1 : 0);
}, 300);
