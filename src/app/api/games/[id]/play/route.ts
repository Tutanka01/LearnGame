import { NextRequest } from "next/server";
import db from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Sert le HTML brut du jeu, affiché dans une iframe sandboxée.
// La CSP bloque toute ressource externe et tout appel réseau depuis le jeu.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non connecté.", { status: 401 });

  const { id } = await params;
  const game = db.prepare("SELECT html FROM games WHERE id = ?").get(id) as
    | { html: string }
    | undefined;

  if (!game) return new Response("Jeu introuvable.", { status: 404 });

  db.prepare("UPDATE games SET plays = plays + 1 WHERE id = ?").run(id);

  return new Response(game.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "no-store",
    },
  });
}
