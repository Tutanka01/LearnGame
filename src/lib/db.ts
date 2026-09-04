// SQLite natif de Node.js (node:sqlite) — aucune dépendance native à compiler.
import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

// En dev, Next.js recharge les modules : on garde une seule connexion globale.
const globalForDb = globalThis as unknown as { __lgDb?: DatabaseSync };

/**
 * Bootstrap du premier admin : les noms listés dans ADMIN_USERNAMES (séparés par
 * des virgules) sont promus role='admin', status='approved' s'ils existent déjà
 * en base. Idempotent, sans effet si la variable est vide.
 */
function promoteAdmins(db: DatabaseSync): void {
  const raw = process.env.ADMIN_USERNAMES?.trim();
  if (!raw) return;
  const names = raw
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const stmt = db.prepare("UPDATE users SET role = 'admin', status = 'approved' WHERE username = ?");
  for (const name of names) stmt.run(name);
}

function createDb(): DatabaseSync {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "learngame.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'intermédiaire',
      title TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      plays INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
    CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at DESC);

    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      max_score INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game_id);
    CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);

    -- Historique de conversation du Studio (chat à gauche, façon Lovable).
    CREATE TABLE IF NOT EXISTS game_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      version INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_game ON game_messages(game_id);

    -- Versions archivées des jeux : permet de restaurer un état précédent.
    CREATE TABLE IF NOT EXISTS game_versions (
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      html TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (game_id, version)
    );
  `);

  // Migrations additives : les colonnes de partage public n'existaient pas en v1.
  const gameCols = db
    .prepare("PRAGMA table_info(games)")
    .all()
    .map((c) => (c as { name: string }).name);
  if (!gameCols.includes("is_public")) {
    db.exec("ALTER TABLE games ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;");
  }
  if (!gameCols.includes("public_slug")) {
    db.exec("ALTER TABLE games ADD COLUMN public_slug TEXT;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_games_slug ON games(public_slug);");
  }
  // Résumé du changement qui a produit la version COURANTE du jeu : copié dans
  // game_versions.summary au moment de l'archivage (l'historique reste lisible).
  if (!gameCols.includes("change_summary")) {
    db.exec("ALTER TABLE games ADD COLUMN change_summary TEXT NOT NULL DEFAULT '';");
  }

  const msgCols = db
    .prepare("PRAGMA table_info(game_messages)")
    .all()
    .map((c) => (c as { name: string }).name);
  // kind : la nature du message n'est plus encodée dans son texte
  // (chat | restore | error | cancelled), l'UI peut les styler différemment.
  if (!msgCols.includes("kind")) {
    db.exec("ALTER TABLE game_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';");
  }
  if (!msgCols.includes("job_id")) {
    db.exec("ALTER TABLE game_messages ADD COLUMN job_id TEXT;");
  }

  const verCols = db
    .prepare("PRAGMA table_info(game_versions)")
    .all()
    .map((c) => (c as { name: string }).name);
  if (!verCols.includes("summary")) {
    db.exec("ALTER TABLE game_versions ADD COLUMN summary TEXT NOT NULL DEFAULT '';");
  }

  // Jobs de génération persistés : la génération vit côté serveur, le client
  // s'y (re)connecte par SSE. Les événements sont rejouables (seq croissant).
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('create', 'edit')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error', 'cancelled')),
      payload TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON generation_jobs(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_game ON generation_jobs(game_id);

    CREATE TABLE IF NOT EXISTS generation_events (
      job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (job_id, seq)
    );
  `);

  // Un seul score par (jeu, élève) : on dédoublonne (meilleur ratio conservé)
  // PUIS on pose l'index unique. Idempotent : ne s'exécute qu'une fois.
  const hasUniqueScores = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_scores_unique'")
    .get();
  if (!hasUniqueScores) {
    db.exec(`
      DELETE FROM scores WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY game_id, user_id
            ORDER BY CAST(score AS REAL) / MAX(max_score, 1) DESC, created_at ASC
          ) AS rn FROM scores
        ) WHERE rn = 1
      );
    `);
    db.exec("CREATE UNIQUE INDEX idx_scores_unique ON scores(game_id, user_id);");
  }

  // Sessions d'authentification en base : révocables (déconnexion, rejet,
  // changement de mot de passe) et pivotées à chaque connexion. La table ne
  // stocke que le SHA-256 du token — la fuite de la base ne permet pas de
  // forger un cookie. Les horodatages sont en epoch ms (comparaison fiable).
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
  `);

  // Inscription avec approbation admin : role ('user'|'admin') et status
  // ('pending'|'approved'). Défaut 'approved' sur la colonne pour ne pas bloquer
  // les comptes déjà en base — les nouveaux comptes reçoivent 'pending' à
  // l'INSERT (route d'inscription), pas via ce défaut.
  const userCols = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((c) => (c as { name: string }).name);
  if (!userCols.includes("role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';");
  }
  if (!userCols.includes("status")) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';");
  }

  // Connexion SSO (OIDC) : identité fédérée (émetteur + sujet) rattachée au
  // compte, et e-mail (utilisé pour rattacher un compte local existant).
  // `password_hash` reste NOT NULL : les comptes nés en SSO y stockent '' —
  // aucun mot de passe local n'existe pour eux.
  if (!userCols.includes("email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
  }
  if (!userCols.includes("oidc_issuer")) {
    db.exec("ALTER TABLE users ADD COLUMN oidc_issuer TEXT;");
  }
  if (!userCols.includes("oidc_sub")) {
    db.exec("ALTER TABLE users ADD COLUMN oidc_sub TEXT;");
  }
  // Un compte ne peut porter qu'UNE identité fédérée, et une identité ne peut
  // être portée que par UN compte (index partiel : les comptes locaux ne
  // comptent pas, leurs colonnes restent NULL).
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc ON users(oidc_issuer, oidc_sub) WHERE oidc_sub IS NOT NULL;"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");
  // Le rattachement SSO compare les e-mails en casse-insensible (lower()) :
  // index fonctionnel pour rester efficace si la table grossit.
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email));");

  // Flux d'authentification OIDC en cours (state/nonce/verifier PKCE) : la
  // trace serveur qui rend le `state` single-use et surviv à un redémarrage.
  // Le `state` brut ne vit que dans l'URL, la table ne stocke que son SHA-256.
  db.exec(`
    CREATE TABLE IF NOT EXISTS oidc_flows (
      id TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      nonce TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      next_path TEXT NOT NULL DEFAULT '/',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oidc_flows_expires ON oidc_flows(expires_at);
  `);

  promoteAdmins(db);

  return db;
}

/**
 * Le nom fait-il partie des comptes promus admin (ADMIN_USERNAMES) ?
 * Même règle que promoteAdmins() et la route d'inscription — partagée ici
 * pour que la création de compte SSO applique exactement la même politique.
 */
export function isAdminUsername(name: string): boolean {
  const list = (process.env.ADMIN_USERNAMES ?? "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(name.trim().toLowerCase());
}

// Ouverture paresseuse : la connexion n'est créée qu'à la première requête,
// jamais à l'import du module (le build de Next importe les routes en parallèle).
const db = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const instance = (globalForDb.__lgDb ??= createDb());
    const value = Reflect.get(instance, prop) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(instance) : value;
  },
});

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  status: string;
  created_at: string;
}

export interface Game {
  id: string;
  user_id: number;
  topic: string;
  difficulty: string;
  title: string;
  html: string;
  version: number;
  plays: number;
  is_public: number;
  public_slug: string | null;
  change_summary: string;
  created_at: string;
  updated_at: string;
  author?: string;
}

export type MessageKind = "chat" | "restore" | "error" | "cancelled";

export interface GameMessage {
  id: number;
  game_id: string;
  user_id: number | null;
  role: "user" | "assistant";
  content: string;
  version: number | null;
  kind: MessageKind;
  job_id: string | null;
  created_at: string;
  username?: string | null;
}

/**
 * Exécute `fn` dans une transaction (BEGIN IMMEDIATE : le verrou d'écriture
 * est pris immédiatement, pas de course entre lecture et écriture).
 * `fn` doit rester synchrone — node:sqlite l'est, c'est tout l'intérêt.
 */
export function withTransaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // transaction déjà annulée
    }
    throw err;
  }
}

/**
 * Archive la version courante d'un jeu avant qu'elle ne soit écrasée.
 * INSERT strict : une collision de version est une vraie erreur (course),
 * jamais un écrasement silencieux — à appeler dans withTransaction().
 */
export function archiveCurrentVersion(gameId: string) {
  db.prepare(
    `INSERT INTO game_versions (game_id, version, title, html, summary)
     SELECT id, version, title, html, change_summary FROM games WHERE id = ?`
  ).run(gameId);
}

export function addGameMessage(
  gameId: string,
  userId: number | null,
  role: "user" | "assistant",
  content: string,
  version: number | null = null,
  kind: MessageKind = "chat",
  jobId: string | null = null
) {
  db.prepare(
    "INSERT INTO game_messages (game_id, user_id, role, content, version, kind, job_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(gameId, userId, role, content, version, kind, jobId);
}

export default db;
