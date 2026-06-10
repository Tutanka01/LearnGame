"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Game } from "@/lib/db";

// Lecteur public : aucune connexion requise. C'est la page qu'ouvre un élève
// depuis un lien ou un QR code imprimé dans un support de cours.
export default function PublicPlayer({
  game,
  username,
}: {
  game: Omit<Game, "html">;
  username: string | null;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [result, setResult] = useState<{ score: number; max: number } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data;
      if (d?.type !== "learngame:complete") return;
      const score = Number(d.score);
      const maxScore = Number(d.maxScore);
      if (!Number.isFinite(score) || !Number.isFinite(maxScore)) return;

      setResult({ score, max: maxScore });
      if (username) {
        const res = await fetch(`/api/games/${game.id}/scores`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score, maxScore }),
        });
        if (res.ok) setSaved(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [game.id, username]);

  function fullscreen() {
    iframeRef.current?.requestFullscreen?.();
  }

  return (
    <main className="h-screen flex flex-col">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-md">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="shrink-0 font-bold tracking-tight text-sm sm:text-base">
              🎮 Learn<span className="text-[var(--color-accent)]">Game</span>
            </Link>
            <div className="w-px h-6 bg-[var(--color-border)] shrink-0 hidden sm:block" />
            <div className="min-w-0">
              <h1 className="font-semibold truncate text-sm sm:text-base">
                {game.title || game.topic}
              </h1>
              <p className="text-[11px] text-[var(--color-ink-dim)] truncate">
                <span className="capitalize">{game.difficulty}</span> · proposé par {game.author}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={fullscreen} className="btn btn-ghost hidden sm:inline-flex">
              ⛶ Plein écran
            </button>
            {username ? (
              <Link href={`/games/${game.id}`} className="btn btn-ghost">
                Ouvrir dans LearnGame
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary">
                Créer mon compte
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          src={`/api/p/${game.public_slug}/play?v=${game.version}`}
          sandbox="allow-scripts allow-pointer-lock"
          className="w-full h-full border-0 bg-white"
          title={game.title || game.topic}
        />

        {result && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 toast-in">
            <div className="card px-5 py-3.5 shadow-2xl flex items-center gap-4 border-[var(--color-accent)]/40">
              <span className="text-2xl" aria-hidden>
                🎉
              </span>
              <div className="text-sm">
                <p className="font-semibold">
                  Terminé ! Score : {result.score}/{result.max}
                </p>
                {username ? (
                  <p className="text-xs text-[var(--color-ink-dim)]">
                    {saved ? "Ton score est enregistré au classement." : "Enregistrement…"}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--color-ink-dim)]">
                    <Link href="/login" className="text-[var(--color-accent)] hover:underline">
                      Crée un compte
                    </Link>{" "}
                    pour enregistrer tes scores et entrer au classement.
                  </p>
                )}
              </div>
              <button
                onClick={() => setResult(null)}
                className="text-[var(--color-ink-dim)] hover:text-white text-sm px-1"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
