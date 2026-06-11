"use client";

// Briques partagées entre le Studio d'un jeu existant (Studio.tsx), le Studio
// de création (/studio) et le panneau de génération : formatage, indicateur
// de frappe, bulle d'erreur, aperçu live, mini-markdown du chat.

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { GenerationApi } from "./GenerationProvider";
import CodeView from "./ui/CodeView";

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

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}

/**
 * Mini-rendu markdown des messages de l'assistant : **gras**, *italique*,
 * `code`. Volontairement minimal et sans HTML brut — tout le reste est du
 * texte. Suffisant pour les RÉSUMÉS du modèle, sans lib ni sanitisation.
 */
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Découpe sur les segments stylés ; le reste passe tel quel.
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const seg = m[0];
    if (seg.startsWith("**")) {
      out.push(<strong key={key++}>{seg.slice(2, -2)}</strong>);
    } else if (seg.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[0.85em]"
        >
          {seg.slice(1, -1)}
        </code>
      );
    } else {
      out.push(<em key={key++}>{seg.slice(1, -1)}</em>);
    }
    last = m.index! + seg.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
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
        <p className="text-sm font-medium text-red-300 mb-1">La génération a échoué</p>
        <p className="text-xs text-[var(--color-ink-dim)] whitespace-pre-wrap">{message}</p>
        <div className="flex gap-2 mt-3">
          <button onClick={onRetry} className="btn btn-primary text-xs px-3 py-1.5">
            <RefreshCw size={13} aria-hidden /> Réessayer
          </button>
          <button onClick={onDismiss} className="btn btn-ghost text-xs px-3 py-1.5">
            <X size={13} aria-hidden /> Ignorer
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
  const running = api.state.status === "running";

  useEffect(() => {
    if (!running || view !== "preview") return;
    setPreviewHtml(api.getFullCode());
    const t = setInterval(() => setPreviewHtml(api.getFullCode()), 2000);
    return () => clearInterval(t);
  }, [running, view, api]);

  if (view === "code") {
    return (
      <CodeView
        code={api.state.codeTail}
        streaming
        className="bg-[var(--color-bg)]"
      />
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
          <div className="text-4xl animate-bounce" aria-hidden>
            🎨
          </div>
          <p className="text-sm">
            {api.state.phase === "thinking" || api.state.phase === "connect"
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
