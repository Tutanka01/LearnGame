import { NextRequest } from "next/server";
import db from "@/lib/db";
import { apiError, handleApi } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";

// Beacon public (lecteur /p/[slug], sans compte) : compte une partie réelle.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return handleApi(async () => {
    const { slug } = await params;
    const game = db
      .prepare("SELECT id FROM games WHERE public_slug = ? AND is_public = 1")
      .get(slug) as { id: string } | undefined;
    if (!game) return apiError(404, "Ce jeu n'est pas (ou plus) public.");

    // Au plus une partie comptée toutes les 30 s par IP et par jeu.
    if (rateLimit(`plays-public:${slug}:${clientIp(req)}`, 1, 30_000)) {
      db.prepare("UPDATE games SET plays = plays + 1 WHERE id = ?").run(game.id);
    }
    return Response.json({ ok: true });
  });
}
