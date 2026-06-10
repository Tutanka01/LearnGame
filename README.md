# 🎮 LearnGame

Plateforme web pour étudiants : décris ce que tu veux apprendre ("je veux comprendre TCP/IP"),
l'IA génère **un jeu interactif sur mesure** pour te l'enseigner — dans l'esprit de Lovable,
mais appliqué à la pédagogie.

## Fonctionnalités

- ✨ **Génération de jeux par IA** — un jeu HTML complet et autonome, avec niveaux progressifs,
  feedback pédagogique, score et quiz final. Génération visible en direct (streaming), y compris
  la phase de **réflexion des modèles à raisonnement** (Gemini, DeepSeek, o-series…).
- 🏆 **Gamification** — chaque jeu remonte le score de l'élève à la plateforme (postMessage) :
  classement par jeu, badges « Terminé », points cumulés par élève.
- 🪄 **Itération** — l'élève peut demander des améliorations ("ajoute un niveau", "trop dur").
- 📚 **Bibliothèque partagée** — recherche, filtres (à faire / mes jeux), tri par popularité ;
  tous les jeux générés sont jouables par toute la classe. Téléchargement du jeu en .html.
- 👤 **Comptes élèves** — inscription simple, optionnellement protégée par un code de classe.
- 🔁 **Robustesse** — nouvelle tentative automatique si le modèle renvoie une réponse invalide,
  détection des réponses tronquées (budget de tokens insuffisant).
- 🔒 **Sécurité** — les jeux tournent dans une iframe sandboxée avec une CSP stricte :
  aucun accès réseau, aucun accès aux cookies/au site parent.

## Installation

```bash
npm install
cp .env.example .env   # puis remplir .env (déjà créé avec un secret généré)
```

Dans `.env`, configure ton endpoint compatible OpenAI :

| Variable | Description |
|---|---|
| `OPENAI_BASE_URL` | URL de base de l'API, sans `/chat/completions` (ex : `https://mon-serveur/v1`) |
| `OPENAI_API_KEY` | Clé API (laisser vide si l'endpoint n'en demande pas) |
| `OPENAI_MODEL` | Nom du modèle à utiliser |
| `OPENAI_MAX_TOKENS` | Budget de tokens par jeu (16000 recommandé — les jeux sont longs) |
| `SESSION_SECRET` | Secret de signature des sessions (`openssl rand -hex 32`) |
| `REGISTRATION_CODE` | Code que les élèves saisissent pour s'inscrire (vide = inscription libre) |

> ⚠️ Choisis un modèle **fort en génération de code** (la qualité des jeux en dépend
> directement) et avec un budget de sortie d'au moins ~16k tokens.

## Lancement

```bash
npm run dev        # développement → http://localhost:3000
npm run build && npm start   # production
```

## Docker

```bash
docker compose up -d --build   # → http://localhost:3000
```

Le conteneur lit la configuration dans `.env` et persiste la base SQLite dans `./data`
(volume). Sur un serveur Linux, si le conteneur ne peut pas écrire dans `./data`,
donnez-lui les droits : `chown 1000:1000 data` (l'app tourne avec l'utilisateur `node`).

La base SQLite est créée automatiquement dans `data/learngame.db` (module natif `node:sqlite`,
nécessite Node ≥ 22.5).

## Architecture

- **Next.js 15 + React 19 + Tailwind 4** — app full-stack, interface en français
- `src/lib/prompts.ts` — le prompt pédagogique qui pilote la qualité des jeux (structure
  imposée : accueil → 3-5 niveaux progressifs → boss final → récapitulatif)
- `src/app/api/generate` — génération en streaming SSE
- `src/app/api/games/[id]/play` — sert le HTML du jeu avec une CSP verrouillée
- `data/learngame.db` — utilisateurs + jeux (SQLite natif Node)
