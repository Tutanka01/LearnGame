import { NextRequest } from "next/server";
import db from "@/lib/db";
import { handleApi, requireGame, requireUser } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

// Beacon envoyé par le client au chargement réel du jeu : c'est LA source du
// compteur de parties (la route /play n'y touche plus — elle sert aussi la vue
// code, le téléchargement et les rechargements).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    requireGame(id);

    // Au plus une partie comptée toutes les 30 s par élève et par jeu.
    if (rateLimit(`plays:${id}:${user.id}`, 1, 30_000)) {
      db.prepare("UPDATE games SET plays = plays + 1 WHERE id = ?").run(id);
    }
    return Response.json({ ok: true });
  });
}
