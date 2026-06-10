"use client";

// Atelier de création : on y atterrit dès qu'une génération est lancée depuis
// l'accueil (façon Lovable). Chat à gauche (demande + IA au travail), aperçu
// live à droite. À la fin, redirection vers le Studio du jeu créé.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGeneration } from "@/components/GenerationProvider";
import { WorkingBubble, ErrorBubble, LiveStream } from "@/components/StudioShared";

export default function StudioNewPage() {
  const router = useRouter();
  const generation = useGeneration();
  const { state } = generation;
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("preview");
  const navigated = useRef(false);

  const setEmbedded = generation.setEmbedded;
  useEffect(() => {
    setEmbedded(true);
    return () => setEmbedded(false);
  }, [setEmbedded]);

  // Fin de génération → Studio du jeu. Pas de génération → retour accueil.
  useEffect(() => {
    if (navigated.current) return;
    if (state.status === "done" && state.result) {
      navigated.current = true;
      const id = state.result.id;
      router.replace(`/games/${id}`);
      generation.dismiss();
    } else if (state.status === "idle") {
      navigated.current = true;
      router.replace("/");
    }
  }, [state.status, state.result, router, generation]);

  const isNew = state.request !== null && "topic" in state.request;
  if (!isNew || state.status === "idle" || state.status === "done") {
    return (
      <main className="h-screen flex items-center justify-center">
        <div className="text-center float-in">
          <div className="text-4xl mb-3 animate-bounce">🎮</div>
          <p className="text-[var(--color-ink-dim)]">Ouverture du Studio…</p>
        </div>
      </main>
    );
  }

  const difficulty =
    state.request && "difficulty" in state.request ? state.request.difficulty : "";

  return (
    <main className="h-screen flex flex-col">
      {/* Bascule Chat / Aperçu sur mobile */}
      <div className="lg:hidden flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80">
        <Link href="/" className="btn btn-ghost text-xs px-2.5 py-1.5" aria-label="Retour">
          ←
        </Link>
        <div className="flex flex-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-0.5 text-xs">
          {(
            [
              ["chat", "💬 Discussion"],
              ["preview", "🕹 Aperçu"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMobilePane(value)}
              className={`flex-1 px-3 py-1.5 rounded-md font-medium transition-colors ${
                mobilePane === value
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-ink-dim)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Chat (gauche) */}
        <aside
          className={`${
            mobilePane === "chat" ? "flex" : "hidden"
          } lg:flex flex-col w-full lg:w-[400px] xl:w-[440px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]/50 min-h-0`}
        >
          <header className="hidden lg:flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            <Link
              href="/"
              className="btn btn-ghost shrink-0 px-2.5"
              aria-label="Retour à la bibliothèque"
              title="La génération continuera en arrière-plan"
            >
              ←
            </Link>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm">✨ Nouveau jeu</h1>
              <p className="text-[11px] text-[var(--color-ink-dim)] truncate capitalize">
                {difficulty}
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto thin-scroll px-4 py-4 space-y-3">
            <div className="ml-auto max-w-[85%]">
              <div className="chat-user px-4 py-2.5">
                <p className="text-sm whitespace-pre-wrap">{state.label}</p>
              </div>
            </div>

            {state.status === "running" && (
              <WorkingBubble state={state} onCancel={generation.cancel} />
            )}
            {state.status === "error" && (
              <ErrorBubble
                message={state.error}
                onRetry={generation.retry}
                onDismiss={generation.cancel}
              />
            )}
          </div>

          <div className="border-t border-[var(--color-border)] p-3">
            <p className="text-[11px] text-[var(--color-ink-dim)] px-1">
              💬 Dès que ton jeu sera prêt, tu pourras discuter avec l&apos;IA ici pour
              l&apos;améliorer version après version.
            </p>
          </div>
        </aside>

        {/* Aperçu (droite) */}
        <section
          className={`${
            mobilePane === "preview" ? "flex" : "hidden"
          } lg:flex flex-col flex-1 min-w-0 min-h-0`}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60">
            <div className="flex rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-0.5 text-xs">
              {(
                [
                  ["preview", "🕹 Aperçu"],
                  ["code", "⌨️ Code"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    tab === value
                      ? "bg-[var(--color-surface-2)] text-white"
                      : "text-[var(--color-ink-dim)] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {state.status === "running" && (
              <span className="px-2 py-1 rounded-full bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40 text-[10px] font-semibold text-[var(--color-accent-strong)]">
                ✍️ v1 en écriture…
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <LiveStream api={generation} view={tab} />
          </div>
        </section>
      </div>
    </main>
  );
}
