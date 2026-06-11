"use client";

// Vue code unique de l'application : coloration syntaxique shiki chargée à la
// demande (hors bundle initial), avec repli <pre> brut tant qu'elle charge.
// En mode streaming, le texte reste brut (perf) et suit le bas automatiquement ;
// la coloration complète s'applique dès que le flux est terminé.

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

type Highlighter = { codeToHtml: (code: string, opts: object) => string };
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme, html] =
      await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        import("@shikijs/themes/one-dark-pro"),
        import("@shikijs/langs/html"),
      ]);
    return createHighlighterCore({
      themes: [theme.default],
      langs: [html.default],
      engine: createJavaScriptRegexEngine(),
    }) as Promise<Highlighter>;
  })();
  return highlighterPromise;
}

const MAX_HIGHLIGHT_LENGTH = 300_000; // au-delà, on reste en texte brut

export default function CodeView({
  code,
  streaming = false,
  copyable = false,
  onCopied,
  className = "",
}: {
  code: string;
  /** Flux en cours : pas de coloration, défilement collé en bas. */
  streaming?: boolean;
  copyable?: boolean;
  onCopied?: () => void;
  className?: string;
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Coloration (hors streaming) : asynchrone, annulable, repli silencieux.
  useEffect(() => {
    if (streaming || !code || code.length > MAX_HIGHLIGHT_LENGTH) {
      setHighlighted(null);
      return;
    }
    let alive = true;
    getHighlighter()
      .then((hl) => {
        if (!alive) return;
        setHighlighted(hl.codeToHtml(code, { lang: "html", theme: "one-dark-pro" }));
      })
      .catch(() => setHighlighted(null));
    return () => {
      alive = false;
    };
  }, [code, streaming]);

  // Streaming : on suit le bas du flux.
  useEffect(() => {
    if (!streaming) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [code, streaming]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // presse-papiers indisponible (iframe, permissions…)
    }
  }

  return (
    <div className={`relative w-full h-full min-h-0 ${className}`}>
      {copyable && code && !streaming && (
        <button
          onClick={copy}
          className="absolute top-3 right-5 z-10 btn btn-ghost text-xs px-2.5 py-1.5"
          aria-label="Copier le code"
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? "Copié" : "Copier"}
        </button>
      )}
      <div ref={scrollRef} className="code-stream w-full h-full overflow-auto">
        {highlighted && !streaming ? (
          // HTML produit par shiki à partir du code du jeu (échappé par shiki).
          <div className="code-shiki text-xs" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre
            className={`p-5 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all ${
              streaming ? "text-emerald-300/80" : "text-slate-300"
            }`}
          >
            {code ||
              (streaming
                ? "Le code arrivera ici dès que le modèle aura fini de réfléchir…"
                : "Chargement du code…")}
          </pre>
        )}
      </div>
    </div>
  );
}
