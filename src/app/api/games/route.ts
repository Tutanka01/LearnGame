import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const games = db
    .prepare(
      `SELECT g.id, g.topic, g.difficulty, g.title, g.version, g.plays,
              g.is_public, g.public_slug,
              g.created_at, g.updated_at, g.user_id, u.username AS author,
              EXISTS(SELECT 1 FROM scores s WHERE s.game_id = g.id AND s.user_id = ?) AS completed_by_me,
              (SELECT COUNT(DISTINCT s.user_id) FROM scores s WHERE s.game_id = g.id) AS finishers
       FROM games g JOIN users u ON u.id = g.user_id
       ORDER BY g.updated_at DESC
       LIMIT 200`
    )
    .all(user.id)
    .map((r) => ({ ...(r as Record<string, unknown>) }));

  // Stats de l'élève : nombre de jeux terminés + somme de ses meilleurs scores.
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS completed, COALESCE(SUM(best), 0) AS points
       FROM (SELECT MAX(score) AS best FROM scores WHERE user_id = ? GROUP BY game_id)`
    )
    .get(user.id) as { completed: number; points: number };

  return NextResponse.json({ games, userId: user.id, stats: { ...stats } });
}
