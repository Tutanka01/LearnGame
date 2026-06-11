import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import db from "@/lib/db";
import { apiError, handleApi, readJson, requireOwnedGame, requireUser } from "@/lib/api";

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
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    const game = requireOwnedGame(id, user.id, "publier ce jeu");

    const body = await readJson<{ public: boolean }>(req);
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
      if (!slug) return apiError(500, "Impossible de générer un lien.");
    }

    db.prepare("UPDATE games SET is_public = ? WHERE id = ?").run(makePublic ? 1 : 0, id);

    return Response.json({ ok: true, isPublic: makePublic, slug });
  });
}
