# AGENTS.md — Guide d'accueil des agents

> **À lire intégralement avant toute modification.** Ce fichier fait économiser à un
> agent fraîchement démarré des heures d'exploration : ce qui compte, ce qui est
> interdit, comment vérifier, et comment travailler avec des sous-agents sans se
> tirer une balle dans le pied.

---

## 1. Le projet en 30 secondes

**LearnGame** : des étudiants universitaires décrivent un sujet d'apprentissage, un
LLM génère un **jeu pédagogique HTML 100 % autonome** (un seul fichier, validé
mécaniquement), améliorable par chat dans un Studio façon Lovable.

- **Stack** : Next.js 15 (App Router) · React 19 · Tailwind CSS v4 · `node:sqlite`
  natif (aucune dépendance native à compiler) · auth 100 % maison (scrypt + sessions
  en base) ; le SSO OIDC est le seul recours à une lib d'authentification
  (`openid-client`, choisi sciemment pour la validation cryptographique des jetons).
- **Déploiement** : Docker standalone, **UN SEUL process Node** — c'est une hypothèse
  structurante (rate limiter en mémoire, runner de jobs in-process, sessions en base).
- **Langue** : tout en français — interface, prompts, messages d'erreur, commentaires
  de code. Public : étudiants universitaires, tutoiement.

## 2. Hiérarchie documentaire (sources de vérité)

| Document | Contenu |
|---|---|
| `CLAUDE.md` | Le plus détaillé : architecture interne, contraintes, variables d'env, méthodologie de test |
| `docs/architecture.md` | Vue d'ensemble : carte des modules, parcours d'une génération, persistance, rendu des jeux |
| `docs/authentification.md` | Le système de connexion : sessions, sécurité, endpoints, flux d'approbation |
| `docs/guide-demarrage.md` | Setup, variables `.env`, tests, Docker, dépannage |
| `docs/administration.md` | Comptes : approbation, refus, `ADMIN_USERNAMES`, réinitialisation de mot de passe |

**Règle** : toute évolution d'architecture se documente **dans le même commit** que
le code — le document concerné + `CLAUDE.md` + ce fichier si une règle change. Une
doc en retard est un bug.

## 3. Commandes essentielles

```bash
npm run dev                    # dev → http://localhost:3000
npm run build                  # build + TYPE-CHECK COMPLET — c'est LE check du projet
npm start                      # production (après build)
docker compose up -d --build   # déploiement (volume ./data pour SQLite)
```

**Prérequis** : Node ≥ 22.5 (`node:sqlite`) ; en pratique ≥ 24 recommandé (la commande
d'inspection ci-dessous repose sur le type-stripping natif, Node ≥ 23.6).
Environnement de référence : Node 26 en local, `node:24-alpine` en Docker.
La génération exige un `.env` renseigné (copier `.env.example`) — cf. `docs/guide-demarrage.md`.

⚠️ **Pas d'ESLint, pas de framework de test** : `npm run lint` ouvre un prompt
interactif (ne pas l'utiliser). `npm run build` fait office de vérification de types
— il doit passer à zéro erreur avant tout commit.

### Tests (ad hoc, `npx tsx`, harnais maison — pas de framework)

| Test | Commande exacte |
|---|---|
| `validate`, `genEvents`, `artDirection`, `smoketest`, `lint`, `oidcCore` | `npx -y tsx tests/<f>.test.ts` (depuis la racine) |
| `db`, `jobs.test.mts`, `authCore` | `cd "$(mktemp -d)" && npx -y tsx <chemin-absolu>/tests/<f>` — ils créent une base fraîche et **refusent** de tourner là où une base existe |
| `authApproval` | 2 phases dans le **même** dossier temporaire (simule un redémarrage) — voir l'en-tête du fichier |
| Smoke SSO de bout en bout | IdP mocké : `tests/mock-idp.mjs` (HTTPS local, recette dans son en-tête) — l'app doit tourner depuis un répertoire séparé pour ne pas toucher la vraie base |
| Smoke HTTP de bout en bout | `PORT=3457 npm start` puis `curl` — ne jamais toucher au port du serveur de dev |

**Nettoyage obligatoire** après tout test ayant créé des données : `DELETE FROM
users WHERE username LIKE 'test-%'` cascade tout (FK `ON DELETE CASCADE`).

### Inspection de la base

```bash
node --input-type=module -e "import('./src/lib/db.ts').then(m => { /* m.default = DatabaseSync */ })"
```

**Impérativement depuis la racine du projet** (`db.ts` ouvre `process.cwd()/data/learngame.db`).

## 4. Invariants non négociables

1. **Tout en français.** Interface, prompts, messages d'erreur, commentaires, docs.
2. **`node:sqlite` natif uniquement** (Node ≥ 22.5). better-sqlite3 a été écarté après
   un échec de compilation constaté sur Node 26 ; le Dockerfile tourne sur
   `node:24-alpine`. Ne jamais ajouter de dépendance SQLite tierce.
3. **Migrations additives uniquement** : `CREATE TABLE IF NOT EXISTS` +
   `PRAGMA table_info` + `ALTER TABLE`. Ne jamais casser une base existante.
4. **Un jeu invalide n'atteint jamais la base** : tout HTML passe par
   `validateGameHtml()` avant `INSERT`/`UPDATE`.
5. **Un seul process Node** (build standalone Docker) : ne pas introduire de store
   distribué ni de worker séparé sans remettre en cause explicitement cette hypothèse.
6. **Endpoint LLM = OpenAI-compatible générique** (`OPENAI_BASE_URL`), jamais de SDK
   propriétaire. La robustesse de `llm.ts`/`prompts.ts` existe pour les modèles
   « thinking » dont le raisonnement ne peut pas être désactivé côté serveur — ne
   pas la simplifier.
7. **Aucune donnée d'authentification sensible exposée** : `getCurrentUser()` retourne
   un `SessionUser` sanitisé (jamais `password_hash`) ; les tokens de session ne
   vivent qu'en cookie httpOnly, la base ne stocke que leur SHA-256.
8. **Endpoint de l'application** : port 3000 par défaut (`PORT=<n>` pour override) ;
   les smoke tests utilisent 3457.

## 5. Carte express du code

| Chemin | Rôle |
|---|---|
| `src/lib/session.ts` | Noyau auth PUR : scrypt versionné, sessions en base. Testable sans Next |
| `src/lib/auth.ts` | Glue cookies Next (`getCurrentUser`, `setSessionCookie`, `clearSessionCookie`) |
| `src/lib/authValidate.ts` | Règles identifiants partagées client/serveur — source de vérité unique |
| `src/lib/oidc.ts` | Noyau SSO OIDC (PKCE, flux persistés single-use, résolution de compte). Le protocole est délégué à `openid-client` v6 |
| `src/lib/oidcMessages.ts` | Codes d'erreur SSO fermés + messages — partagés callback ↔ formulaire |
| `src/lib/api.ts` | Gardes des routes (`requireUser`, `requireAdmin`, `assertSameOrigin`), `handleApi`, format d'erreur `{ error }` |
| `src/lib/errors.ts` | `ApiError` (pur) — défini ici, ré-exporté par `api.ts` |
| `src/lib/db.ts` | SQLite (WAL, proxy paresseux sur `globalThis`), schéma + migrations, `withTransaction` |
| `src/lib/jobs.ts` + `generation.ts` | Génération détachée du HTTP (jobs persistés, verrou user+jeu) |
| `src/lib/genEvents.ts` | Protocole d'événements PUR partagé serveur/client (réducteur) |
| `src/lib/llm.ts` → `prompts.ts` → `validate.ts` | Pipeline LLM (streaming, thinking, extraction, validation) |
| `src/lib/lint.ts` | Lint de qualité non bloquant (réflexions du modèle livrées, shuffle biaisé, console.log, TODO, fonctions dupliquées) → findings injectés dans la QA |
| `src/lib/editor.ts` | Édition agentique par blocs CHERCHER/REMPLACER |
| `src/lib/clientApi.ts` | `apiFetch` client : 401 → redirect `/login?next=…`, erreurs → `HttpError` |
| `src/components/auth/LoginForm.tsx` | Formulaire connexion/inscription (validation en direct) |
| `src/components/GenerationProvider.tsx` | État de génération global (EventSource rejouable) |
| `src/app/globals.css` | Design system « Atelier nocturne » (tokens `@theme`, classes `.btn/.card/.field`) |

La carte complète et commentée : `docs/architecture.md`.

## 6. Conventions de code

- **Modules PUR quand possible** : pas d'import Next dans la logique métier — c'est ce
  qui rend les tests triviaux (cf. `session.ts`, `authValidate.ts`, `genEvents.ts`,
  `editor.ts`). La glue Next vit dans des fichiers séparés et minces (`auth.ts`).
- **Erreurs API** : `throw new ApiError(status, "message en français")` → `handleApi()`
  → `Response.json({ error })`. Un seul format de wire, jamais de 500 silencieux.
- **Design system** : les classes `.btn`, `.card`, `.field`, `.seg` sont **stables** —
  `globals.css` en élève l'exécution, il ne renomme rien. Réutiliser les briques
  existantes : `Segmented`, `ToastProvider` (`useToast`), `ConfirmDialog`
  (`useConfirm` — remplace tous les `confirm()` natifs), `CodeView`.
- **Côté client**, les fetchs passent par `apiFetch` (`src/lib/clientApi.ts`), pas par
  `fetch` nu. Exceptions légitimes — elles doivent contourner la redirection 401
  d'`apiFetch` ou ne sont pas des appels authentifiés : le formulaire d'auth
  (`LoginForm`), le sondage/émission de jobs (`GenerationProvider`), le téléchargement
  du HTML (`Studio`), la bascule de partage (`ShareModal`), l'envoi du score et le
  beacon de comptage de parties (`PublicPlayer`), la déconnexion (`Dashboard`). Toute
  nouvelle exception se justifie dans un commentaire sur place.
- **Pas de `any`** mou, pas de `@ts-ignore` : le type-check du build est la seule
  barrière, ne pas la percer.
- Les commentaires expliquent le **pourquoi**, pas le quoi — en français.

## 7. Checklists par type de modification

### 🔐 Auth (zone sensible — checklist de sécurité)

- [ ] Aucune donnée sensible dans une réponse (`SessionUser`, jamais `password_hash`)
- [ ] Toute route qui **bannit**, **supprime** ou **change le mot de passe** d'un
      compte appelle `revokeAllUserSessions(id)` (défense en profondeur)
- [ ] Rate limit **AVANT tout parsing du corps** ; les clés de bucket sont bornées
      (un pseudo de 2 Mo ne doit jamais finir en clé de Map)
- [ ] La validation client de la CONNEXION reste minimale (« non vide ») : les comptes
      créés avant une évolution des règles doivent toujours pouvoir se connecter.
      Les règles complètes ne s'appliquent qu'à l'INSCRIPTION (miroir du serveur via
      `authValidate.ts`)
- [ ] `assertSameOrigin(req)` présent sur toute route d'authentification qui mute
- [ ] Les réponses de « check » (disponibilité de pseudo…) restent **neutres** en cas
      d'erreur serveur — jamais de conclusion inférée d'un 429/500
- [ ] `tests/authCore.test.ts` étendu dans le même commit
- [ ] SSO : toute évolution du flux touche `src/lib/oidc.ts` + les 2 routes
      `/api/auth/oidc/*` + `tests/oidcCore.test.ts` dans le même commit ; les
      erreurs passent par les codes FERMÉS d'`oidcMessages.ts` (jamais de
      texte de l'IdP dans l'URL)
- [ ] SSO : ne JAMAIS construire d'URL depuis `req.url` (`next start` le
      réécrit en `http://localhost:<port>` quel que soit l'hôte servi) —
      passer par `redirectOrigin(req)`
- [ ] Modifier les coûts scrypt = bump du format versionné + `needsRehash` gère la
      migration — ne jamais invalider les hash existants

### 🎮 Génération / protocole d'événements

- [ ] Le protocole change → `genEvents.ts` (types + réducteur) **et** l'émetteur
      (`generation.ts`/`jobs.ts`) **et** les surfaces d'affichage
      (`GenerationProvider`, `GenerationPanel`, `GenerationOverlay`) **dans le même commit**
- [ ] Un jeu invalide n'atteint jamais la base ; un échec LLM ne crashe jamais le job
      (`runGenerationJob` ne jette pas)

### 🗄️ Schéma de base

- [ ] Migration **additive** seulement (`IF NOT EXISTS`, `PRAGMA table_info` +
      `ALTER TABLE`), jamais de `DROP`/`ALTER` destructeur
- [ ] Test ajouté/exécuté depuis un `mktemp -d` (il protège la vraie base)

### 📄 UI

- [ ] Classes du design system réutilisées (pas de CSS ad hoc redondant)
- [ ] Accessibilité : labels `htmlFor`, `aria-invalid`/`aria-describedby` sur les
      champs en erreur, `aria-live` pour les statuts dynamiques, focus visible
- [ ] `prefers-reduced-motion` respecté (la règle globale de `globals.css` s'en charge)

## 8. Pièges réels (leçons de bugs et de revues de sécurité)

- **`ADMIN_USERNAMES` pointant vers un pseudo inexistant** = silence total : personne
  n'est admin, personne ne peut valider les inscriptions. Toujours vérifier que le
  compte listé existe (`docs/administration.md` §7).
- **Cookie `secure` en HTTP pur** = jeté silencieusement par le navigateur →
  déconnexion en boucle sans aucune erreur. `SESSION_SECURE_COOKIE=0` pour un LAN sans TLS.
- **`x-forwarded-for` est forgable** : `clientIp()` ne s'y fie qu'avec
  `TRUST_PROXY=1` (proxy qui ÉCRASE l'en-tête). Sinon les fenêtres par IP deviennent
  globales — dimensionnées pour une salle de classe, la fenêtre par compte reste intacte.
- **Règles d'inscription ≠ validation de connexion** : appliquer les nouvelles règles
  au login verrouille les comptes legacy (bug réel corrigé — voir §7 checklist auth).
- **Un endpoint de « vérification »** (ex. pseudo disponible) doit répondre en trois
  états (dispo / pris / indéterminé) : conclure « pris » sur une 429 ou un 500 affiche
  un mensonge à l'utilisateur.
- **La documentation ment vite** : si le code et la doc divergent, corriger la doc
  immédiatement (le cas `SESSION_SECRET` déclaré obligatoire alors qu'abandonné a
  dérouté un relecteur — c'est corrigé, garder le réflexe).
- **`req.url` ment sous `next start`** : réécrit en `http://localhost:<port>` quel
  que soit l'hôte servi — construire une redirection avec = renvoyer les navigateurs
  vers localhost. Passer par `redirectOrigin(req)` (OIDC_REDIRECT_URI →
  `TRUST_PROXY` → en-tête `Host`).

## 9. Travailler avec des sous-agents — intelligemment

Les sous-agents sont des sessions enfants avec un contexte frais : ils ne savent **que
ce que tu leur dis** et ne partagent **rien** de ce que tu as appris dans la session
courante. C'est leur force (contexte vierge, travail parallèle) et leur piège.

### Quand déléguer ✅

| Cas | Agent | Mode |
|---|---|---|
| Exploration large : trouver tous les appelants d'une fonction, cartographier un système | `explore` (préciser `quick`/`medium`/`very thorough`) | foreground |
| Travail parallèle indépendant : rédiger N documents distincts, écrire un fichier de test avec des signatures figées pendant que tu codes le UI | plusieurs `general` | background |
| **Revue adversaire** d'un code que TU viens d'écrire (sécurité, UX, robustesse) | `general` | background, puis tu intègres les correctifs |
| Exécution vérifiée : un agent peut écrire ET exécuter (tests, doc avec commandes testées) puis rapporter | `general` | foreground ou background |

La revue adversaire est le pattern le plus rentable : tu écris le code (tu as le
contexte), un agent frais le relit avec hostilité (il n'a pas ton angle mort), tu
corriges ses findings, tu **revalides** (build + tests).

### Comment briefer un sous-agent 📋

1. **Contexte complet dans le prompt** : chemins exacts, extraits réels du code, les
   conventions du projet (français, modules purs, format d'erreur), les contraintes.
   Un brief vague produit du travail générique.
2. **Signatures exactes**, jamais « devine l'API » : donner les types, les constantes
   exportées, le comportement attendu cas par cas.
3. **Autoriser/interdire explicitement la modification de fichiers** : un relecteur
   ne modifie **rien**, il rapporte ; un rédacteur de test touche son fichier et rien
   d'autre ; s'il découvre un bug dans `src/`, il le rapporte au lieu de corriger.
4. **Exiger un livrable vérifiable** : tout ce qui est exécutable doit être exécuté
   par l'agent, avec la sortie copiée dans son rapport.
5. **Préciser les pièges locaux** : tests → `mktemp -d` ; imports relatifs ; langue
   française ; ne pas toucher à la vraie base.

### Coordination 🔄

- `background` = travail indépendant en parallèle ; tu continues sur des fichiers
  **disjoints**. Ne jamais modifier un fichier qu'un agent background est en train de
  travailler.
- Récupérer les résultats (le `sessionID` permet de relancer un agent là où il s'est
  arrêté) et **intégrer toi-même** les correctifs d'une revue : toi seul as la vue
  d'ensemble.
- Après toute intervention d'agent sur `src/` : `npm run build` + tests concernés +
  relecture de tes yeux. Un agent est un stagiaire brillant, pas un collègue de
  confiance aveugle.

### Quand NE PAS déléguer ❌

- **Cohérence fine** : refactorer un fichier, suivre le style local, toucher au
  design system — un agent au contexte vierge casserait les subtilités.
- **La synthèse de ta session** : si le savoir existe uniquement dans ta conversation
  (découvertes de debugging, décisions prises avec l'utilisateur), le rédiger
  toi-même — un agent devrait le ré-accumuler à grands frais.
- **Les décisions produit ambiguës** (quel compte promouvoir admin, quel mot de passe
  choisir, quelle politique de validation) : **demander à l'utilisateur** plutôt que
  deviner, puis exécuter.
- **La sécurité critique en dernier ressort** : un agent peut relire, mais la
  responsabilité finale du merge t'appartient — relis toi-même ses correctifs.

## 10. Dépannage express

| Symptôme | Cause → solution |
|---|---|
| Déconnexion en boucle, sans erreur | Cookie `secure` en HTTP → `SESSION_SECURE_COOKIE=0` |
| Personne ne peut valider les inscriptions | `ADMIN_USERNAMES` → pseudo inexistant en base |
| « Session expirée » après un déploiement | Comportement attendu si le mécanisme de session a changé — les anciens cookies sont ignorés |
| Tests refusent de démarrer | « Une base existe déjà ici » → lancer depuis un `mktemp -d` |
| Port 3000 occupé | `lsof -i :3000` puis kill, ou `PORT=<n>` — en évitant 3457, réservé au smoke test |
| Type errors en cascade sur `SessionUser`/`User` | `requireUser()` retourne le type sanitisé — ne jamais re-ajouter `password_hash` aux types exposés |

Le guide complet : `docs/guide-demarrage.md` §7.

## 11. Rituel de fin de tâche

1. `npm run build` — zéro erreur (c'est le seul type-check).
2. Tests concernés, avec les **commandes exactes** de §3.
3. Smoke HTTP si une route a changé (`PORT=3457`), puis **nettoyage** des données de test.
4. Documentation à jour dans le même commit (§2) — code, `CLAUDE.md`, `docs/`, ce fichier.
5. Commit en français, message qui dit le **pourquoi**.
