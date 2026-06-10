"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import GenerationOverlay from "./GenerationOverlay";
import type { Game } from "@/lib/db";

interface ScoreRow {
  username: string;
  score: number;
  max_score: number;
  created_at: string;
  user_id: number;
}

export default function GamePlayer({
  game,
  isOwner,
}: {
  game: Omit<Game, "html">;
  isOwner: boolean;
}) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [improveOpen, setImproveOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [improving, setImproving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [boardOpen, setBoardOpen] = useState(false);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [myId, setMyId] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const loadScores = useCallback(async () => {
    const res = await fetch(`/api/games/${game.id}/scores`);
    if (res.ok) {
      const data = await res.json();
      setScores(data.scores);
      setMyId(data.userId);
    }
  }, [game.id]);

  useEffect(() => {
    loadScores();
  }, [loadScores]);

  // Le jeu envoie son score via postMessage quand l'élève termine.
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data;
      if (d?.type !== "learngame:complete") return;
      const score = Number(d.score);
      const maxScore = Number(d.maxScore);
      if (!Number.isFinite(score) || !Number.isFinite(maxScore)) return;

      const res = await fetch(`/api/games/${game.id}/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, maxScore }),
      });
      if (res.ok) {
        setToast(`🎉 Jeu terminé ! Score enregistré : ${score}/${maxScore}`);
        setTimeout(() => setToast(""), 5000);
        loadScores();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [game.id, loadScores]);

  function fullscreen() {
    iframeRef.current?.requestFullscreen?.();
  }

  async function downloadHtml() {
    const res = await fetch(`/api/games/${game.id}/play`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(game.title || game.topic).replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setToast("🔗 Lien copié !");
    setTimeout(() => setToast(""), 2500);
  }

  async function deleteGame() {
    if (!confirm("Supprimer définitivement ce jeu ?")) return;
    const res = await fetch(`/api/games/${game.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main className="h-screen flex flex-col bg-[var(--color-bg)]">
      {improving && (
        <GenerationOverlay
          request={{ gameId: game.id, feedback }}
          onDone={() => {
            setImproving(false);
            setImproveOpen(false);
            setFeedback("");
            setReloadKey((k) => k + 1);
            router.refresh();
          }}
          onCancel={() => setImproving(false)}
        />
      )}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-accent)]/50 shadow-2xl text-sm font-medium float-in">
          {toast}
        </div>
      )}

      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="shrink-0 px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-[var(--color-bg)] border border-[var(--color-border)] transition-colors"
            >
              ← Retour
            </Link>
            <div className="min-w-0">
              <h1 className="font-semibold truncate text-sm sm:text-base">
                {game.title || game.topic}
              </h1>
              <p className="text-[11px] text-slate-500 truncate">
                {game.topic} · <span className="capitalize">{game.difficulty}</span> · par{" "}
                {game.author}
                {game.version > 1 && ` · v${game.version}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setBoardOpen((o) => !o)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                boardOpen
                  ? "bg-amber-400/15 text-amber-300 border-amber-400/40"
                  : "text-slate-300 hover:text-white bg-[var(--color-bg)] border-[var(--color-border)]"
              }`}
            >
              🏆 Classement
            </button>
            <button
              onClick={() => setImproveOpen(true)}
              className="px-3 py-1.5 rounded-lg text-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/25 transition-colors"
            >
              🪄 Améliorer
            </button>
            <button
              onClick={fullscreen}
              className="hidden sm:block px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-[var(--color-bg)] border border-[var(--color-border)] transition-colors"
            >
              ⛶ Plein écran
            </button>
            <button
              onClick={copyLink}
              className="hidden sm:block px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-[var(--color-bg)] border border-[var(--color-border)] transition-colors"
              title="Copier le lien du jeu"
            >
              🔗
            </button>
            <button
              onClick={downloadHtml}
              className="hidden sm:block px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-[var(--color-bg)] border border-[var(--color-border)] transition-colors"
              title="Télécharger le jeu (fichier HTML autonome)"
            >
              ⬇
            </button>
            {isOwner && (
              <button
                onClick={deleteGame}
                className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 bg-[var(--color-bg)] border border-[var(--color-border)] transition-colors"
                title="Supprimer ce jeu"
              >
                🗑
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={`/api/games/${game.id}/play?v=${game.version}-${reloadKey}`}
          sandbox="allow-scripts allow-pointer-lock"
          className="flex-1 w-full border-0 bg-white"
          title={game.title || game.topic}
        />

        {boardOpen && (
          <aside className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto">
            <div className="p-4">
              <h2 className="font-semibold text-sm mb-3">🏆 Classement</h2>
              {scores.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Personne n&apos;a encore terminé ce jeu. Sois le premier ou la première !
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {scores.map((s, i) => {
                    const pct = Math.round((s.score / Math.max(s.max_score, 1)) * 100);
                    const isMe = s.user_id === myId;
                    return (
                      <li
                        key={s.user_id}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${
                          isMe
                            ? "bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40"
                            : "bg-[var(--color-bg)]"
                        }`}
                      >
                        <span className="w-6 text-center shrink-0">
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                        </span>
                        <span className="flex-1 truncate">
                          {s.username}
                          {isMe && <span className="text-slate-400"> (toi)</span>}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0">
                          {s.score}/{s.max_score}{" "}
                          <span className="text-[var(--color-accent-2)]">({pct}%)</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <p className="text-[11px] text-slate-500 mt-4">
                Termine le jeu pour entrer au classement. Seul ton meilleur essai compte.
              </p>
            </div>
          </aside>
        )}
      </div>

      {improveOpen && !improving && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setImproveOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 float-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1">🪄 Améliorer ce jeu</h2>
            <p className="text-sm text-slate-400 mb-4">
              Décris ce que tu veux changer : ajouter un niveau, simplifier, corriger quelque chose,
              changer la mécanique…
            </p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              maxLength={1000}
              autoFocus
              placeholder='Ex : "Ajoute un niveau sur les ports TCP célèbres" ou "Le niveau 2 est trop dur"'
              className="w-full px-4 py-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none resize-none transition-colors"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setImproveOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-300 hover:text-white transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => feedback.trim().length >= 5 && setImproving(true)}
                disabled={feedback.trim().length < 5}
                className="px-5 py-2 rounded-xl bg-[var(--color-accent)] hover:bg-[#8d7fff] disabled:opacity-40 text-sm font-semibold transition-colors"
              >
                Lancer l&apos;amélioration
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
