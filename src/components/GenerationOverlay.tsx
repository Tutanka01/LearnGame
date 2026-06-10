"use client";

// UI de la génération : overlay plein écran (timeline de phases, onglets
// Réflexion / Code / Aperçu live) + pilule flottante quand il est minimisé.
// Toute la logique réseau vit dans GenerationProvider.

import { useEffect, useRef, useState } from "react";
import type { GenerationApi, GenerationPhase } from "./GenerationProvider";

const TIPS = [
  "💡 Tu pourras améliorer ce jeu après coup avec le bouton 🪄 : ajouter un niveau, simplifier, corriger…",
  "🌐 Un jeu partagé en public est jouable sans compte, via un lien ou un QR code.",
  "🏆 Seul ton meilleur score compte au classement — rejoue autant que tu veux.",
  "🧠 Le modèle « réfléchit » avant d'écrire le code : la conception peut prendre plusieurs minutes.",
  "📥 Chaque jeu se télécharge en fichier HTML autonome, jouable hors ligne.",
  "🎯 Plus ta demande est précise (« les jointures SQL avec des exemples »), meilleur sera le jeu.",
  "⏳ Tu peux passer la génération en arrière-plan et explorer la bibliothèque en attendant.",
];

const STEPS: { phase: GenerationPhase; icon: string; label: string }[] = [
  { phase: "thinking", icon: "💭", label: "Conception" },
  { phase: "coding", icon: "⚙️", label: "Programmation" },
  { phase: "validating", icon: "🔍", label: "Vérification" },
];

const PHASE_INDEX: Record<GenerationPhase, number> = {
  connect: -1,
  thinking: 0,
  coding: 1,
  validating: 2,
};

function formatElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function progressOf(phase: GenerationPhase, counts: { reasoning: number; code: number }): number {
  switch (phase) {
    case "connect":
      return 2;
    case "thinking":
      return 4 + Math.min((counts.reasoning / 30000) * 12, 12);
    case "coding":
      return 18 + Math.min(counts.code / 42000, 1) * 77;
    case "validating":
      return 97;
  }
}

type Tab = "reasoning" | "code" | "preview";

export default function GenerationOverlay({ api }: { api: GenerationApi }) {
  const { state } = api;
  const [tab, setTab] = useState<Tab>("reasoning");
  const tabPinned = useRef(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [previewHtml, setPreviewHtml] = useState("");
  const codeRef = useRef<HTMLPreElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);

  const running = state.status === "running";

  // L'onglet suit la phase, sauf si l'élève en a choisi un lui-même.
  useEffect(() => {
    if (!running || tabPinned.current) return;
    if (state.phase === "thinking") setTab("reasoning");
    else if (state.phase === "coding" || state.phase === "validating") setTab("code");
  }, [state.phase, running]);

  useEffect(() => {
    if (state.status === "idle") {
      tabPinned.current = false;
      setTab("reasoning");
      setPreviewHtml("");
    }
  }, [state.status]);

  // Conseils en rotation pendant l'attente.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 9000);
    return () => clearInterval(t);
  }, [running]);

  // Aperçu live : on régénère le srcDoc toutes les 2 s (pas à chaque chunk).
  useEffect(() => {
    if (!running || tab !== "preview") return;
    setPreviewHtml(api.getFullCode());
    const t = setInterval(() => setPreviewHtml(api.getFullCode()), 2000);
    return () => clearInterval(t);
  }, [running, tab, api]);

  useEffect(() => {
    codeRef.current?.scrollTo({ top: codeRef.current.scrollHeight });
  }, [state.codeTail]);

  useEffect(() => {
    reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight });
  }, [state.reasoningTail]);

  // Le Studio affiche la génération en ligne (chat + aperçu) : l'overlay se tait.
  if (state.status === "idle" || state.embedded) return null;

  // --- Pilule flottante (génération en arrière-plan) ------------------------
  if (state.minimized) {
    const pill =
      state.status === "done" ? (
        <button
          onClick={api.openResult}
          className="card flex items-center gap-3 px-4 py-3 border-emerald-500/50 hover:border-emerald-400 transition-colors text-left"
        >
          <span className="text-xl">🎉</span>
          <span className="text-sm">
            <span className="font-semibold text-emerald-300 block">Ton jeu est prêt !</span>
            <span className="text-xs text-[var(--color-ink-dim)]">
              {state.result?.title ?? state.label} — clique pour jouer
            </span>
          </span>
        </button>
      ) : state.status === "error" ? (
        <button
          onClick={api.restore}
          className="card flex items-center gap-3 px-4 py-3 border-red-500/50 hover:border-red-400 transition-colors text-left"
        >
          <span className="text-xl">😕</span>
          <span className="text-sm">
            <span className="font-semibold text-red-300 block">La génération a échoué</span>
            <span className="text-xs text-[var(--color-ink-dim)]">Clique pour voir le détail</span>
          </span>
        </button>
      ) : (
        <button
          onClick={api.restore}
          className="card px-4 py-3 border-[var(--color-accent)]/40 hover:border-[var(--color-accent)] transition-colors text-left w-72"
        >
          <span className="flex items-center gap-3">
            <span className="text-xl animate-pulse">🎮</span>
            <span className="text-sm min-w-0 flex-1">
              <span className="font-medium block truncate">{state.label}</span>
              <span className="text-xs text-[var(--color-ink-dim)]">
                {STEPS[Math.max(PHASE_INDEX[state.phase], 0)].label}… · ⏱{" "}
                {formatElapsed(state.elapsed)}
              </span>
            </span>
          </span>
          <span className="block h-1 mt-2 rounded-full bg-[var(--color-bg)] overflow-hidden">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] transition-all duration-1000"
              style={{ width: `${progressOf(state.phase, state.counts)}%` }}
            />
          </span>
        </button>
      );
    return <div className="fixed bottom-4 right-4 z-50 toast-in">{pill}</div>;
  }

  // --- Overlay plein écran ---------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-bg)]/95 backdrop-blur flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-3xl float-in">
        {state.status === "error" ? (
          <div className="card border-red-900/60 p-8 text-center">
            <div className="text-4xl mb-4">😕</div>
            <h2 className="text-xl font-semibold mb-2">La génération a échoué</h2>
            <p className="text-[var(--color-ink-dim)] text-sm mb-6 whitespace-pre-wrap max-w-xl mx-auto">
              {state.error}
            </p>
            <div className="flex justify-center gap-3">
              <button onClick={api.dismiss} className="btn btn-ghost px-6 py-2.5">
                Fermer
              </button>
              <button onClick={api.retry} className="btn btn-primary px-6 py-2.5">
                🔄 Réessayer
              </button>
            </div>
          </div>
        ) : state.status === "done" ? (
          <div className="card border-emerald-700/60 p-8 text-center">
            <div className="text-4xl mb-4">🎉</div>
            <h2 className="text-xl font-semibold mb-2">Ton jeu est prêt !</h2>
            <p className="text-[var(--color-ink-dim)] text-sm mb-6">{state.result?.title}</p>
            <button onClick={api.openResult} className="btn btn-primary px-6 py-2.5">
              ▶ Jouer maintenant
            </button>
          </div>
        ) : (
          <div className="card p-6 sm:p-8 pulse-glow">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-4 min-w-0">
                <div className="text-4xl animate-bounce">🎮</div>
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-semibold">
                    {state.request && "gameId" in state.request
                      ? "Amélioration de ton jeu…"
                      : "Création de ton jeu…"}
                  </h2>
                  <p className="text-sm text-[var(--color-ink-dim)] truncate">{state.label}</p>
                </div>
              </div>
              <span className="font-mono text-sm text-[var(--color-ink-dim)] shrink-0 tabular-nums">
                ⏱ {formatElapsed(state.elapsed)}
              </span>
            </div>

            {/* Timeline des phases */}
            <ol className="flex items-center gap-2 mb-4" aria-label="Étapes de la génération">
              {STEPS.map((step, i) => {
                const current = PHASE_INDEX[state.phase];
                const stepState = i < current ? "done" : i === current ? "active" : "pending";
                return (
                  <li key={step.phase} className="flex items-center gap-2 flex-1 min-w-0">
                    <span
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                        stepState === "active"
                          ? "bg-[var(--color-accent)]/20 text-[var(--color-accent-strong)] border border-[var(--color-accent)]/50"
                          : stepState === "done"
                            ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                            : "text-[var(--color-ink-dim)] border border-[var(--color-border)]"
                      }`}
                    >
                      <span>{stepState === "done" ? "✓" : step.icon}</span>
                      <span className="hidden sm:inline">{step.label}</span>
                    </span>
                    {i < STEPS.length - 1 && (
                      <span
                        className={`h-px flex-1 ${
                          i < current ? "bg-emerald-500/50" : "bg-[var(--color-border)]"
                        }`}
                      />
                    )}
                  </li>
                );
              })}
            </ol>

            <div className="h-1.5 rounded-full bg-[var(--color-bg)] overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] transition-all duration-1000"
                style={{ width: `${progressOf(state.phase, state.counts)}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--color-ink-dim)] mb-4 truncate">
              {state.statusMsg}
              {state.attempt > 1 && ` · tentative ${state.attempt}`}
            </p>

            {/* Onglets Réflexion / Code / Aperçu */}
            <div className="flex items-center gap-1 mb-2 text-xs" role="tablist">
              {(
                [
                  ["reasoning", "💭 Réflexion"],
                  ["code", state.mode === "edit" ? "🔧 Modifications" : "⌨️ Code"],
                  // L'aperçu live n'a de sens que pour un jeu écrit en entier.
                  ...(state.mode === "create" ? ([["preview", "👁 Aperçu live"]] as const) : []),
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => {
                    tabPinned.current = true;
                    setTab(value);
                  }}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    tab === value
                      ? "bg-[var(--color-surface-2)] text-white border border-[var(--color-border-strong)]"
                      : "text-[var(--color-ink-dim)] hover:text-white border border-transparent"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "reasoning" && (
              <div
                ref={reasoningRef}
                className="code-stream h-52 overflow-y-auto rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/30 p-4 text-xs leading-relaxed text-[var(--color-accent)]/90 italic whitespace-pre-wrap"
              >
                {state.reasoningTail ||
                  (state.phase === "connect"
                    ? "Connexion au modèle…"
                    : "Ce modèle écrit directement le code, sans réflexion visible.")}
              </div>
            )}
            {tab === "code" && (
              <pre
                ref={codeRef}
                className="code-stream h-52 overflow-y-auto rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] p-4 text-[11px] leading-relaxed text-emerald-300/80 font-mono whitespace-pre-wrap break-all"
              >
                {state.codeTail || "Le code arrivera ici dès que le modèle aura fini de réfléchir…"}
              </pre>
            )}
            {tab === "preview" && (
              <div className="h-52 rounded-xl overflow-hidden border border-[var(--color-border)] bg-white relative">
                {previewHtml ? (
                  <iframe
                    sandbox=""
                    srcDoc={previewHtml}
                    className="w-full h-full border-0 pointer-events-none"
                    title="Aperçu du jeu en cours de génération"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 bg-[var(--color-bg)]">
                    L&apos;aperçu apparaîtra dès les premières lignes de code…
                  </div>
                )}
                {previewHtml && (
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-[10px] text-white">
                    aperçu visuel — interactif à la fin
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
              <p className="text-xs text-slate-500 font-mono">
                {state.counts.reasoning > 0 && `💭 ${(state.counts.reasoning / 1000).toFixed(1)}k`}
                {state.counts.reasoning > 0 && state.counts.code > 0 && " · "}
                {state.counts.code > 0 && `⚙️ ${(state.counts.code / 1000).toFixed(1)}k car. de code`}
                {state.counts.reasoning === 0 && state.counts.code === 0 && "Démarrage…"}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={api.minimize} className="btn btn-ghost text-xs">
                  ⬇ Continuer en arrière-plan
                </button>
                <button
                  onClick={() => {
                    if (confirm("Abandonner cette génération ?")) api.cancel();
                  }}
                  className="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1"
                >
                  Annuler
                </button>
              </div>
            </div>

            <p className="text-xs text-[var(--color-ink-dim)] mt-4 pt-4 border-t border-[var(--color-border)] min-h-8">
              {TIPS[tipIndex]}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
