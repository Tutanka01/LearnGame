"use client";

// LE composant de progression de génération — une seule source de vérité pour
// la bulle de chat (Studio), la pilule flottante et l'overlay plein écran.
// Progression honnête : un stepper d'étapes accomplies + une barre indéterminée
// animée sur l'étape courante (plus aucun faux pourcentage calculé sur des
// caractères). Les étapes viennent des phases ÉMISES PAR LE SERVEUR.

import { useEffect, useRef } from "react";
import {
  Brain,
  CheckCircle2,
  Gamepad2,
  Hammer,
  Loader2,
  SearchCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { GenerationApi, GenerationState } from "./GenerationProvider";
import type { GenPhase } from "@/lib/genEvents";
import { TypingDots, formatElapsed } from "./StudioShared";
import { useConfirm } from "./ui/ConfirmDialog";

export interface GenStep {
  label: string;
  icon: LucideIcon;
  phases: GenPhase[];
}

/** Étapes affichées, selon le mode (le serveur émet les phases correspondantes). */
export function stepsFor(mode: GenerationState["mode"]): GenStep[] {
  if (mode === "edit") {
    return [
      { label: "Analyse", icon: Brain, phases: ["connect", "thinking"] },
      { label: "Retouches", icon: Wrench, phases: ["coding"] },
      { label: "Application", icon: Hammer, phases: ["applying"] },
      { label: "Vérification", icon: SearchCheck, phases: ["validating"] },
    ];
  }
  return [
    { label: "Conception", icon: Brain, phases: ["connect", "thinking"] },
    { label: "Écriture", icon: Sparkles, phases: ["coding"] },
    { label: "Vérification", icon: SearchCheck, phases: ["validating"] },
  ];
}

export function currentStepIndex(state: GenerationState): number {
  const steps = stepsFor(state.mode);
  const i = steps.findIndex((s) => s.phases.includes(state.phase));
  return i === -1 ? 0 : i;
}

/** Intitulé lisible de l'activité en cours. */
export function phaseTitle(state: GenerationState): string {
  const tour = state.mode === "edit" && state.round > 1 ? ` (tour ${state.round})` : "";
  switch (state.phase) {
    case "connect":
      return "Connexion au modèle";
    case "thinking":
      return state.mode === "edit"
        ? `Lecture du jeu et analyse de ta demande${tour}`
        : "Conception pédagogique du jeu";
    case "coding":
      return state.mode === "edit"
        ? `Écriture des modifications ciblées${tour}`
        : "Écriture du code du jeu";
    case "applying":
      return "Application des modifications";
    case "validating":
      return state.mode === "edit" ? "Vérification des modifications" : "Vérification du jeu";
  }
}

/** Stepper horizontal : étapes accomplies ✓, étape active animée, à venir. */
export function GenSteps({ state, compact = false }: { state: GenerationState; compact?: boolean }) {
  const steps = stepsFor(state.mode);
  const current = currentStepIndex(state);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Étapes de la génération">
      {steps.map((step, i) => {
        const status = i < current ? "done" : i === current ? "active" : "pending";
        const Icon = status === "done" ? CheckCircle2 : status === "active" ? Loader2 : step.icon;
        return (
          <li key={step.label} className="flex items-center gap-1.5 flex-1 min-w-0">
            <span
              className={`flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors ${
                compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs"
              } ${
                status === "active"
                  ? "bg-[var(--color-accent)]/15 text-[var(--color-accent-strong)] border border-[var(--color-accent)]/45"
                  : status === "done"
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                    : "text-[var(--color-ink-dim)] border border-[var(--color-border)]"
              }`}
            >
              <Icon
                size={compact ? 11 : 13}
                className={status === "active" ? "animate-spin" : ""}
                aria-hidden
              />
              <span className={compact ? "hidden md:inline" : "hidden sm:inline"}>{step.label}</span>
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`h-px flex-1 ${i < current ? "bg-emerald-500/50" : "bg-[var(--color-border)]"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Barre indéterminée : l'activité sans prétendre connaître le pourcentage. */
export function GenActivityBar({ className = "" }: { className?: string }) {
  return (
    <div className={`h-1 rounded-full bg-[var(--color-bg)] overflow-hidden ${className}`} aria-hidden>
      <div className="progress-indeterminate h-full w-full rounded-full" />
    </div>
  );
}

/** Ligne d'état : message serveur + tentative + volume reçu. */
export function GenStatusLine({ state, className = "" }: { state: GenerationState; className?: string }) {
  return (
    <p className={`text-[11px] text-[var(--color-ink-dim)] truncate ${className}`}>
      {state.statusMsg}
      {state.attempt > 1 && ` · tentative ${state.attempt}/3`}
      {state.counts.code > 0 && ` · ${(state.counts.code / 1000).toFixed(1)}k car.`}
    </p>
  );
}

/** Réflexion du modèle, dépliable, collée en bas. */
export function GenReasoning({ state }: { state: GenerationState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.reasoningTail]);

  if (!state.reasoningTail) return null;
  return (
    <details className="mt-2 group">
      <summary className="text-[11px] text-[var(--color-accent-strong)] cursor-pointer select-none hover:underline">
        💭 Voir la réflexion du modèle
      </summary>
      <div
        ref={ref}
        className="code-stream mt-2 max-h-32 overflow-y-auto rounded-lg bg-[var(--color-bg)] border border-[var(--color-accent)]/20 p-3 text-[11px] leading-relaxed text-[var(--color-accent)]/80 italic whitespace-pre-wrap"
      >
        {state.reasoningTail}
      </div>
    </details>
  );
}

/** Bouton Annuler avec confirmation (dialogue accessible, plus de confirm()). */
export function GenCancelButton({
  onCancel,
  className = "",
}: {
  onCancel: () => void;
  className?: string;
}) {
  const { confirmer } = useConfirm();
  return (
    <button
      onClick={async () => {
        if (
          await confirmer({
            title: "Abandonner cette génération ?",
            description: "Le travail en cours sera perdu, mais ta demande restera dans le chat.",
            confirmLabel: "Abandonner",
            danger: true,
          })
        ) {
          onCancel();
        }
      }}
      className={`text-[11px] text-slate-400 hover:text-white transition-colors ${className}`}
    >
      Annuler
    </button>
  );
}

/** Variante « bulle de chat » : l'IA travaille, dans le fil de discussion. */
export function GenerationBubble({ api }: { api: GenerationApi }) {
  const { state } = api;
  return (
    <div className="mr-auto max-w-[95%] w-full">
      <div className="card rounded-2xl rounded-bl-sm p-4 border-[var(--color-accent)]/30">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 text-sm font-medium min-w-0">
            <TypingDots />
            <span className="truncate">{phaseTitle(state)}…</span>
          </span>
          <span className="font-mono text-xs text-[var(--color-ink-dim)] tabular-nums shrink-0">
            {formatElapsed(state.elapsed)}
          </span>
        </div>

        <div className="mt-3">
          <GenSteps state={state} compact />
        </div>
        <GenActivityBar className="mt-2.5" />
        <GenStatusLine state={state} className="mt-2" />
        <GenReasoning state={state} />

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--color-border)]">
          <span className="text-[11px] text-[var(--color-ink-dim)]">
            Tu peux naviguer ailleurs — la génération continue sur le serveur, même si tu fermes
            l&apos;onglet.
          </span>
          <GenCancelButton onCancel={api.cancel} className="shrink-0 ml-3" />
        </div>
      </div>
    </div>
  );
}

/** Variante « pilule flottante » : génération en arrière-plan. */
export function GenerationPill({ api }: { api: GenerationApi }) {
  const { state } = api;
  const steps = stepsFor(state.mode);
  const current = steps[currentStepIndex(state)];
  return (
    <button
      onClick={api.restore}
      className="card px-4 py-3 border-[var(--color-accent)]/40 hover:border-[var(--color-accent)] transition-colors text-left w-72 block"
    >
      <span className="flex items-center gap-3">
        <Gamepad2 size={20} className="text-[var(--color-accent-strong)] animate-pulse" aria-hidden />
        <span className="text-sm min-w-0 flex-1">
          <span className="font-medium block truncate">{state.label}</span>
          <span className="text-xs text-[var(--color-ink-dim)]">
            {current.label}… · {formatElapsed(state.elapsed)}
          </span>
        </span>
      </span>
      <GenActivityBar className="mt-2" />
    </button>
  );
}
