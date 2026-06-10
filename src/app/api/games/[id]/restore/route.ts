import db, { Game, archiveCurrentVersion, addGameMessage } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Restaure une version archivée d'un jeu (créateur uniquement).
// Façon Lovable : la restauration crée une NOUVELLE version, rien n'est perdu.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Non connecté." }, { status: 401 });
  }
  const { id } = await params;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(id) as unknown as
    | Game
    | undefined;
  if (!game) {
    return Response.json({ error: "Jeu introuvable." }, { status: 404 });
  }
  if (game.user_id !== user.id) {
    return Response.json({ error: "Seul le créateur du jeu peut restaurer une version." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1 || version >= game.version) {
    return Response.json({ error: "Version invalide." }, { status: 400 });
  }

  const target = db
    .prepare("SELECT title, html FROM game_versions WHERE game_id = ? AND version = ?")
    .get(id, version) as unknown as { title: string; html: string } | undefined;
  if (!target) {
    return Response.json({ error: "Cette version n'est plus disponible." }, { status: 404 });
  }

  archiveCurrentVersion(id);
  const newVersion = game.version + 1;
  db.prepare(
    "UPDATE games SET html = ?, title = ?, version = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(target.html, target.title, newVersion, id);
  addGameMessage(
    id,
    user.id,
    "assistant",
    `↩️ Version ${version} restaurée — le jeu est revenu à cet état (enregistré comme v${newVersion}).`,
    newVersion
  );

  return Response.json({ version: newVersion, title: target.title });
}
