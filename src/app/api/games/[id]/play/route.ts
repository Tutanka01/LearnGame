import { NextRequest } from "next/server";
import db from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { gameHtmlError, gameHtmlResponse } from "@/lib/api";

// Sert le HTML brut du jeu, affiché dans une iframe sandboxée (CSP stricte).
// Ne compte PAS les parties : la vue code, le téléchargement et les rechargements
// passent aussi par ici — le compteur est alimenté par POST /plays (beacon).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return gameHtmlError(401, "Connecte-toi pour jouer à ce jeu.");

  const { id } = await params;
  const game = db.prepare("SELECT html FROM games WHERE id = ?").get(id) as
    | { html: string }
    | undefined;

  if (!game) return gameHtmlError(404, "Jeu introuvable.");

  return gameHtmlResponse(game.html);
}
