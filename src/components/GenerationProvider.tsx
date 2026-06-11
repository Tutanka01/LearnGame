"use client";

// Pilote la génération de jeux au niveau de l'application entière.
// La génération vit CÔTÉ SERVEUR (job persisté, src/lib/jobs.ts) : ici on ne
// fait que s'y (re)connecter en SSE. Conséquences :
//  - un refresh, une navigation ou un onglet fermé ne tuent JAMAIS une
//    génération : au montage, on récupère le job actif et on raccroche ;
//  - la reconnexion rejoue les événements manqués (Last-Event-ID natif
//    d'EventSource + réducteur partagé src/lib/genEvents.ts) : l'état
//    d'affichage est reconstruit à l'identique, aperçu live compris ;
//  - l'annulation est une action explicite (POST cancel), pas une déconnexion.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  GenEvent,
  GenJobType,
  GenPhase,
  GenSnapshot,
  initialSnapshot,
  reduceGenEvent,
} from "@/lib/genEvents";
import GenerationOverlay from "./GenerationOverlay";

export type GenerationRequest =
  | { topic: string; difficulty: string }
  | { gameId: string; feedback: string };

export type { GenPhase as GenerationPhase };

/** Job tel que renvoyé par /api/jobs et /api/jobs/active. */
interface PublicJob {
  id: string;
  type: GenJobType;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  gameId: string | null;
  label: string;
  createdAt: string;
  result: { gameId: string; title: string; version: number; summary: string } | null;
  error: string | null;
}

export interface GenerationState {
  status: "idle" | "running" | "done" | "error";
  jobId: string | null;
  request: GenerationRequest | null;
  /** create = nouveau jeu écrit en entier · edit = retouches ciblées. */
  mode: GenJobType;
  label: string;
  phase: GenPhase;
  /** Tour de la session d'édition (1 à 3). */
  round: number;
  statusMsg: string;
  reasoningTail: string;
  codeTail: string;
  counts: { reasoning: number; code: number };
  startedAt: number;
  elapsed: number;
  attempt: number;
  error: string;
  result: { id: string; title: string; version: number; summary: string } | null;
  minimized: boolean;
  /** true quand un Studio affiche la génération en ligne : l'overlay global se tait. */
  embedded: boolean;
}

export interface StartOptions {
  onDone?: (id: string) => void;
  /** Appelé dès que le job est accepté par le serveur (demande persistée). */
  onStarted?: (jobId: string) => void;
  /** L'appelant affiche lui-même la génération (Studio) : pas d'overlay global. */
  embedded?: boolean;
}

export interface GenerationApi {
  state: GenerationState;
  /** true tant que le job actif éventuel n'a pas encore été récupéré au montage. */
  bootstrapped: boolean;
  /** Lance une génération. Retourne false si une génération est déjà en cours. */
  start: (req: GenerationRequest, opts?: StartOptions) => boolean;
  cancel: () => void;
  retry: () => void;
  minimize: () => void;
  restore: () => void;
  dismiss: () => void;
  openResult: () => void;
  /** Le Studio se déclare comme surface d'affichage de la génération. */
  setEmbedded: (embedded: boolean) => void;
  /** Code HTML complet reçu jusqu'ici (pour l'aperçu live). */
  getFullCode: () => string;
}

const INITIAL: GenerationState = {
  status: "idle",
  jobId: null,
  request: null,
  mode: "create",
  label: "",
  phase: "connect",
  round: 1,
  statusMsg: "",
  reasoningTail: "",
  codeTail: "",
  counts: { reasoning: 0, code: 0 },
  startedAt: 0,
  elapsed: 0,
  attempt: 1,
  error: "",
  result: null,
  minimized: false,
  embedded: false,
};

/** Date SQLite (UTC "YYYY-MM-DD HH:MM:SS") → timestamp local. */
function parseSqliteDate(s: string): number {
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(t) ? Date.now() : t;
}

function requestOf(job: PublicJob): GenerationRequest {
  return job.type === "create"
    ? { topic: job.label, difficulty: "" }
    : { gameId: job.gameId ?? "", feedback: job.label };
}

const GenerationContext = createContext<GenerationApi | null>(null);

export function useGeneration(): GenerationApi {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration doit être utilisé sous <GenerationProvider>");
  return ctx;
}

export default function GenerationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GenerationState>(INITIAL);
  const [bootstrapped, setBootstrapped] = useState(false);

  const statusRef = useRef<GenerationState["status"]>("idle");
  const minimizedRef = useRef(false);
  const embeddedRef = useRef(false);
  const snapshotRef = useRef<GenSnapshot>(initialSnapshot());
  const sourceRef = useRef<EventSource | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const reconnectsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef<((id: string) => void) | null>(null);
  const lastRunRef = useRef<{ req: GenerationRequest; opts?: StartOptions } | null>(null);

  // Chronomètre tant qu'une génération tourne.
  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(
      () =>
        setState((s) =>
          s.status === "running"
            ? { ...s, elapsed: Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000)) }
            : s
        ),
      1000
    );
    return () => clearInterval(t);
  }, [state.status, state.startedAt]);

  const closeSource = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const fail = useCallback((message: string) => {
    statusRef.current = "error";
    setState((s) => ({ ...s, status: "error", error: message }));
  }, []);

  const succeed = useCallback(
    (result: NonNullable<GenerationState["result"]>) => {
      const handler = onDoneRef.current;
      if (handler) {
        statusRef.current = "idle";
        jobIdRef.current = null;
        setState((s) => ({ ...INITIAL, embedded: s.embedded }));
        handler(result.id);
        return;
      }
      if (embeddedRef.current || minimizedRef.current) {
        // Le Studio (ou la pilule) affichera le résultat.
        statusRef.current = "done";
        setState((s) => ({ ...s, status: "done", result }));
      } else {
        statusRef.current = "idle";
        jobIdRef.current = null;
        setState(INITIAL);
        router.push(`/games/${result.id}`);
      }
    },
    [router]
  );

  /** Applique un événement du flux au snapshot partagé puis à l'état React. */
  const applyEvent = useCallback(
    (event: GenEvent) => {
      const snap = reduceGenEvent(snapshotRef.current, event);
      snapshotRef.current = snap;

      if (event.type === "done") {
        closeSource();
        succeed({
          id: snap.result!.gameId,
          title: snap.result!.title,
          version: snap.result!.version,
          summary: snap.result!.summary,
        });
        return;
      }
      if (event.type === "error") {
        closeSource();
        fail(snap.error);
        return;
      }
      if (event.type === "cancelled") {
        // Annulé (peut venir d'un autre onglet) : on range tout.
        closeSource();
        statusRef.current = "idle";
        jobIdRef.current = null;
        setState((s) => ({ ...INITIAL, embedded: s.embedded }));
        return;
      }

      setState((s) =>
        s.status === "running"
          ? {
              ...s,
              mode: snap.mode,
              phase: snap.phase,
              round: snap.round,
              attempt: snap.attempt,
              statusMsg: snap.statusMsg,
              reasoningTail: snap.reasoningTail,
              codeTail: snap.codeTail,
              counts: snap.counts,
            }
          : s
      );
    },
    [closeSource, fail, succeed]
  );

  /**
   * Ouvre (ou rouvre) le flux SSE d'un job. EventSource gère lui-même les
   * micro-coupures (avec Last-Event-ID) ; s'il abandonne (réponse non-200 :
   * compilation à la volée en dev, hoquet de proxy, redémarrage…), on NE
   * déclare PAS l'échec tant que le job est vivant côté serveur — on se
   * raccroche avec un backoff, le replay par seq reconstruit ce qui manque.
   */
  const openStream = useCallback(
    (jobId: string) => {
      closeSource();
      const source = new EventSource(`/api/jobs/${jobId}/events`);
      sourceRef.current = source;

      source.onmessage = (e) => {
        reconnectsRef.current = 0; // le flux vit : compteur de raccrochages remis à zéro
        try {
          applyEvent(JSON.parse(e.data) as GenEvent);
        } catch {
          // événement illisible : ignorer
        }
      };
      source.onerror = async () => {
        if (source.readyState !== EventSource.CLOSED || statusRef.current !== "running") return;
        if (jobIdRef.current !== jobId) return; // annulé / remplacé entre-temps

        // Le job a-t-il fini sans nous ?
        try {
          const res = await fetch("/api/jobs/active");
          const data = res.ok ? await res.json() : null;
          if (data?.job?.id === jobId && data.job.status === "done" && data.job.result) {
            succeed({
              id: data.job.result.gameId,
              title: data.job.result.title,
              version: data.job.result.version,
              summary: data.job.result.summary,
            });
            return;
          }
          if (data?.job?.id === jobId && data.job.status === "error") {
            fail(data.job.error || "La génération a échoué.");
            return;
          }
          if (data?.job?.id === jobId && data.job.status === "cancelled") {
            statusRef.current = "idle";
            jobIdRef.current = null;
            setState((s) => ({ ...INITIAL, embedded: s.embedded }));
            return;
          }
        } catch {
          // réseau coupé : on retente quand même ci-dessous
        }

        // Job encore vivant (ou injoignable) : on se raccroche, backoff doux.
        if (reconnectsRef.current >= 10) {
          fail("La connexion au flux de génération est perdue. Réessaie.");
          return;
        }
        const delay = Math.min(1000 * 2 ** Math.min(reconnectsRef.current, 4), 10_000);
        reconnectsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          if (statusRef.current === "running" && jobIdRef.current === jobId) {
            openStream(jobId);
          }
        }, delay);
      };
    },
    [applyEvent, closeSource, fail, succeed]
  );

  /** Branche l'interface sur un job (nouveau ou retrouvé au montage). */
  const attachToJob = useCallback(
    (job: PublicJob, opts?: StartOptions) => {
      snapshotRef.current = initialSnapshot();
      reconnectsRef.current = 0;
      jobIdRef.current = job.id;
      onDoneRef.current = opts?.onDone ?? null;
      statusRef.current = "running";
      setState((s) => ({
        ...INITIAL,
        status: "running",
        jobId: job.id,
        request: requestOf(job),
        mode: job.type,
        label: job.label,
        startedAt: parseSqliteDate(job.createdAt),
        statusMsg: "Connexion au flux de génération…",
        minimized: minimizedRef.current,
        embedded: s.embedded,
      }));
      openStream(job.id);
    },
    [openStream]
  );

  // Au montage : la génération est-elle déjà en cours côté serveur ?
  // (refresh, autre onglet, retour après fermeture…)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/jobs/active");
        if (!alive || !res.ok) return;
        const data = await res.json();
        const job: PublicJob | null = data.job;
        if (!job || statusRef.current !== "idle") return;
        if (job.status === "queued" || job.status === "running") {
          // Discret par défaut : pilule flottante, le Studio peut la déplier.
          minimizedRef.current = true;
          attachToJob(job);
        } else if (job.status === "done" && job.result) {
          // Résultat raté (onglet fermé pendant la fin) : pilule « jeu prêt ».
          minimizedRef.current = true;
          statusRef.current = "done";
          setState((s) => ({
            ...s,
            status: "done",
            jobId: job.id,
            request: requestOf(job),
            mode: job.type,
            label: job.label,
            minimized: true,
            result: {
              id: job.result!.gameId,
              title: job.result!.title,
              version: job.result!.version,
              summary: job.result!.summary,
            },
          }));
        }
      } catch {
        // hors ligne : tant pis, l'utilisateur relancera
      } finally {
        if (alive) setBootstrapped(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(
    (req: GenerationRequest, opts?: StartOptions): boolean => {
      if (statusRef.current === "running") {
        // Déjà une génération en cours : on remet l'overlay au premier plan.
        minimizedRef.current = false;
        setState((s) => ({ ...s, minimized: false }));
        return false;
      }

      // État optimiste immédiat (l'appelant navigue tout de suite vers /studio).
      snapshotRef.current = initialSnapshot();
      reconnectsRef.current = 0;
      onDoneRef.current = opts?.onDone ?? null;
      lastRunRef.current = { req, opts };
      minimizedRef.current = false;
      embeddedRef.current = opts?.embedded ?? embeddedRef.current;
      statusRef.current = "running";
      const label = "topic" in req ? req.topic : req.feedback;
      setState({
        ...INITIAL,
        status: "running",
        request: req,
        mode: "topic" in req ? "create" : "edit",
        label,
        startedAt: Date.now(),
        statusMsg: "Création de la tâche de génération…",
        embedded: embeddedRef.current,
      });

      (async () => {
        try {
          const res = await fetch("/api/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
          });
          const data = await res.json().catch(() => ({}));
          if (statusRef.current !== "running") return; // annulé entre-temps

          if (res.status === 409 && data.activeJob) {
            // Une génération tourne déjà (autre onglet…) : on raccroche.
            attachToJob(data.activeJob, opts);
            return;
          }
          if (!res.ok || !data.job) {
            fail(data.error || `Erreur serveur (${res.status}).`);
            return;
          }
          jobIdRef.current = data.job.id;
          setState((s) => (s.status === "running" ? { ...s, jobId: data.job.id } : s));
          opts?.onStarted?.(data.job.id);
          openStream(data.job.id);
        } catch (err) {
          if (statusRef.current === "running") {
            fail(err instanceof Error ? err.message : "Erreur réseau.");
          }
        }
      })();

      return true;
    },
    [attachToJob, fail, openStream]
  );

  const cancel = useCallback(() => {
    const jobId = jobIdRef.current;
    closeSource();
    statusRef.current = "idle";
    jobIdRef.current = null;
    setState(INITIAL);
    if (jobId) {
      // Annulation côté serveur (sinon le job continuerait sans nous).
      fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => {});
    }
  }, [closeSource]);

  const retry = useCallback(() => {
    const last = lastRunRef.current;
    statusRef.current = "idle";
    jobIdRef.current = null;
    if (last) start(last.req, last.opts);
  }, [start]);

  const minimize = useCallback(() => {
    minimizedRef.current = true;
    setState((s) => ({ ...s, minimized: true }));
  }, []);

  const restore = useCallback(() => {
    minimizedRef.current = false;
    setState((s) => ({ ...s, minimized: false }));
  }, []);

  const dismiss = useCallback(() => {
    closeSource();
    statusRef.current = "idle";
    jobIdRef.current = null;
    setState((s) => ({ ...INITIAL, embedded: s.embedded }));
  }, [closeSource]);

  const setEmbedded = useCallback((embedded: boolean) => {
    embeddedRef.current = embedded;
    setState((s) => {
      // Quitter le Studio pendant une génération : elle continue en pilule.
      const minimized = embedded ? false : s.status !== "idle" ? true : s.minimized;
      minimizedRef.current = minimized;
      return { ...s, embedded, minimized };
    });
  }, []);

  const openResult = useCallback(() => {
    const id = state.result?.id;
    statusRef.current = "idle";
    jobIdRef.current = null;
    setState(INITIAL);
    if (id) router.push(`/games/${id}`);
  }, [state.result, router]);

  const getFullCode = useCallback(() => snapshotRef.current.fullCode, []);

  const api = useMemo<GenerationApi>(
    () => ({
      state,
      bootstrapped,
      start,
      cancel,
      retry,
      minimize,
      restore,
      dismiss,
      openResult,
      setEmbedded,
      getFullCode,
    }),
    [
      state,
      bootstrapped,
      start,
      cancel,
      retry,
      minimize,
      restore,
      dismiss,
      openResult,
      setEmbedded,
      getFullCode,
    ]
  );

  return (
    <GenerationContext.Provider value={api}>
      {children}
      <GenerationOverlay api={api} />
    </GenerationContext.Provider>
  );
}
