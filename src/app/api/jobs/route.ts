import { NextRequest } from "next/server";
import { apiError, handleApi, readJson, requireOwnedGame, requireUser } from "@/lib/api";
import { jobRunner, toPublicJob, JobPayload } from "@/lib/jobs";

const DIFFICULTIES = new Set(["débutant", "intermédiaire", "avancé"]);

// Crée un job de génération (création ou amélioration) et le lance en tâche
// de fond. Le client suit ensuite le flux via GET /api/jobs/[id]/events.
export async function POST(req: NextRequest) {
  return handleApi(async () => {
    const user = await requireUser();
    const body = await readJson<{
      topic: string;
      difficulty: string;
      gameId: string;
      feedback: string;
    }>(req);

    const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 500) : "";
    const difficulty = DIFFICULTIES.has(body.difficulty ?? "")
      ? (body.difficulty as string)
      : "intermédiaire";
    const gameId = typeof body.gameId === "string" ? body.gameId : null;
    const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 1000) : "";

    let payload: JobPayload;
    if (gameId) {
      requireOwnedGame(gameId, user.id);
      if (!feedback) return apiError(400, "Décris l'amélioration souhaitée.");
      payload = { type: "edit", gameId, feedback };
    } else {
      if (topic.length < 3) {
        return apiError(400, "Décris ce que tu veux apprendre (au moins 3 caractères).");
      }
      payload = { type: "create", topic, difficulty };
    }

    // Job déjà actif ? On le signale avec son id : le client raccroche au lieu
    // d'échouer (deux onglets, double clic…). createJob revérifie sous verrou.
    const active = jobRunner.getActiveJobForUser(user.id);
    if (active) {
      return Response.json(
        { error: "Une génération est déjà en cours.", activeJob: toPublicJob(active) },
        { status: 409 }
      );
    }

    const job = jobRunner.createJob(user, payload);
    return Response.json({ job: toPublicJob(job) }, { status: 202 });
  });
}
