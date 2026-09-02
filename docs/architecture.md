# Architecture de LearnGame

> Vue d'ensemble pour un développeur qui découvre le projet. La source de vérité détaillée (commandes, tests, variables d'environnement) reste **CLAUDE.md**.

**Stack** : Next.js 15 (App Router) · React 19 · Tailwind CSS v4 (tokens `@theme` dans `globals.css`) · SQLite via `node:sqlite` natif (aucune dépendance native à compiler).

---

## 1. Le produit en trois phrases

Un étudiant décrit un sujet d'apprentissage (et un niveau : débutant / intermédiaire / avancé) depuis le Dashboard. Un LLM génère alors un **jeu pédagogique HTML 100 % autonome** — un seul fichier, sans aucune ressource externe — validé mécaniquement avant d'être sauvegardé. L'étudiant l'améliore ensuite par chat dans un **Studio façon Lovable** (conversation à gauche, jeu rendu à droite), chaque amélioration créant une version restaurable.

## 2. Carte des modules

### `src/lib/` — logique métier

Les modules marqués « pur » n'importent ni Next, ni la base, ni le réseau : testables directement avec `npx tsx`.

| Fichier | Rôle |
|---|---|
| `db.ts` | Connexion SQLite native (`node:sqlite`), singleton sur `globalThis.__lgDb` (survit au rechargement de modules en dev). Ouverture **paresseuse** via un Proxy : la base ne s'ouvre qu'à la première requête, jamais à l'import (le build Next importe les routes en parallèle). Schéma complet + migrations additives (`PRAGMA table_info` + `ALTER TABLE`). Exporte aussi `withTransaction()`, `archiveCurrentVersion()`, `addGameMessage()`. |
| `session.ts` | Noyau d'authentification **pur et testable** : scrypt versionné `scrypt$N$r$p$salt$hash` (les paramètres voyagent avec le hash), sessions en base (`auth_sessions`), token stocké uniquement en SHA-256, pivoté à chaque connexion, durée fixe 30 jours, purge des sessions expirées à chaque création. |
| `auth.ts` | Colle le cookie httpOnly `lg_session` sur le noyau (auto-détection du cookie `secure` selon le protocole effectif) et ré-exporte tout. `getCurrentUser()` renvoie un `SessionUser` **sanitisé** (jamais `password_hash`) — c'est le type attendu par tous les appelants. |
| `authValidate.ts` | Source de vérité unique des règles d'identifiants (pseudo 3–32 caractères, mot de passe ≥ 8, force). Importé par les routes API **et** le formulaire `/login` : les messages affichés sont exactement ceux du serveur. |
| `api.ts` | Utilitaires des routes API : format d'erreur JSON unique `{ error }`, gardes réutilisables (`requireUser`, `requireAdmin`, `requireGame`, `requireOwnedGame`), `handleApi()` (ApiError → réponse propre), `assertSameOrigin()` (défense CSRF en profondeur), `readJson()` (corps invalide → objet vide), `gameHtmlResponse()`/`gameHtmlError()` (HTML des jeux + CSP). |
| `errors.ts` | `ApiError` : erreur métier portant son statut HTTP et son message français. Pur. |
| `ratelimit.ts` | Limiteur de débit en mémoire (fenêtre fixe, GC paresseux) + `clientIp()`. Suffisant car un seul process Node. |
| `jobs.ts` | Runner in-process des jobs de génération (singleton `globalThis.__lgJobs`, même pattern que `db.ts`). Verrou « un job actif par utilisateur et par jeu », persistance **puis** diffusion des événements avec le même `seq`, coalescence des deltas (~150 ms ou 2 Ko), `subscribe()` rejouable, `cancelJob()`, `sweepStaleJobs()` (jobs orphelins après redémarrage), GC des jobs terminés à 24 h. |
| `generation.ts` | Cœur métier, indépendant de HTTP, exécuté par le runner : pipeline de création (DIRECTOR → BUILDER → QA), session d'édition agentique, replis, écritures en base sous `withTransaction()`. `runGenerationJob()` ne jette jamais : il retourne toujours un `GenerationOutcome` (`done` / `error` / `cancelled`). |
| `genEvents.ts` | Protocole v2 des événements — module **pur partagé serveur/client** : types `GenEvent` et `GenPhase`, `initialSnapshot()`, `reduceGenEvent()`, `replayEvents()`. Toute évolution du protocole se fait ici + chez l'émetteur + dans les surfaces d'affichage, dans le même commit. |
| `llm.ts` | `streamChat()` : async generator minimaliste pour tout endpoint OpenAI-compatible en streaming SSE. Normalise les 3 formats de raisonnement ; `ThinkTagSplitter` stateful ; retry automatique si le serveur rejette les champs de thinking. |
| `prompts.ts` | Les prompts système (`GAME_SYSTEM_PROMPT` single-shot, `DIRECTOR_SYSTEM_PROMPT`, `BUILDER_SYSTEM_PROMPT`, `EDIT_SYSTEM_PROMPT`), les builders de prompts utilisateur, `extractHtml()` paranoïaque, `stripThinking()`, `normalizeGameHtml()` (meta viewport), `extractTitle()`. |
| `editor.ts` | Moteur d'édition chirurgicale CHERCHER/REMPLACER (façon Aider) : `parseEditResponse()` (parseur ligne à ligne, tolère fences markdown et fins de ligne Windows), `applyOps()` (matching exact puis tolérant à l'indentation, détection d'ambiguïté, succès conservés même si d'autres échouent), `nearestExcerpt()` pour aider le modèle à corriger son ancre. |
| `validate.ts` | `validateGameHtml()` : validation mécanique **avant toute sauvegarde** (syntaxe JS via `node:vm` sans exécution, autonomie, postMessage). Retourne `null` si tout est bon, sinon la raison du rejet en français, réutilisée telle quelle vers le modèle et l'élève. Serveur uniquement. |
| `smoketest.ts` | Smoke-test runtime **conservateur**, après la validation syntaxique : câblage des handlers `onclick`/`oninput` (statique) puis boot du script sous jsdom (capture des exceptions de démarrage). Au moindre doute sur son propre outillage, laisse passer — un échec relance une tentative mais ne bloque jamais la sauvegarde. |
| `lint.ts` | Lint de **qualité** (pur, regex uniquement) : commentaires de réflexion du modèle livrés dans le fichier, mélange biaisé `sort(() => Math.random() - 0.5)`, `console.log` restants, TODO/FIXME, fonctions déclarées deux fois. **Jamais bloquant** — ses findings nourrissent le prompt de QA (le lint ne juge pas la recevabilité du jeu, `validate.ts` le fait). |
| `artDirection.ts` | Direction artistique **imposée** tirée d'une table curée (thème nommé, palette hex avec rôles sémantiques, polices système uniquement, langage de mouvement) : deux jeux sur le même sujet auront un look franchement différent. Pur. |
| `clientApi.ts` | `apiFetch()` côté client : 401 → redirection `/login?next=…` (en conservant la destination), autres erreurs → `HttpError` portant le message français du serveur, affiché en toast. Pur (`"use client"`). |

### `src/app/` — pages et routes API

| Route | Rôle |
|---|---|
| `page.tsx` (`/`) | Dashboard : bibliothèque de jeux + formulaire de création. Connecté uniquement (sinon redirect `/login`). |
| `studio/page.tsx` (`/studio`) | Atelier de création en cours (client) : chat à gauche, aperçu live à droite. Redirige vers le Studio du jeu à la fin. |
| `games/[id]/page.tsx` (`/games/[id]`) | Server component qui charge le jeu (jointure auteur) et rend `<Studio>` avec `isOwner`. Métadonnées en `robots: noindex`. |
| `admin/page.tsx` (`/admin`) | Approbation des inscriptions en attente (`AdminUsers`). Admin uniquement. |
| `p/[slug]/page.tsx` (`/p/[slug]`) | Page publique d'un jeu partagé : `public_slug` + `is_public = 1`, sinon 404. Aucun compte requis, métadonnées OpenGraph indexables. |
| `login/page.tsx` (`/login`) | Connexion/inscription (redirige les connectés vers `/`). Délègue à `auth/LoginForm` (validation en direct, jauge de force, Verr. Maj, écran dédié au compte en attente). |
| `api/auth/*` | `register` (crée un compte `pending`), `login`, `logout`, `username-available`. Toutes avec `assertSameOrigin()` + anti-brute-force double fenêtre (par IP, puis par couple IP+compte). |
| `api/me` | Utilisateur courant, sanitisé. |
| `api/jobs` | `POST` : crée un job et le lance en tâche de fond (rate limit 8 générations / 10 min / utilisateur). `GET /active` : job en cours ou résultat terminé < 5 min. `POST /[id]/cancel` : annulation explicite. `GET /[id]/events` : flux SSE rejouable. |
| `api/games` | `GET /` : bibliothèque paginée (`?offset=&limit=`, du plus récemment modifié au plus ancien). `[id]` : fiche d'un jeu. `[id]/messages` : chat + versions (**réservé au créateur**). `[id]/play` : HTML brut pour l'iframe. `[id]/plays` : beacon de comptage de parties. `[id]/scores` : enregistrement d'une partie (POST, un score par couple jeu/élève). `[id]/restore` : restaure une version archivée → crée une **nouvelle** version. `[id]/share` : bascule la publication et génère le slug public lisible (`les-bases-de-sql-a3f9km`). |
| `api/admin/*` | Liste des comptes, `approve`, `reject`. Révocation immédiate des sessions d'un compte rejeté. |
| `api/p/[slug]/*` | `play` : HTML d'un jeu publié **sans authentification** ; `plays` : beacon public. |

### `src/components/`

| Composant | Rôle |
|---|---|
| `GenerationProvider.tsx` | État global de génération, monté dans `layout.tsx` (sous `ToastProvider` et `ConfirmProvider`). Ouvre l'`EventSource`, réduit les événements via `reduceGenEvent`, se raccroche au job actif au montage, gère minimisation/annulation/retry. |
| `Studio.tsx` | Studio d'un jeu : chat persistant à gauche, panneaux redimensionnables (`react-resizable-panels`, positions persistées), onglets aperçu/code, versions, scores, partage, plein écran. |
| `StudioShared.tsx` | Briques partagées des deux studios (bulles d'erreur, `LiveStream` d'aperçu live). |
| `GenerationPanel.tsx` | LA source unique de l'affichage de progression : stepper des phases **émises par le serveur** + barre indéterminée — ne jamais réintroduire de faux pourcentage. Version en ligne (`GenerationBubble`) et réutilisable. |
| `GenerationOverlay.tsx` | Overlay plein écran de génération, rendu par le provider. |
| `Dashboard.tsx` | Bibliothèque + création (appelle `start()`, puis navigue vers `/studio`). |
| `AdminUsers.tsx` | File d'approbation admin. |
| `PublicPlayer.tsx` | Lecteur de la page publique (iframe + beacon + score si connecté). |
| `ShareModal.tsx` | Partage public d'un jeu (slug, lien, dépublication). |
| `VersionsTimeline.tsx` | Historique des versions + restauration. |
| `auth/LoginForm.tsx` | Formulaire de connexion/inscription. |
| `ui/ToastProvider.tsx` | Toasts unifiés (`useToast`). |
| `ui/ConfirmDialog.tsx` | `useConfirm` : remplace tous les `confirm()` natifs. |
| `ui/CodeView.tsx` | Coloration syntaxique shiki chargée en dynamique (texte brut pendant le streaming). |
| `ui/CommandPalette.tsx` | Palette de commandes (⌘K). |
| `ui/Segmented.tsx` | Contrôle à segments réutilisable (onglets). |

## 3. Le parcours d'une génération

La génération vit **côté serveur**, détachée de toute requête HTTP : un refresh,
une navigation ou un onglet fermé ne la tuent jamais.

1. **`POST /api/jobs`** — l'utilisateur est authentifié (401 sinon) et rate-limité
   (8 générations / 10 min). Dans une transaction (`withTransaction`) :
   - vérification du **verrou** : un seul job `queued`/`running` par utilisateur,
     et par jeu en mode édition (409 avec `activeJob` → le client raccroche ce job au lieu d'échouer) ;
   - en mode édition, le **message utilisateur est persisté dès la création du job** :
     même si la génération échoue ou est annulée, la demande reste visible dans le chat ;
   - `INSERT` du job (`generation_jobs`, payload JSON).
   Puis lancement **détaché** : `void jobRunner.runJob(id)` — la requête HTTP qui a
   créé le job peut se terminer, la génération continue.

2. **Exécution** — `runGenerationJob()` (`generation.ts`) reçoit une fonction `emit`
   qui **ne jette jamais** : la disparition des clients ne fait rien. Chaque événement
   (`GenEvent`) est **persisté dans `generation_events` avec un `seq` croissant, PUIS
   diffusé** aux abonnés avec le même seq : le live et le replay voient la même
   séquence. Les deltas `reasoning`/`chunk` sont **coalesqués** (~150 ms ou 2 Ko) :
   environ 10² INSERT par génération au lieu de 10⁴. Un événement structurel
   (`phase`, `status`, `done`…) part toujours après flush des deltas en attente :
   l'ordre est préservé.

3. **Suivi client** — `GET /api/jobs/[id]/events` est un flux **SSE rejouable** :
   - chaque événement part avec `id: <seq>` ; l'en-tête `Last-Event-ID` (envoyé
     nativement par `EventSource` à la reconnexion, ou `?cursor=`) sert de curseur ;
   - `subscribe()` rejoue d'abord les événements persistés (seq > curseur), puis
     raccorde au live avec déduplication par seq : **ni trou, ni doublon** ;
   - heartbeat toutes les 15 s + `X-Accel-Buffering: no` pour les proxys ;
   - la déconnexion d'un client ne fait que le désabonner ; l'annulation est
     explicite (`POST /api/jobs/[id]/cancel`).

4. **Réduction côté client** — `GenerationProvider` applique chaque événement via
   `reduceGenEvent()` (`genEvents.ts`) : le client ne déduit plus rien, le serveur
   est la source de vérité (phases, tentatives, bascule de mode). Après une
   reconnexion, le replay reconstruit l'état **à l'identique**, aperçu live compris
   (`fullCode` cumule les chunks). Au montage, le provider interroge
   `GET /api/jobs/active` et se raccroche automatiquement au job en cours (ou à un
   résultat raté < 5 min) — c'est ce qui rend la génération « immortelle » côté
   client. Si le flux meurt, le provider ne déclare pas d'échec tant que le job vit
   côté serveur : backoff exponentiel (jusqu'à 10 raccrochages) puis reprise.

5. **Validation et INSERT** — le HTML extrait passe par `normalizeGameHtml()`
   (injection de la meta viewport si oubliée), puis **`validateGameHtml()`**
   (syntaxe, autonomie, postMessage) et `smokeTestGameHtml()` (câblage + boot
   jsdom, non bloquant grâce à `bestHtml`). Un jeu invalide n'atteint **jamais** la
   base : en création, jusqu'à 3 tentatives avec la raison précise du rejet
   renvoyée au modèle. La sauvegarde (`saveCreation` / `saveImprovement`) est
   transactionnelle, avec **relecture de la version au moment de l'écriture**
   (anti-course : la génération peut durer des minutes, une restauration
   concurrente a pu passer).

6. **Fin de vie** — le statut final (`done`/`error`/`cancelled`) et un événement
   final sont persistés (rejouables pour les clients qui raccrochent après coup) ;
   les jobs terminés sont purgés après 24 h ; au premier accès après un
   redémarrage, `sweepStaleJobs()` clôture en erreur les jobs orphelins et consigne
   un message `kind='error'` dans le chat des éditions interrompues.

## 4. Les deux modes

Le type du job (`create` / `edit`) est porté par le serveur et propagé au client
(`state.mode` dans le provider). Une bascule en cours de route passe par un
événement `mode` explicite.

### Création (`runCreatePipeline`)

Trois étapes, chacune dégradant gracieusement — on ne régresse jamais sous le
single-shot d'origine :

1. **DIRECTOR** (`runDirector`) : conçoit un **brief** textuel (mécanique, 4–6
   concepts, niveaux, boss final, « moment wow ») en intégrant la direction
   artistique imposée par `artDirection.ts`. Sa sortie est streamée comme
   `reasoning` (elle ne pollue pas l'aperçu HTML). Échec ou brief trop court →
   repli single-shot (`GAME_SYSTEM_PROMPT`).
2. **BUILDER** (`runCreateFlow` + `BUILDER_SYSTEM_PROMPT`) : implémente le brief
   fidèlement en un seul fichier HTML. Jusqu'à 3 tentatives : à chaque relance, la
   raison précise du rejet est renvoyée au modèle (et consigne « nettement plus
   COMPACT » si la réponse a été tronquée par le budget de tokens).
3. **QA** (`runQaSession`) : relecture qualité par retouches CHERCHER/REMPLACER
   chirurgicales (réutilise `editor.ts`), best-effort, 2 tours max. Elle est
   **nourrie des défauts détectés mécaniquement** (smoke-test runtime + findings
   du `lint.ts`) : une relecture ciblée corrige bien mieux qu'une checklist dans
   le vide. Si rien d'exploitable, on garde le HTML du Builder.

### Édition agentique (`runEditSession` + `editor.ts`)

Le modèle ne réécrit **pas** le jeu : il émet des blocs
`<<<<<<< CHERCHER / ======= / >>>>>>> REMPLACER` (précédés d'une ligne
`RÉSUMÉ :`) que le serveur applique :

- matching **exact** d'abord, puis tolérant aux espaces de fin puis d'indentation
  de ligne ; une ancre présente plusieurs fois = échec « ambigu » (jamais de
  modification au mauvais endroit) ;
- chaque échec est rapporté au modèle **avec un extrait du passage réel le plus
  proche** (`nearestExcerpt`) pour qu'il corrige son ancrage — boucle agentique,
  jusqu'à 3 tours ;
- les succès sont conservés même si d'autres blocs échouent ;
- jeu invalide après application → l'erreur (`buildEditValidationFeedback`) lui est
  renvoyée pour correction ;
- cas exceptionnels prévus : réécriture complète dans un bloc ```html``` (acceptée
  seulement si aucune opération n'est proposée), réponse sans bloc → rappel du
  format strict (`EDIT_FORMAT_REMINDER`) ;
- en dernier recours : **repli en régénération complète** — événement
  `mode: "create"` (le client vide ses buffers : le flux redevient un document
  complet et l'aperçu live redevient pertinent), prompt
  `buildImprovementPrompt` sur le HTML existant.

La ligne `RÉSUMÉ :` de la réponse devient le message assistant du chat. Chaque
amélioration réussie **archive** l'état courant dans `game_versions`
(`archiveCurrentVersion`, INSERT strict : une collision de version est une vraie
erreur de course, jamais un écrasement silencieux) et incrémente
`games.version` ; restaurer une version crée une **nouvelle** version, rien n'est
perdu.

## 5. Le pipeline LLM

`streamChat()` (`llm.ts`) POSTe sur `${OPENAI_BASE_URL}/chat/completions`
(**endpoint OpenAI-compatible générique**, jamais de SDK propriétaire ; le
déploiement réel utilise un gateway universitaire avec un modèle Qwen dont le
thinking ne peut pas être désactivé côté serveur) et normalise les **trois
formats de raisonnement** des modèles « thinking » en événements
`{kind:"reasoning" | "text" | "finish"}` :

1. `delta.reasoning` (OpenRouter) ;
2. `delta.reasoning_content` (vLLM, SGLang, DeepSeek, Qwen…) ;
3. balises `<think>…</think>` incrustées dans `delta.content` — séparées par
   `ThinkTagSplitter`, **stateful** car une balise peut arriver coupée entre deux
   chunks SSE (tout suffixe susceptible d'être un début de balise est retenu jusqu'au
   chunk suivant ; variantes `<thinking>`/`<thought>` acceptées).

Pour désactiver le thinking (`OPENAI_REASONING_EFFORT=none`), la requête envoie
**à la fois** `reasoning.enabled=false` (OpenRouter) et
`chat_template_kwargs.enable_thinking=false` (vLLM/SGLang) ; si le serveur rejette
ces champs inconnus (HTTP 400/422), retry automatique sans eux. La fin de stream
est un **événement** `finish` (portant `finish_reason`), pas une exception : une
réponse tronquée peut quand même contenir un document complet récupérable. Les
erreurs de fetch sont enrichies (URL + cause réseau comme ECONNREFUSED) pour
rester actionnables — cas typique : gateway universitaire joignable seulement via
VPN.

En aval :

- `extractHtml()` (`prompts.ts`) est volontairement **paranoïaque** : strip des
  blocs de réflexion (`stripThinking`, y compris balise ouverte jamais fermée,
  en gardant un document HTML qui apparaîtrait après), collecte de **tous** les
  candidats (blocs ```html```, texte brut hors fences) et choix du **dernier**
  document `<!DOCTYPE html>…</html>` complet (les brouillons et la réflexion
  précèdent toujours la réponse finale).
- `validateGameHtml()` (`validate.ts`, serveur uniquement) enchaîne : `</html>`
  final, au moins un `<script>` (commentaires HTML et blocs complets retirés avant
  de chercher une balise orpheline — même sémantique que le navigateur), aucun
  `type="module"` ni `src=` (autonomie + fonctions globales accessibles aux
  `onclick`), **syntaxe JS vérifiée sans exécution via `node:vm`**, et présence du
  postMessage `learngame:complete`. Toute raison de rejet est un message français
  réutilisé tel quel vers le modèle et l'élève.
- `smokeTestGameHtml()` (`smoketest.ts`) ajoute deux contrôles runtime
  conservateurs : câblage (toute fonction appelée depuis un attribut
  `onclick`/`oninput` existe dans le script) et boot (le script s'exécute au
  chargement sous jsdom sans exception). Un échec relance une tentative mais ne
  bloque jamais la sauvegarde (repli sur le meilleur candidat syntaxiquement
  valide).
- `lintGameHtml()` (`lint.ts`, pur) complète la chaîne sur la **qualité** : il
  liste par regex les défauts repérables sans exécution (commentaires de
  réflexion du modèle, mélange `sort(() => Math.random() - 0.5)` biaisé,
  `console.log` restants, TODO/FIXME, fonctions déclarées deux fois) sans jamais
  bloquer la sauvegarde — ses findings sont injectés dans le prompt de QA avec
  le défaut runtime éventuel. Dans le même esprit, `normalizeGameHtml()` retire
  désormais `user-scalable=no`/`maximum-scale` de la meta viewport (le zoom est
  un droit) au lieu de payer une régénération entière. Les prompts Director/
  Builder/QA encodent les règles qualité correspondantes (réponse jamais
  lisible avant d'agir, barème où l'addition des points gagnables = maxScore,
  Fisher-Yates, feedback enseignant dès le premier échec, a11y minimale).

## 6. La persistance

SQLite (fichier `data/learngame.db` relatif à `process.cwd()`) en mode **WAL**,
`PRAGMA foreign_keys = ON`, via `DatabaseSync` de `node:sqlite`. La connexion est
un singleton global ouvert paresseusement ; les migrations sont **additives**
(`PRAGMA table_info` + `ALTER TABLE` dans `createDb()`) : ne jamais casser une base
existante.

Tables principales et leurs liens :

| Table | Liens et points clés |
|---|---|
| `users` | `role` (`user`/`admin`) et `status` (`pending`/`approved`) ajoutés par migration ; les nouveaux comptes naissent `pending` (route d'inscription). Promotions admin idempotentes via `ADMIN_USERNAMES` au démarrage. |
| `games` | `user_id → users ON DELETE CASCADE`. HTML courant, `version`, `difficulty`, `change_summary`, `is_public` + `public_slug` (index unique), `plays`. |
| `scores` | `game_id → games CASCADE`, `user_id → users CASCADE`. **Un score par couple (jeu, élève)** : dédoublonnage (meilleur ratio conservé) puis index unique, migration idempotente. |
| `game_messages` | Chat du Studio ; `game_id → games CASCADE`, `user_id → users ON DELETE SET NULL`. Typé par `kind` (`chat`/`restore`/`error`/`cancelled`) et lié au `job_id`. |
| `game_versions` | Historique archivé ; PK (`game_id`, `version`), `summary` copié depuis `games.change_summary` au moment de l'archivage. |
| `generation_jobs` | `user_id → users CASCADE`, `game_id → games ON DELETE SET NULL`. Statuts `queued`/`running`/`done`/`error`/`cancelled`, payload JSON, horodatages. |
| `generation_events` | `job_id → generation_jobs CASCADE` ; PK (`job_id`, `seq`) : le replay est ordonné par seq. |
| `auth_sessions` | `user_id → users CASCADE` ; SHA-256 du token uniquement (une fuite de base ne permet pas de forger un cookie), horodatages en epoch ms, `user_agent`. Morte aussitôt si le compte repasse `status != 'approved'`. |

Les écritures multi-opérations passent par **`withTransaction()`**
(`BEGIN IMMEDIATE` : le verrou d'écriture est pris immédiatement, pas de course
entre lecture et écriture ; `fn` reste synchrone — `node:sqlite` l'est, c'est tout
l'intérêt). Deux usages structurants :

- `createJob` (`jobs.ts`) : vérification du verrou anti-doublon + message
  utilisateur + INSERT du job, dans une seule transaction ;
- `saveImprovement` (`generation.ts`) : **relecture de `version` sous le verrou**,
  archivage de l'état courant, UPDATE du jeu, message assistant — le mapping
  message ↔ version reste exact.

`getCurrentUser()` (auth) lit la session en base à chaque requête : révocable
(déconnexion = DELETE en base, pas juste un cookie jeté), pivotée à chaque
connexion, purge des sessions expirées à chaque création. Défenses complémentaires :
`assertSameOrigin()` (CSRF en profondeur), `burnScryptTime()` (coût scrypt payé
même si le compte n'existe pas → anti-énumération par timing), double fenêtre
anti-brute-force, re-hachage transparent des anciens hash `salt:hash` à la
première connexion réussie.

## 7. Les pages et qui y a accès

| Page | Accès | Contenu |
|---|---|---|
| `/` | Connecté (sinon redirect `/login`) | Dashboard : bibliothèque (pagination « Charger plus ») + création d'un jeu. |
| `/studio` | Connecté (page client) | Création en cours : chat (demande + bulle de progression) à gauche, aperçu/code live à droite. Flux : Dashboard → `start(…, {embedded:true})` → `/studio` → fin → `router.replace("/games/[id]")`. **Attend `generation.bootstrapped` avant de rediriger** (sinon un F5 pendant une création renverrait à l'accueil). |
| `/games/[id]` | Connecté | Studio du jeu. Le **chat et les actions d'édition sont réservés au créateur** (`isOwner`, revérifié côté API par `requireOwnedGame`) ; la page est en `noindex`. |
| `/admin` | Connecté **et** `role === "admin"` (sinon redirect `/`) | Approbation/rejet des comptes `pending`. |
| `/p/[slug]` | **Public** (jeu trouvé via `public_slug` + `is_public = 1`, sinon 404) | Lecteur public (`PublicPlayer`) ; si l'élève est connecté, son score est enregistré au classement. |
| `/login` | Déconnecté (sinon redirect `/`) | Connexion/inscription ; écran dédié tant que le compte est en attente d'approbation. |

Trois surfaces d'affichage de la génération, **exclusives**, pilotées par le
provider : `embedded=true` → un Studio l'affiche en ligne (l'overlay global se
tait) ; sinon overlay plein écran ; sinon pilule flottante si minimisé (quand on
quitte le Studio en cours de route, ou après un raccrochage au montage).
`state.mode` distingue `create` (aperçu live du HTML streamé) et `edit` (le flux
est une liste de retouches : pas d'aperçu live, le jeu courant reste jouable).

Côté API, les gardes de `api.ts` font foi : `requireUser` (401), `requireAdmin`
(403), `requireOwnedGame` (403 « seul le créateur… »). Les flux client passent par
`apiFetch()` (`clientApi.ts`) : 401 → redirection `/login?next=…`.

## 8. Le rendu des jeux

- Les jeux sont servis en HTML **brut** par `GET /api/games/[id]/play`
  (authentifié) ou `GET /api/p/[slug]/play` (public), via `gameHtmlResponse()` :
  - **CSP stricte** : `default-src 'none'; script-src 'unsafe-inline';
    style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';
    frame-ancestors 'self'` — aucune ressource externe, aucun appel réseau ;
  - `X-Frame-Options: SAMEORIGIN`, `Cache-Control: no-store` ;
  - erreurs rendues en page HTML minimale (pas de JSON dans une iframe).
- L'iframe est `sandbox`ée par l'attribut côté client (`Studio`, `PublicPlayer`) :
  pas de `localStorage`, pas de cookies, pas d'`alert` — règles imposées au prompt
  et vérifiées à la validation.
- Le score remonte par **`postMessage({type:"learngame:complete", score,
  maxScore})`**, exigé par les prompts, vérifié par `validateGameHtml()`, et
  filtré par le récepteur (`e.source === iframe.contentWindow`) avant POST vers
  `/api/games/[id]/scores`. L'index unique garantit un score par (jeu, élève).
- Le compteur de parties n'est **pas** alimenté par `/play` (vue code,
  téléchargement, rechargements y passent aussi) mais par un beacon
  `POST .../plays` envoyé au chargement réel, avec un garde anti-spam côté client
  (une partie par 30 s).
- Dans le Studio, **une seule `<iframe>`** est instanciée, dont la `key` est le
  seul `reloadKey` (rechargement manuel) : changer de vue (aperçu ↔ code) ou
  d'appareil ne la remonte jamais ; la vue code la recouvre sans la démonter.

## 9. Les invariants non négociables

Tirés de CLAUDE.md ; toute contribution doit les respecter.

1. **Tout en français** : interface, prompts, messages d'erreur, commentaires de
   code. Public : étudiants universitaires.
2. **`node:sqlite` natif uniquement** (better-sqlite3 ne compile pas sur Node 26) ;
   migrations additives dans `createDb()`, jamais de migration destructive.
3. **Endpoint LLM OpenAI-compatible générique** (`OPENAI_BASE_URL`), jamais de SDK
   propriétaire. La robustesse de `llm.ts`/`prompts.ts` (thinking non désactivable
   du gateway Qwen) ne doit pas être simplifiée.
4. **Un jeu invalide n'atteint jamais la base** : tout HTML passe par
   `validateGameHtml()` (syntaxe JS via `node:vm`, postMessage présent, pas de
   `<script src>`/module) avant `INSERT`/`UPDATE`.
5. **Un seul process Node assumé** (build standalone en Docker) : singletons sur
   `globalThis` (`__lgDb`, `__lgJobs`), rate-limit et verrous en mémoire. Ne pas
   introduire de déploiement multi-instances sans revoir `jobs.ts` et `ratelimit.ts`.
6. **La génération est serveur et rejouable** : événement persisté puis diffusé
   avec le même `seq` ; le client ne déduit rien (réducteur partagé `genEvents.ts`) ;
   toute évolution du protocole touche `genEvents.ts` + l'émetteur
   (`generation.ts`/`jobs.ts`) + les surfaces d'affichage, dans le même commit.
7. **L'historique n'est jamais perdu** : chaque amélioration archive la version
   précédente dans `game_versions`, une restauration crée une nouvelle version, et
   le message utilisateur d'édition est persisté dès la création du job.
8. **Le prompt système `GAME_SYSTEM_PROMPT` est le levier n°1 de la qualité des
   jeux** : le modifier avec parcimonie, il encode des règles durement acquises
   (autonomie du fichier, sandbox, postMessage, structure pédagogique).
