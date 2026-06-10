"use client";

// Pilote la génération de jeux au niveau de l'application entière :
// la requête SSE vit ici (et non dans une page), donc l'élève peut minimiser
// l'overlay, naviguer, jouer à un autre jeu… pendant que son jeu se génère.

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
import GenerationOverlay from "./GenerationOverlay";

export type GenerationRequest =
  | { topic: string; difficulty: string }
  | { gameId: string; feedback: string };

export type GenerationPhase = "connect" | "thinking" | "coding" | "validating";

export interface GenerationState {
  status: "idle" | "running" | "done" | "error";
  request: GenerationRequest | null;
  /** create = nouveau jeu écrit en entier · edit = retouches ciblées d'un jeu existant. */
  mode: "create" | "edit";
  label: string;
  phase: GenerationPhase;
  statusMsg: string;
  reasoningTail: string;
  codeTail: string;
  counts: { reasoning: number; code: number };
  startedAt: number;
  elapsed: number;
  attempt: number;
  error: string;
  result: { id: string; title: string } | null;
  minimized: boolean;
  /** true quand un Studio affiche la génération en ligne : l'overlay global se tait. */
  embedded: boolean;
}

export interface StartOptions {
  onDone?: (id: string) => void;
  /** L'appelant affiche lui-même la génération (Studio) : pas d'overlay global. */
  embedded?: boolean;
}

export interface GenerationApi {
  state: GenerationState;
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
  request: null,
  mode: "create",
  label: "",
  phase: "connect",
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

const GenerationContext = createContext<GenerationApi | null>(null);

export function useGeneration(): GenerationApi {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration doit être utilisé sous <GenerationProvider>");
  return ctx;
}

export default function GenerationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GenerationState>(INITIAL);
  const statusRef = useRef<GenerationState["status"]>("idle");
  const minimizedRef = useRef(false);
  const embeddedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const fullCodeRef = useRef("");
  const onDoneRef = useRef<((id: string) => void) | null>(null);
  const lastRunRef = useRef<{ req: GenerationRequest; opts?: StartOptions } | null>(null);

  // Chronomètre tant qu'une génération tourne.
  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(
      () =>
        setState((s) =>
          s.status === "running"
            ? { ...s, elapsed: Math.floor((Date.now() - s.startedAt) / 1000) }
            : s
        ),
      1000
    );
    return () => clearInterval(t);
  }, [state.status]);

  const start = useCallback(
    (req: GenerationRequest, opts?: StartOptions): boolean => {
      if (statusRef.current === "running") {
        // Déjà une génération en cours : on remet l'overlay au premier plan.
        minimizedRef.current = false;
        setState((s) => ({ ...s, minimized: false }));
        return false;
      }

      const abort = new AbortController();
      abortRef.current = abort;
      fullCodeRef.current = "";
      onDoneRef.current = opts?.onDone ?? null;
      lastRunRef.current = { req, opts };
      minimizedRef.current = false;
      embeddedRef.current = opts?.embedded ?? embeddedRef.current;
      statusRef.current = "running";

      const label = "topic" in req ? req.topic : "Amélioration du jeu";
      setState({
        ...INITIAL,
        status: "running",
        request: req,
        mode: "topic" in req ? "create" : "edit",
        label,
        startedAt: Date.now(),
        statusMsg: "Connexion au modèle…",
        embedded: embeddedRef.current,
      });

      const fail = (message: string) => {
        statusRef.current = "error";
        setState((s) => ({ ...s, status: "error", error: message }));
      };

      const succeed = (id: string, title: string) => {
        const handler = onDoneRef.current;
        if (handler) {
          statusRef.current = "idle";
          setState((s) => ({ ...INITIAL, embedded: s.embedded }));
          handler(id);
          return;
        }
        if (embeddedRef.current || minimizedRef.current) {
          // Le Studio (ou la pilule) affichera le résultat.
          statusRef.current = "done";
          setState((s) => ({ ...s, status: "done", result: { id, title } }));
        } else {
          statusRef.current = "idle";
          setState(INITIAL);
          router.push(`/games/${id}`);
        }
      };

      (async () => {
        try {
          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
            signal: abort.signal,
          });

          if (!res.ok || !res.body) {
            const data = await res.json().catch(() => ({}));
            fail(data.error || `Erreur serveur (${res.status}).`);
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              let event;
              try {
                event = JSON.parse(line.slice(5));
              } catch {
                continue;
              }
              switch (event.type) {
                case "status":
                  setState((s) => ({ ...s, statusMsg: event.message }));
                  break;
                case "phase":
                  setState((s) => ({ ...s, phase: event.phase }));
                  break;
                case "reset":
                  fullCodeRef.current = "";
                  setState((s) => ({
                    ...s,
                    reasoningTail: "",
                    codeTail: "",
                    counts: { reasoning: 0, code: 0 },
                    attempt: s.attempt + 1,
                    phase: "connect",
                  }));
                  break;
                case "reasoning":
                  setState((s) => ({
                    ...s,
                    phase: s.phase === "connect" ? "thinking" : s.phase,
                    reasoningTail: (s.reasoningTail + event.text).slice(-3000),
                    counts: { ...s.counts, reasoning: s.counts.reasoning + event.text.length },
                  }));
                  break;
                case "chunk":
                  fullCodeRef.current += event.text;
                  setState((s) => ({
                    ...s,
                    phase: s.phase === "validating" ? s.phase : "coding",
                    codeTail: (s.codeTail + event.text).slice(-6000),
                    counts: { ...s.counts, code: s.counts.code + event.text.length },
                  }));
                  break;
                case "done":
                  succeed(event.id, event.title);
                  return;
                case "error":
                  fail(event.message);
                  return;
              }
            }
          }
          fail("La connexion s'est interrompue avant la fin. Réessaie.");
        } catch (err) {
          if (!abort.signal.aborted) {
            fail(err instanceof Error ? err.message : "Erreur réseau.");
          }
        }
      })();

      return true;
    },
    [router]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    statusRef.current = "idle";
    setState(INITIAL);
  }, []);

  const retry = useCallback(() => {
    const last = lastRunRef.current;
    statusRef.current = "idle";
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
    statusRef.current = "idle";
    setState((s) => ({ ...INITIAL, embedded: s.embedded }));
  }, []);

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
    setState(INITIAL);
    if (id) router.push(`/games/${id}`);
  }, [state.result, router]);

  const getFullCode = useCallback(() => fullCodeRef.current, []);

  const api = useMemo<GenerationApi>(
    () => ({
      state,
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
    [state, start, cancel, retry, minimize, restore, dismiss, openResult, setEmbedded, getFullCode]
  );

  return (
    <GenerationContext.Provider value={api}>
      {children}
      <GenerationOverlay api={api} />
    </GenerationContext.Provider>
  );
}
