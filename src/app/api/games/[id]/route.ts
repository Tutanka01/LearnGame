import { NextRequest } from "next/server";
import db from "@/lib/db";
import { apiError, handleApi, readJson, requireGame, requireOwnedGame, requireUser } from "@/lib/api";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    const game = db
      .prepare(
        `SELECT g.id, g.topic, g.difficulty, g.title, g.version, g.plays,
                g.is_public, g.public_slug,
                g.created_at, g.updated_at, g.user_id, u.username AS author
         FROM games g JOIN users u ON u.id = g.user_id WHERE g.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!game) return apiError(404, "Jeu introuvable.");
    return Response.json({ game: { ...game }, userId: user.id });
  });
}

// Renommage du titre (créateur uniquement).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    requireOwnedGame(id, user.id, "renommer ce jeu");

    const body = await readJson<{ title: string }>(req);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 120) {
      return apiError(400, "Le titre doit faire entre 1 et 120 caractères.");
    }

    db.prepare("UPDATE games SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
      title,
      id
    );
    return Response.json({ ok: true, title });
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    requireGame(id);
    requireOwnedGame(id, user.id, "supprimer ce jeu");

    db.prepare("DELETE FROM games WHERE id = ?").run(id);
    return Response.json({ ok: true });
  });
}
