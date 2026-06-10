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

### Pipeline LLM (`src/lib/llm.ts` → `src/lib/prompts.ts` → `src/lib/validate.ts`)

`streamChat()` normalise les trois formats de raisonnement des modèles "thinking" en événements `{kind:"reasoning"|"text"|"finish"}` :
1. `delta.reasoning` (OpenRouter), 2. `delta.reasoning_content` (vLLM/SGLang), 3. balises `<think>…</think>` incrustées dans `content` (séparées par `ThinkTagSplitter`, stateful car une balise peut arriver coupée entre deux chunks SSE).

Pour désactiver le thinking (`OPENAI_REASONING_EFFORT=none`), la requête envoie à la fois `reasoning.enabled=false` (OpenRouter) et `chat_template_kwargs.enable_thinking=false` (vLLM) ; si le serveur rejette ces champs (HTTP 400/422), retry automatique sans eux. La fin de stream est un événement (`finish`), pas une exception : une réponse tronquée peut quand même contenir un document complet récupérable.

`extractHtml()` est volontairement paranoïaque : strip des blocs `<think>`, collecte de tous les candidats (fences ```` ```html ````, fence non fermée, texte brut) et choix du **dernier** document `<!DOCTYPE…</html>` complet (les brouillons et la réflexion précèdent toujours la réponse finale).

### Deux modes de génération (`src/app/api/generate/route.ts`)

- **Création** : prompt `GAME_SYSTEM_PROMPT` → jeu complet streamé, jusqu'à 3 tentatives avec la raison précise du rejet renvoyée au modèle (et consigne "plus compact" si troncature).
- **Amélioration = session d'édition agentique** (`runEditSession` + `src/lib/editor.ts`) : le modèle ne réécrit PAS le jeu, il émet des blocs `<<<<<<< CHERCHER / ======= / >>>>>>> REMPLACER` (façon Aider) que le serveur applique (matching exact puis tolérant à l'indentation, détection d'ambiguïté). Échecs rapportés au modèle avec un extrait du passage réel le plus proche, jusqu'à 3 tours ; jeu invalide après édition → l'erreur lui est renvoyée pour correction ; repli en régénération complète en dernier recours. La ligne `RÉSUMÉ :` de sa réponse devient le message assistant du chat.

Chaque amélioration archive l'état courant dans `game_versions` (restauration = nouvelle version, rien n'est perdu) et écrit l'échange dans `game_messages`.

### Protocole SSE route ↔ client (contrat inter-fichiers)

`/api/generate` émet `data: {type: …}` avec `status | phase | reasoning | chunk | reset | done | error`. Consommé exclusivement par `GenerationProvider.tsx`. **Toute évolution de ce protocole doit être répercutée des deux côtés** (et dans l'UI : `GenerationOverlay`, `StudioShared`).

### État de génération global (`src/components/GenerationProvider.tsx`)

Monté dans `layout.tsx`, il possède la requête fetch SSE : la génération **survit à la navigation**. Une seule génération à la fois. Trois surfaces d'affichage exclusives :
- `embedded=true` → un Studio l'affiche en ligne (l'overlay global se tait) ;
- overlay plein écran (`GenerationOverlay`) sinon ;
- pilule flottante si minimisé ou si on quitte le Studio en cours de route.

`state.mode` distingue `create` (aperçu live du HTML streamé pertinent) de `edit` (le flux est une liste de retouches : pas d'aperçu live, le jeu courant reste jouable).

### Studio (`src/components/Studio.tsx`, page `/games/[id]` ; `src/app/studio/page.tsx` pour la création en cours)

Chat persistant à gauche (`/api/games/[id]/messages`, restauration via `/api/games/[id]/restore`, créateur uniquement), aperçu/code à droite. Le flux création : Dashboard → `start({topic…}, {embedded:true})` → `router.push("/studio")` → fin → `router.replace("/games/[id]")`.

## Étapes à suivre pour une modification type

1. Identifier le mode touché : création (prompt système, extraction) ou édition (protocole de blocs, `editor.ts`).
2. Si le parsing/édition change : écrire ou étendre un test `npx tsx` qui importe le module et couvre les cas limites (balises coupées, troncature, ancre ambiguë…). Ces modules sont purs, les tests sont faciles.
3. Si le protocole SSE ou l'état de génération change : mettre à jour route **et** provider **et** les composants d'affichage, dans le même commit.
4. `npm run build` (type-check complet), puis smoke test sur `PORT=3457` ; pour un flux complet, mock LLM local + utilisateur/jeu de test injectés via `db.ts`, **et nettoyer les données de test ensuite**.
5. Le prompt système (`GAME_SYSTEM_PROMPT`) est le levier n°1 de la qualité des jeux : le modifier avec parcimonie, il encode des règles durement acquises (autonomie du fichier, sandbox, postMessage, structure pédagogique).

## Variables d'environnement à connaître

`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` (endpoint OpenAI-compatible) · `OPENAI_MAX_TOKENS` (garder large, ≥ 50000 : le thinking consomme ce budget) · `OPENAI_REASONING_EFFORT` (`none` recommandé, `default` = ne rien envoyer) · `OPENAI_TEMPERATURE` (0.6 par défaut) · `SESSION_SECRET` · `REGISTRATION_CODE` (vide = inscription libre).
