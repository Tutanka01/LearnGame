"use client";

import { useEffect, useRef, useState } from "react";

export type GenerationRequest =
  | { topic: string; difficulty: string }
  | { gameId: string; feedback: string };

export default function GenerationOverlay({
  request,
  onDone,
  onCancel,
}: {
  request: GenerationRequest;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [reasoning, setReasoning] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Connexion au modèle…");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [counts, setCounts] = useState({ reasoning: 0, code: 0 });
  const codeRef = useRef<HTMLPreElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const phase: "waiting" | "thinking" | "coding" = code
    ? "coding"
    : reasoning
      ? "thinking"
      : "waiting";

  // Pas de garde "déjà lancé" ici : en dev, React StrictMode monte le composant
  // deux fois (montage → démontage → montage). Le cleanup annule la 1re requête ;
  // un garde empêcherait la 2e de partir et l'écran resterait figé.
  useEffect(() => {
    const abort = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Erreur serveur (${res.status}).`);
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
                setStatus(event.message);
                break;
              case "reset":
                setReasoning("");
                setCode("");
                setCounts({ reasoning: 0, code: 0 });
                break;
              case "reasoning":
                setReasoning((r) => (r + event.text).slice(-3000));
                setCounts((c) => ({ ...c, reasoning: c.reasoning + event.text.length }));
                break;
              case "chunk":
                setCode((c) => (c + event.text).slice(-6000));
                setCounts((c) => ({ ...c, code: c.code + event.text.length }));
                break;
              case "done":
                onDone(event.id);
                return;
              case "error":
                setError(event.message);
                return;
            }
          }
        }
        setError("La connexion s'est interrompue avant la fin. Réessaie.");
      } catch (err) {
        if (!abort.signal.aborted) {
          setError(err instanceof Error ? err.message : "Erreur réseau.");
        }
      }
    })();

    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    codeRef.current?.scrollTo({ top: codeRef.current.scrollHeight });
  }, [code]);

  useEffect(() => {
    reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight });
  }, [reasoning]);

  const phaseLabel = {
    waiting: "⏳ Connexion au modèle…",
    thinking: "💭 L'IA analyse le sujet et conçoit la pédagogie…",
    coding: "⚙️ L'IA programme ton jeu…",
  }[phase];

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-bg)]/95 backdrop-blur flex items-center justify-center p-6">
      <div className="w-full max-w-2xl float-in">
        {error ? (
          <div className="bg-[var(--color-surface)] border border-red-900/60 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-4">😕</div>
            <h2 className="text-xl font-semibold mb-2">La génération a échoué</h2>
            <p className="text-slate-400 text-sm mb-6 whitespace-pre-wrap">{error}</p>
            <button
              onClick={onCancel}
              className="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] hover:bg-[#8d7fff] font-medium transition-colors"
            >
              Retour
            </button>
          </div>
        ) : (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8 pulse-glow">
            <div className="flex items-center gap-4 mb-5">
              <div className="text-4xl animate-bounce">🎮</div>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold">Création de ton jeu…</h2>
                <p className="text-slate-400 text-sm mt-1">{phaseLabel}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">{status}</p>
              </div>
            </div>

            <div className="h-1.5 rounded-full bg-[var(--color-bg)] overflow-hidden mb-5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] transition-all duration-1000"
                style={{
                  width:
                    phase === "coding"
                      ? `${Math.min(20 + (code.length / 45000) * 76, 96)}%`
                      : phase === "thinking"
                        ? "12%"
                        : "4%",
                }}
              />
            </div>

            {/* Réflexion du modèle (modèles à raisonnement type Gemini/o-series) */}
            {reasoning && phase === "thinking" && (
              <div
                ref={reasoningRef}
                className="code-stream h-40 overflow-y-auto rounded-xl bg-[var(--color-bg)] border border-[var(--color-accent)]/30 p-4 text-xs leading-relaxed text-[var(--color-accent)]/90 italic whitespace-pre-wrap mb-2"
              >
                {reasoning}
              </div>
            )}

            {/* Code du jeu en cours d'écriture */}
            {(phase === "coding" || !reasoning) && (
              <pre
                ref={codeRef}
                className="code-stream h-44 overflow-y-auto rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] p-4 text-[11px] leading-relaxed text-emerald-300/80 font-mono whitespace-pre-wrap break-all"
              >
                {code || "En attente du modèle…"}
              </pre>
            )}

            <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
              <p className="text-xs text-slate-500 font-mono">
                ⏱ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
                {counts.reasoning > 0 && ` · 💭 ${(counts.reasoning / 1000).toFixed(1)}k`}
                {counts.code > 0 && ` · ⚙️ ${(counts.code / 1000).toFixed(1)}k car. de code`}
              </p>
              <p className="text-xs text-slate-500">Un bon jeu prend 1 à 3 minutes 😉</p>
              <button
                onClick={onCancel}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
