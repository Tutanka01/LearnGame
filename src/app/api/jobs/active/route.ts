import { getCurrentUser } from "@/lib/auth";
import { handleApi, requireUser } from "@/lib/api";
import { jobRunner, toPublicJob } from "@/lib/jobs";

// Le job actif de l'utilisateur (ou son dernier job terminé il y a < 5 min,
// pour raccrocher un résultat raté après un refresh). Appelé au montage du
// GenerationProvider : c'est ce qui rend la génération immortelle côté client.
// Un visiteur non connecté (page /login) reçoit { job: null } en 200 plutôt
// qu'un 401 : la réponse est légitime (« pas de job ») et n'inonde pas la
// console d'erreurs réseau à chaque visite de la page de connexion.
export async function GET() {
  return handleApi(async () => {
    const user = await getCurrentUser();
    if (!user) return Response.json({ job: null });
    const job = jobRunner.getActiveJobForUser(user.id) ?? jobRunner.getRecentFinishedJob(user.id);
    return Response.json({ job: job ? toPublicJob(job) : null });
  });
}
