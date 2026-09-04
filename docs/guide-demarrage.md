# Guide de démarrage — LearnGame

LearnGame est une plateforme où des étudiants décrivent un sujet, un LLM génère un jeu
pédagogique HTML **100 % autonome**, puis l'améliorent par chat dans un Studio façon Lovable
(chat à gauche, jeu rendu à droite). Ce guide s'adresse à un développeur qui prend le projet
en main pour la première fois.

---

## 1. Prérequis

| Outil  | Version                                        | Remarque                                                            |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| Node.js | ≥ 22.5 (`node:sqlite` natif), recommandé ≥ 24 | Projet développé et testé avec **Node 26.7.0** ; l'image Docker utilise `node:24-alpine` |
| npm    | ≥ 10                                           | Fourni avec Node                                                     |
| Docker | optionnel                                      | Uniquement pour le déploiement (section 6)                           |

**Point clé : la base de données est SQLite via le module `node:sqlite` de Node — il n'y a
**aucun paquet natif à compiler** (pas de better-sqlite3). Une version récente de Node est donc
le seul vrai prérequis.

Vérifiez votre installation :

```bash
node -v   # ≥ 22.5 attendu (26.7.0 sur la machine de développement)
npm -v
```

---

## 2. Installation et premier lancement

```bash
npm install
npm run dev
```

Puis ouvrez **http://localhost:3000** : vous arrivez sur l'écran de connexion. Créez un compte
depuis `/login` (le compte passe en « en attente d'approbation » sauf si vous êtes dans
`ADMIN_USERNAMES` — voir la section 3).

Au premier lancement, le dossier `data/` est créé automatiquement avec la base SQLite
`data/learngame.db` (migrations additives dans `createDb()`). Toutes les données (comptes, jeux,
versions, messages, jobs) vivent dans ce dossier : ne le supprimez pas sans savoir pourquoi.

---

## 3. Configuration (`.env`)

Copiez le modèle et adaptez les valeurs :

```bash
cp .env.example .env
```

Toutes les variables (les variables d'environnement réelles **priment** sur le fichier `.env`) :

| Variable                  | Rôle                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENAI_BASE_URL`         | URL de base d'une API **compatible OpenAI**, sans le `/chat/completions` final. Exemples : `https://api.openai.com/v1`, `http://localhost:11434/v1`, un gateway universitaire. Aucun SDK propriétaire : tout passe par cet endpoint générique. |
| `OPENAI_API_KEY`          | Clé d'API pour cet endpoint (`sk-...` selon le fournisseur).                                                                          |
| `OPENAI_MODEL`            | Nom du modèle (`gpt-4o`, Qwen via gateway, etc.).                                                                                     |
| `OPENAI_MAX_TOKENS`       | Budget de tokens par génération. **Prévoir large (≥ 50000)** : les jeux complets sont longs ET les modèles à raisonnement consomment une partie du budget pour « réfléchir » avant d'écrire. |
| `OPENAI_REASONING_EFFORT` | Raisonnement des modèles « thinking » : `none` (désactivé, rapide — recommandé pour les élèves), `low`/`medium`/`high`, ou `default` (ne rien envoyer). Avec `none`, la requête envoie les deux formats (OpenRouter + vLLM/SGLang) et retente sans eux si le serveur les rejette. Même si le modèle « réfléchit » quand même, la réflexion est correctement séparée du code du jeu. |
| `OPENAI_TEMPERATURE`      | Température d'échantillonnage (0.6 par défaut : code plus fiable que 0.7+).                                                           |
| `SESSION_SECURE_COOKIE`   | Par défaut, le cookie de session est marqué `secure` (HTTPS uniquement) en production. Mettre **`0`** uniquement pour un déploiement en HTTP pur (réseau interne sans TLS). |
| `TRUST_PROXY`             | Mettre **`1`** derrière un reverse proxy de confiance qui **écrase** `x-forwarded-for` (nginx, traefik…) : les fenêtres anti-abus identifient alors chaque client par sa vraie IP. Sans cette variable, les plafonds par IP deviennent des plafonds globaux (dimensionnés pour une salle de classe) ; la protection par compte (10 tentatives/minute) reste active. |
| `ADMIN_USERNAMES`         | Noms d'utilisateur (séparés par des virgules) promus `role='admin'`, `status='approved'` à l'inscription **ou au démarrage du serveur**. Sert au bootstrap du premier admin. S'applique aussi aux comptes créés via le SSO (nom final, suffixé en cas de collision). |
| `OIDC_ISSUER`             | Issuer du fournisseur d'identité pour la **connexion SSO** (ex. CAS de l'université : `https://sso.univ-pau.fr/cas/oidc` — sans `/.well-known/openid-configuration`). Avec `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET`, active le bouton « Se connecter via le SSO » sur `/login`. Détails et flux : [`docs/authentification.md`](authentification.md) §8. |
| `OIDC_CLIENT_ID`          | Identifiant du client **confidentiel** déclaré chez l'université (registre CAS : flux authorization code + PKCE). |
| `OIDC_CLIENT_SECRET`      | Secret de ce client. |
| `OIDC_REDIRECT_URI`       | URI de rappel `https://…/api/auth/oidc/callback` — **recommandé en production** (doit être identique à celle déclarée auprès de l'université). Sans elle, l'URI est déduite de l'origine servie (`TRUST_PROXY=1` → en-têtes `x-forwarded-*`, sinon en-tête `Host`). |
| `OIDC_SCOPES`             | Scopes demandés (défaut : `openid profile email`). Doit contenir `openid`. |
| `OIDC_ALLOWED_DOMAINS`    | Suffixes de domaine e-mail autorisés, séparés par des virgules (sous-domaines inclus, ex. `univ-pau.fr`). Vide = toutes les identités délivrées par l'IdP. |
| `OIDC_TOKEN_AUTH`         | Authentification au token endpoint : `post` (défaut) ou `basic`. |

> NB : `SESSION_SECRET` (présent dans d'anciennes versions) est **obsolète** — les sessions
> sont désormais des tokens aléatoires stockés en base sous forme de SHA-256, il n'y a plus
> rien à signer. Vous pouvez la retirer de votre `.env`.

### Créer le premier compte admin (workflow exact)

Les inscriptions sont validées par un admin via la page `/admin`. Pour obtenir ce premier admin :

- **Option A — avant l'inscription (le plus simple)** : renseignez `ADMIN_USERNAMES=<votre-pseudo>`
  dans `.env`, puis inscrivez-vous normalement : le compte est créé directement admin et approuvé.
- **Option B — si vous vous êtes déjà inscrit** : votre compte est « en attente ». Renseignez
  `ADMIN_USERNAMES=<votre-pseudo>` dans `.env`, puis **redémarrez le serveur** : les noms listés
  sont promus admin au démarrage.

Les variables `ADMIN_USERNAMES` et `TRUST_PROXY` peuvent aussi être passées comme variables
d'environnement du process (elles priment sur `.env`).

> 🔑 **Mot de passe admin oublié ?** Aucun mot de passe n'est récupérable (hachage
> à sens unique) — mais il se réinitialise en une commande, y compris pour le compte
> admin : voir [`docs/administration.md`](administration.md) §6. Vérifiez aussi que
> `ADMIN_USERNAMES` correspond bien à un pseudo **existant** en base : une variable
> pointant vers un compte inexistant ne produit aucune erreur, mais personne n'est
> alors admin (procédure d'inspection dans le même document).

---

## 4. Commandes utiles

```bash
npm run dev                       # développement → http://localhost:3000
npm run build                     # build + vérification TypeScript complète (c'est LE check du projet)
npm start                         # production (après build)
docker compose up -d --build      # déploiement (volume ./data pour SQLite)
```

- **Pas de framework de test ni d'ESLint configuré**. `npm run lint` ouvre un prompt interactif :
  ne pas l'utiliser. `npm run build` fait office de vérification de types : c'est la commande à
  lancer avant tout commit.
- Les modules de `src/lib/` n'ont aucune dépendance à Next : c'est ce qui rend les tests ad hoc
  possibles (section 5).

---

## 5. Tester

Il n'y a pas de runner de tests : chaque test est un **script TS autonome** exécuté avec
`npx -y tsx`. Attention au **répertoire courant** : `db.ts` ouvre `process.cwd()/data/learngame.db`,
donc les tests qui touchent la base doivent tourner **depuis un répertoire temporaire vide**
(`mktemp -d`) pour ne pas écraser vos données — ils refusent de s'exécuter si une base existe déjà.

| Test                            | Ce qu'il vérifie                                            | Commande exacte                                                                                                              |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tests/validate.test.ts`        | `validateGameHtml` : faux rejets et détection de troncature  | `npx -y tsx tests/validate.test.ts` (depuis la racine)                                                                        |
| `tests/genEvents.test.ts`       | Protocole v2 des événements de génération (réducteur)        | `npx -y tsx tests/genEvents.test.ts` (depuis la racine)                                                                       |
| `tests/artDirection.test.ts`    | Randomiseur d'art direction (tirage seedé)                   | `npx -y tsx tests/artDirection.test.ts` (depuis la racine)                                                                    |
| `tests/smoketest.test.ts`       | Smoke-test runtime des jeux générés (câblage des handlers)   | `npx -y tsx tests/smoketest.test.ts` (depuis la racine)                                                                       |
| `tests/authCore.test.ts`        | Noyau d'authentification : validation + scrypt + sessions    | `cd "$(mktemp -d)" && npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/authCore.test.ts`                          |
| `tests/db.test.ts`              | Migrations, transactions, archives, scores                   | `cd "$(mktemp -d)" && npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/db.test.ts`                               |
| `tests/jobs.test.mts`           | Bout en bout du runner de jobs avec un **mock LLM SSE local** | `cd "$(mktemp -d)" && npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/jobs.test.mts`                            |
| `tests/authApproval.test.ts`    | Workflow d'approbation (2 phases, redémarrage simulé)        | `DIR=$(mktemp -d) && cd "$DIR" && npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/authApproval.test.ts phase1 && ADMIN_USERNAMES=admin1 npx -y tsx /Users/makhal/Nextcloud/mo/Projects/LearnGame/tests/authApproval.test.ts phase2` |

Notes :

- `tests/jobs.test.mts` embarque son propre mock LLM (endpoint OpenAI-compatible en SSE sur un
  port local) : aucun vrai modèle ni clé d'API nécessaire.
- `tests/authApproval.test.ts` simule un redémarrage serveur entre `phase1` (inscriptions) et
  `phase2` (bootstrap `ADMIN_USERNAMES`, approbation/rejet) — les deux passes utilisent le **même**
  dossier temporaire, d'où la variable `DIR`.

### Smoke test du serveur

Pour vérifier le serveur de production sans toucher au port de dev :

```bash
npm run build
PORT=3457 npm start &
curl -s http://localhost:3457/ | head -5
```

Pour tester la génération de bout en bout sans vrai LLM, lancez un mock SSE OpenAI-compatible sur
un port local puis démarrez avec `OPENAI_BASE_URL=http://localhost:<port>/v1`.

---

## 6. Déploiement (Docker)

```bash
cp .env.example .env   # renseignez OPENAI_*, ADMIN_USERNAMES, puis APP_DOMAIN et HTTPS_MODE (section 7)
docker compose up -d --build
```

Comment ça fonctionne :

- **`next.config.ts` active `output: "standalone"`** : le build produit `.next/standalone`, un
  serveur Node autonome avec les `node_modules` minimaux. Le Dockerfile copie ce dossier (plus
  `.next/static`) et démarre `node server.js` — image finale légère, sans recopier tout
  `node_modules`. Le runner de jobs est **in-process** : cette hypothèse d'un seul process Node
  est assurée par ce build standalone.
- **`docker-compose.yml`** définit **deux services** : `learngame` (l'application) et
  `proxy` (Caddy v2, terminaison TLS — section 7). Le service `learngame` monte
  **`./data:/app/data`** en volume : la base SQLite et les données survivent aux
  recréations du conteneur. Le conteneur tourne avec l'utilisateur `node` (non root),
  le `env_file: .env` transmet la configuration, et `restart: unless-stopped` relance le service.
- Le service `learngame` écoute sur **`127.0.0.1:3000`** : accessible uniquement en local
  (debug). Il n'est **pas** exposé publiquement — l'accès public passe par le service
  `proxy`, seul à ouvrir les ports 80/443 (section 7).

### Proxy et HTTPS

Le compose embarque un **service `proxy` (Caddy v2)** qui termine le TLS et expose
l'application sur les ports 80/443 : modes `HTTPS_MODE` (`off`, `self`, `certs` avec vos
certificats), domaine `APP_DOMAIN`, variante « reverse proxy de l'université » — tout est
décrit
dans la section 7.

Rappel : le cookie de session est marqué `secure` automatiquement quand l'application est
servie en HTTPS. **Ne laissez `SESSION_SECURE_COOKIE=0` que si l'application est réellement
servie en HTTP pur** (réseau interne sans TLS) : en HTTPS, remettez la valeur par défaut.

---

## 7. HTTPS et domaine avec Docker

Le `docker-compose.yml` définit **deux services** :

| Service     | Rôle                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learngame` | L'application (Next standalone). **Non exposée publiquement** : liée à `127.0.0.1:3000`, accessible seulement en local pour le debug.                  |
| `proxy`     | **Caddy v2**, seul point d'entrée public : écoute 80 (HTTP) et 443 (TCP + UDP pour HTTP/3), termine le TLS et redirige vers l'application. Certificats persistés dans les volumes nommés `caddy_data` et `caddy_config`. |

### Variables de déploiement (`.env`)

| Variable            | Défaut      | Rôle                                                                                                                                                                                                                       |
| ------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_DOMAIN`        | `localhost` | Domaine public de l'application, **sans protocole ni port** (ex. `learngame.mon-univ.fr`). Une seule source de vérité : utilisée comme adresse du site par le proxy **et** par l'application pour les redirections internes et l'URI de rappel SSO par défaut. |
| `HTTPS_MODE`        | `off`       | Choix du TLS : `off` (HTTP pur), `self` (certificat interne de Caddy, tests en LAN) ou `certs` (**vos certificats**, fournis par l'université). Les trois modes sont détaillés ci-dessous.                                   |
| `OIDC_REDIRECT_URI` | —           | Override explicite de l'URI de rappel SSO. S'il n'est pas fixé, l'application dérive automatiquement `https://$APP_DOMAIN/api/auth/oidc/callback` dès que `APP_DOMAIN` est renseigné **et** `HTTPS_MODE` vaut `self` ou `certs`. En mode `off`, pas de dérivation automatique (l'URI resterait en http) : fixer `OIDC_REDIRECT_URI` explicitement si le SSO doit fonctionner en HTTP pur. |
| `TRUST_PROXY`       | —           | **Vaut `1` par défaut** (le compose l'injecte : le proxy intégré écrase les en-têtes `x-forwarded-*`). Mettre `TRUST_PROXY=0` dans `.env` uniquement dans la variante « proxy universitaire » qui n'écraserait pas ces en-têtes. |

### Les trois modes `HTTPS_MODE`

- **`off` — HTTP pur (défaut).** Le proxy sert l'application en HTTP sur le port 80 : le
  comportement le plus simple, pour un LAN sans TLS ou un premier essai. Prérequis :
  aucun. Côté navigateur : aucun avertissement, mais le trafic circule en clair — l'app
  lit `x-forwarded-proto` et marque donc le cookie de session **non** `secure`.
- **`self` — certificat de l'autorité interne de Caddy (`tls internal`).** Caddy crée sa
  propre autorité de certification et émet un certificat pour `APP_DOMAIN` : pour tester
  en HTTPS dans un LAN où le domaine n'est pas publiquement résoluble. Prérequis :
  aucun (tout est local). Côté navigateur : **avertissement de certificat** tant que le
  certificat racine interne n'a pas été importé sur les postes (procédure ci-dessous) ;
  sans import, il faut accepter l'avertissement à chaque visite. Pas de HSTS dans ce
  mode (volontaire : un HSTS d'un an bloquerait un retour en `off`).
- **`certs` — vos propres certificats (mode de production).** Vous déposez les
  certificats **délivrés par le service informatique / l'AC de l'université** dans le
  dossier `./certs/` (voir ci-dessous) : Caddy les sert tels quels, redirection
  HTTP→HTTPS et en-tête **HSTS** activés. Prérequis : `APP_DOMAIN` doit correspondre
  au nom dans le certificat. Côté navigateur : cadenas valide (le poste fait
  confiance à l'AC émettrice), aucune manipulation.
- **`certs` — vos propres certificats (mode de production).** Vous déposez les
  certificats **délivrés par le service informatique / l'AC de l'université** dans le
  dossier `./certs/` (voir ci-dessous) : Caddy les sert tels quels, redirection
  HTTP→HTTPS et en-tête **HSTS** activés. Prérequis : `APP_DOMAIN` doit correspondre
  au nom dans le certificat. Côté navigateur : cadenas valide (le poste fait
  confiance à l'AC émettrice), aucune manipulation.

### Mise en route

```bash
cp .env.example .env            # renseigner au minimum APP_DOMAIN et HTTPS_MODE
docker compose up -d --build
docker compose logs -f proxy    # suivre le démarrage du proxy
docker compose restart          # après une modification du .env
docker compose down             # tout arrêter
```

### Mode `certs` : déposer vos certificats

Créez le dossier `certs/` à la racine du projet (il est **ignoré par git** — les clés
privées n'y seront jamais commitées) et déposez-y deux fichiers, avec exactement ces
noms :

| Fichier                     | Contenu                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `certs/fullchain.pem`       | Le certificat du domaine **plus la chaîne complète** (intermédiaires inclus)  |
| `certs/privkey.pem`         | La clé privée correspondante (format PEM, `BEGIN PRIVATE KEY` ou `BEGIN RSA PRIVATE KEY`) |

Puis :

```bash
HTTPS_MODE=certs dans .env, APP_DOMAIN = le nom dans le certificat
docker compose up -d --build
```

Le proxy refuse de démarrer si les fichiers manquent (message explicite) plutôt que de
servir du HTTP en silence. Après chaque **renouvellement** par l'université : remplacez
les fichiers puis `docker compose restart proxy`.

### Mode `self` : faire confiance au certificat racine interne

Caddy signe les certificats avec une autorité locale que les navigateurs ne connaissent
pas — d'où l'avertissement. Pour le faire disparaître sur les postes du LAN, exportez la
racine puis importez-la dans le trousseau de chaque poste :

```bash
docker compose exec proxy cat /data/caddy/pki/authorities/local/root.crt > learngame-root.crt
```

Importez ensuite `learngame-root.crt` dans le trousseau du poste (macOS : **Trousseau
d'accès** → certificats système ; Firefox : **Paramètres** → certificats).

### Variante : l'université fournit déjà un reverse proxy

N'utilisez pas le proxy intégré : démarrez uniquement l'application.

```bash
docker compose up -d learngame
```

Le service `learngame` écoute sur `127.0.0.1:3000` (déjà le cas dans le compose) : faites
pointer le reverse proxy de l'université vers cette adresse. Mettez `TRUST_PROXY=1` dans
`.env` **uniquement si** ce proxy écrase `x-forwarded-for` (sinon les plafonds par IP
deviennent des plafonds globaux — cf. section 3). Le TLS et le domaine dépendent alors
entièrement de ce proxy.

### Rappels

- **L'application n'est jamais exposée publiquement** : seule la porte 80/443 du proxy
  l'est ; `learngame` reste liée à `127.0.0.1`.
- HSTS uniquement en mode `certs`.
- **SSO** : avec HTTPS activé (`self` ou `certs`), l'URI de rappel à déclarer auprès
  de l'université est `https://$APP_DOMAIN/api/auth/oidc/callback` — ou la valeur
  explicite d'`OIDC_REDIRECT_URI` si vous l'avez fixée.

---

## 8. Dépannage courant

| Symptôme                                                          | Cause et solution                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Je me connecte, mais la session « ne tient pas » (redirigé vers `/login` en boucle) | En production, le cookie est marqué `secure` et est **silencieusement jeté par le navigateur** si l'app est servie en HTTP. Si votre déploiement est volontairement en HTTP pur, mettre `SESSION_SECURE_COOKIE=0` dans `.env` puis redémarrer. |
| Le serveur « marche » mais sans distinguer les clients (rate limits globaux) | Aucun proxy de confiance déclaré : `x-forwarded-for` est forgable, donc ignoré. Derrière un reverse proxy qui écrase cet en-tête, mettre `TRUST_PROXY=1` dans `.env` puis redémarrer. La protection par compte (10 tentatives/minute) reste active dans tous les cas.                            |
| Erreur de compilation d'un module natif SQLite (better-sqlite3)     | Le projet n'utilise **pas** better-sqlite3 mais `node:sqlite` natif (better-sqlite3 ne compile pas sur Node 26). Vérifiez que vous n'avez pas ajouté de dépendance native et que votre Node est ≥ 22.5 (recommandé ≥ 24).                   |
| `EADDRINUSE` / port 3000 déjà pris                                 | Un autre process occupe le port (souvent un `npm run dev` ou `npm start` oublié). Tuez-le (`kill <pid>` après `lsof -i :3000`) ou changez de port : `PORT=3457 npm start` (dev : `PORT=3457 npm run dev`).                                 |
| `npm run lint` se bloque                                            | Comportement attendu : il ouvre un prompt interactif (pas d'ESLint configuré). Utilisez `npm run build` comme check.                                                                                                                       |
| Les tests qui touchent la base refusent de démarrer                  | Message « Refus : une base existe déjà ici » : ils protègent vos données. Lancez-les depuis un dossier temporaire vide comme indiqué en section 5.                                                                                          |
| Inscription bloquée « en attente d'approbation »                     | Comportement normal : un admin doit valider via `/admin`. Pour le premier admin, suivre le workflow `ADMIN_USERNAMES` (section 3).                                                                                                          |
| Le bouton SSO n'apparaît pas                                          | `OIDC_ISSUER`, `OIDC_CLIENT_ID` et `OIDC_CLIENT_SECRET` doivent être **tous trois** renseignés (vérifier que le process les voit : ils priment sur `.env`). Journal de démarrage : un avertissement signale l'absence d'`OIDC_REDIRECT_URI`. |
| « Le SSO de l'université a refusé la connexion » (`oidc_refus_idp`)   | L'IdP a renvoyé une erreur (identification refusée, client mal déclaré…) : les détails sont dans les journaux du serveur. Vérifier côté université la déclaration du client (redirect_uri **identique** à `OIDC_REDIRECT_URI`, PKCE activé).  |
| « Session de connexion expirée ou déjà utilisée » (`oidc_etat_invalide`) | Le flux SSO dure 10 minutes au maximum et un callback ne se rejoue pas. Reprendre depuis le bouton SSO. Un blocage systématique côté navigateur pointe vers un proxy qui retire les cookies.                                                |
| SSO : chaque connexion crée un doublon de compte                      | Le rattachement par e-mail exige que l'IdP délivre l'e-mail du compte (claim `email`) et que celui-ci corresponde au compte local (casse ignorée). Vérifier les scopes (`email`) et l'e-mail du compte local.                               |
| Le proxy refuse de démarrer (`HTTPS_MODE=certs`)                      | Les fichiers `certs/fullchain.pem` et `certs/privkey.pem` sont absents ou mal nommés — voir `certs/README.md`. Le refus au démarrage est volontaire : un proxy sans certificat ne doit pas servir du HTTP en silence.                        |
| Certificat expiré / renouvelé par l'université                        | Remplacer `certs/fullchain.pem` et `certs/privkey.pem` par les nouveaux fichiers puis `docker compose restart proxy`. Aucun rebuild nécessaire.                                                                                             |
| Let's Encrypt n'émet pas de certificat                               | Le DNS de `APP_DOMAIN` ne pointe pas vers ce serveur, ou les ports 80/443 sont bloqués : vérifier `docker compose logs proxy`. En attendant, `HTTPS_MODE=self` donne un TLS utilisable.                                                      |
| Avertissement navigateur en mode `self`                              | Comportement attendu : le certificat est émis par l'autorité interne de Caddy. Importer le certificat racine (section 7) ou accepter l'avertissement.                                                                                      |

---

## 9. Arborescence du projet

```
LearnGame/
├── .env.example          # Modèle de configuration (section 3)
├── docker-compose.yml    # Deux services : learngame (app standalone, 127.0.0.1:3000) + proxy (Caddy, TLS 80/443)
├── Dockerfile            # Build standalone (node:24-alpine), utilisateur non root, port 3000
├── next.config.ts        # output: "standalone" (build Docker autonome)
├── data/                 # Base SQLite (learngame.db) — créée au premier lancement, à sauvegarder
├── docs/                 # Cette documentation
├── tests/                # Tests ad hoc `npx tsx` (voir section 5 — attention au répertoire courant)
└── src/
    ├── app/              # Pages et routes API (App Router Next.js)
    │   ├── page.tsx      # Accueil / Dashboard
    │   ├── login/        # Connexion / inscription (compte en attente d'approbation)
    │   ├── studio/       # Création en cours (redirige vers le jeu une fois terminée)
    │   ├── games/[id]/   # Studio d'un jeu : chat + aperçu/code
    │   ├── p/[slug]/     # Page publique d'un jeu partagé
    │   ├── admin/        # Validation des inscriptions en attente
    │   └── api/          # auth/*, games/[id]/*, jobs/* (SSE sur /jobs/[id]/events), me, p/[slug]
    ├── lib/              # Cœur métier, SANS dépendance à Next (testable via npx tsx)
    │   ├── db.ts         # node:sqlite, migrations additives, transactions (ouvre data/learngame.db)
    │   ├── session.ts    # Scrypt versionné + sessions en base (token stocké en SHA-256)
    │   ├── auth.ts       # Collage du cookie httpOnly sur session.ts
    │   ├── authValidate.ts # Règles pseudo/mot de passe — partagées serveur ET formulaire client
    │   ├── llm.ts        # streamChat : normalise les 3 formats de raisonnement en événements
    │   ├── prompts.ts    # Prompt système (levier n°1 de la qualité) + extraction HTML paranoïaque
    │   ├── validate.ts   # validateGameHtml : un jeu invalide n'atteint jamais la base
    │   ├── generation.ts # Création (3 tentatives) + édition agentique (blocs CHERCHER/REMPLACER)
    │   ├── editor.ts     # Moteur de blocs de recherche/remplacement façon Aider
    │   ├── jobs.ts       # Runner in-process singleton : génération détachée de la requête HTTP
    │   ├── genEvents.ts  # Protocole v2 partagé serveur/client (types + réducteur)
    │   ├── smoketest.ts  # Smoke-test runtime du HTML généré (jsdom)
    │   └── clientApi.ts  # Fetchs côté client (401 → redirect /login?next=…)
    └── components/       # React (Dashboard, Studio, GenerationProvider/Panel/Overlay, AdminUsers)
        └── ui/           # Design system : toasts, ConfirmDialog, CodeView, CommandPalette…
```

---

## Pour aller plus loin

`CLAUDE.md` à la racine documente l'architecture en profondeur (jobs de génération persistés,
protocole d'événements v2, pipeline LLM, défenses d'authentification) et les contraintes non
négociables du projet — à lire avant toute modification du code.
