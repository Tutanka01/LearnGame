import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import db from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Slug lisible et stable : "les-bases-de-sql-a3f9km".
// La partie aléatoire rend l'URL non devinable tout en restant courte.
function makeSlug(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = randomBytes(4).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "jeu";
  return base ? `${base}-${suffix}` : suffix;
}

// POST : publie ou dépublie un jeu. Le slug est créé à la première publication
// puis conservé pour toujours : les liens imprimés dans un PDF restent valides.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const { id } = await params;
  const game = db
    .prepare("SELECT user_id, title, topic, public_slug FROM games WHERE id = ?")
    .get(id) as { user_id: number; title: string; topic: string; public_slug: string | null } | undefined;

  if (!game) return NextResponse.json({ error: "Jeu introuvable." }, { status: 404 });
  if (game.user_id !== user.id) {
    return NextResponse.json({ error: "Seul l'auteur peut publier ce jeu." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const makePublic = Boolean(body.public);

  let slug = game.public_slug;
  if (makePublic && !slug) {
    // En cas de collision (très improbable), on retente avec un nouveau suffixe.
    for (let i = 0; i < 5; i++) {
      slug = makeSlug(game.title || game.topic);
      try {
        db.prepare("UPDATE games SET public_slug = ? WHERE id = ?").run(slug, id);
        break;
      } catch {
        slug = null;
      }
    }
    if (!slug) return NextResponse.json({ error: "Impossible de générer un lien." }, { status: 500 });
  }

  db.prepare("UPDATE games SET is_public = ? WHERE id = ?").run(makePublic ? 1 : 0, id);

  return NextResponse.json({ ok: true, isPublic: makePublic, slug });
}
