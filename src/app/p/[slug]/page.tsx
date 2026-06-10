import type { Metadata } from "next";
import { notFound } from "next/navigation";
import db, { Game } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import PublicPlayer from "@/components/PublicPlayer";

export const dynamic = "force-dynamic";

function getPublicGame(slug: string) {
  return db
    .prepare(
      `SELECT g.id, g.topic, g.difficulty, g.title, g.version, g.plays,
              g.created_at, g.updated_at, g.user_id, g.is_public, g.public_slug,
              u.username AS author
       FROM games g JOIN users u ON u.id = g.user_id
       WHERE g.public_slug = ? AND g.is_public = 1`
    )
    .get(slug) as unknown as Game | undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = getPublicGame(slug);
  if (!game) return { title: "Jeu introuvable — LearnGame" };
  const title = `${game.title || game.topic} — LearnGame`;
  const description = `Jeu pédagogique : ${game.topic}. Joue directement dans ton navigateur, aucun compte requis.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default async function PublicGamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = getPublicGame(slug);
  if (!game) notFound();

  // Si l'élève est déjà connecté, son score sera enregistré au classement.
  const user = await getCurrentUser();

  return <PublicPlayer game={{ ...game }} username={user?.username ?? null} />;
}
