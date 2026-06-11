import { NextRequest } from "next/server";
import db from "@/lib/db";
import { gameHtmlError, gameHtmlResponse } from "@/lib/api";

// Sert le HTML d'un jeu PUBLIÉ, sans authentification : c'est l'endpoint
// utilisé par la page publique /p/[slug] (lien partagé dans un cours, un PDF…).
// Même CSP stricte que l'endpoint privé ; le compteur de parties est alimenté
// par POST /api/p/[slug]/plays (beacon), pas par cette route.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = db
    .prepare("SELECT html FROM games WHERE public_slug = ? AND is_public = 1")
    .get(slug) as { html: string } | undefined;

  if (!game) return gameHtmlError(404, "Ce jeu n'est pas (ou plus) public.");

  return gameHtmlResponse(game.html);
}
