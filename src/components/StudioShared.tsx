"use client";

// Briques partagées entre le Studio d'un jeu existant (Studio.tsx) et le
// Studio de création (/studio) : bulle "l'IA travaille", bulle d'erreur,
// et panneau de droite pendant une génération (aperçu live / code qui défile).

import { useEffect, useRef, useState } from "react";
import type { GenerationApi, GenerationPhase, GenerationState } from "./GenerationProvider";

export const PHASE_LABELS: Record<GenerationPhase, string> = {
  connect: "Connexion au modèle",
  thinking: "Conception pédagogique",
  coding: "Écriture du code",
  validating: "Vérification du jeu",
};

export function formatElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Formate une date SQLite (UTC, "YYYY-MM-DD HH:MM:SS") en heure locale. */
export function formatWhen(s: string): string {
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} ${hm}`;
}

export function genProgress(state: GenerationState): number {
  // En mode édition, la réponse attendue est courte (des blocs de retouches).
  const codeTarget = state.mode === "edit" ? 6000 : 42000;
  switch (state.phase) {
    case "connect":
      return 2;
    case "thinking":
      return 4 + Math.min((state.counts.reasoning / 30000) * 12, 12);
    case "coding":
      return 18 + Math.min(state.counts.code / codeTarget, 1) * 77;
    case "validating":
      return 97;
  }
}

export function phaseLabel(state: GenerationState): string {
  if (state.mode === "edit") {
    if (state.phase === "thinking") return "Lecture du jeu et analyse de ta demande";
    if (state.phase === "coding") return "Écriture des modifications ciblées";
    if (state.phase === "validating") return "Application et vérification des modifications";
  }
  return PHASE_LABELS[state.phase];
}

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}

/** Bulle de chat "l'IA travaille" : phase, chrono, réflexion dépliable. */
export function WorkingBubble({ state, onCancel }: { state: GenerationState; onCancel: () => void }) {
  const reasoningRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight });
  }, [state.reasoningTail]);

  return (
    <div className="mr-auto max-w-[95%] w-full">
      <div className="card rounded-2xl rounded-bl-sm p-4 border-[var(--color-accent)]/30">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 text-sm font-medium min-w-0">
            <TypingDots />
            <span className="truncate">{phaseLabel(state)}…</span>
          </span>
          <span className="font-mono text-xs text-[var(--color-ink-dim)] tabular-nums shrink-0">
            ⏱ {formatElapsed(state.elapsed)}
          </span>
        </div>

        <div className="h-1 rounded-full bg-[var(--color-bg)] overflow-hidden mt-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] transition-all duration-1000"
            style={{ width: `${genProgress(state)}%` }}
          />
        </div>

        <p className="text-[11px] text-[var(--color-ink-dim)] mt-2 truncate">
          {state.statusMsg}
          {state.attempt > 1 && ` · tentative ${state.attempt}`}
          {state.counts.code > 0 && ` · ${(state.counts.code / 1000).toFixed(1)}k car. de code`}
        </p>

        {state.reasoningTail && (
          <details className="mt-2 group">
            <summary className="text-[11px] text-[var(--color-accent-strong)] cursor-pointer select-none hover:underline">
              💭 Voir la réflexion du modèle
            </summary>
            <div
              ref={reasoningRef}
              className="code-stream mt-2 max-h-32 overflow-y-auto rounded-lg bg-[var(--color-bg)] border border-[var(--color-accent)]/20 p-3 text-[11px] leading-relaxed text-[var(--color-accent)]/80 italic whitespace-pre-wrap"
            >
              {state.reasoningTail}
            </div>
          </details>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--color-border)]">
          <span className="text-[11px] text-[var(--color-ink-dim)]">
            Tu peux naviguer ailleurs, la génération continue.
          </span>
          <button
            onClick={() => {
              if (confirm("Abandonner cette génération ?")) onCancel();
            }}
            className="text-[11px] text-slate-400 hover:text-white transition-colors"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bulle de chat d'erreur de génération, avec relance. */
export function ErrorBubble({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mr-auto max-w-[95%]">
      <div className="card rounded-2xl rounded-bl-sm p-4 border-red-900/60">
        <p className="text-sm font-medium text-red-300 mb-1">😕 La génération a échoué</p>
        <p className="text-xs text-[var(--color-ink-dim)] whitespace-pre-wrap">{message}</p>
        <div className="flex gap-2 mt-3">
          <button onClick={onRetry} className="btn btn-primary text-xs px-3 py-1.5">
            🔄 Réessayer
          </button>
          <button onClick={onDismiss} className="btn btn-ghost text-xs px-3 py-1.5">
            Ignorer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Panneau de droite pendant une génération : aperçu live du jeu en train de
 * s'écrire (iframe sans scripts, rafraîchie toutes les 2 s) ou code qui défile.
 */
export function LiveStream({ api, view }: { api: GenerationApi; view: "preview" | "code" }) {
  const [previewHtml, setPreviewHtml] = useState("");
  const codeRef = useRef<HTMLPreElement>(null);
  const running = api.state.status === "running";

  useEffect(() => {
    if (!running || view !== "preview") return;
    setPreviewHtml(api.getFullCode());
    const t = setInterval(() => setPreviewHtml(api.getFullCode()), 2000);
    return () => clearInterval(t);
  }, [running, view, api]);

  useEffect(() => {
    codeRef.current?.scrollTo({ top: codeRef.current.scrollHeight });
  }, [api.state.codeTail]);

  if (view === "code") {
    return (
      <pre
        ref={codeRef}
        className="code-stream w-full h-full overflow-y-auto bg-[var(--color-bg)] p-5 text-xs leading-relaxed text-emerald-300/80 font-mono whitespace-pre-wrap break-all"
      >
        {api.state.codeTail || "Le code arrivera ici dès que le modèle aura fini de réfléchir…"}
      </pre>
    );
  }

  return (
    <div className="relative w-full h-full bg-white">
      {previewHtml ? (
        <iframe
          sandbox=""
          srcDoc={previewHtml}
          className="w-full h-full border-0 pointer-events-none"
          title="Aperçu du jeu en cours de génération"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--color-bg)] text-[var(--color-ink-dim)]">
          <div className="text-4xl animate-bounce">🎨</div>
          <p className="text-sm">
            {api.state.phase === "thinking"
              ? "Le modèle conçoit la pédagogie du jeu…"
              : "L'aperçu apparaîtra dès les premières lignes de code…"}
          </p>
        </div>
      )}
      {previewHtml && (
        <span className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/70 text-[11px] text-white flex items-center gap-1.5">
          <TypingDots /> écriture en cours — interactif à la fin
        </span>
      )}
    </div>
  );
}
