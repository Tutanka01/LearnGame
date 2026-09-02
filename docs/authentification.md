# Authentification

Documentation du système d'authentification de LearnGame (Next.js 15, TypeScript, `node:sqlite`). Principe structurant : le noyau (`session.ts`) est un **module pur sans dépendance Next**, testable avec `npx tsx` ; Next ne fait que coller des cookies autour.

## 1. Vue d'ensemble

| Fichier | Rôle |
|---|---|
| `src/lib/session.ts` | **Noyau pur** : hachage scrypt versionné, sessions en base (`createSession`, `getSessionUser`, `revokeSession`, `revokeAllUserSessions`). |
| `src/lib/auth.ts` | **Glue Next** : pose/lit le cookie `lg_session` (`setSessionCookie`, `clearSessionCookie`, `getCurrentUser`) ; ré-exporte le noyau. |
| `src/lib/authValidate.ts` | **Règles partagées client/serveur** : `validateUsername`, `validatePassword`, `passwordStrength` + constantes (pseudo 3–32, mot de passe 8–256). |
| `src/lib/api.ts` | Gardes de routes : `requireUser()`, `requireAdmin()`, `assertSameOrigin()` (CSRF), `handleApi()` (ApiError → JSON `{ error }`). |
| `src/lib/ratelimit.ts` | Limiteur en mémoire (fenêtre fixe) + `clientIp()` (XFF uniquement si `TRUST_PROXY=1`, sinon clé globale "local"). |
| `src/app/api/auth/*`, `src/app/api/me` | Les 5 endpoints (section 6). |
| `src/app/login/page.tsx` + `src/components/auth/LoginForm.tsx` | Formulaire connexion/inscription (section 8). |
| `src/lib/db.ts` | Table `auth_sessions`, colonnes `users.role`/`users.status`, `promoteAdmins()`. |
| `tests/authCore.test.ts`, `tests/authApproval.test.ts` | Tests ad hoc (section 9). |

`getCurrentUser()` retourne un `SessionUser` **sanitisé** (`id`, `username`, `role`, `status`, `created_at` — jamais `password_hash`) : c'est le type attendu par tous les appelants. `authValidate.ts` étant importé par les routes API **et** le formulaire, les messages affichés sont exactement ceux du serveur.

## 2. Cycle de vie d'une session

Les sessions vivent en base (table `auth_sessions`), pas en mémoire : un redémarrage ne déconnecte personne. Durée fixe **30 jours** (`SESSION_DAYS`), pas de session éternelle.

- **Création** — à chaque connexion réussie (ou inscription directe approuvée) : `createSession()` génère un token `randomBytes(32)` en base64url, insère une ligne et **purge au passage les sessions expirées**.
- **Pivot** — chaque connexion crée une **nouvelle** session ; les anciennes ne sont jamais réutilisées.
- **Validation** — à chaque requête : `getSessionUser(token)` joint `users`, refuse (`null`) toute session inconnue, expirée (purgée au passage) ou rattachée à un compte `status !== 'approved'` ; met à jour `last_seen_at` au plus une fois par heure.
- **Révocation** — déconnexion : `revokeSession()` fait un **DELETE en base**, pas juste un cookie jeté (un cookie volé ne vaut plus rien). Idempotent.
- **Mort immédiate** — si le compte repasse en attente, sa session devient invalide à la requête suivante.
- **Révocation globale** — `revokeAllUserSessions(userId)` tue toutes les sessions d'un compte.

```
      Connexion réussie                          Requête protégée
      ─────────────────                          ────────────────
POST /api/auth/login                       cookie lg_session (httpOnly)
  ├─ verifyPassword()                              │
  ├─ needsRehash ? → re-hachage                    ▼
  └─ createSession(user)                    getSessionUser(token)
      ├─ purge des sessions expirées          ├─ ligne inconnue       → null → 401
      ├─ token = randomBytes(32)              ├─ expires_at ≤ now     → purge + null → 401
      └─ INSERT auth_sessions(sha256(token))  ├─ status ≠ 'approved'  → null → 401
          → setSessionCookie()                └─ last_seen_at > 1 h   → mise à jour
                                                ▼
                                              SessionUser sanitisé (ou 401)

POST /api/auth/logout → revokeSession(token) : DELETE en base + suppression du cookie
```

## 3. Sécurité des mots de passe

Scrypt (`node:crypto`), format **versionné** : les paramètres voyagent avec le hash, ce qui permet de durcir les coûts sans casser les comptes existants.

```
scrypt$N$r$p$saltHex$hashHex
scrypt$16384$8$1$<32 hex>$<128 hex>    ← N=16384, r=8, p=1, sel 16 o, clé 64 o
```

```ts
// src/lib/session.ts
const hash = scryptSync(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
```

- **Vérification** (`verifyPassword`) : reconnaît aussi l'**ancien format** `saltHex:hashHex` (coûts par défaut implicites), compare via `timingSafeEqual`, retourne `false` sans jeter sur un hash malformé. Un mot de passe > `PASSWORD_MAX` (256) est refusé d'office.
- **Re-hachage transparent** : `needsRehash(stored)` est vrai dès que le préfixe ne vaut pas `scrypt$16384$8$1$`. La connexion met alors à jour `users.password_hash` après une vérification réussie — migration douce de l'ancien parc :

```ts
// src/app/api/auth/login/route.ts
if (needsRehash(user.password_hash)) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id);
}
```

- **Anti-énumération par timing** : `burnScryptTime()` vérifie un `DUMMY_HASH` au format courant quand le compte n'existe pas — le coût d'un scrypt est payé dans les deux cas, et le message 401 est unique (« Nom d'utilisateur ou mot de passe incorrect. ») : « compte inconnu » et « mot de passe faux » sont indiscernables au chrono.

## 4. Stockage du token

Le token existe **en clair à un seul endroit : le cookie** `lg_session`. La base n'en stocke que le **SHA-256** (colonne `id`, clé primaire) : une fuite de base (dump, sauvegarde) ne permet pas de forger un cookie.

Cookie posé par `setSessionCookie()` (`src/lib/auth.ts`) : `httpOnly` (inaccessible au JS), `sameSite: "lax"`, `path: "/"`, `maxAge` calé sur l'expiration de la session, `secure` **auto-détecté** (`shouldUseSecureCookie`) : `SESSION_SECURE_COOKIE=0/1` force, sinon `x-forwarded-proto`, puis le protocole de la requête, puis `NODE_ENV` — un cookie `secure` sur HTTP pur est silencieusement jeté par le navigateur.

```sql
-- src/lib/db.ts (horodatages en epoch ms, index sur user_id et expires_at)
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,           -- SHA-256 du token, JAMAIS le token brut
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''   -- tronqué à 180 caractères
);
```

## 5. Défenses anti-abus

- **`assertSameOrigin()`** (`src/lib/api.ts`) — CSRF en profondeur, en plus de `SameSite=Lax` : 403 si `sec-fetch-site: cross-site`, ou si `origin` ne correspond pas à l'hôte servi (`x-forwarded-host`/`host`). Présente sur register, login, logout. curl et les tests (sans en-têtes de navigateur) ne sont pas concernés.
- **Double rate limit login** (`src/lib/ratelimit.ts`, fenêtre fixe en mémoire) : `login-ip:<ip>` **60/min** (fenêtre large : elle devient globale si `TRUST_PROXY` n'est pas déclaré, et doit passer une salle entière) **et** `login:<ip>:<compte>` **10/min** (force brute ciblée — LA fenêtre qui compte : indépendante de l'IP, elle borne le test des mots de passe d'un compte même en attaque distribuée) → 429.
- **Register** : `register:<ip>` **15/min** → 429. **Username-available** : `name-check:<ip>` **60/min** → 429 (praticable à l'usage, pas énumérable massivement).
- **`clientIp()` et `TRUST_PROXY`** : `x-forwarded-for` est forgable par le client. Sans `TRUST_PROXY=1` (proxy de confiance qui ÉCRASE l'en-tête), tous les clients partagent la clé `"local"` — les plafonds par IP deviennent des plafonds globaux, dimensionnés pour une classe ; la fenêtre par compte reste intacte. Les fenêtres sont prises AVANT tout parsing du corps (aucun travail coûteux payé par un client en excès).
- **Bornes d'entrée** (`authValidate.ts`, appliquées serveur et affichées client) : mot de passe **8 à 256** caractères ; pseudo **3 à 32** caractères (lettres/chiffres Unicode accentés compris, `_ . -` interdits aux extrémités). `hashPassword()` jette au-delà de 256.

## 6. Les 5 endpoints d'auth

Toute erreur suit le format `{ "error": "message" }` (`handleApi`/`apiError`).

### `POST /api/auth/register`
Corps : `{ "username", "password" }`. Valide (400), rate-limite (429), vérifie l'unicité (**409**, y compris course d'INSERT tranchée par la contrainte `UNIQUE`), puis crée le compte : dans `ADMIN_USERNAMES` → `role='admin'`, `status='approved'`, cookie posé ; sinon `role='user'`, `status='pending'`, **pas de cookie**.
Réponses : `200 { ok: true, pending: false|true }` · 400 · 403 · 409 · 429.

### `POST /api/auth/login`
Corps : `{ "username", "password" }` (`password` > 256 ou `username` > 32 → 400 ; borne précoce : le nom ne sert jamais de clé de rate limit). Fenêtre par IP (429), puis par compte (429). Compte inconnu → `burnScryptTime()` puis **401** ; mauvais mot de passe → **401** ; re-hachage éventuel ; compte non approuvé → **403** « Ton compte est en attente d'approbation par un enseignant. » ; sinon nouvelle session + cookie.
Réponses : `200 { ok: true }` · 400 · 401 · 403 · 429.

### `POST /api/auth/logout`
Révoque la session **en base** puis supprime le cookie. Réponses : `200 { ok: true }` — idempotent, marche sans session.

### `GET /api/auth/username-available?name=…`
Pour le formulaire d'inscription. Réponses : `200 { available: true }` ou `{ available: false, reason: "message" }` (`reason` = message de `validateUsername`) · 429.

### `GET /api/me`
Réponses : `200 { user: { id, username, role, status } }` (sanitisé) · 401 « Non connecté. »
Côté client, les fetchs passent par `src/lib/clientApi.ts` : un 401 redirige vers `/login?next=…`.

## 7. Le flux d'approbation

Plateforme sur invitation : une inscription crée un compte **`pending`** qui ne peut ni se connecter (403) ni conserver une session.

- **Migration additive** dans `createDb()` (`src/lib/db.ts`) : `users.role` (défaut `'user'`) et `users.status` (défaut `'approved'` — *grandfathering*, les comptes préexistants restent utilisables).
- **`ADMIN_USERNAMES`** (noms séparés par virgules) :
  - à l'**inscription**, un nom listé naît admin + approuvé et reçoit directement une session ;
  - au **démarrage**, `promoteAdmins()` promeut (`UPDATE users SET role='admin', status='approved' WHERE username = ?`) tout compte portant ce nom — idempotent.
- **`/admin`** (`src/app/admin/page.tsx`, server component) : redirige vers `/login` si non connecté, vers `/` si non admin ; liste les comptes en attente via `AdminUsers`.
- **Endpoints admin** (`requireAdmin()`) :
  - `POST /api/admin/users/[id]/approve` → `UPDATE users SET status='approved' WHERE id=? AND status='pending'` — le guard rend l'opération idempotente (déjà traité → **404** « Compte introuvable ou déjà traité. »).
  - `POST /api/admin/users/[id]/reject` → `DELETE FROM users WHERE id=? AND status='pending'` — le compte est supprimé, le nom redevient disponible.

## 8. Le formulaire `/login`

`src/app/login/page.tsx` est un server component `force-dynamic` : redirige les connectés vers `/`, rend `LoginForm` dans un `<Suspense>` (lecture des search params). `LoginForm` gère les deux modes (Connexion / Inscription) et POSTe vers `/api/auth/login` ou `/register`.

- **Validation en direct** : importe `validateUsername`, `validatePassword`, `passwordStrength` de `authValidate.ts`. En INSCRIPTION : miroir exact des règles serveur, erreurs de champ sous chaque saisie (`aria-invalid` + `aria-describedby`), bannière pour les réponses serveur, secousse (classe `shake`) au rejet. En CONNEXION : seulement « non vide » — les comptes créés avant la refonte peuvent avoir un pseudo ou un mot de passe hors des règles actuelles (6 caractères, séparateur en bord) ; c'est au serveur de vérifier les identifiants, pas leur forme.
- **Disponibilité du pseudo** : en inscription, requête debouncée (400 ms) et annulable (`AbortController`) vers `/api/auth/username-available`, seulement pour un nom déjà bien formé ; statut annoncé en `aria-live="polite"`.
- **Jauge de force** : 4 segments + libellés (`Faible` → `Excellent`) calculés par `passwordStrength` (longueur ≥ 8/12, diversité de classes, mots de passe répandus plafonnés à « Faible »).
- **Verr. Maj** : suivi champ par champ (`capsLockField`) via `getModifierState("CapsLock")` — l'alerte s'affiche sous le champ mot de passe ou confirmation actif, référencée par son `aria-describedby`.
- **Compte en attente** : réponse `pending: true` → écran dédié « Compte créé ! » (étapes : validation enseignante puis reconnexion) ; une 403 au login s'affiche en bannière d'information, pas d'erreur.
- **`?next=` sûr** : un chemin local uniquement, jamais d'extérieur.

```ts
// src/components/auth/LoginForm.tsx
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
```

## 9. Comment tester

Pas de framework : scripts TS exécutés avec `npx tsx`, harnais maison.

**Noyau pur** — `tests/authCore.test.ts` (47 règles). `db.ts` ouvre `process.cwd()/data/learngame.db` : lancer **depuis un répertoire temporaire vide** (le script refuse une base existante).

```bash
cd "$(mktemp -d)" && npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/authCore.test.ts
```

Couvre : format versionné, roundtrip bon/mauvais mot de passe, ancien format + `needsRehash`, hash malformé sans exception, `burnScryptTime`, clé stockée = SHA-256, session expirée purgée, compte `pending` refusé, throttle `last_seen_at` (1 h), révocations unitaire et globale, `user_agent` tronqué à 180.

**Approbation** — `tests/authApproval.test.ts`, **2 phases dans le même dossier temporaire** (la phase 2 simule un redémarrage avec `ADMIN_USERNAMES` configuré) :

```bash
DIR=$(mktemp -d) && cd "$DIR" \
  && npx -y tsx /chemin/du/projet/tests/authApproval.test.ts phase1 \
  && ADMIN_USERNAMES=admin1 npx -y tsx /chemin/du/projet/tests/authApproval.test.ts phase2
```

Phase 1 : défauts de colonnes (grandfathering), comptes créés `pending`. Phase 2 : promotion bootstrap, approve/reject avec guard `status='pending'`, réinscription au même nom après refus.

**Smoke test curl** (`PORT=3457 npm start` après `npm run build` ; curl, sans en-têtes navigateur, n'est pas bloqué par `assertSameOrigin`) :

```bash
curl -i -X POST localhost:3457/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"test-marie","password":"mot-de-passe-solide"}'  # → pending:true, pas de cookie
# Pour un compte directement connecté, démarrer avec ADMIN_USERNAMES=test-marie :
curl -i -c /tmp/cj -X POST localhost:3457/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"test-marie","password":"mot-de-passe-solide"}'  # → ok:true + Set-Cookie
curl -b /tmp/cj localhost:3457/api/me                              # → {"user":{…}}
```

Nettoyage : `DELETE FROM users WHERE username = 'test-…'` cascade tout (FK `ON DELETE CASCADE`).

## 10. Notes de maintenance

- **Ajouter une règle de validation** → uniquement dans `src/lib/authValidate.ts` (source de vérité unique) : routes API et formulaire la récupèrent automatiquement, les messages restent identiques. Étendre `tests/authCore.test.ts` dans le même mouvement.
- **Révoquer toutes les sessions d'un compte** → `revokeAllUserSessions(userId)` (`session.ts`) : changement de mot de passe, rejet, suspension. La route de rejet l'appelle AVANT le DELETE (défense en profondeur : le CASCADE de `auth_sessions.user_id` ferait déjà le ménage). Toute future route qui bannit sans supprimer ou change un mot de passe DOIT l'appeler.
- **Ajouter une route protégée** → `await requireUser()` (401 si non connecté) ou `await requireAdmin()` (403 si non admin) au début du handler, enveloppé dans `handleApi()`. Côté pages : `getCurrentUser()` + `redirect()` (cf. `src/app/admin/page.tsx`).

```ts
import { handleApi, requireAdmin } from "@/lib/api";

export async function POST(req: NextRequest) {
  return handleApi(async () => {
    await requireAdmin(); // ApiError 401/403 → réponse JSON propre
    // …
  });
}
```

- Durée de session : `SESSION_DAYS = 30` (`session.ts`). Coûts scrypt : `SCRYPT_N/R/P` — les monter ne casse rien (format versionné), mais les anciens hash ne sont re-hachés qu'à la prochaine connexion réussie.
