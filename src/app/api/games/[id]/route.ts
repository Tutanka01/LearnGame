import { NextRequest, NextResponse } from "next/server";
import db, { Game } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const { id } = await params;
  const game = db
    .prepare(
      `SELECT g.id, g.topic, g.difficulty, g.title, g.version, g.plays,
              g.created_at, g.updated_at, g.user_id, u.username AS author
       FROM games g JOIN users u ON u.id = g.user_id WHERE g.id = ?`
    )
    .get(id) as unknown as Game | undefined;

  if (!game) return NextResponse.json({ error: "Jeu introuvable." }, { status: 404 });
  return NextResponse.json({ game, userId: user.id });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const { id } = await params;
  const game = db.prepare("SELECT user_id FROM games WHERE id = ?").get(id) as
    | { user_id: number }
    | undefined;

  if (!game) return NextResponse.json({ error: "Jeu introuvable." }, { status: 404 });
  if (game.user_id !== user.id) {
    return NextResponse.json({ error: "Tu ne peux supprimer que tes propres jeux." }, { status: 403 });
  }

  db.prepare("DELETE FROM games WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
