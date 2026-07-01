import { NextRequest } from "next/server";
import db from "@/lib/db";
import { apiError, handleApi, requireAdmin } from "@/lib/api";

// Approuve un compte en attente (admin uniquement).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    await requireAdmin();
    const { id } = await params;

    const result = db
      .prepare("UPDATE users SET status = 'approved' WHERE id = ? AND status = 'pending'")
      .run(id);

    if (Number(result.changes) === 0) {
      return apiError(404, "Compte introuvable ou déjà traité.");
    }
    return Response.json({ ok: true });
  });
}
