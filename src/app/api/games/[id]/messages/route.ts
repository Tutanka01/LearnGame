import db, { GameMessage } from "@/lib/db";
import { handleApi, requireOwnedGame, requireUser } from "@/lib/api";

// Historique de conversation + versions d'un jeu (panneau de chat du Studio).
// Réservé au créateur : les demandes d'amélioration sont une conversation privée.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    requireOwnedGame(id, user.id, "consulter sa conversation");

    const messages = db
      .prepare(
        `SELECT m.id, m.role, m.content, m.version, m.kind, m.job_id, m.created_at, u.username
         FROM game_messages m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.game_id = ? ORDER BY m.id`
      )
      .all(id)
      .map((m) => ({ ...m })) as unknown as GameMessage[];

    const versions = db
      .prepare(
        "SELECT version, title, summary, created_at FROM game_versions WHERE game_id = ? ORDER BY version"
      )
      .all(id)
      .map((v) => ({ ...v }));

    return Response.json({ messages, versions, userId: user.id });
  });
}
