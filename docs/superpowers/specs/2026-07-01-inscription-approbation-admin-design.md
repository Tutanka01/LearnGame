# Inscription avec approbation admin

**Date :** 2026-07-01
**Statut :** approuvé, en implémentation

## Problème

L'inscription est actuellement ouverte à tous (`/api/auth/register`) : le seul frein est
un `REGISTRATION_CODE` optionnel (vide par défaut = inscription libre), et un compte créé
obtient immédiatement une session active. N'importe qui connaissant l'URL peut donc créer
un compte et utiliser la plateforme. L'objectif est de fermer l'inscription libre : un
compte fraîchement créé doit rester inactif tant qu'un enseignant (admin) ne l'a pas
approuvé manuellement.

Le reste du système d'authentification (`src/lib/auth.ts`) est déjà solide — hachage
`scrypt` avec sel, comparaisons `timingSafeEqual`, sessions HMAC signées avec expiry,
cookies `httpOnly`/`sameSite=lax`/`secure` auto-détecté, rate limiting sur login et
register — et n'a **pas besoin d'être retouché**. Ce spec ne couvre que l'ajout d'un
état de compte (`pending`/`approved`) et d'un rôle (`user`/`admin`), et supprime le
mécanisme `REGISTRATION_CODE` qui devient redondant.

## Principe directeur

Ne jamais casser une base existante (contrainte non négociable du projet) : les comptes
déjà en base doivent rester utilisables sans aucune action manuelle après la migration.

## Modèle de données (`src/lib/db.ts`)

Migration additive dans `createDb()`, suivant le pattern `PRAGMA table_info` +
`ALTER TABLE` déjà utilisé pour `games`/`game_messages`/`game_versions` :

```sql
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
```

- `role` : `'user' | 'admin'`.
- `status` : `'pending' | 'approved'`. Le défaut `'approved'` sur la colonne garantit que
  tous les comptes existants restent connectables tels quels après la migration — c'est
  l'`INSERT` de la route d'inscription qui passera explicitement `'pending'` pour les
  **nouveaux** comptes, pas le défaut de la colonne.
- Pas de valeur `'rejected'` : un refus supprime la ligne (voir plus bas), donc l'état
  n'a jamais besoin d'être représenté en base.
- `User` (interface TS, `src/lib/db.ts`) gagne les champs `role: string` et
  `status: string`.

## Bootstrap du premier admin — `ADMIN_USERNAMES`

Nouvelle variable d'environnement, liste de noms d'utilisateur séparés par des virgules
(ex. `ADMIN_USERNAMES=mohamad`). Une fonction `promoteAdmins(db)` appelée à la fin de
`createDb()` :

```sql
UPDATE users SET role = 'admin', status = 'approved'
WHERE username IN (<noms normalisés issus de ADMIN_USERNAMES>);
```

Idempotente, sans effet si la variable est vide ou si aucun des noms n'existe encore.
Flux de bootstrap réel : l'admin s'inscrit une première fois via le formulaire normal
(compte créé `pending`), configure `ADMIN_USERNAMES` avec son propre nom, puis redémarre
le serveur (ou tout redémarrage ultérieur suffit) — son compte est alors promu
automatiquement. La même vérification est aussi appliquée **au moment de l'insertion**
dans la route d'inscription (voir plus bas), pour éviter d'exiger un redémarrage si
`ADMIN_USERNAMES` est déjà configuré avant la première inscription.

## Inscription (`src/app/api/auth/register/route.ts`)

- Suppression du paramètre `code` et de toute référence à `REGISTRATION_CODE`.
- `INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)` où
  `role`/`status` valent `('admin', 'approved')` si le nom figure dans
  `ADMIN_USERNAMES`, sinon `('user', 'pending')`.
- **Ne pose plus de cookie de session** dans le cas `pending` (aujourd'hui
  `setSessionCookie` est appelé inconditionnellement après l'insertion) : un compte en
  attente ne doit pas pouvoir naviguer connecté. Dans le cas `admin` auto-promu, la
  session est posée normalement (expérience fluide pour l'admin qui vient de configurer
  `ADMIN_USERNAMES`).
- Réponse JSON distincte selon le cas, ex. `{ ok: true, pending: true }` vs
  `{ ok: true, pending: false }`, pour que le client sache quel message afficher.

## Connexion (`src/app/api/auth/login/route.ts`)

Après `verifyPassword` réussi, avant `setSessionCookie` :

```ts
if (user.status !== "approved") {
  return apiError(403, "Ton compte est en attente d'approbation par un enseignant.");
}
```

Message explicite (décision produit assumée : révéler qu'un compte existe et est en
attente n'est pas une donnée sensible sur cette plateforme pédagogique).

## Autorisation admin (`src/lib/api.ts`)

À côté de `requireUser()` (même fichier, même style) :

```ts
/** Utilisateur connecté ET admin, sinon ApiError 401/403. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new ApiError(403, "Réservé aux administrateurs.");
  return user;
}
```

## Routes admin (nouveau : `src/app/api/admin/users/`)

- `GET /api/admin/users` → `requireAdmin()`, retourne les comptes `status = 'pending'`
  (id, username, created_at), triés par `created_at ASC`.
- `POST /api/admin/users/[id]/approve` → `requireAdmin()`,
  `UPDATE users SET status = 'approved' WHERE id = ? AND status = 'pending'`.
- `POST /api/admin/users/[id]/reject` → `requireAdmin()`,
  `DELETE FROM users WHERE id = ? AND status = 'pending'`. Restreint aux comptes encore
  `pending` par sécurité (jamais de suppression accidentelle d'un compte déjà actif via
  cette route). Un compte `pending` n'a jamais pu se connecter donc ne possède aucune
  donnée liée (jeux, scores, messages) à nettoyer en cascade.

## UI admin (nouveau : `src/app/admin/page.tsx`)

Server component : `getCurrentUser()` → si absent, `redirect("/login")` ; si présent
mais `role !== "admin"`, `redirect("/")`. Rend un client component `AdminUsers` qui :

- Charge la liste des comptes `pending` via `apiFetch`.
- Affiche chaque compte dans une `.card` (nom, date de création) avec deux boutons
  `.btn` : Approuver (`btn-primary`) et Refuser (`btn-ghost`, ouvre `useConfirm()` avant
  d'appeler la route reject — action destructive).
- Feedback via `useToast()` après chaque action, retire l'entrée de la liste en local
  sans recharger toute la page.
- État vide : message "Aucune demande en attente."

**Point d'entrée** : dans `Dashboard.tsx`, si `user.role === "admin"` (prop ajoutée,
transmise depuis `HomePage`), un lien discret vers `/admin` dans la barre d'actions
existante (à côté du bouton de déconnexion).

## Page de connexion (`src/app/login/page.tsx`)

- Suppression du champ "Code d'inscription" et de l'état `code`.
- Après une inscription réussie avec `pending: true`, pas de redirection : affichage
  d'un message de succès dans la carte ("Ton compte a été créé. Un enseignant doit
  l'approuver avant que tu puisses te connecter.") à la place du formulaire, avec un
  bouton pour revenir à l'écran de connexion.
- Cas `pending: false` (admin auto-promu) : comportement actuel inchangé (redirection).

## Nettoyage

- `.env.example` : remplacer la ligne `REGISTRATION_CODE=` par
  `ADMIN_USERNAMES=` (avec commentaire), documenter le flux de bootstrap.
- Retirer toute mention de `REGISTRATION_CODE` dans le code (déjà limité à
  `register/route.ts` d'après l'audit).

## Hors scope (extensions futures possibles, non construites maintenant)

- Gestion des comptes déjà approuvés (promotion/rétrogradation, désactivation a
  posteriori) — pas de route ni d'UI pour ça.
- Notification email à l'admin lors d'une nouvelle demande (le projet n'a aucun service
  d'envoi d'email actuellement).
- Historique des refus (puisque le refus supprime la ligne, aucune trace n'est gardée).

## Tests

Script ad hoc `npx tsx` (pattern `tests/db.test.ts`/`tests/jobs.test.mts` : lancé depuis
un répertoire temporaire vide pour une base fraîche) couvrant :

1. Inscription d'un compte normal → `status = 'pending'`, pas de cookie de session posé,
   tentative de login immédiate → 403 avec le message d'attente.
2. `ADMIN_USERNAMES` configuré avec le nom d'un compte `pending` existant → après
   `createDb()` (ou ré-insertion), le compte devient `role = 'admin', status = 'approved'`.
3. Inscription directe d'un nom présent dans `ADMIN_USERNAMES` → `admin`/`approved`
   immédiat, cookie de session posé.
4. `requireAdmin()` : refuse un utilisateur non connecté (401) et un utilisateur
   `role = 'user'` (403).
5. Approve : le compte passe à `approved`, login possible ensuite.
6. Reject : la ligne disparaît de `users`, une réinscription au même nom d'utilisateur
   redevient possible.

Puis `npm run build` (type-check complet) et un smoke test manuel sur `PORT=3457`.
