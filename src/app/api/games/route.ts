import { NextRequest } from "next/server";
import db from "@/lib/db";
import { handleApi, requireUser } from "@/lib/api";

// Bibliothèque de jeux, paginée (?offset=&limit=), du plus récemment modifié
// au plus ancien. `total` permet au front d'afficher « Charger plus ».
// Filtres combinables (AND) : `q` (sous-chaîne insensible à la casse sur le
// titre, le sujet ou l'auteur), `mine=1` (mes jeux), `todo=1` (jeux que je
// n'ai pas terminés) et `sort=popular` (plus de finisseurs, puis plus joués).
export async function GET(req: NextRequest) {
  return handleApi(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 60, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const mine = url.searchParams.get("mine") === "1";
    const todo = url.searchParams.get("todo") === "1";
    const sort = url.searchParams.get("sort") === "popular" ? "popular" : "recent";

    // Clauses WHERE et paramètres construits dynamiquement, puis réutilisés à
    // l'identique pour la requête de page et le COUNT (même ensemble filtré).
    const where: string[] = [];
    const whereParams: (string | number)[] = [];
    if (q) {
      // % et _ doivent pouvoir être cherchés littéralement : on les échappe et
      // on déclare '\' comme caractère d'échappement de chaque LIKE.
      const needle = q.replaceAll("%", "\\%").replaceAll("_", "\\_");
      where.push(
        `(lower(g.title) LIKE '%' || lower(?) || '%' ESCAPE '\\'
          OR lower(g.topic) LIKE '%' || lower(?) || '%' ESCAPE '\\'
          OR lower(u.username) LIKE '%' || lower(?) || '%' ESCAPE '\\')`
      );
      whereParams.push(needle, needle, needle);
    }
    if (mine) {
      where.push("g.user_id = ?");
      whereParams.push(user.id);
    }
    if (todo) {
      where.push("NOT EXISTS(SELECT 1 FROM scores s WHERE s.game_id = g.id AND s.user_id = ?)");
      whereParams.push(user.id);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    // Tri : les plus récemment modifiés (défaut) ou les plus finis d'abord.
    const orderBySql =
      sort === "popular"
        ? "ORDER BY (SELECT COUNT(*) FROM scores s WHERE s.game_id = g.id) DESC, g.plays DESC"
        : "ORDER BY g.updated_at DESC";

    const games = db
      .prepare(
        `SELECT g.id, g.topic, g.difficulty, g.title, g.version, g.plays,
                g.is_public, g.public_slug,
                g.created_at, g.updated_at, g.user_id, u.username AS author,
                EXISTS(SELECT 1 FROM scores s WHERE s.game_id = g.id AND s.user_id = ?) AS completed_by_me,
                (SELECT COUNT(*) FROM scores s WHERE s.game_id = g.id) AS finishers
         FROM games g JOIN users u ON u.id = g.user_id
         ${whereSql}
         ${orderBySql}
         LIMIT ? OFFSET ?`
      )
      .all(user.id, ...whereParams, limit, offset)
      .map((r) => ({ ...(r as Record<string, unknown>) }));

    const { total } = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM games g JOIN users u ON u.id = g.user_id
         ${whereSql}`
      )
      .get(...whereParams) as { total: number };

    // Stats de l'élève : jeux terminés + somme de ses meilleurs scores en
    // POURCENTAGE par jeu (0–100) — comparable d'un jeu à l'autre, contrairement
    // aux scores bruts dont l'échelle varie librement.
    const stats = db
      .prepare(
        `SELECT COUNT(*) AS completed, COALESCE(ROUND(SUM(pct)), 0) AS points
         FROM (
           SELECT MAX(CAST(score AS REAL) / MAX(max_score, 1)) * 100 AS pct
           FROM scores WHERE user_id = ? GROUP BY game_id
         )`
      )
      .get(user.id) as { completed: number; points: number };

    return Response.json({ games, total, userId: user.id, stats: { ...stats } });
  });
}
