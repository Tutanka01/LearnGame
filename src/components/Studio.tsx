"use client";

// Le Studio : interface façon Lovable/v0 — conversation avec l'IA à gauche,
// jeu rendu à droite. Chaque demande crée une nouvelle version restaurable.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGeneration } from "./GenerationProvider";
import { WorkingBubble, ErrorBubble, LiveStream, TypingDots, formatWhen } from "./StudioShared";
import ShareModal from "./ShareModal";
import type { Game } from "@/lib/db";

interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
  version: number | null;
  created_at: string;
  username: string | null;
}

interface VersionInfo {
  version: number;
  title: string;
  created_at: string;
}

interface ScoreRow {
  username: string;
  score: number;
  max_score: number;
  created_at: string;
  user_id: number;
}

const QUICK_ACTIONS = [
  "➕ Ajoute un niveau supplémentaire",
  "🔥 Rends-le plus difficile",
  "🌱 Rends-le plus facile",
  "🎨 Améliore le design",
  "🧹 Raccourcis les explications",
];

export default function Studio({
  game,
  isOwner,
}: {
  game: Omit<Game, "html">;
  isOwner: boolean;
}) {
  const router = useRouter();
  const generation = useGeneration();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [msgsLoaded, setMsgsLoaded] = useState(false);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const [codeText, setCodeText] = useState("");

  const [boardOpen, setBoardOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [myId, setMyId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Génération : ce Studio est la surface d'affichage pour CE jeu ---------
  const genState = generation.state;
  const genIsMine =
    genState.request !== null && "gameId" in genState.request && genState.request.gameId === game.id;
  const busy = genState.status === "running" && genIsMine;
  const busyElsewhere = genState.status === "running" && !genIsMine;
  const genFailed = genState.status === "error" && genIsMine;

  const setEmbedded = generation.setEmbedded;
  useEffect(() => {
    if (genIsMine) setEmbedded(true);
  }, [genIsMine, setEmbedded]);
  useEffect(() => () => setEmbedded(false), [setEmbedded]);

  const showToast = useCallback((msg: string, ms = 4000) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }, []);

  // --- Données : messages, versions, scores ----------------------------------
  const loadMessages = useCallback(async () => {
    const res = await fetch(`/api/games/${game.id}/messages`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
      setVersions(data.versions);
      setPendingMsg(null);
    }
    setMsgsLoaded(true);
  }, [game.id]);

  const loadScores = useCallback(async () => {
    const res = await fetch(`/api/games/${game.id}/scores`);
    if (res.ok) {
      const data = await res.json();
      setScores(data.scores);
      setMyId(data.userId);
    }
  }, [game.id]);

  useEffect(() => {
    loadMessages();
    loadScores();
  }, [loadMessages, loadScores]);

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
        showToast(`🎉 Jeu terminé ! Score enregistré : ${score}/${maxScore}`, 5000);
        loadScores();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [game.id, loadScores, showToast]);

  // Chat collé en bas quand de nouveaux messages arrivent.
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages, pendingMsg, busy, genFailed, genState.phase, genState.statusMsg]);

  // Vue code : chargée à la demande, hors génération.
  useEffect(() => {
    if (tab !== "code" || busy) return;
    let alive = true;
    fetch(`/api/games/${game.id}/play?v=${game.version}-${reloadKey}`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => alive && setCodeText(t));
    return () => {
      alive = false;
    };
  }, [tab, busy, game.id, game.version, reloadKey]);

  // --- Actions ----------------------------------------------------------------
  function send(text?: string) {
    const msg = (text ?? input).trim();
    if (msg.length < 5 || genState.status === "running") return;
    const started = generation.start(
      { gameId: game.id, feedback: msg },
      {
        embedded: true,
        onDone: () => {
          setReloadKey((k) => k + 1);
          router.refresh();
          loadMessages();
          showToast("✨ Nouvelle version prête !");
        },
      }
    );
    if (started) {
      setPendingMsg(msg);
      setInput("");
      setTab("preview");
    }
  }

  async function restoreVersion(version: number) {
    if (!confirm(`Restaurer la version ${version} ? L'état actuel restera dans l'historique.`)) return;
    const res = await fetch(`/api/games/${game.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setReloadKey((k) => k + 1);
      router.refresh();
      loadMessages();
      showToast(`↩️ Version ${version} restaurée`);
    } else {
      showToast(data.error || "Impossible de restaurer cette version.");
    }
  }

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

  async function deleteGame() {
    if (!confirm("Supprimer définitivement ce jeu (et tout son historique) ?")) return;
    const res = await fetch(`/api/games/${game.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    }
  }

  const restorable = (m: Msg) =>
    isOwner &&
    m.role === "assistant" &&
    m.version !== null &&
    m.version < game.version &&
    versions.some((v) => v.version === m.version) &&
    genState.status !== "running";

  // --- Rendu -------------------------------------------------------------------
  return (
    <main className="h-screen flex flex-col">
      {toast && (
        <div className="fixed top-16 left-1/2 z-50 toast-in">
          <div className="card px-5 py-3 border-[var(--color-accent)]/50 shadow-2xl text-sm font-medium whitespace-nowrap">
            {toast}
          </div>
        </div>
      )}

      {shareOpen && (
        <ShareModal
          gameId={game.id}
          title={game.title || game.topic}
          isOwner={isOwner}
          initialPublic={Boolean(game.is_public)}
          initialSlug={game.public_slug}
          onClose={() => setShareOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Bascule Chat / Jeu sur mobile */}
      <div className="lg:hidden flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80">
        <Link href="/" className="btn btn-ghost text-xs px-2.5 py-1.5" aria-label="Retour">
          ←
        </Link>
        <div className="flex flex-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-0.5 text-xs">
          {(
            [
              ["chat", "💬 Discussion"],
              ["preview", "🕹 Jeu"],
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
        {/* ====================== Chat (gauche) ====================== */}
        <aside
          className={`${
            mobilePane === "chat" ? "flex" : "hidden"
          } lg:flex flex-col w-full lg:w-[400px] xl:w-[440px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]/50 min-h-0`}
        >
          <header className="hidden lg:flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            <Link href="/" className="btn btn-ghost shrink-0 px-2.5" aria-label="Retour à la bibliothèque">
              ←
            </Link>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate flex items-center gap-2">
                <span className="truncate">{game.title || game.topic}</span>
                {Boolean(game.is_public) && (
                  <span
                    className="shrink-0 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-medium"
                    title="Jeu public : jouable sans compte via son lien"
                  >
                    🌐
                  </span>
                )}
              </h1>
              <p className="text-[11px] text-[var(--color-ink-dim)] truncate">
                <span className="capitalize">{game.difficulty}</span> · par {game.author} · v
                {game.version}
              </p>
            </div>
          </header>

          {/* Messages */}
          <div ref={chatRef} className="flex-1 overflow-y-auto thin-scroll px-4 py-4 space-y-3">
            {!msgsLoaded ? (
              <>
                <div className="skeleton h-12 w-3/4 ml-auto rounded-2xl" />
                <div className="skeleton h-20 w-5/6 rounded-2xl" />
              </>
            ) : (
              <>
                {messages.length === 0 && (
                  <div className="mr-auto max-w-[95%] chat-ai px-4 py-3">
                    <p className="text-sm">
                      👋 Ce jeu a été créé sur le sujet « {game.topic} ». Dis-moi ce que tu veux
                      changer : ajouter un niveau, ajuster la difficulté, corriger quelque chose…
                    </p>
                  </div>
                )}
                {messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="ml-auto max-w-[85%]">
                      <div className="chat-user px-4 py-2.5">
                        <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                      </div>
                      <p className="text-[10px] text-[var(--color-ink-dim)] text-right mt-1 mr-1">
                        {m.username ?? "élève"} · {formatWhen(m.created_at)}
                      </p>
                    </div>
                  ) : (
                    <div key={m.id} className="mr-auto max-w-[95%]">
                      <div className="chat-ai px-4 py-3">
                        <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {m.version !== null && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                m.version === game.version
                                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                                  : "bg-[var(--color-bg)] border-[var(--color-border)] text-[var(--color-ink-dim)]"
                              }`}
                            >
                              v{m.version}
                              {m.version === game.version && " · actuelle"}
                            </span>
                          )}
                          {restorable(m) && (
                            <button
                              onClick={() => restoreVersion(m.version!)}
                              className="text-[10px] text-[var(--color-accent-strong)] hover:underline"
                            >
                              ↩️ Restaurer cette version
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-[var(--color-ink-dim)] mt-1 ml-1">
                        🤖 LearnGame · {formatWhen(m.created_at)}
                      </p>
                    </div>
                  )
                )}
                {pendingMsg && (busy || genFailed) && (
                  <div className="ml-auto max-w-[85%]">
                    <div className="chat-user px-4 py-2.5">
                      <p className="text-sm whitespace-pre-wrap">{pendingMsg}</p>
                    </div>
                  </div>
                )}
                {busy && <WorkingBubble state={genState} onCancel={generation.cancel} />}
                {genFailed && (
                  <ErrorBubble
                    message={genState.error}
                    onRetry={generation.retry}
                    onDismiss={() => {
                      generation.dismiss();
                      setPendingMsg(null);
                    }}
                  />
                )}
              </>
            )}
          </div>

          {/* Composeur */}
          <div className="border-t border-[var(--color-border)] p-3">
            <div className="flex gap-1.5 overflow-x-auto pb-2 thin-scroll">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => {
                    setInput(a.replace(/^\S+\s/, ""));
                    inputRef.current?.focus();
                  }}
                  disabled={genState.status === "running"}
                  className="shrink-0 px-2.5 py-1 rounded-full text-[11px] text-slate-300 bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40"
                >
                  {a}
                </button>
              ))}
            </div>
            <div className="card p-2 focus-within:border-[var(--color-accent)] transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                maxLength={1000}
                disabled={genState.status === "running"}
                placeholder={
                  busy
                    ? "L'IA travaille sur ta demande…"
                    : busyElsewhere
                      ? "Une autre génération est en cours…"
                      : "Décris ce que tu veux changer dans ce jeu…"
                }
                className="w-full bg-transparent resize-none px-2 py-1.5 text-sm focus:outline-none placeholder:text-[#5b6478] disabled:opacity-50"
              />
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-[var(--color-ink-dim)]">
                  Entrée pour envoyer · Maj+Entrée : saut de ligne
                </span>
                <button
                  onClick={() => send()}
                  disabled={input.trim().length < 5 || genState.status === "running"}
                  className="btn btn-primary px-3 py-1.5 text-xs"
                >
                  {busy ? "⏳" : "🪄 Envoyer"}
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* ====================== Aperçu (droite) ====================== */}
        <section
          className={`${
            mobilePane === "preview" ? "flex" : "hidden"
          } lg:flex flex-col flex-1 min-w-0 min-h-0`}
        >
          {/* Barre d'outils */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 flex-wrap">
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

            {tab === "preview" && !busy && (
              <div className="hidden sm:flex rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-0.5 text-xs">
                {(
                  [
                    ["desktop", "🖥"],
                    ["mobile", "📱"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setDevice(value)}
                    title={value === "desktop" ? "Vue ordinateur" : "Vue téléphone"}
                    className={`px-2.5 py-1.5 rounded-md transition-colors ${
                      device === value
                        ? "bg-[var(--color-surface-2)] text-white"
                        : "text-[var(--color-ink-dim)] hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <span
              className="px-2 py-1 rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] text-[10px] font-semibold text-[var(--color-ink-dim)]"
              title={`${versions.length} version${versions.length > 1 ? "s" : ""} archivée${versions.length > 1 ? "s" : ""}`}
            >
              v{game.version}
            </span>

            {busy && (
              <span className="px-2 py-1 rounded-full bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40 text-[10px] font-semibold text-[var(--color-accent-strong)]">
                ✍️ v{game.version + 1} en écriture…
              </span>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="btn btn-ghost px-2.5 py-1.5 text-xs"
                title="Recharger le jeu"
              >
                ↻
              </button>
              <button
                onClick={() => setBoardOpen((o) => !o)}
                className={`btn px-2.5 py-1.5 text-xs ${
                  boardOpen
                    ? "bg-amber-400/15 text-amber-300 border-amber-400/40"
                    : "btn-ghost"
                }`}
                aria-pressed={boardOpen}
                title="Classement"
              >
                🏆<span className="hidden xl:inline"> Classement</span>
              </button>
              <button onClick={() => setShareOpen(true)} className="btn btn-ghost px-2.5 py-1.5 text-xs" title="Partager">
                🌐<span className="hidden xl:inline"> Partager</span>
              </button>
              <button onClick={fullscreen} className="btn btn-ghost px-2.5 py-1.5 text-xs hidden sm:inline-flex" title="Plein écran">
                ⛶
              </button>
              <button onClick={downloadHtml} className="btn btn-ghost px-2.5 py-1.5 text-xs hidden sm:inline-flex" title="Télécharger le jeu (HTML autonome)">
                ⬇
              </button>
              {isOwner && (
                <button onClick={deleteGame} className="btn btn-danger px-2.5 py-1.5 text-xs" title="Supprimer ce jeu">
                  🗑
                </button>
              )}
            </div>
          </div>

          {/* Contenu */}
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 min-w-0 relative bg-[var(--color-bg)]">
              {busy && tab === "code" ? (
                // Pendant une modification : les retouches du modèle défilent ici.
                <LiveStream api={generation} view="code" />
              ) : busy ? (
                // Le jeu actuel reste jouable pendant que l'IA le retouche.
                <div className="relative w-full h-full">
                  <iframe
                    key={reloadKey}
                    ref={iframeRef}
                    src={`/api/games/${game.id}/play?v=${game.version}-${reloadKey}`}
                    sandbox="allow-scripts allow-pointer-lock"
                    className="w-full h-full border-0 bg-white"
                    title={game.title || game.topic}
                  />
                  <span className="absolute bottom-3 right-3 px-3 py-1.5 rounded-full bg-black/75 text-[11px] text-white flex items-center gap-2 pointer-events-none shadow-lg">
                    <TypingDots /> l&apos;IA modifie le jeu — la v{game.version} reste jouable
                  </span>
                </div>
              ) : tab === "code" ? (
                <div className="relative w-full h-full">
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(codeText);
                      showToast("📋 Code copié !");
                    }}
                    className="absolute top-3 right-5 z-10 btn btn-ghost text-xs px-2.5 py-1.5"
                  >
                    📋 Copier
                  </button>
                  <pre className="code-stream w-full h-full overflow-auto p-5 text-xs leading-relaxed text-emerald-300/80 font-mono whitespace-pre-wrap break-all">
                    {codeText || "Chargement du code…"}
                  </pre>
                </div>
              ) : device === "mobile" ? (
                <div className="w-full h-full flex items-center justify-center p-4">
                  <div className="w-[390px] max-w-full h-full max-h-[760px] rounded-[2rem] border-4 border-[var(--color-border-strong)] overflow-hidden shadow-2xl bg-white">
                    <iframe
                      key={reloadKey}
                      ref={iframeRef}
                      src={`/api/games/${game.id}/play?v=${game.version}-${reloadKey}`}
                      sandbox="allow-scripts allow-pointer-lock"
                      className="w-full h-full border-0"
                      title={game.title || game.topic}
                    />
                  </div>
                </div>
              ) : (
                <iframe
                  key={reloadKey}
                  ref={iframeRef}
                  src={`/api/games/${game.id}/play?v=${game.version}-${reloadKey}`}
                  sandbox="allow-scripts allow-pointer-lock"
                  className="w-full h-full border-0 bg-white"
                  title={game.title || game.topic}
                />
              )}
            </div>

            {boardOpen && (
              <aside className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto thin-scroll">
                <div className="p-4">
                  <h2 className="font-semibold text-sm mb-3">🏆 Classement</h2>
                  {scores.length === 0 ? (
                    <p className="text-xs text-[var(--color-ink-dim)]">
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
                              {isMe && <span className="text-[var(--color-ink-dim)]"> (toi)</span>}
                            </span>
                            <span className="text-xs text-[var(--color-ink-dim)] shrink-0">
                              {s.score}/{s.max_score}{" "}
                              <span className="text-[var(--color-accent-2)]">({pct}%)</span>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <p className="text-[11px] text-[var(--color-ink-dim)] mt-4">
                    Termine le jeu pour entrer au classement. Seul ton meilleur essai compte.
                  </p>
                </div>
              </aside>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
