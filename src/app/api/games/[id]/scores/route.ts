import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// POST : le jeu (via postMessage → GamePlayer) enregistre le score d'une partie terminée.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const { id } = await params;
  const game = db.prepare("SELECT id FROM games WHERE id = ?").get(id);
  if (!game) return NextResponse.json({ error: "Jeu introuvable." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  let score = Math.round(Number(body.score));
  let maxScore = Math.round(Number(body.maxScore));
  if (!Number.isFinite(score) || !Number.isFinite(maxScore)) {
    return NextResponse.json({ error: "Score invalide." }, { status: 400 });
  }
  maxScore = Math.min(Math.max(maxScore, 1), 1_000_000);
  score = Math.min(Math.max(score, 0), maxScore);

  db.prepare("INSERT INTO scores (game_id, user_id, score, max_score) VALUES (?, ?, ?, ?)").run(
    id,
    user.id,
    score,
    maxScore
  );

  return NextResponse.json({ ok: true });
}

// GET : classement du jeu (meilleur essai par élève, en pourcentage).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const { id } = await params;
  const rows = db
    .prepare(
      `SELECT u.username, t.score, t.max_score, t.created_at, t.user_id
       FROM (
         SELECT s.*, ROW_NUMBER() OVER (
           PARTITION BY s.user_id
           ORDER BY CAST(s.score AS REAL) / MAX(s.max_score, 1) DESC, s.created_at ASC
         ) AS rn
         FROM scores s WHERE s.game_id = ?
       ) t
       JOIN users u ON u.id = t.user_id
       WHERE t.rn = 1
       ORDER BY CAST(t.score AS REAL) / MAX(t.max_score, 1) DESC, t.created_at ASC
       LIMIT 15`
    )
    .all(id)
    .map((r) => ({ ...(r as Record<string, unknown>) }));

  return NextResponse.json({ scores: rows, userId: user.id });
}
