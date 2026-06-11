import db, { archiveCurrentVersion, addGameMessage, withTransaction } from "@/lib/db";
import { ApiError, apiError, handleApi, readJson, requireOwnedGame, requireUser } from "@/lib/api";

// Restaure une version archivée d'un jeu (créateur uniquement).
// Façon Lovable : la restauration crée une NOUVELLE version, rien n'est perdu.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    requireOwnedGame(id, user.id, "restaurer une version");

    const body = await readJson<{ version: number }>(req);
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) {
      return apiError(400, "Version invalide.");
    }

    // Transaction : la version courante est relue SOUS le verrou d'écriture,
    // aucune édition concurrente ne peut s'intercaler entre archive et update.
    const result = withTransaction(() => {
      const fresh = db.prepare("SELECT version FROM games WHERE id = ?").get(id) as
        | { version: number }
        | undefined;
      if (!fresh) throw new ApiError(404, "Jeu introuvable.");
      if (version >= fresh.version) throw new ApiError(400, "Version invalide.");

      const target = db
        .prepare("SELECT title, html FROM game_versions WHERE game_id = ? AND version = ?")
        .get(id, version) as unknown as { title: string; html: string } | undefined;
      if (!target) throw new ApiError(404, "Cette version n'est plus disponible.");

      archiveCurrentVersion(id);
      const newVersion = fresh.version + 1;
      db.prepare(
        `UPDATE games SET html = ?, title = ?, version = ?, change_summary = ?,
         updated_at = datetime('now') WHERE id = ?`
      ).run(target.html, target.title, newVersion, `Restauration de la version ${version}.`, id);
      addGameMessage(
        id,
        user.id,
        "assistant",
        `Version ${version} restaurée — le jeu est revenu à cet état (enregistré comme v${newVersion}).`,
        newVersion,
        "restore"
      );
      return { version: newVersion, title: target.title };
    });

    return Response.json(result);
  });
}
