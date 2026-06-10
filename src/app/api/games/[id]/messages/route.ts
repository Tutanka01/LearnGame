import db, { GameMessage } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Historique de conversation + versions d'un jeu (panneau de chat du Studio).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Non connecté." }, { status: 401 });
  }
  const { id } = await params;
  const game = db.prepare("SELECT id FROM games WHERE id = ?").get(id);
  if (!game) {
    return Response.json({ error: "Jeu introuvable." }, { status: 404 });
  }

  const messages = db
    .prepare(
      `SELECT m.id, m.role, m.content, m.version, m.created_at, u.username
       FROM game_messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.game_id = ? ORDER BY m.id`
    )
    .all(id)
    .map((m) => ({ ...m })) as unknown as GameMessage[];

  const versions = db
    .prepare(
      "SELECT version, title, created_at FROM game_versions WHERE game_id = ? ORDER BY version"
    )
    .all(id)
    .map((v) => ({ ...v }));

  return Response.json({ messages, versions, userId: user.id });
}
