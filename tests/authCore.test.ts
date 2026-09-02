// Test ad hoc du noyau d'authentification : authValidate.ts (pur) + session.ts
// (hachage scrypt, sessions en base). session.ts touche la base via db.ts, qui
// ouvre process.cwd()/data/learngame.db — exécuter depuis un répertoire VIDE :
//   cd "$(mktemp -d)" && npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/authCore.test.ts

import path from "path";
import fs from "fs";
import { createHash, randomBytes, scryptSync } from "crypto";
import {
  USERNAME_MIN,
  USERNAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  validateUsername,
  validatePassword,
  passwordStrength,
} from "../src/lib/authValidate";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  burnScryptTime,
  createSession,
  getSessionUser,
  revokeSession,
  revokeAllUserSessions,
  type SessionUser,
} from "../src/lib/session";
import db from "../src/lib/db";

// Garde-fou : refuser de toucher une vraie base (db.ts ouvre le cwd).
const dataDir = path.join(process.cwd(), "data");
if (fs.existsSync(path.join(dataDir, "learngame.db"))) {
  console.error("Refus : une base existe déjà ici. Lancer depuis un répertoire temporaire vide.");
  process.exit(1);
}

// --- Harnais maison : assertions qui jettent + compteur -----------------------

let total = 0;
let failures = 0;

function attendu(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function verifie(name: string, fn: () => void): void {
  total++;
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} → ${err instanceof Error ? err.message : String(err)}`);
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const TRENTE_JOURS = 30 * 24 * 3600 * 1000;

// Noms d'utilisateurs / mots de passe : petits raccourcis lisibles.
function refuseNom(raw: string): void {
  attendu(validateUsername(raw) !== null, "accepté à tort");
}
function accepteNom(raw: string): void {
  const err = validateUsername(raw);
  attendu(err === null, `refusé à tort : ${err}`);
}
function refuseMdp(p: string): void {
  attendu(validatePassword(p) !== null, "accepté à tort");
}
function accepteMdp(p: string): void {
  const err = validatePassword(p);
  attendu(err === null, `refusé à tort : ${err}`);
}
function exigeUser(token: string): SessionUser {
  const u = getSessionUser(token);
  if (u === null) throw new Error(`session attendue, reçue null (token ${token.slice(0, 8)}…)`);
  return u;
}

// --- Fixtures scrypt (calculées une fois, hors des checks) --------------------
// Hash au format COURANT et hash à l'ANCIEN format (salt:hash, coûts par
// défaut de Node, clé de 64 octets) — comme les comptes créés avant migration.
const MOT_DE_PASSE = "mot-de-passe-solide-42";
const hashCourant = hashPassword(MOT_DE_PASSE);
const saltAncien = randomBytes(16);
const hashAncien =
  saltAncien.toString("hex") + ":" + scryptSync("ancien-mot-de-passe", saltAncien, 64).toString("hex");

// --- authValidate : validateUsername ------------------------------------------

function testNomsUtilisateur(): void {
  verifie(
    `constantes exportées (USERNAME_MIN=${USERNAME_MIN}, USERNAME_MAX=${USERNAME_MAX}, PASSWORD_MIN=${PASSWORD_MIN}, PASSWORD_MAX=${PASSWORD_MAX})`,
    () => {
      attendu(
        USERNAME_MIN === 3 && USERNAME_MAX === 32 && PASSWORD_MIN === 8 && PASSWORD_MAX === 256,
        "constantes inattendues"
      );
    }
  );
  verifie('validateUsername : «  » refusé', () => refuseNom(""));
  verifie('validateUsername : « ab » (2 caractères) refusé', () => refuseNom("ab"));
  verifie("validateUsername : 33 caractères refusés", () => refuseNom("a".repeat(33)));
  verifie('validateUsername : « .marie » (séparateur initial) refusé', () => refuseNom(".marie"));
  verifie('validateUsername : « marie- » (séparateur final) refusé', () => refuseNom("marie-"));
  verifie('validateUsername : « ma rie » (espace interdite) refusé', () => refuseNom("ma rie"));
  verifie('validateUsername : « marie.dupont_1 » accepté', () => accepteNom("marie.dupont_1"));
  verifie('validateUsername : « émile_2 » (lettres accentuées) accepté', () => accepteNom("émile_2"));
  verifie('validateUsername : «   marie   » (espaces retirés) accepté', () => accepteNom("  marie  "));
  verifie("validateUsername : bornes acceptées (3 et 32 caractères)", () => {
    accepteNom("abc");
    accepteNom("a".repeat(32));
  });
}

// --- authValidate : validatePassword ------------------------------------------

function testMotsDePasse(): void {
  verifie('validatePassword : «  » refusé', () => refuseMdp(""));
  verifie('validatePassword : « court » (< 8 caractères) refusé', () => refuseMdp("court"));
  verifie("validatePassword : 257 caractères refusés", () => refuseMdp("a".repeat(257)));
  verifie("validatePassword : 8 caractères accepté", () => accepteMdp("a".repeat(8)));
  verifie("validatePassword : 256 caractères accepté", () => accepteMdp("a".repeat(256)));
}

// --- authValidate : passwordStrength ------------------------------------------
// Le plafonnement « trop répandu » est testé avec des mots réellement présents
// dans COMMON_PASSWORDS (dont les variantes azerty12 / password1!).

function testForceMotDePasse(): void {
  verifie('passwordStrength : «  » → score 0, libellé vide', () => {
    const s = passwordStrength("");
    attendu(s.score === 0 && s.label === "", `reçu ${JSON.stringify(s)}`);
  });
  verifie('passwordStrength : « azertyuiop » (répandu) → 1 « Faible »', () => {
    const s = passwordStrength("azertyuiop");
    attendu(s.score === 1 && s.label === "Faible", `reçu ${s.score} « ${s.label} »`);
  });
  verifie('passwordStrength : « password1 » (répandu, 2 classes) plafonné à 1', () => {
    attendu(passwordStrength("password1").score === 1, "score > 1 : plafonnement inopérant");
  });
  verifie('passwordStrength : « bienvenue1 » (répandu, 2 classes) plafonné à 1', () => {
    attendu(passwordStrength("bienvenue1").score === 1, "score > 1 : plafonnement inopérant");
  });
  verifie('passwordStrength : « MotDePasseLong123! » → 4 « Excellent »', () => {
    const s = passwordStrength("MotDePasseLong123!");
    attendu(s.score === 4 && s.label === "Excellent", `reçu ${s.score} « ${s.label} »`);
  });
  verifie('passwordStrength : « aaaaaaaa » (une seule classe) ≤ 2', () => {
    attendu(passwordStrength("aaaaaaaa").score <= 2, "score trop élevé pour un mot uniforme");
  });
  // Variantes très répandues ajoutées à COMMON_PASSWORDS : plafonnées à 1.
  verifie('passwordStrength : « azerty12 » (répandu) plafonné à 1', () => {
    attendu(passwordStrength("azerty12").score === 1, "score > 1 : plafonnement inopérant");
  });
  verifie('passwordStrength : « password1! » (répandu, 3 classes) plafonné à 1', () => {
    attendu(passwordStrength("password1!").score === 1, "score > 1 : plafonnement inopérant");
  });
}

// --- session : hachage et vérification des mots de passe -----------------------

function testHachage(): void {
  verifie("hashPassword : format versionné scrypt$16384$8$1$salt(32 hex)$hash(128 hex)", () => {
    attendu(
      /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(hashCourant),
      `format inattendu : ${hashCourant.slice(0, 30)}…`
    );
  });
  verifie("verifyPassword : le bon mot de passe passe le roundtrip", () => {
    attendu(verifyPassword(MOT_DE_PASSE, hashCourant) === true, "bon mot de passe refusé");
  });
  verifie("verifyPassword : un mauvais mot de passe est refusé", () => {
    attendu(verifyPassword("mauvais-mot-de-passe", hashCourant) === false, "accepté à tort");
  });
  verifie("hashPassword : jette au-delà de 256 caractères (257 ici)", () => {
    let threw = false;
    try {
      hashPassword("a".repeat(257));
    } catch {
      threw = true;
    }
    attendu(threw, "aucune erreur levée pour un mot de passe trop long");
  });
  verifie("verifyPassword : ANCIEN format salt:hash accepté", () => {
    attendu(verifyPassword("ancien-mot-de-passe", hashAncien) === true, "ancien format refusé");
  });
  verifie("verifyPassword : mauvais mot de passe sur ancien format refusé", () => {
    attendu(verifyPassword("autre-mot-de-passe", hashAncien) === false, "accepté à tort");
  });
  verifie("needsRehash : true pour l'ancien format salt:hash", () => {
    attendu(needsRehash(hashAncien) === true, "ancien format non détecté");
  });
  verifie("needsRehash : false pour le hash courant de hashPassword", () => {
    attendu(needsRehash(hashCourant) === false, "hash courant jugé à re-hacher");
  });
  verifie("verifyPassword : stored invalide (sans « : ») → false, sans jeter", () => {
    attendu(verifyPassword("peu-importe", "n'importe quoi") === false, "vrai retourné pour un hash invalide");
  });
  verifie("verifyPassword : stored versionné malformé → false, sans jeter", () => {
    attendu(verifyPassword("peu-importe", "scrypt$invalide") === false, "vrai retourné pour un hash invalide");
  });
  verifie("burnScryptTime : s'exécute sans jeter (anti-énumération par timing)", () => {
    burnScryptTime();
  });
}

// --- session : sessions en base ------------------------------------------------
// Les checks sont séquentiels : l'état des sessions d'alice évolue d'un check
// à l'autre (révocation → expiration → throttle → révocation globale → UA).

function testSessions(): void {
  // Préparatif : deux comptes insérés directement (role/status explicites).
  db.prepare(
    "INSERT INTO users (username, password_hash, role, status) VALUES ('alice', 'x:y', 'user', 'approved')"
  ).run();
  const aliceId = (db.prepare("SELECT id FROM users WHERE username = 'alice'").get() as { id: number }).id;
  db.prepare(
    "INSERT INTO users (username, password_hash, role, status) VALUES ('bob', 'x:y', 'user', 'pending')"
  ).run();
  const bobId = (db.prepare("SELECT id FROM users WHERE username = 'bob'").get() as { id: number }).id;

  let token1 = "";
  verifie("createSession : retourne un token et une expiration à ~30 jours", () => {
    const s = createSession(aliceId);
    token1 = s.token;
    attendu(typeof token1 === "string" && token1.length >= 32, "token absent ou trop court");
    attendu(
      Math.abs(s.expiresAt - (Date.now() + TRENTE_JOURS)) < 60_000,
      `expiresAt inattendu : ${s.expiresAt}`
    );
  });

  verifie("auth_sessions : la clé stockée est le SHA-256 du token, jamais le token brut", () => {
    const row = db.prepare("SELECT id FROM auth_sessions WHERE user_id = ?").get(aliceId) as {
      id: string;
    };
    attendu(row.id === sha256(token1), "clé stockée ≠ sha256(token)");
    attendu(row.id !== token1, "token brut stocké en clair dans la base !");
  });

  verifie("getSessionUser : renvoie alice (id/username/role/status/created_at) SANS password_hash", () => {
    const u = exigeUser(token1);
    attendu(
      u.id === aliceId && u.username === "alice" && u.role === "user" && u.status === "approved",
      `contenu inattendu : ${JSON.stringify(u)}`
    );
    attendu(typeof u.created_at === "string", "created_at absent ou non textuel");
    attendu(!("password_hash" in u), "password_hash exposé dans SessionUser !");
  });

  verifie("getSessionUser : token inconnu → null", () => {
    attendu(getSessionUser("token-inexistant-xyz") === null, "renseigné pour un token inconnu");
  });

  verifie("revokeSession : la session révoquée n'est plus valide", () => {
    revokeSession(token1);
    attendu(getSessionUser(token1) === null, "session encore acceptée après révocation");
  });
  verifie("revokeSession : idempotent (2e appel sans erreur)", () => {
    revokeSession(token1);
  });

  verifie("getSessionUser : session expirée → null ET ligne purgée de auth_sessions", () => {
    const token = createSession(aliceId).token;
    db.prepare("UPDATE auth_sessions SET expires_at = ? WHERE user_id = ?").run(Date.now() - 1000, aliceId);
    attendu(getSessionUser(token) === null, "session expirée encore acceptée");
    const row = db.prepare("SELECT id FROM auth_sessions WHERE id = ?").get(sha256(token));
    attendu(row === undefined, "ligne de la session expirée non supprimée");
  });

  verifie("getSessionUser : compte en attente (bob, status 'pending') → null", () => {
    const tokenBob = createSession(bobId).token;
    attendu(getSessionUser(tokenBob) === null, "compte non approuvé accepté");
  });

  let tokenLS = "";
  verifie("getSessionUser : last_seen_at antérieur de 2 h est mis à jour", () => {
    tokenLS = createSession(aliceId).token;
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(
      Date.now() - 2 * 3600_000,
      sha256(tokenLS)
    );
    exigeUser(tokenLS);
    const row = db.prepare("SELECT last_seen_at FROM auth_sessions WHERE id = ?").get(sha256(tokenLS)) as {
      last_seen_at: number;
    };
    attendu(row.last_seen_at > Date.now() - 60_000, `last_seen_at non rafraîchi : ${row.last_seen_at}`);
  });
  verifie("getSessionUser : last_seen_at récent (< 1 h) n'est pas réécrit (throttle)", () => {
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(
      Date.now() - 1800_000,
      sha256(tokenLS)
    );
    const avant = (
      db.prepare("SELECT last_seen_at FROM auth_sessions WHERE id = ?").get(sha256(tokenLS)) as {
        last_seen_at: number;
      }
    ).last_seen_at;
    exigeUser(tokenLS);
    const apres = (
      db.prepare("SELECT last_seen_at FROM auth_sessions WHERE id = ?").get(sha256(tokenLS)) as {
        last_seen_at: number;
      }
    ).last_seen_at;
    attendu(apres === avant, `last_seen_at réécrit hors throttle : ${avant} → ${apres}`);
  });

  verifie("revokeAllUserSessions : toutes les sessions du compte meurent", () => {
    const ta = createSession(aliceId).token;
    const tb = createSession(aliceId).token;
    attendu(exigeUser(ta).id === aliceId && exigeUser(tb).id === aliceId, "sessions fraîches invalides");
    revokeAllUserSessions(aliceId);
    attendu(
      getSessionUser(ta) === null && getSessionUser(tb) === null,
      "une session a survécu à la révocation globale"
    );
  });

  verifie("createSession : user_agent de 300 caractères tronqué à 180, sans erreur", () => {
    createSession(aliceId, "U".repeat(300));
    const rows = db.prepare("SELECT user_agent FROM auth_sessions WHERE user_id = ?").all(aliceId) as {
      user_agent: string;
    }[];
    attendu(rows.length === 1, `${rows.length} ligne(s) pour alice, 1 attendue`);
    attendu(rows[0].user_agent.length === 180, `longueur stockée ${rows[0].user_agent.length} au lieu de 180`);
  });
}

// --- Bilan ----------------------------------------------------------------------

function main(): void {
  console.log("— authValidate : validateUsername —");
  testNomsUtilisateur();
  console.log("— authValidate : validatePassword —");
  testMotsDePasse();
  console.log("— authValidate : passwordStrength —");
  testForceMotDePasse();
  console.log("— session : hachage des mots de passe —");
  testHachage();
  console.log("— session : sessions en base —");
  testSessions();

  console.log(`\nBilan : ${total - failures}/${total} règles vérifiées passent.`);
  if (failures > 0) {
    console.error(`${failures} échec(s).`);
    process.exit(1);
  }
  console.log("Tous les tests du noyau d'authentification passent.");
}

main();
