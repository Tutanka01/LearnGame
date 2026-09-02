import { NextRequest } from "next/server";
import db from "@/lib/db";
import { revokeAllUserSessions } from "@/lib/session";
import { apiError, handleApi, requireAdmin } from "@/lib/api";

// Rejette (supprime) un compte en attente (admin uniquement).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await requireAdmin();
    const { id } = await params;

    // Défense en profondeur : on révoque d'abord toute session du compte,
    // avant la suppression (la cascade FK ferait déjà le travail — un appel
    // explicite rend l'invariant lisible et survit à un futur changement de
    // politique de suppression).
    revokeAllUserSessions(Number(id));

    const result = db
      .prepare("DELETE FROM users WHERE id = ? AND status = 'pending'")
      .run(id);

    if (Number(result.changes) === 0) {
      return apiError(404, "Compte introuvable ou déjà traité.");
    }
    return Response.json({ ok: true });
  });
}
