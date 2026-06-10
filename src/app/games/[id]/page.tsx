import { notFound, redirect } from "next/navigation";
import db, { Game } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import Studio from "@/components/Studio";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const game = db
    .prepare(
      `SELECT g.id, g.topic, g.difficulty, g.title, g.version, g.plays,
              g.is_public, g.public_slug,
              g.created_at, g.updated_at, g.user_id, u.username AS author
       FROM games g JOIN users u ON u.id = g.user_id WHERE g.id = ?`
    )
    .get(id) as unknown as Game | undefined;

  if (!game) notFound();

  // node:sqlite renvoie des objets à prototype nul ; Next exige des objets simples.
  return <Studio game={{ ...game }} isOwner={game.user_id === user.id} />;
}
