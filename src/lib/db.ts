// SQLite natif de Node.js (node:sqlite) — aucune dépendance native à compiler.
import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

// En dev, Next.js recharge les modules : on garde une seule connexion globale.
const globalForDb = globalThis as unknown as { __lgDb?: DatabaseSync };

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

  return db;
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
  created_at: string;
  updated_at: string;
  author?: string;
}

export interface GameMessage {
  id: number;
  game_id: string;
  user_id: number | null;
  role: "user" | "assistant";
  content: string;
  version: number | null;
  created_at: string;
  username?: string | null;
}

/** Archive la version courante d'un jeu avant qu'elle ne soit écrasée. */
export function archiveCurrentVersion(gameId: string) {
  db.prepare(
    `INSERT OR REPLACE INTO game_versions (game_id, version, title, html)
     SELECT id, version, title, html FROM games WHERE id = ?`
  ).run(gameId);
}

export function addGameMessage(
  gameId: string,
  userId: number | null,
  role: "user" | "assistant",
  content: string,
  version: number | null = null
) {
  db.prepare(
    "INSERT INTO game_messages (game_id, user_id, role, content, version) VALUES (?, ?, ?, ?, ?)"
  ).run(gameId, userId, role, content, version);
}

export default db;
