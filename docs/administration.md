# Administration de LearnGame

> Guide d'exploitation pour l'enseignant qui gère les comptes étudiants, avec les
> manipulations techniques (base de données) regroupées à la fin pour le mainteneur.
> Les commandes sont à exécuter **depuis la racine du projet**.

**La base de données** vit dans un seul fichier SQLite : `data/learngame.db` (créé
automatiquement au premier démarrage). En déploiement Docker, le dossier `./data`
est monté tel quel dans le conteneur : les commandes ci-dessous passées depuis la
racine du projet sur la machine hôte agissent bien sur la base de production.
Par prudence, effectuez les écritures directes en base **serveur arrêté**.

---

## 1. Le modèle d'accès en une phrase

Toute personne s'inscrit librement sur `/login`, mais son compte naît **« en
attente »** et reste inactif — la connexion affiche « Ton compte est en attente
d'approbation par un enseignant » — **jusqu'à ce qu'un administrateur l'approuve**
depuis la page `/admin` ; il obtient alors un accès complet.

Ce filtre est appliqué partout, pas seulement au login : toute session d'un compte
qui n'est plus « approuvé » est morte aussitôt (le serveur la refuse à chaque
requête), donc suspendre un compte revient à le déconnecter immédiatement.

## 2. Le rôle de l'administrateur

Un compte admin peut, et ne peut **que** :

- **accéder à la page `/admin`** : la liste des comptes en attente, avec badge de
  comptage (« N comptes en attente »), date d'inscription relative (« il y a 5 min »)
  et deux boutons par compte : **Refuser** et **Approuver** ;
- **approuver** un compte en attente (voir §4) ;
- **refuser** un compte en attente (voir §5).

La page est protégée : non connecté → redirection vers `/login` ; connecté mais non
admin → redirection vers l'accueil. Les routes API correspondantes renvoient
« Réservé aux administrateurs. » sinon.

À noter : l'interface ne liste **que les comptes en attente**. Un compte déjà
approuvé ne peut ni y être supprimé, ni y être rétrogradé — ces opérations passent
par la base de données (§3 et §6).

## 3. Nommer le premier administrateur : `ADMIN_USERNAMES`

Il n'existe pas de « bouton promouvoir » : le premier admin se désigne par la
variable d'environnement `ADMIN_USERNAMES` (noms d'utilisateur séparés par des
virgules), définie dans `.env` (reprise par Docker via `env_file`) — voir
`.env.example`. Deux mécanismes l'exploitent :

1. **À l'inscription** : un compte dont le nom figure dans la liste naît directement
   admin et approuvé, sans attente.
2. **Au démarrage du serveur** : la fonction `promoteAdmins()` (dans `src/lib/db.ts`)
   exécute pour chaque nom listé `UPDATE users SET role = 'admin',
   status = 'approved' WHERE username = ?`. L'opération est idempotente (sans effet
   sur un compte déjà admin) et sans effet si la variable est vide.

### Deux workflows possibles

- **Workflow A — définir la variable AVANT l'inscription** : renseignez
  `ADMIN_USERNAMES=votre-pseudo` dans `.env`, puis inscrivez-vous normalement.
  Le compte est admin dès sa création.
- **Workflow B — inscrire d'abord, puis redémarrer** : inscrivez-vous normalement
  (compte en attente), ajoutez votre pseudo dans `ADMIN_USERNAMES`, puis
  redémarrez le serveur (`docker compose up -d --build`, ou relancez `npm run dev`).
  La promotion s'applique au démarrage. C'est le workflow décrit dans `.env.example`.

### 🚀 Première installation, de A à Z

1. Déployez le projet (`npm run dev`, ou Docker) et ouvrez le site.
2. Onglet **Inscription** : créez votre compte (pseudo + mot de passe).
   ⚠️ Choisissez immédiatement un mot de passe **fort et dont vous vous souviendrez** :
   il est haché (scrypt) en base et **personne ne peut le relire** — pas même le
   mainteneur. En cas d'oubli, seule une **réinitialisation** est possible (§6).
3. Renseignez `ADMIN_USERNAMES=votre-pseudo` dans `.env`, puis redémarrez le serveur
   (ou renseignez la variable AVANT l'étape 2 pour être admin dès l'inscription).
4. Vérifiez : connectez-vous, ouvrez **`/admin`** — la page s'affiche (un non-admin
   est renvoyé à l'accueil), et votre pseudo y apparaît avec le badge admin.
5. Les inscriptions suivantes arrivent « en attente » : validez-les depuis `/admin`
   (§4 et §5).

> Piège classique : la variable `ADMIN_USERNAMES` pointe vers un pseudo qui
> n'existe pas en base (faute de frappe, ou compte jamais créé). Le serveur ne
> dit rien — `promoteAdmins()` ne fait simplement rien. Résultat : **personne
> n'est admin**, personne ne peut valider les inscriptions. Vérifiez avec la
> commande d'inspection (§7) que le compte listé existe bien et a bien `role=admin`.

### 🔑 Mot de passe admin perdu

Les mots de passe — admin ou non — ne sont **jamais récupérables** (hachage à sens
unique). La procédure de réinitialisation du §6 s'applique à votre compte admin
exactement comme à un compte étudiant : même commande, en remplaçant le pseudo.
Générez un mot de passe solide avec `openssl rand -base64 24`, remplacez, reconnectez-vous.

### ⚠️ Retirer un nom de la variable ne rétrograde PAS le compte

`ADMIN_USERNAMES` ne fait que **promouvoir** les noms listés : supprimer un nom de
la variable ne change rien à un compte déjà en base. Pour retirer les droits admin
à quelqu'un, il faut un `UPDATE` manuel (commande testée, voir §7 pour les
précautions) :

```bash
node --input-type=module -e 'import("./src/lib/db.ts").then((m) => { m.default.prepare("UPDATE users SET role = ? WHERE username = ?").run("user", "pseudo-a-retrograder"); console.log("Rétrogradation OK"); })'
```

Le compte garde `status = 'approved'` (il reste connecté, simplement sans accès
admin). Pour le suspendre en plus : `UPDATE users SET status = ?` avec `"pending"` —
ses sessions actives mourront aussitôt.

## 4. Approuver un compte

1. Connectez-vous avec votre compte admin, ouvrez **`/admin`**.
2. Chaque compte en attente apparaît avec son pseudo et sa date d'inscription.
3. Cliquez **Approuver**.

Effet : `UPDATE users SET status = 'approved'` (côté serveur, la modification ne
s'applique qu'aux comptes encore en attente — si un autre admin l'a déjà traitée,
l'API répond « Compte introuvable ou déjà traité. »). La ligne disparaît de la liste
et **la personne peut se connecter immédiatement**, sans redémarrage ni
revalidation de sa part : son prochain essai de connexion aboutit.

## 5. Refuser un compte

1. Sur `/admin`, cliquez **Refuser** sur le compte concerné.
2. Une boîte de confirmation s'affiche : *« Le compte sera définitivement
   supprimé. Cette action est irréversible. »* — bouton **Refuser et supprimer**.
3. Confirmez.

Effet : **suppression définitive** du compte (`DELETE FROM users ... WHERE
status = 'pending'`). Ce n'est pas une suspension :

- toutes ses données disparaissent **en cascade** : jeux, scores, versions de jeux,
  historiques de conversation, jobs de génération, sessions ;
- **le pseudo redevient disponible** : la personne peut se réinscrire, elle créera
  un nouveau compte de zéro (de nouveau en attente).

Seuls les comptes **en attente** peuvent être refusés via l'interface ; un compte
approuvé ne peut pas être supprimé depuis `/admin` (voir §7 pour une suppression
manuelle).

## 6. Réinitialiser un mot de passe (procédure mainteneur)

> **À savoir d'abord** : aucun mot de passe n'est récupérable — ils sont hachés
> avec scrypt (fonction à sens unique, voir `docs/authentification.md`). « Retrouver »
> un mot de passe perdu est donc impossible, y compris pour l'admin ; en revanche
> on peut lui en **attribuer un nouveau** en une commande. Cela vaut pour un compte
> étudiant, pour **le compte admin lui-même** (mot de passe oublié après la
> première installation — cf. §3), ou pour tout compte dont le propriétaire est
> bloqué.

Il n'y a **aucune réinitialisation par e-mail** (la plateforme n'envoie aucun
courriel). Si un étudiant perd son mot de passe, son pseudo étant réservé il ne
peut pas se réinscrire : le mainteneur doit écraser le hash en base. La commande
ci-dessous (testée) utilise le même `hashPassword()` que la plateforme
(`src/lib/session.ts`), donc le même format de hash — à exécuter **depuis la racine
du projet** :

```bash
npx -y tsx -e 'import db from "./src/lib/db"; import { hashPassword, revokeAllUserSessions } from "./src/lib/session"; const u = db.prepare("SELECT id FROM users WHERE username = ?").get("pseudo-eleve"); if (!u) throw new Error("Utilisateur introuvable"); db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword("NouveauMotDePasse123"), u.id); revokeAllUserSessions(u.id); console.log("Mot de passe réinitialisé et sessions révoquées.");'
```

Remplacez `pseudo-eleve` et `NouveauMotDePasse123` (même règles qu'à
l'inscription : 8 caractères minimum, 256 maximum). Pour générer un mot de passe
solide : `openssl rand -base64 24`. Communiquez le nouveau mot de
passe à l'étudiant par un canal sûr et invitez-le à le changer ensuite.

**Attention** : la commande appelle volontairement `revokeAllUserSessions()`, qui
déconnecte l'étudiant de **toutes** ses sessions (c'est le même mécanisme qu'un
refus de compte ou un changement de mot de passe classique). C'est le comportement
souhaité après une réinitialisation ; si vous vouliez changer le mot de passe sans
déconnecter l'utilisateur, retirez simplement l'appel `revokeAllUserSessions(u.id);`
de la commande.

Pour révoquer les sessions d'un compte **sans** toucher à son mot de passe
(déconnexion forcée), l'équivalent SQL direct est :

```sql
DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE username = 'pseudo-eleve');
```

## 7. Inspecter les comptes (pour le mainteneur)

Pour voir l'état réel des comptes — et vérifier par exemple qu'un admin existe
vraiment — ouvrez la base en lecture (commande de référence de `CLAUDE.md`,
**impérativement depuis la racine du projet**, car la base est ouverte relativement
au répertoire courant) :

```bash
node --input-type=module -e "import('./src/lib/db.ts').then(m => { const rows = m.default.prepare('SELECT username, role, status, created_at FROM users ORDER BY created_at ASC').all(); console.table(rows); })"
```

Signification des colonnes :

| Colonne | Valeurs | Sens |
|---|---|---|
| `username` | texte | Pseudo choisi à l'inscription, unique et insensible à la casse (`Jean` = `jean`). |
| `role` | `user` / `admin` | `admin` = accès à `/admin` et aux routes d'administration. |
| `status` | `pending` / `approved` | `pending` = compte en attente, connexion refusée et sessions refusées ; `approved` = accès complet. |
| `created_at` | `AAAA-MM-JJ HH:MM:SS` | Date d'inscription, en **UTC** (soustraire 2 h en été / 1 h en hiver pour l'heure de Paris). |

Variantes utiles :

```bash
# Nombre de comptes en attente (ce que compte le badge de /admin)
node --input-type=module -e "import('./src/lib/db.ts').then(m => console.log(m.default.prepare('SELECT COUNT(*) AS en_attente FROM users WHERE status = ?').get('pending')))"

# Supprimer manuellement un compte déjà approuvé (cascade identique au refus, §5)
node --input-type=module -e 'import("./src/lib/db.ts").then((m) => { m.default.prepare("DELETE FROM users WHERE username = ?").run("pseudo-a-supprimer"); console.log("Supprimé"); })'
```

## 8. Questions fréquentes

### Un étudiant s'est inscrit mais « ne reçoit jamais de validation »

La plateforme n'envoie aucun e-mail : l'approbation se fait manuellement sur
`/admin`. Si vous ne pouvez pas y accéder (redirection vers l'accueil), c'est
probablement qu'**aucun compte admin n'existe réellement** — sans admin, personne
ne peut approuver. Vérifiez avec la commande du §7 : il doit exister au moins une
ligne avec `role = 'admin'` **et** `status = 'approved'`. Sinon, appliquez le §3
(ajoutez votre pseudo à `ADMIN_USERNAMES` et redémarrez le serveur).

### Un compte approuvé ne peut pas se connecter

La page de login affiche le même message (« Nom d'utilisateur ou mot de passe
incorrect ») pour un pseudo inconnu et pour un mot de passe erroné — vérifiez donc
d'abord **le mot de passe** (faute de frappe, clavier, casse ; en cas de doute,
procédure du §6). Après trop de tentatives, le serveur impose aussi une pause
d'une minute (protection anti force brute). Enfin, contrôlez le `status` réel du
compte avec la commande du §7 : seule la valeur `approved` permet la connexion.

### Que devient un compte refusé ?

Il est **intégralement supprimé** (voir §5) : le pseudo est libéré, tous les jeux,
scores et sessions associés disparaissent en cascade, et rien n'est conservé pour
une « réactivation ». Si la personne se réinscrit plus tard avec le même pseudo,
c'est un compte neuf, de nouveau en attente d'approbation.
