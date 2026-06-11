import { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { jobRunner } from "@/lib/jobs";
import type { GenEvent } from "@/lib/genEvents";

export const maxDuration = 600;

// Flux SSE rejouable d'un job : `id: <seq>` sur chaque événement, reprise via
// l'en-tête Last-Event-ID (envoyé nativement par EventSource à la reconnexion)
// ou ?cursor=. La déconnexion du client N'ANNULE PAS le job (désabonnement
// seulement) — l'annulation passe par POST /api/jobs/[id]/cancel.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "Non connecté.");

  const { id } = await params;
  const job = jobRunner.getJob(id);
  if (!job) return apiError(404, "Génération introuvable.");
  if (job.user_id !== user.id) return apiError(403, "Cette génération ne t'appartient pas.");

  const url = new URL(req.url);
  const fromSeq =
    Number(req.headers.get("last-event-id") ?? url.searchParams.get("cursor") ?? 0) || 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // déjà fermé
        }
      };

      const sendEvent = (seq: number, e: GenEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          close();
          return;
        }
        if (e.type === "done" || e.type === "error" || e.type === "cancelled") close();
      };

      // Replay synchrone puis raccord au live (déduplication par seq).
      unsubscribe = jobRunner.subscribe(id, fromSeq, sendEvent);
      if (closed) {
        unsubscribe();
        return;
      }

      // Job déjà terminal mais cursor au-delà de l'événement final : fermer
      // proprement plutôt que de laisser le client attendre indéfiniment.
      const fresh = jobRunner.getJob(id);
      if (fresh && fresh.status !== "queued" && fresh.status !== "running") {
        close();
        return;
      }

      // Heartbeat : empêche proxys et navigateurs de croire la connexion morte.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          close();
        }
      }, 15_000);

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx & co : ne pas bufferiser le flux.
      "X-Accel-Buffering": "no",
    },
  });
}
