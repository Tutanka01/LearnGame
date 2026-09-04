// Connexion SSO par OpenID Connect (ex. : le CAS de l'université).
//
// Philosophie identique à session.ts : ce module ne contient AUCUN import Next
// — les routes d'API ne font que coller les redirections autour. Tout ce qui
// est contrôlable est vérifié ici :
//   - flux « authorization code » avec PKCE S256 (même pour un client
//     confidentiel : le code volé ne sert à rien sans le verifier),
//   - `state` anti-CSRF aléatoire stocké en base sous forme de SHA-256,
//     SINGLE-USE et expirant (10 min) — rejouer un callback échoue,
//   - `nonce` lié à la réponse (vérifié par openid-client via expectedNonce),
//   - signature du ID token vérifiée par openid-client contre le JWKS de
//     l'émetteur, avec double contrôle local : l'alg utilisé doit appartenir à
//     une allowlist STRICTE d'asymétriques (le CAS annonce aussi "none" et
//     HS256 dans sa découverte — jamais acceptés ici),
//   - `redirect_uri` reconstruit depuis celui STOCKÉ dans le flux : l'échange
//     du code correspond exactement à la demande d'autorisation, même derrière
//     un proxy capricieux sur les en-têtes,
//   - identité fédérée = (émetteur, sub) en base ; jamais de confiance dans le
//     pseudo renvoyé (un étudiant ne peut pas « prendre » un compte local par
//     son pseudo, seulement par rattachement d'e-mail contrôlé).
//
// Confidentialité : ni l'access token ni le refresh token ne sont conservés —
// les scopes demandés (openid profile email) ne donnent pas de refresh token,
// et l'access token est jeté après l'appel userinfo.

import * as client from "openid-client";
import { createHash, timingSafeEqual } from "crypto";
import db, { isAdminUsername, withTransaction } from "./db";
import { USERNAME_MAX, USERNAME_MIN } from "./authValidate";
import type { Configuration } from "openid-client";

// Cookie qui LIE le flux au navigateur (anti login-CSRF) : posé au départ du
// flux, exigé au callback. Sans lui, une URL de callback volée par un
// attaquant (ayant fait SON identification au SSO) connecterait la victime au
// compte de l'attaquant — l'attaquant ne peut pas poser de cookie sur notre
// domaine, donc l'attaque tombe (RFC 9700 §4.5/4.8).
export const OIDC_FLOW_COOKIE = "lg_oidc_flow";

// Durée de vie d'un flux de connexion : le temps de s'identifier au SSO,
// largement au-delà. Au-delà, le callback est refusé (état inconnu).
const FLOW_TTL_MS = 10 * 60 * 1000;

// Allowlist stricte des algorithmes de signature du ID token : asymétriques
// uniquement (vérification contre le JWKS de l'émetteur). "none" et tous les
// HS* (secret partagé) sont refusés par principe de précaution.
const ID_TOKEN_ALG_ALLOWLIST = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
]);

// ---------------------------------------------------------------------------
// Configuration (variables d'environnement, lues à l'appel pour les tests)
// ---------------------------------------------------------------------------

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** URL de rappel explicite ; sinon déduite de l'origine des requêtes. */
  redirectUri?: string;
  scopes: string;
  /** Suffixes de domaine e-mail autorisés ; vide = tous (l'IdP fait foi). */
  allowedDomains: string[];
  /** Méthode d'authentification au token endpoint (défaut : post). */
  tokenAuth: "basic" | "post";
}

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

export function oidcSettings(): OidcSettings {
  const declared = declaredOrigin();
  const httpsDeclared = declared !== undefined && deploymentIsHttps();
  return {
    issuer: env("OIDC_ISSUER") ?? "",
    clientId: env("OIDC_CLIENT_ID") ?? "",
    clientSecret: env("OIDC_CLIENT_SECRET") ?? "",
    // Override explicite > domaine déclaré en HTTPS par le déploiement
    // (APP_DOMAIN + HTTPS_MODE=self|certs) > rien (l'URI sera déduite des
    // en-têtes, avec avertissement). En HTTPS_MODE=off, pas de dérivation :
    // une URI de rappel http n'est en pratique pas déclarable à l'université,
    // autant exiger le choix explicite.
    redirectUri:
      env("OIDC_REDIRECT_URI") ?? (httpsDeclared ? `${declared}/api/auth/oidc/callback` : undefined),
    scopes: env("OIDC_SCOPES") ?? "openid profile email",
    allowedDomains: (env("OIDC_ALLOWED_DOMAINS") ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    tokenAuth: env("OIDC_TOKEN_AUTH") === "basic" ? "basic" : "post",
  };
}

/** Le SSO est-il configuré ? (check synchrone : page de connexion, routes) */
export function isOidcEnabled(): boolean {
  const s = oidcSettings();
  return Boolean(s.issuer && s.clientId && s.clientSecret);
}

/**
 * Origine déclarée par l'opérateur via le déploiement Docker intégré :
 * APP_DOMAIN + HTTPS_MODE. Une seule source de vérité pour le domaine : le
 * proxy Caddy s'en sert comme adresse de site, l'app en déduit les
 * redirections internes (et l'URI de rappel SSO quand le mode est https).
 *
 *   - self | certs → https://APP_DOMAIN ;
 *   - off          → http://APP_DOMAIN (le protocole est CONNU : autant
 *     l'utiliser plutôt que l'en-tête Host, forgable par le client) ;
 *   - APP_DOMAIN absent ou invalide → undefined (repli sur les en-têtes).
 *
 * Domaine strictement nu (lettres/chiffres/points/tirets, PAS de port : la
 * topologie intégrée ne sert que 80/443) — ce qui exclut aussi toute
 * injection dans la configuration ou les URL générées.
 */
export function declaredOrigin(): string | undefined {
  const domain = process.env.APP_DOMAIN?.trim();
  const mode = process.env.HTTPS_MODE?.trim();
  if (!domain) return undefined;
  // Garde-fou : domaine nu, pas de port ni de caractère exotique ; « localhost »
  // accepté (tests en LAN), sinon un point est exigé (pas de nom incomplet).
  if (!/^[a-zA-Z0-9.\-]+$/.test(domain)) return undefined;
  if (domain !== "localhost" && !domain.includes(".")) return undefined;
  if (mode === "self" || mode === "certs") return `https://${domain}`;
  if (mode === "off") return `http://${domain}`;
  return undefined;
}

/** Le déploiement déclaré est-il en HTTPS ? (self ou certs) */
function deploymentIsHttps(): boolean {
  const mode = process.env.HTTPS_MODE?.trim();
  return mode === "self" || mode === "certs";
}

/** URI de rappel pour une origine donnée (si OIDC_REDIRECT_URI n'est pas fixé). */
export function deriveCallbackUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/auth/oidc/callback`;
}

/**
 * Origine à utiliser pour les URL de redirection (vers /login en cas d'erreur,
 * vers la destination post-login, et pour dériver l'URI de rappel si
 * OIDC_REDIRECT_URI n'est pas fixé).
 *
 * `req.url` n'est PAS fiable pour ça : `next start` le réécrit en
 * http://localhost:<port> quel que soit l'hôte servi. Ordre de confiance :
 *   1. OIDC_REDIRECT_URI (override explicite) ;
 *   2. APP_DOMAIN + HTTPS_MODE (déploiement Docker intégré : http en off,
 *      https en self/certs — cf. declaredOrigin) ;
 *   3. x-forwarded-host/proto, si l'opérateur déclare un proxy de confiance
 *      qui ÉCRASE ces en-têtes (`TRUST_PROXY=1`) — même règle que clientIp() ;
 *   4. l'en-tête `Host` du navigateur (repli : APP_DOMAIN non renseigné).
 */
export function redirectOrigin(req: Request): string {
  // 1. Override explicite (avertissement si défini mais inexploitable : un
  //    diagnostic final « URI non enregistrée à l'IdP » est très loin de la
  //    vraie cause — une typo dans la variable).
  const configured = process.env.OIDC_REDIRECT_URI?.trim();
  if (configured) {
    try {
      const u = new URL(configured);
      if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
    } catch {
      /* ci-dessous */
    }
    console.warn(
      `SSO OIDC : OIDC_REDIRECT_URI définie mais inexploitable (« ${configured} ») — attendu une URL complète, ex. https://mon-domaine/api/auth/oidc/callback.`
    );
  }
  // 2. Domaine déclaré par le déploiement (APP_DOMAIN + HTTPS_MODE, protocole
  //    connu — http en off, https en self/certs) : plus fiable que tout
  //    en-tête.
  const declared = declaredOrigin();
  if (declared) return declared;
  // 3. x-forwarded-host/proto, si l'opérateur déclare un proxy de confiance
  //    qui ÉCRASE ces en-têtes (`TRUST_PROXY=1`) — même règle que clientIp().
  const trusted = process.env.TRUST_PROXY === "1";
  const host =
    (trusted ? req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : undefined) ??
    req.headers.get("host")?.trim();
  const proto = trusted
    ? (req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http")
    : "http";
  // Strict : un Host exotique (injection, espaces) retombe sur le repli. La
  // forme [IPv6]:port est acceptée (LAN en IPv6).
  if (
    (/^[a-zA-Z0-9.\-]+(:\d{1,5})?$/.test(host ?? "") ||
      /^\[[0-9a-fA-F:]+\](:\d{1,5})?$/.test(host ?? "")) &&
    host
  ) {
    return `${proto}://${host}`;
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost";
  }
}

// ---------------------------------------------------------------------------
// Client OIDC (découverte mise en cache par redirect_uri, survit au HMR)
// ---------------------------------------------------------------------------

const globalForOidc = globalThis as unknown as {
  __lgOidcClients?: Map<string, Promise<Configuration>>;
};
const clientCache = (globalForOidc.__lgOidcClients ??= new Map());

/** Exporté pour les tests : pré-remplir le cache avec un client sans réseau. */
export const oidcClientCache = clientCache;

// Avertissement « OIDC_REDIRECT_URI absent » : une seule fois par process
// (c'est un rappel opérateur, pas un événement par requête).
const globalForOidcWarn = globalThis as unknown as { __lgOidcWarnedRedirect?: boolean };

function clientCacheKey(redirectUri: string): string {
  const s = oidcSettings();
  return `${s.issuer}|${s.clientId}|${redirectUri}`;
}

async function clientForRedirect(redirectUri: string): Promise<Configuration> {
  const key = clientCacheKey(redirectUri);
  let entry = clientCache.get(key);
  if (!entry) {
    const s = oidcSettings();
    if (!s.redirectUri && !globalForOidcWarn.__lgOidcWarnedRedirect) {
      globalForOidcWarn.__lgOidcWarnedRedirect = true;
      console.warn(
        "SSO OIDC : OIDC_REDIRECT_URI n'est pas fixé — l'URI de rappel est déduite de " +
          "l'origine servie. En production (reverse proxy), la fixer explicitement."
      );
    }
    // La découverte valide l'issuer de la réponse contre l'URL demandée
    // (protection anti mix-up). Défaut : auth client_secret_post — le CAS de
    // l'université l'annonce ; OIDC_TOKEN_AUTH=basic pour un IdP qui ne
    // supporterait que client_secret_basic.
    const auth = s.tokenAuth === "basic" ? client.ClientSecretBasic(s.clientSecret) : undefined;
    entry = client.discovery(new URL(s.issuer), s.clientId, s.clientSecret, auth).then((c) => {
      c.timeout = 15; // discovery/token/userinfo : pas de requête suspendue
      const methods = c.serverMetadata().code_challenge_methods_supported;
      if (methods && !methods.includes("S256")) {
        throw new Error("L'IdP ne supporte pas PKCE S256 — SSO désactivé par prudence.");
      }
      return c;
    });
    entry.catch(() => clientCache.delete(key)); // une découverte ratée peut être retentée
    // Éviction FIFO : la clé contient l'URI de rappel, tenons le cache borné
    // quelle que soit la qualité de la configuration (10 clients = très large).
    if (clientCache.size >= 10) {
      const oldest = clientCache.keys().next().value;
      if (oldest !== undefined) clientCache.delete(oldest);
    }
    clientCache.set(key, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Flux de connexion (state/nonce/verifier persistés, single-use)
// ---------------------------------------------------------------------------

export interface OidcFlowRow {
  code_verifier: string;
  nonce: string;
  redirect_uri: string;
  next_path: string;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Le cookie de binding correspond-il à ce state ? (comparaison temps constant) */
export function verifyFlowCookie(cookie: string | undefined, state: string): boolean {
  if (!cookie) return false;
  const expected = Buffer.from(sha256(state));
  let actual: Buffer;
  try {
    actual = Buffer.from(cookie);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Démarre un login SSO : persiste le flux (state haché, verifier PKCE, nonce,
 * redirect_uri, destination post-login) puis construit l'URL d'autorisation.
 * Retourne l'URL vers laquelle rediriger le navigateur + la valeur du cookie
 * de binding à poser (anti login-CSRF, vérifiée au callback).
 */
export async function beginOidcLogin(
  nextPath: string,
  redirectUri: string
): Promise<{ authorizeUrl: string; flowCookie: string }> {
  const s = oidcSettings();
  if (!s.scopes.split(/\s+/).includes("openid")) {
    // Sans le scope openid, pas de ID token : chaque login échouerait avec un
    // message opaque — autant refuser au départ, lisible dans les journaux.
    throw new Error("OIDC_SCOPES doit inclure « openid ».");
  }
  const config = await clientForRedirect(redirectUri);

  const state = client.randomState();
  const codeVerifier = client.randomPKCECodeVerifier();
  const nonce = client.randomNonce();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  // Purge des flux expirés au passage (même principe que auth_sessions).
  const now = Date.now();
  db.prepare("DELETE FROM oidc_flows WHERE expires_at <= ?").run(now);
  db.prepare(
    `INSERT INTO oidc_flows (id, code_verifier, nonce, redirect_uri, next_path, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sha256(state), codeVerifier, nonce, redirectUri, nextPath, now, now + FLOW_TTL_MS);

  const authorizeUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: s.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return { authorizeUrl: authorizeUrl.href, flowCookie: sha256(state) };
}

/**
 * Consomme le flux désigné par `state` (déjà validé par sa présence en base) :
 * lecture + DELETE dans une transaction — un callback rejoué est refusé.
 * Retourne null si le flux est inconnu ou expiré.
 */
export function consumeOidcFlow(state: string): OidcFlowRow | null {
  if (!state || state.length > 512) return null;
  const id = sha256(state);
  return withTransaction(() => {
    const row = db
      .prepare(
        "SELECT code_verifier, nonce, redirect_uri, next_path, expires_at FROM oidc_flows WHERE id = ?"
      )
      .get(id) as
      | { code_verifier: string; nonce: string; redirect_uri: string; next_path: string; expires_at: number }
      | undefined;
    if (!row) return null;
    db.prepare("DELETE FROM oidc_flows WHERE id = ?").run(id);
    if (row.expires_at <= Date.now()) return null;
    return {
      code_verifier: row.code_verifier,
      nonce: row.nonce,
      redirect_uri: row.redirect_uri,
      next_path: row.next_path,
    };
  });
}

// ---------------------------------------------------------------------------
// Résolution de l'identité vers un compte
// ---------------------------------------------------------------------------

/** Erreur de flux SSO avec un code de l'ensemble fermé d'oidcMessages. */
export class OidcLoginError extends Error {
  constructor(public readonly code: string) {
    super(`Erreur SSO OIDC : ${code}`);
  }
}

export interface OidcIdentity {
  /** Sujet opaque et stable de l'IdP — LA clé de l'identité fédérée. */
  sub: string;
  preferredUsername?: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
}

/** L'e-mail est-il exploitable pour rattacher un compte ? Refus uniquement
 * s'il est explicitement marqué non vérifié par l'IdP : le SSO universitaire
 * ne délivre que des identités institutionnelles, et nombre d'IdP (CAS inclus)
 * délivrent l'e-mail sans le claim email_verified — l'absence est traitée
 * comme « inconnu », pas comme « non vérifié ». */
export function emailVerifiable(emailVerified: unknown): boolean {
  return emailVerified !== false && emailVerified !== "false" && emailVerified !== 0;
}

/**
 * Filtre par suffixe de domaine (OIDC_ALLOWED_DOMAINS) : correspondance sur
 * des libellés complets — « evil-univ-pau.fr » ne passe PAS pour
 * « univ-pau.fr », mais « etu.univ-pau.fr » oui.
 */
export function emailDomainAllowed(email: string | undefined, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email?.split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  return allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Réduit un identifiant exogène (pseudo IdP, partie locale d'e-mail, nom
 * affiché) à un candidat de pseudo conforme aux règles du projet : caractères
 * autorisés (les autres deviennent des tirets), séparateurs interdits aux
 * extrémités, bornes USERNAME_MIN/MAX respectées. Chaîne vide si rien de
 * recueillable.
 */
export function sanitizeUsernameCandidate(raw: string): string {
  const cleaned = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .slice(0, USERNAME_MAX)
    .replace(/^[-._]+|[-._]+$/g, "");
  return cleaned.length >= USERNAME_MIN ? cleaned : "";
}

/** Candidats de pseudo par ordre de préférence, dédupliqués. */
export function usernameCandidates(identity: OidcIdentity): string[] {
  const out: string[] = [];
  const raws = [identity.preferredUsername, identity.email?.split("@")[0], identity.name];
  for (const raw of raws) {
    if (!raw) continue;
    const candidate = sanitizeUsernameCandidate(raw);
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  // Dernier recours : base générique qui sera suffixée jusqu'à être unique.
  if (out.length === 0) out.push("etudiant");
  return out;
}

export type OidcAccountAction = "reconnu" | "rattache" | "cree";

interface UserRow {
  id: number;
  username: string;
  status: string;
  email?: string | null;
  oidc_sub?: string | null;
}

export interface OidcLoginResult {
  userId: number;
  username: string;
  status: string;
  action: OidcAccountAction;
}

/**
 * Ouvre (ou retrouve) le compte correspondant à l'identité fédérée.
 *
 * Politique (choisie par l'opérateur) :
 *  1. une identité déjà liée reconnecte SON compte (e-mail mis à jour si
 *     l'IdP en annonce un nouveau) ;
 *  2. sinon, si l'IdP donne un e-mail exploitable, le compte local portant
 *     cet e-mail est RATTACHÉ (pas de doublon pour la même personne) — un
 *     compte n'accepte qu'une seule identité fédérée (index unique) ;
 *  3. sinon création d'un compte immédiatement approuvé : l'identité est déjà
 *     vérifiée par l'université. ADMIN_USERNAMES s'applique au nom final
 *     (suffixé en cas de collision), comme pour une inscription locale.
 */
export function resolveOidcAccount(issuer: string, identity: OidcIdentity): OidcLoginResult {
  return withTransaction(() => {
    // 1. Identité déjà fédérée → son compte, quel que soit l'e-mail actuel.
    const bound = db
      .prepare(
        "SELECT id, username, status, email FROM users WHERE oidc_issuer = ? AND oidc_sub = ?"
      )
      .get(issuer, identity.sub) as unknown as UserRow | undefined;
    if (bound) {
      if (identity.email && identity.email !== bound.email) {
        db.prepare("UPDATE users SET email = ? WHERE id = ?").run(identity.email, bound.id);
      }
      return { userId: bound.id, username: bound.username, status: bound.status, action: "reconnu" };
    }

    // 2. Rattachement par e-mail à un compte local existant (jamais à un
    // compte déjà fédéré — il aurait été trouvé à l'étape 1, mais gardons le
    // garde-fou explicite). Comparaison insensible à la casse : l'IdP et
    // l'inscription locale peuvent diverger sur les majuscules.
    if (identity.email && emailVerifiable(identity.emailVerified)) {
      const local = db
        .prepare(
          "SELECT id, username, status, oidc_sub FROM users WHERE lower(email) = lower(?) ORDER BY id ASC LIMIT 1"
        )
        .get(identity.email) as unknown as UserRow | undefined;
      if (local && !local.oidc_sub) {
        try {
          const res = db
            .prepare(
              "UPDATE users SET oidc_issuer = ?, oidc_sub = ? WHERE id = ? AND oidc_sub IS NULL"
            )
            .run(issuer, identity.sub, local.id);
          if (res.changes > 0) {
            return {
              userId: local.id,
              username: local.username,
              status: local.status,
              action: "rattache",
            };
          }
        } catch (err) {
          // Course entre deux requêtes qui lient la MÊME identité : la
          // contrainte unique (issuer, sub) a tranché — relecture ci-dessous.
          if (!(err instanceof Error && err.message.includes("UNIQUE constraint failed"))) throw err;
        }
        // Course perdue : l'identité vient d'être liée par une requête
        // concurrente — relecture, l'étape 1 la retrouvera.
        const raced = db
          .prepare("SELECT id, username, status FROM users WHERE oidc_issuer = ? AND oidc_sub = ?")
          .get(issuer, identity.sub) as unknown as UserRow | undefined;
        if (raced) {
          return {
            userId: raced.id,
            username: raced.username,
            status: raced.status,
            action: "reconnu",
          };
        }
      }
    }

    // 3. Création : compte approuvé d'office (identité universitaire vérifiée),
    // sans mot de passe local (password_hash = '' : aucune connexion locale
    // possible tant qu'un mot de passe n'est pas posé par un enseignant).
    const candidates = usernameCandidates(identity);
    for (const base of candidates) {
      for (let i = 0; i < 50; i++) {
        const username = i === 0 ? base : `${base}-${i + 1}`;
        if (username.length > USERNAME_MAX) continue;
        const role = isAdminUsername(username) ? "admin" : "user";
        try {
          const res = db
            .prepare(
              "INSERT INTO users (username, password_hash, role, status, email, oidc_issuer, oidc_sub) VALUES (?, '', ?, 'approved', ?, ?, ?)"
            )
            .run(username, role, identity.email ?? null, issuer, identity.sub);
          if (role === "admin") {
            // Privilège critique accordé sur un nom dérivé de l'IdP : trace
            // de journal pour audit (même règle que l'inscription locale,
            // mais la provenance SSO mérite d'être visible).
            console.log(
              `SSO OIDC : compte « ${username} » créé avec le rôle admin (liste ADMIN_USERNAMES).`
            );
          }
          return {
            userId: Number(res.lastInsertRowid),
            username,
            status: "approved",
            action: "cree",
          };
        } catch (err) {
          // Collision de pseudo (course ou base déjà remplie) : suffixe suivant.
          if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) continue;
          throw err;
        }
      }
    }
    // Extrêmement improbable (50 suffixes tous pris pour chaque candidat) :
    // nom aléatoire, unique par construction.
    const fallback = `etudiant-${createHash("sha256").update(issuer + identity.sub).digest("hex").slice(0, 12)}`;
    try {
      const res = db
        .prepare(
          "INSERT INTO users (username, password_hash, role, status, email, oidc_issuer, oidc_sub) VALUES (?, '', ?, 'approved', ?, ?, ?)"
        )
        .run(
          fallback,
          isAdminUsername(fallback) ? "admin" : "user",
          identity.email ?? null,
          issuer,
          identity.sub
        );
      return {
        userId: Number(res.lastInsertRowid),
        username: fallback,
        status: "approved",
        action: "cree",
      };
    } catch (err) {
      // La contrainte unique partielle (issuer, sub) a tranché une course :
      // l'identité existe déjà → relecture.
      const raced = db
        .prepare("SELECT id, username, status FROM users WHERE oidc_issuer = ? AND oidc_sub = ?")
        .get(issuer, identity.sub) as unknown as UserRow | undefined;
      if (raced) {
        return {
          userId: raced.id,
          username: raced.username,
          status: raced.status,
          action: "reconnu",
        };
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Fin du flux : échange du code + userinfo + résolution
// ---------------------------------------------------------------------------

/**
 * Double contrôle local : l'alg du ID token doit être un asymétrique connu.
 * (openid-client vérifie déjà la signature contre le JWKS ; cette allowlist
 * documente et fige la politique quoi que fasse la librairie — le CAS annonce
 * « none » et HS256 dans sa découverte : jamais acceptés ici.)
 * Exporté pour les tests (la seule défense anti-confusion d'alg).
 */
export function assertIdTokenAlgAllowed(idToken: string): void {
  const headerPart = idToken.split(".")[0];
  if (!headerPart) throw new OidcLoginError("oidc_echec");
  try {
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as {
      alg?: unknown;
    };
    if (typeof header.alg !== "string" || !ID_TOKEN_ALG_ALLOWLIST.has(header.alg)) {
      throw new OidcLoginError("oidc_echec");
    }
  } catch (err) {
    if (err instanceof OidcLoginError) throw err;
    throw new OidcLoginError("oidc_echec");
  }
}

/** Extrait l'identité utile des claims (userinfo en priorité), sans confiance aveugle. */
export function extractIdentity(
  claims: Record<string, unknown>,
  fallback: Record<string, unknown>
): OidcIdentity {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const source: Record<string, unknown> = { ...fallback, ...claims };
  return {
    sub: String(source.sub),
    preferredUsername: str(source.preferred_username) ?? str(source.nickname),
    name: str(source.name) ?? str(source.given_name),
    email: str(source.email) ?? str(source.mail),
    // TROIS états (true / false / inconnu) : beaucoup d'IdP, dont le CAS,
    // délivrent l'e-mail sans le claim email_verified — l'absence ne doit pas
    // être lue comme un refus de vérification (cf. emailVerifiable).
    emailVerified:
      source.email_verified === true
        ? true
        : source.email_verified === false || source.email_verified === "false"
          ? false
          : undefined,
  };
}

/**
 * Termine le login : échange le code (PKCE, state, nonce déjà contrôlés par
 * openid-client), vérifie la signature du ID token, récupère l'e-mail/pseudo
 * via userinfo, puis résout le compte. Jette OidcLoginError (codes fermés).
 */
export async function finishOidcLogin(
  flow: OidcFlowRow,
  state: string,
  responseParams: URLSearchParams
): Promise<OidcLoginResult> {
  const s = oidcSettings();
  const config = await clientForRedirect(flow.redirect_uri);

  // L'URL passée au grant est reconstruite depuis le redirect_uri STOCKÉ dans
  // le flux : l'échange au token endpoint correspondra exactement à la demande
  // d'autorisation, indépendamment des en-têtes de proxy vus au callback.
  const callbackUrl = new URL(flow.redirect_uri);
  for (const [key, value] of responseParams) {
    callbackUrl.searchParams.set(key, value);
  }

  let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
  try {
    tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: flow.code_verifier,
      expectedState: state,
      expectedNonce: flow.nonce,
    });
  } catch (err) {
    console.error("SSO OIDC : échange du code refusé par l'IdP.", err);
    throw new OidcLoginError("oidc_echec");
  }

  if (!tokens.id_token) throw new OidcLoginError("oidc_echec");
  assertIdTokenAlgAllowed(tokens.id_token);

  const idClaims = tokens.claims();
  if (!idClaims || typeof idClaims.sub !== "string" || !idClaims.sub) {
    throw new OidcLoginError("oidc_echec");
  }
  const sub = idClaims.sub;

  // userinfo : e-mail / pseudo à jour. En cas d'indisponibilité, les claims du
  // ID token suffisent (le sub y est déjà vérifié par la signature).
  let info: Record<string, unknown> = idClaims as unknown as Record<string, unknown>;
  try {
    info = (await client.fetchUserInfo(config, tokens.access_token, sub)) as Record<string, unknown>;
  } catch (err) {
    console.error("SSO OIDC : userinfo indisponible, repli sur les claims du ID token.", err);
  }

  const identity = extractIdentity(info, idClaims as unknown as Record<string, unknown>);
  if (identity.sub !== sub) throw new OidcLoginError("oidc_echec");

  // Filtre de domaine (inactif tant qu'OIDC_ALLOWED_DOMAINS est vide).
  if (!emailDomainAllowed(identity.email, s.allowedDomains)) {
    throw new OidcLoginError("oidc_compte_non_autorise");
  }

  return resolveOidcAccount(s.issuer, identity);
}
