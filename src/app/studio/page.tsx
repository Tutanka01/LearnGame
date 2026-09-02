"use client";

// Atelier de création : on y atterrit dès qu'une génération est lancée depuis
// l'accueil (façon Lovable). Chat à gauche (demande + IA au travail), aperçu
// live à droite. À la fin, redirection vers le Studio du jeu créé.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGeneration } from "@/components/GenerationProvider";
import { ErrorBubble, LiveStream } from "@/components/StudioShared";
import { GenerationBubble } from "@/components/GenerationPanel";
import { Code2, Gamepad2, MessageSquare } from "lucide-react";
import Segmented from "@/components/ui/Segmented";

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
  // On attend `bootstrapped` : après un F5, le provider va d'abord récupérer
  // le job actif côté serveur et raccrocher le flux — ne pas rediriger avant.
  useEffect(() => {
    if (navigated.current || !generation.bootstrapped) return;
    if (state.status === "done" && state.result) {
      navigated.current = true;
      const id = state.result.id;
      router.replace(`/games/${id}`);
      generation.dismiss();
    } else if (state.status === "idle") {
      navigated.current = true;
      router.replace("/");
    }
  }, [state.status, state.result, router, generation, generation.bootstrapped]);

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
        <Segmented
          className="flex-1 [&_.seg-item]:flex-1"
          ariaLabel="Discussion ou aperçu"
          size="sm"
          tone="accent"
          value={mobilePane}
          onChange={setMobilePane}
          options={[
            { value: "chat", label: "Discussion", icon: MessageSquare },
            { value: "preview", label: "Aperçu", icon: Gamepad2 },
          ]}
        />
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

            {state.status === "running" && <GenerationBubble api={generation} />}
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
            <Segmented
              size="sm"
              ariaLabel="Aperçu ou code"
              role="radiogroup"
              value={tab}
              onChange={setTab}
              options={[
                { value: "preview", label: "Aperçu", icon: Gamepad2 },
                { value: "code", label: "Code", icon: Code2 },
              ]}
            />
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
