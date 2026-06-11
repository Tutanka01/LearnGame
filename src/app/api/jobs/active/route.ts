import { handleApi, requireUser } from "@/lib/api";
import { jobRunner, toPublicJob } from "@/lib/jobs";

// Le job actif de l'utilisateur (ou son dernier job terminé il y a < 5 min,
// pour raccrocher un résultat raté après un refresh). Appelé au montage du
// GenerationProvider : c'est ce qui rend la génération immortelle côté client.
export async function GET() {
  return handleApi(async () => {
    const user = await requireUser();
    const job = jobRunner.getActiveJobForUser(user.id) ?? jobRunner.getRecentFinishedJob(user.id);
    return Response.json({ job: job ? toPublicJob(job) : null });
  });
}
