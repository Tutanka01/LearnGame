import { NextRequest } from "next/server";
import db from "@/lib/db";
import { apiError, handleApi, readJson, requireGame, requireUser } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

// POST : le jeu (via postMessage → Studio/PublicPlayer) enregistre une partie
// terminée. Une seule ligne par (jeu, élève) : seul le MEILLEUR essai est gardé.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    requireGame(id);

    // Garde-fou anti-spam : un vrai joueur ne termine pas un jeu toutes les 3 s.
    if (!rateLimit(`scores:${id}:${user.id}`, 1, 3_000)) {
      return apiError(429, "Doucement ! Score déjà enregistré il y a un instant.");
    }

    const body = await readJson<{ score: number; maxScore: number }>(req);
    let score = Math.round(Number(body.score));
    let maxScore = Math.round(Number(body.maxScore));
    if (!Number.isFinite(score) || !Number.isFinite(maxScore)) {
      return apiError(400, "Score invalide.");
    }
    maxScore = Math.min(Math.max(maxScore, 1), 1_000_000);
    score = Math.min(Math.max(score, 0), maxScore);

    // UPSERT « meilleur essai » : on ne remplace que si le ratio s'améliore.
    db.prepare(
      `INSERT INTO scores (game_id, user_id, score, max_score) VALUES (?, ?, ?, ?)
       ON CONFLICT(game_id, user_id) DO UPDATE SET
         score = excluded.score,
         max_score = excluded.max_score,
         created_at = datetime('now')
       WHERE CAST(excluded.score AS REAL) / MAX(excluded.max_score, 1)
           > CAST(scores.score AS REAL) / MAX(scores.max_score, 1)`
    ).run(id, user.id, score, maxScore);

    return Response.json({ ok: true });
  });
}

// GET : classement du jeu (un meilleur essai par élève, trié par pourcentage).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;

    const rows = db
      .prepare(
        `SELECT u.username, s.score, s.max_score, s.created_at, s.user_id
         FROM scores s JOIN users u ON u.id = s.user_id
         WHERE s.game_id = ?
         ORDER BY CAST(s.score AS REAL) / MAX(s.max_score, 1) DESC, s.created_at ASC
         LIMIT 15`
      )
      .all(id)
      .map((r) => ({ ...(r as Record<string, unknown>) }));

    return Response.json({ scores: rows, userId: user.id });
  });
}
