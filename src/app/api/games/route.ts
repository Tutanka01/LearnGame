import { NextRequest } from "next/server";
import db from "@/lib/db";
import { handleApi, requireUser } from "@/lib/api";

// Bibliothèque de jeux, paginée (?offset=&limit=), du plus récemment modifié
// au plus ancien. `total` permet au front d'afficher « Charger plus ».
export async function GET(req: NextRequest) {
  return handleApi(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 60, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    const games = db
      .prepare(
        `SELECT g.id, g.topic, g.difficulty, g.title, g.version, g.plays,
                g.is_public, g.public_slug,
                g.created_at, g.updated_at, g.user_id, u.username AS author,
                EXISTS(SELECT 1 FROM scores s WHERE s.game_id = g.id AND s.user_id = ?) AS completed_by_me,
                (SELECT COUNT(*) FROM scores s WHERE s.game_id = g.id) AS finishers
         FROM games g JOIN users u ON u.id = g.user_id
         ORDER BY g.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(user.id, limit, offset)
      .map((r) => ({ ...(r as Record<string, unknown>) }));

    const { total } = db.prepare("SELECT COUNT(*) AS total FROM games").get() as {
      total: number;
    };

    // Stats de l'élève : jeux terminés + somme de ses meilleurs scores en
    // POURCENTAGE par jeu (0–100) — comparable d'un jeu à l'autre, contrairement
    // aux scores bruts dont l'échelle varie librement.
    const stats = db
      .prepare(
        `SELECT COUNT(*) AS completed, COALESCE(ROUND(SUM(pct)), 0) AS points
         FROM (
           SELECT MAX(CAST(score AS REAL) / MAX(max_score, 1)) * 100 AS pct
           FROM scores WHERE user_id = ? GROUP BY game_id
         )`
      )
      .get(user.id) as { completed: number; points: number };

    return Response.json({ games, total, userId: user.id, stats: { ...stats } });
  });
}
