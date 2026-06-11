import { NextRequest } from "next/server";
import { apiError, handleApi, requireUser } from "@/lib/api";
import { jobRunner } from "@/lib/jobs";

// Annulation explicite d'un job (créateur du job uniquement).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await requireUser();
    const { id } = await params;

    const job = jobRunner.getJob(id);
    if (!job) return apiError(404, "Génération introuvable.");
    if (job.user_id !== user.id) return apiError(403, "Cette génération ne t'appartient pas.");

    const cancelled = jobRunner.cancelJob(id);
    if (!cancelled) return apiError(409, "Cette génération est déjà terminée.");
    return Response.json({ ok: true });
  });
}
