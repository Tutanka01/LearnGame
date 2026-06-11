// Test ad hoc de db.ts (migrations, transactions, archives, upsert de scores).
// IMPORTANT : à exécuter depuis un répertoire temporaire pour ne PAS toucher
// la vraie base (db.ts ouvre process.cwd()/data/learngame.db) :
//   cd "$(mktemp -d)" && npx -y tsx /chemin/du/projet/tests/db.test.ts

import path from "path";
import fs from "fs";
// Import statique sans risque : db.ts ouvre la connexion PARESSEUSEMENT
// (premier accès), donc le garde-fou ci-dessous s'exécute avant toute requête.
import db, { withTransaction, archiveCurrentVersion, addGameMessage } from "../src/lib/db";

const dataDir = path.join(process.cwd(), "data");
if (fs.existsSync(path.join(dataDir, "learngame.db"))) {
  console.error("Refus : une base existe déjà ici. Lancer depuis un répertoire temporaire vide.");
  process.exit(1);
}

let failures = 0;
function assert(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`✗ ${name}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// --- Schéma : les migrations additives ont créé les nouvelles colonnes ---------
const msgCols = db.prepare("PRAGMA table_info(game_messages)").all().map((c: { name?: string }) => c.name);
assert("game_messages.kind existe", msgCols.includes("kind"));
assert("game_messages.job_id existe", msgCols.includes("job_id"));
const verCols = db.prepare("PRAGMA table_info(game_versions)").all().map((c: { name?: string }) => c.name);
assert("game_versions.summary existe", verCols.includes("summary"));
const gameCols = db.prepare("PRAGMA table_info(games)").all().map((c: { name?: string }) => c.name);
assert("games.change_summary existe", gameCols.includes("change_summary"));
assert(
  "index unique scores présent",
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_scores_unique'").get())
);

// --- Données de test ------------------------------------------------------------
db.prepare("INSERT INTO users (username, password_hash) VALUES ('test', 'x:y')").run();
const userId = Number(
  (db.prepare("SELECT id FROM users WHERE username = 'test'").get() as { id: number }).id
);
db.prepare(
  "INSERT INTO games (id, user_id, topic, title, html, change_summary) VALUES ('g1', ?, 'sujet', 'Titre v1', '<html>v1</html>', 'Création du jeu.')"
).run(userId);

// --- withTransaction : commit et rollback ---------------------------------------
withTransaction(() => {
  db.prepare("UPDATE games SET title = 'Titre modifié' WHERE id = 'g1'").run();
});
assert(
  "withTransaction committe",
  (db.prepare("SELECT title FROM games WHERE id = 'g1'").get() as { title: string }).title ===
    "Titre modifié"
);

try {
  withTransaction(() => {
    db.prepare("UPDATE games SET title = 'JAMAIS' WHERE id = 'g1'").run();
    throw new Error("boum");
  });
} catch {
  // attendu
}
assert(
  "withTransaction annule sur erreur",
  (db.prepare("SELECT title FROM games WHERE id = 'g1'").get() as { title: string }).title ===
    "Titre modifié"
);

// --- Archive : summary copié, collision = vraie erreur ---------------------------
archiveCurrentVersion("g1");
const archived = db
  .prepare("SELECT version, summary FROM game_versions WHERE game_id = 'g1'")
  .get() as { version: number; summary: string };
assert("archive v1 avec son summary", archived.version === 1 && archived.summary === "Création du jeu.");

let collisionThrew = false;
try {
  archiveCurrentVersion("g1"); // même version → violation de clé primaire
} catch {
  collisionThrew = true;
}
assert("collision d'archive = erreur (plus d'écrasement silencieux)", collisionThrew);

// --- Course de versions simulée : deux améliorations séquentielles ---------------
// Chaque écriture relit la version sous transaction (comme saveImprovement).
function improve(summary: string) {
  return withTransaction(() => {
    const fresh = db.prepare("SELECT version FROM games WHERE id = 'g1'").get() as {
      version: number;
    };
    archiveCurrentVersion("g1");
    const v = fresh.version + 1;
    db.prepare(
      "UPDATE games SET html = ?, version = ?, change_summary = ? WHERE id = 'g1'"
    ).run(`<html>v${v}</html>`, v, summary);
    addGameMessage("g1", null, "assistant", summary, v);
    return v;
  });
}
// L'archive v1 existe déjà (test précédent) : la 1re amélioration archive v1 → collision
// si on rejouait, donc on purge l'archive du test précédent pour repartir proprement.
db.prepare("DELETE FROM game_versions WHERE game_id = 'g1'").run();
const v2 = improve("Amélioration A.");
const v3 = improve("Amélioration B.");
assert("versions séquentielles exactes (2 puis 3)", v2 === 2 && v3 === 3);
const versions = db
  .prepare("SELECT version, summary FROM game_versions WHERE game_id = 'g1' ORDER BY version")
  .all() as { version: number; summary: string }[];
assert(
  "archives intactes avec les bons résumés",
  versions.length === 2 &&
    versions[0].summary === "Création du jeu." &&
    versions[1].summary === "Amélioration A."
);
const msgs = db
  .prepare("SELECT version FROM game_messages WHERE game_id = 'g1' ORDER BY id")
  .all() as { version: number }[];
assert("mapping message ↔ version exact", msgs[0].version === 2 && msgs[1].version === 3);

// --- Upsert de score « meilleur essai » ------------------------------------------
const upsert = db.prepare(
  `INSERT INTO scores (game_id, user_id, score, max_score) VALUES (?, ?, ?, ?)
   ON CONFLICT(game_id, user_id) DO UPDATE SET
     score = excluded.score, max_score = excluded.max_score, created_at = datetime('now')
   WHERE CAST(excluded.score AS REAL) / MAX(excluded.max_score, 1)
       > CAST(scores.score AS REAL) / MAX(scores.max_score, 1)`
);
upsert.run("g1", userId, 5, 10); // 50 %
upsert.run("g1", userId, 3, 10); // 30 % → ignoré
upsert.run("g1", userId, 9, 10); // 90 % → remplace
const rows = db.prepare("SELECT score, max_score FROM scores WHERE game_id = 'g1'").all() as {
  score: number;
  max_score: number;
}[];
assert("une seule ligne de score", rows.length === 1);
assert("seul le meilleur essai est gardé (9/10)", rows[0].score === 9);

if (failures > 0) {
  console.error(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log("\nTous les tests db.ts passent.");
