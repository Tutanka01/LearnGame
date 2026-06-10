import { NextRequest } from "next/server";
import db from "@/lib/db";

// Sert le HTML d'un jeu PUBLIÉ, sans authentification : c'est l'endpoint
// utilisé par la page publique /p/[slug] (lien partagé dans un cours, un PDF…).
// Même CSP stricte que l'endpoint privé : aucune ressource externe, aucun réseau.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = db
    .prepare("SELECT id, html FROM games WHERE public_slug = ? AND is_public = 1")
    .get(slug) as { id: string; html: string } | undefined;

  if (!game) return new Response("Ce jeu n'est pas (ou plus) public.", { status: 404 });

  db.prepare("UPDATE games SET plays = plays + 1 WHERE id = ?").run(game.id);

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
