# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Le projet en une phrase

LearnGame : des étudiants décrivent un sujet, un LLM génère un jeu pédagogique HTML autonome, jouable et améliorable par chat dans un Studio façon Lovable (chat à gauche, jeu rendu à droite).

## Commandes

```bash
npm run dev                       # développement → http://localhost:3000
npm run build                     # build + vérification TypeScript complète (c'est LE check à lancer)
npm start                         # production (après build)
docker compose up -d --build      # déploiement (volume ./data pour SQLite)
```

- **Pas de framework de test ni d'ESLint configuré** (`npm run lint` ouvre un prompt interactif — ne pas l'utiliser). `npm run build` fait office de vérification de types.
- Tests unitaires ad hoc : écrire un script TS qui importe directement les modules de `src/lib/` et l'exécuter avec `npx -y tsx <fichier>` (les modules de `src/lib` n'ont pas de dépendance à Next). C'est la méthode utilisée pour tester `prompts.ts` (extraction HTML), `llm.ts` (ThinkTagSplitter) et `editor.ts` (moteur CHERCHER/REMPLACER).
- Smoke test sans toucher au port de dev : `PORT=3457 npm start` puis `curl`. Pour tester la génération de bout en bout sans vrai LLM, lancer un mock SSE OpenAI sur un port local et démarrer avec `OPENAI_BASE_URL=http://localhost:<port>/v1` (les variables d'environnement priment sur `.env`).
- Inspection de la base : `node --input-type=module -e "import('./src/lib/db.ts').then(m => { const db = m.default; … })"` — **impérativement depuis la racine du projet** (`db.ts` ouvre `process.cwd()/data/learngame.db`).

## Contraintes non négociables

- **Tout en français** : interface, prompts, messages d'erreur, commentaires de code. Public : étudiants universitaires.
- **`node:sqlite` natif uniquement** (better-sqlite3 ne compile pas sur Node 26). Migrations additives dans `createDb()` via `PRAGMA table_info` + `ALTER TABLE` — ne jamais casser une base existante.
- **Endpoint LLM = OpenAI-compatible générique** (`OPENAI_BASE_URL`), jamais de SDK propriétaire. Le déploiement réel utilise un gateway universitaire avec un modèle Qwen dont le **thinking ne peut pas être désactivé côté serveur** : toute la robustesse de `llm.ts`/`prompts.ts` existe pour ça, ne pas la simplifier.
- **Un jeu invalide n'atteint jamais la base** : tout HTML passe par `validateGameHtml()` (syntaxe JS vérifiée via `node:vm`, postMessage présent, pas de `<script src>`/module) avant `INSERT`/`UPDATE`.
- Les jeux générés sont des **fichiers HTML 100 % autonomes** servis dans une iframe sandboxée avec CSP stricte (`/api/games/[id]/play`). Ils remontent leur score par `postMessage({type:"learngame:complete", score, maxScore})`.

## Architecture — ce qui demande de lire plusieurs fichiers

### Jobs de génération persistés (`src/lib/jobs.ts` + `src/lib/generation.ts` + `/api/jobs/*`)

La génération vit **côté serveur**, détachée de toute requête HTTP : un refresh, une navigation ou un onglet fermé ne la tuent jamais.

- `POST /api/jobs` crée un job (`generation_jobs`) et le lance en tâche de fond (`void runJob()`). Verrou serveur : **un job actif par utilisateur ET par jeu** (409 avec `activeJob` → le client raccroche). En mode édition, le message utilisateur est persisté **dès la création du job** (visible même après échec/annulation, colonne `kind`).
- `jobs.ts` est un **runner in-process singleton** (`globalThis.__lgJobs`, même pattern que `db.ts` pour survivre au HMR). Hypothèse assumée : **un seul process Node** (build standalone en Docker). `sweepStaleJobs()` clôture en erreur les jobs orphelins après un redémarrage.
- Chaque événement est **persisté dans `generation_events` (seq croissant) puis diffusé** aux abonnés avec le même seq ; les deltas `reasoning`/`chunk` sont coalescés (~150 ms ou 2 Ko). `GET /api/jobs/[id]/events` est un SSE **rejouable** : `id: <seq>` + `Last-Event-ID` (reconnexion native d'EventSource) → replay des événements manqués puis live, sans trou ni doublon. Heartbeat 15 s + `X-Accel-Buffering: no` pour les proxys.
- La déconnexion d'un client ne fait que le désabonner ; l'annulation est explicite (`POST /api/jobs/[id]/cancel`).
- `generation.ts` = le cœur extrait de l'ancienne route `/api/generate` : création (3 tentatives) et session d'édition agentique, **phases émises par le serveur** (`thinking`/`coding`/`applying`/`validating`, avec `round` par tour d'édition, `attempt` autoritaire, événement `mode` lors du repli édition→régénération). Écritures en base sous `withTransaction()` avec **relecture de la version** au moment de l'écriture (anti-course).

### Protocole d'événements v2 (`src/lib/genEvents.ts`)

Module **pur** partagé serveur/client : types `GenEvent`, `initialSnapshot()`, `reduceGenEvent()`. Le client (`GenerationProvider`) ne déduit plus rien : il réduit les événements ; après reconnexion, le replay reconstruit l'état à l'identique (aperçu live compris). **Toute évolution du protocole se fait dans ce fichier + l'émetteur (`generation.ts`/`jobs.ts`) + le réducteur est déjà partagé** ; mettre à jour les surfaces d'affichage (`GenerationPanel`, `GenerationOverlay`, `StudioShared`) dans le même commit.

### Pipeline LLM (`src/lib/llm.ts` → `src/lib/prompts.ts` → `src/lib/validate.ts`)

`streamChat()` normalise les trois formats de raisonnement des modèles "thinking" en événements `{kind:"reasoning"|"text"|"finish"}` :
1. `delta.reasoning` (OpenRouter), 2. `delta.reasoning_content` (vLLM/SGLang), 3. balises `<think>…</think>` incrustées dans `content` (séparées par `ThinkTagSplitter`, stateful car une balise peut arriver coupée entre deux chunks SSE).

Pour désactiver le thinking (`OPENAI_REASONING_EFFORT=none`), la requête envoie à la fois `reasoning.enabled=false` (OpenRouter) et `chat_template_kwargs.enable_thinking=false` (vLLM) ; si le serveur rejette ces champs (HTTP 400/422), retry automatique sans eux. La fin de stream est un événement (`finish`), pas une exception : une réponse tronquée peut quand même contenir un document complet récupérable.

`extractHtml()` est volontairement paranoïaque : strip des blocs `<think>`, collecte de tous les candidats (fences ```` ```html ````, fence non fermée, texte brut) et choix du **dernier** document `<!DOCTYPE…</html>` complet (les brouillons et la réflexion précèdent toujours la réponse finale).

### Deux modes de génération (`src/lib/generation.ts`)

- **Création** : prompt `GAME_SYSTEM_PROMPT` → jeu complet streamé, jusqu'à 3 tentatives avec la raison précise du rejet renvoyée au modèle (et consigne "plus compact" si troncature).
- **Amélioration = session d'édition agentique** (`runEditSession` + `src/lib/editor.ts`) : le modèle ne réécrit PAS le jeu, il émet des blocs `<<<<<<< CHERCHER / ======= / >>>>>>> REMPLACER` (façon Aider) que le serveur applique (matching exact puis tolérant à l'indentation, détection d'ambiguïté). Échecs rapportés au modèle avec un extrait du passage réel le plus proche, jusqu'à 3 tours ; jeu invalide après édition → l'erreur lui est renvoyée pour correction ; repli en régénération complète en dernier recours. La ligne `RÉSUMÉ :` de sa réponse devient le message assistant du chat.

Chaque amélioration archive l'état courant dans `game_versions` (restauration = nouvelle version, rien n'est perdu, `summary` = résumé du changement copié depuis `games.change_summary`) et écrit l'échange dans `game_messages`.

### État de génération global (`src/components/GenerationProvider.tsx`)

Monté dans `layout.tsx`. Il ouvre un **EventSource** sur `/api/jobs/[id]/events` et réduit les événements via `reduceGenEvent`. **Au montage, il interroge `GET /api/jobs/active`** et raccroche automatiquement le job en cours (ou un résultat raté < 5 min) — c'est ce qui rend la génération immortelle côté client. Une seule génération à la fois. Trois surfaces d'affichage exclusives :
- `embedded=true` → un Studio l'affiche en ligne (l'overlay global se tait) ;
- overlay plein écran (`GenerationOverlay`) sinon ;
- pilule flottante si minimisé, si on quitte le Studio en cours de route, ou après un raccrochage au montage.

`state.mode` distingue `create` (aperçu live du HTML streamé pertinent) de `edit` (le flux est une liste de retouches : pas d'aperçu live, le jeu courant reste jouable) — il peut basculer en cours de route (événement `mode` du repli).

### Studio (`src/components/Studio.tsx`, page `/games/[id]` ; `src/app/studio/page.tsx` pour la création en cours)

Chat persistant à gauche (`/api/games/[id]/messages`, **réservé au créateur**, messages typés par `kind` : chat/restore/error/cancelled), aperçu/code à droite, panneaux redimensionnables (`react-resizable-panels`, persistés). **Une seule `<iframe>`**, jamais remontée par les changements de vue/appareil (`key` = reloadKey seul). Le flux création : Dashboard → `start({topic…}, {embedded:true})` → `router.push("/studio")` → fin → `router.replace("/games/[id]")` ; `/studio` attend `generation.bootstrapped` avant de rediriger (sinon un F5 pendant une création renverrait à l'accueil).

### Design system (`src/app/globals.css` + `src/components/ui/*`)

Tokens CSS `@theme` (sombre, accent violet `#8b7cff` / teal `#2dd4bf`) + classes maison `.btn/.card/.field`. Briques : `ToastProvider` (toasts unifiés, `useToast`), `ConfirmDialog` (`useConfirm`, remplace tous les `confirm()` natifs), `CodeView` (coloration shiki chargée en dynamique, texte brut pendant le streaming), `CommandPalette` (⌘K), `GenerationPanel` (LA source unique de l'affichage de progression : stepper de phases serveur + barre indéterminée — ne pas réintroduire de faux pourcentage). Côté client, les fetchs passent par `src/lib/clientApi.ts` (401 → redirect `/login?next=…`).

## Étapes à suivre pour une modification type

1. Identifier le mode touché : création (prompt système, extraction) ou édition (protocole de blocs, `editor.ts`).
2. Si le parsing/édition change : écrire ou étendre un test `npx tsx` dans `tests/` qui importe le module et couvre les cas limites (balises coupées, troncature, ancre ambiguë…). Ces modules sont purs, les tests sont faciles. Tests existants : `tests/validate.test.ts`, `tests/genEvents.test.ts` (à la racine : `npx -y tsx tests/<f>`), `tests/db.test.ts` et `tests/jobs.test.mts` (**depuis un répertoire temporaire vide** : `cd "$(mktemp -d)" && npx -y tsx /chemin/projet/tests/jobs.test.mts` — ils créent une base fraîche, jobs.test embarque son propre mock LLM).
3. Si le protocole d'événements ou l'état de génération change : `genEvents.ts` (types + réducteur) **et** l'émetteur (`generation.ts`/`jobs.ts`) **et** les surfaces (`GenerationProvider`, `GenerationPanel`, `GenerationOverlay`), dans le même commit.
4. `npm run build` (type-check complet), puis smoke test sur `PORT=3457` ; pour un flux complet, mock LLM local + utilisateur/jeu de test injectés via l'API, **et nettoyer les données de test ensuite** (`DELETE FROM users WHERE username = 'test-…'` cascade tout).
5. Le prompt système (`GAME_SYSTEM_PROMPT`) est le levier n°1 de la qualité des jeux : le modifier avec parcimonie, il encode des règles durement acquises (autonomie du fichier, sandbox, postMessage, structure pédagogique).

## Variables d'environnement à connaître

`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` (endpoint OpenAI-compatible) · `OPENAI_MAX_TOKENS` (garder large, ≥ 50000 : le thinking consomme ce budget) · `OPENAI_REASONING_EFFORT` (`none` recommandé, `default` = ne rien envoyer) · `OPENAI_TEMPERATURE` (0.6 par défaut) · `SESSION_SECRET` (**obligatoire en production**, le serveur refuse de signer des sessions sans lui) · `SESSION_SECURE_COOKIE` (`0` pour autoriser le cookie de session en HTTP pur, sinon `secure` en prod) · `REGISTRATION_CODE` (vide = inscription libre).
