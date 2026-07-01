// Test ad hoc du flux d'inscription avec approbation admin (migration
// role/status, bootstrap ADMIN_USERNAMES, approve/reject).
// À exécuter depuis un répertoire temporaire vide (deux passes, même dossier,
// pour simuler un redémarrage serveur après configuration de ADMIN_USERNAMES) :
//
//   DIR=$(mktemp -d) && cd "$DIR" \
//     && npx -y tsx /chemin/du/projet/tests/authApproval.test.ts phase1 \
//     && ADMIN_USERNAMES=admin1 npx -y tsx /chemin/du/projet/tests/authApproval.test.ts phase2

import path from "path";
import fs from "fs";

const phase = process.argv[2];
if (phase !== "phase1" && phase !== "phase2") {
  console.error("Usage : tsx authApproval.test.ts <phase1|phase2>");
  process.exit(1);
}

if (phase === "phase1") {
  const dataDir = path.join(process.cwd(), "data");
  if (fs.existsSync(path.join(dataDir, "learngame.db"))) {
    console.error("Refus : une base existe déjà ici. Lancer depuis un répertoire temporaire vide.");
    process.exit(1);
  }
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

async function main() {
  const { default: db } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth");

  const userCols = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((c: { name?: string }) => c.name);
  assert("users.role existe", userCols.includes("role"));
  assert("users.status existe", userCols.includes("status"));

  if (phase === "phase1") {
    // Grandfathering : un INSERT qui n'indique pas role/status (comme l'ancien
    // code) doit retomber sur les défauts de colonne ('user'/'approved') — les
    // comptes déjà en base avant la migration restent utilisables tels quels.
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
      "legacy1",
      hashPassword("motdepasse")
    );
    const legacy = db.prepare("SELECT role, status FROM users WHERE username = ?").get("legacy1") as
      | { role: string; status: string }
      | undefined;
    assert("compte préexistant : role='user' par défaut", legacy?.role === "user");
    assert("compte préexistant : status='approved' par défaut", legacy?.status === "approved");

    // Inscription normale (simule la route /api/auth/register sans ADMIN_USERNAMES) :
    // le nouveau compte doit être 'pending', pas approuvé automatiquement.
    db.prepare(
      "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'user', 'pending')"
    ).run("admin1", hashPassword("motdepasse"));
    db.prepare(
      "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'user', 'pending')"
    ).run("student1", hashPassword("motdepasse"));
    db.prepare(
      "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'user', 'pending')"
    ).run("student2", hashPassword("motdepasse"));

    const admin1 = db.prepare("SELECT role, status FROM users WHERE username = ?").get("admin1") as
      | { role: string; status: string }
      | undefined;
    assert("admin1 créé en pending (avant configuration ADMIN_USERNAMES)", admin1?.status === "pending");
  }

  if (phase === "phase2") {
    // Ce process redémarre createDb() (nouveau process Node = nouvelle
    // connexion globale) avec ADMIN_USERNAMES=admin1 déjà positionné : le
    // bootstrap doit promouvoir admin1 sans action manuelle en base.
    const admin1 = db.prepare("SELECT role, status FROM users WHERE username = ?").get("admin1") as
      | { role: string; status: string }
      | undefined;
    assert("bootstrap ADMIN_USERNAMES : admin1 promu role='admin'", admin1?.role === "admin");
    assert("bootstrap ADMIN_USERNAMES : admin1 promu status='approved'", admin1?.status === "approved");

    const student1Before = db
      .prepare("SELECT id, status FROM users WHERE username = ?")
      .get("student1") as { id: number; status: string } | undefined;
    assert("student1 toujours pending (pas dans ADMIN_USERNAMES)", student1Before?.status === "pending");

    // Approve (même requête que POST /api/admin/users/[id]/approve).
    const approveResult = db
      .prepare("UPDATE users SET status = 'approved' WHERE id = ? AND status = 'pending'")
      .run(student1Before!.id);
    assert("approve : 1 ligne modifiée", Number(approveResult.changes) === 1);
    const student1After = db
      .prepare("SELECT status FROM users WHERE username = ?")
      .get("student1") as { status: string } | undefined;
    assert("student1 approuvé", student1After?.status === "approved");

    // Ré-approuver un compte déjà approuvé : guard "AND status = 'pending'" → 0 ligne.
    const reapprove = db
      .prepare("UPDATE users SET status = 'approved' WHERE id = ? AND status = 'pending'")
      .run(student1Before!.id);
    assert("ré-approve sur compte déjà approuvé : 0 ligne modifiée", Number(reapprove.changes) === 0);

    // Reject (même requête que POST /api/admin/users/[id]/reject) : suppression.
    const student2 = db.prepare("SELECT id FROM users WHERE username = ?").get("student2") as
      | { id: number }
      | undefined;
    const rejectResult = db
      .prepare("DELETE FROM users WHERE id = ? AND status = 'pending'")
      .run(student2!.id);
    assert("reject : 1 ligne supprimée", Number(rejectResult.changes) === 1);
    const student2After = db.prepare("SELECT id FROM users WHERE username = ?").get("student2");
    assert("student2 bien supprimé", student2After === undefined);

    // Le nom d'utilisateur redevient disponible après un refus.
    db.prepare(
      "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'user', 'pending')"
    ).run("student2", hashPassword("nouveau-mdp"));
    const student2Reinscrit = db
      .prepare("SELECT status FROM users WHERE username = ?")
      .get("student2") as { status: string } | undefined;
    assert("réinscription possible au même nom après refus", student2Reinscrit?.status === "pending");
  }

  if (failures > 0) {
    console.error(`\n${failures} échec(s).`);
    process.exit(1);
  }
  console.log(`\nTous les tests (${phase}) sont passés.`);
}

main();
