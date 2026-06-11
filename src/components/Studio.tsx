"use client";

// Le Studio : interface façon Lovable — conversation avec l'IA à gauche,
// jeu rendu à droite, panneaux redimensionnables. Chaque demande crée une
// nouvelle version restaurable ; la génération vit côté serveur (jobs).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowLeft,
  Check,
  Code2,
  Download,
  Gamepad2,
  Globe,
  History,
  Maximize,
  MessageSquare,
  Monitor,
  Pencil,
  RotateCw,
  Send,
  Smartphone,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { useGeneration } from "./GenerationProvider";
import { ErrorBubble, LiveStream, formatWhen, renderInlineMarkdown } from "./StudioShared";
import { GenerationBubble } from "./GenerationPanel";
import ShareModal from "./ShareModal";
import CodeView from "./ui/CodeView";
import VersionsTimeline, { VersionEntry } from "./VersionsTimeline";
import { useToast } from "./ui/ToastProvider";
import { useConfirm } from "./ui/ConfirmDialog";
import { apiFetch, HttpError } from "@/lib/clientApi";
import type { Game } from "@/lib/db";

interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
  version: number | null;
  kind: "chat" | "restore" | "error" | "cancelled";
  job_id: string | null;
  created_at: string;
  username: string | null;
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

const KIND_PREFIX: Record<Msg["kind"], string> = {
  chat: "",
  restore: "↩️ ",
  error: "⚠️ ",
  cancelled: "🚫 ",
};

export default function Studio({
  game,
  isOwner,
}: {
  game: Omit<Game, "html">;
  isOwner: boolean;
}) {
  const router = useRouter();
  const generation = useGeneration();
  const { toast } = useToast();
  const { confirmer } = useConfirm();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [msgsLoaded, setMsgsLoaded] = useState(false);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const [codeText, setCodeText] = useState("");

  const [sidePanel, setSidePanel] = useState<"none" | "board" | "history">("none");
  const [shareOpen, setShareOpen] = useState(false);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [myId, setMyId] = useState<number | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(game.title || game.topic);

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

  // --- Données : messages, versions, scores ----------------------------------
  const loadMessages = useCallback(async () => {
    // La conversation est privée : seul le créateur peut la lire.
    if (!isOwner) {
      setMsgsLoaded(true);
      return;
    }
    try {
      const data = await apiFetch<{ messages: Msg[]; versions: VersionEntry[] }>(
        `/api/games/${game.id}/messages`
      );
      setMessages(data.messages);
      setVersions(data.versions);
      setPendingMsg(null);
    } catch (err) {
      if (err instanceof HttpError && err.status !== 401) {
        toast("Impossible de charger la conversation.", "error");
      }
    } finally {
      setMsgsLoaded(true);
    }
  }, [game.id, isOwner, toast]);

  const loadScores = useCallback(async () => {
    try {
      const data = await apiFetch<{ scores: ScoreRow[]; userId: number }>(
        `/api/games/${game.id}/scores`
      );
      setScores(data.scores);
      setMyId(data.userId);
    } catch {
      // le classement n'est pas critique : pas de toast
    }
  }, [game.id]);

  useEffect(() => {
    loadMessages();
    loadScores();
  }, [loadMessages, loadScores]);

  // Comptage des parties : un beacon au chargement du Studio (le serveur
  // limite à une partie par 30 s — recharger l'iframe ne gonfle pas le compteur).
  useEffect(() => {
    fetch(`/api/games/${game.id}/plays`, { method: "POST" }).catch(() => {});
  }, [game.id]);

  // Le jeu envoie son score via postMessage quand l'élève termine.
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data;
      if (d?.type !== "learngame:complete") return;
      const score = Number(d.score);
      const maxScore = Number(d.maxScore);
      if (!Number.isFinite(score) || !Number.isFinite(maxScore)) return;

      try {
        await apiFetch(`/api/games/${game.id}/scores`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score, maxScore }),
        });
        toast(`🎉 Jeu terminé ! Score enregistré : ${score}/${maxScore}`, "success", 5000);
        loadScores();
      } catch {
        // score non enregistré (réseau) : le jeu reste jouable, pas d'alarme
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [game.id, loadScores, toast]);

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

  // Composeur : hauteur adaptée au contenu (jusqu'à ~6 lignes).
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // --- Actions ----------------------------------------------------------------
  function send(text?: string) {
    const msg = (text ?? input).trim();
    if (msg.length < 5 || genState.status === "running") return;
    const started = generation.start(
      { gameId: game.id, feedback: msg },
      {
        embedded: true,
        // La demande est persistée dès l'acceptation du job : on recharge le
        // chat (pendingMsg n'est qu'un affichage optimiste en attendant).
        onStarted: () => loadMessages(),
        onDone: () => {
          setReloadKey((k) => k + 1);
          router.refresh();
          loadMessages();
          toast("✨ Nouvelle version prête !", "success");
        },
      }
    );
    if (started) {
      setPendingMsg(msg);
      setInput("");
      setTab("preview");
      requestAnimationFrame(autoResize);
    }
  }

  async function restoreVersion(version: number) {
    const ok = await confirmer({
      title: `Restaurer la version ${version} ?`,
      description: "L'état actuel restera dans l'historique — rien ne sera perdu.",
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/games/${game.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      setReloadKey((k) => k + 1);
      router.refresh();
      loadMessages();
      toast(`Version ${version} restaurée`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Impossible de restaurer cette version.", "error");
    }
  }

  async function renameTitle() {
    const title = titleDraft.trim();
    setEditingTitle(false);
    if (!title || title === (game.title || game.topic)) {
      setTitleDraft(game.title || game.topic);
      return;
    }
    try {
      await apiFetch(`/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      router.refresh();
      toast("Titre mis à jour", "success");
    } catch (err) {
      setTitleDraft(game.title || game.topic);
      toast(err instanceof Error ? err.message : "Renommage impossible.", "error");
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
    const ok = await confirmer({
      title: "Supprimer définitivement ce jeu ?",
      description: "Toutes ses versions, sa conversation et ses scores seront perdus.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/games/${game.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Suppression impossible.", "error");
    }
  }

  const restorable = (m: Msg) =>
    isOwner &&
    m.role === "assistant" &&
    m.version !== null &&
    m.version < game.version &&
    versions.some((v) => v.version === m.version) &&
    genState.status !== "running";

  const toolButton = "btn btn-ghost px-2.5 py-1.5 text-xs";

  // --- Rendu -------------------------------------------------------------------
  return (
    <main className="h-screen flex flex-col">
      {shareOpen && (
        <ShareModal
          gameId={game.id}
          title={game.title || game.topic}
          isOwner={isOwner}
          initialPublic={Boolean(game.is_public)}
          initialSlug={game.public_slug}
          onClose={() => setShareOpen(false)}
          onToast={(msg) => toast(msg, "success")}
        />
      )}

      {/* Bascule Chat / Jeu sur mobile */}
      <div className="lg:hidden flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80">
        <Link href="/" className="btn btn-ghost text-xs px-2.5 py-1.5" aria-label="Retour">
          <ArrowLeft size={14} />
        </Link>
        <div className="flex flex-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-0.5 text-xs">
          {(
            [
              ["chat", "Discussion", MessageSquare],
              ["preview", "Jeu", Gamepad2],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => setMobilePane(value)}
              className={`flex-1 px-3 py-2 rounded-md font-medium transition-colors inline-flex items-center justify-center gap-1.5 ${
                mobilePane === value
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-ink-dim)]"
              }`}
            >
              <Icon size={13} aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>

      <PanelGroup direction="horizontal" autoSaveId="lg-studio-panels" className="flex-1 min-h-0">
        {/* ====================== Chat (gauche) ====================== */}
        <Panel
          defaultSize={32}
          minSize={24}
          maxSize={55}
          className={`${mobilePane === "chat" ? "flex" : "hidden"} lg:flex min-h-0`}
        >
          <aside className="flex flex-col w-full min-h-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]/50">
            <header className="hidden lg:flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
              <Link
                href="/"
                className="btn btn-ghost shrink-0 px-2.5"
                aria-label="Retour à la bibliothèque"
              >
                <ArrowLeft size={15} />
              </Link>
              <div className="min-w-0 flex-1">
                {editingTitle ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameTitle();
                        if (e.key === "Escape") {
                          setEditingTitle(false);
                          setTitleDraft(game.title || game.topic);
                        }
                      }}
                      autoFocus
                      maxLength={120}
                      className="field text-sm py-1 px-2 flex-1 min-w-0"
                      aria-label="Nouveau titre du jeu"
                    />
                    <button
                      onClick={renameTitle}
                      className="btn btn-primary p-1.5"
                      aria-label="Valider le titre"
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ) : (
                  <h1 className="font-semibold text-sm truncate flex items-center gap-2 group">
                    <span className="truncate">{game.title || game.topic}</span>
                    {Boolean(game.is_public) && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-medium inline-flex items-center gap-1"
                        title="Jeu public : jouable sans compte via son lien"
                      >
                        <Globe size={9} aria-hidden /> public
                      </span>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => setEditingTitle(true)}
                        className="shrink-0 p-1 rounded-md text-[var(--color-ink-dim)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-[var(--color-surface-2)] transition-all"
                        aria-label="Renommer le jeu"
                        title="Renommer"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </h1>
                )}
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
                        {isOwner
                          ? `👋 Ce jeu a été créé sur le sujet « ${game.topic} ». Dis-moi ce que tu veux changer : ajouter un niveau, ajuster la difficulté, corriger quelque chose…`
                          : `🎮 Un jeu de ${game.author} sur « ${game.topic} ». Joue-le à droite et tente le meilleur score — seul son créateur peut le modifier.`}
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
                        <div
                          className={`chat-ai px-4 py-3 ${
                            m.kind === "error"
                              ? "border-red-900/60"
                              : m.kind === "cancelled"
                                ? "opacity-70"
                                : ""
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">
                            {KIND_PREFIX[m.kind]}
                            {renderInlineMarkdown(m.content)}
                          </p>
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
                  {busy && <GenerationBubble api={generation} />}
                  {genFailed && (
                    <ErrorBubble
                      message={genState.error}
                      onRetry={generation.retry}
                      onDismiss={() => {
                        generation.dismiss();
                        setPendingMsg(null);
                        // L'échec est aussi consigné en base : on l'affiche.
                        loadMessages();
                      }}
                    />
                  )}
                </>
              )}
            </div>

            {/* Composeur — réservé au créateur (le serveur refuse de toute façon). */}
            {!isOwner ? (
              <div className="border-t border-[var(--color-border)] p-4">
                <p className="text-[11px] text-[var(--color-ink-dim)]">
                  🔒 Seul {game.author} peut modifier ce jeu. Joue et grimpe au classement !
                </p>
              </div>
            ) : (
              <div className="border-t border-[var(--color-border)] p-3">
                <div className="flex gap-1.5 overflow-x-auto pb-2 thin-scroll">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a}
                      onClick={() => {
                        setInput(a.replace(/^\S+\s/, ""));
                        inputRef.current?.focus();
                        requestAnimationFrame(autoResize);
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
                    onChange={(e) => {
                      setInput(e.target.value);
                      autoResize();
                    }}
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
                      <Send size={12} aria-hidden /> Envoyer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </Panel>

        <PanelResizeHandle className="resize-handle hidden lg:block" aria-label="Redimensionner les panneaux" />

        {/* ====================== Aperçu (droite) ====================== */}
        <Panel
          className={`${mobilePane === "preview" ? "flex" : "hidden"} lg:flex flex-col min-w-0 min-h-0`}
        >
          <section className="flex flex-col w-full min-h-0">
            {/* Barre d'outils */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 flex-wrap">
              <div className="flex rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-0.5 text-xs">
                {(
                  [
                    ["preview", "Aperçu", Gamepad2],
                    ["code", "Code", Code2],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    onClick={() => setTab(value)}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors inline-flex items-center gap-1.5 ${
                      tab === value
                        ? "bg-[var(--color-surface-2)] text-white"
                        : "text-[var(--color-ink-dim)] hover:text-white"
                    }`}
                  >
                    <Icon size={13} aria-hidden /> {label}
                  </button>
                ))}
              </div>

              {tab === "preview" && !busy && (
                <div className="hidden sm:flex rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-0.5 text-xs">
                  {(
                    [
                      ["desktop", Monitor, "Vue ordinateur"],
                      ["mobile", Smartphone, "Vue téléphone"],
                    ] as const
                  ).map(([value, Icon, title]) => (
                    <button
                      key={value}
                      onClick={() => setDevice(value)}
                      title={title}
                      aria-label={title}
                      className={`px-2.5 py-1.5 rounded-md transition-colors ${
                        device === value
                          ? "bg-[var(--color-surface-2)] text-white"
                          : "text-[var(--color-ink-dim)] hover:text-white"
                      }`}
                    >
                      <Icon size={13} aria-hidden />
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
                  className={toolButton}
                  title="Recharger le jeu"
                  aria-label="Recharger le jeu"
                >
                  <RotateCw size={14} />
                </button>
                {isOwner && (
                  <button
                    onClick={() => setSidePanel((p) => (p === "history" ? "none" : "history"))}
                    className={`btn px-2.5 py-1.5 text-xs ${
                      sidePanel === "history"
                        ? "bg-[var(--color-accent)]/15 text-[var(--color-accent-strong)] border-[var(--color-accent)]/40"
                        : "btn-ghost"
                    }`}
                    aria-pressed={sidePanel === "history"}
                    title="Historique des versions"
                    aria-label="Historique des versions"
                  >
                    <History size={14} />
                    <span className="hidden xl:inline"> Historique</span>
                  </button>
                )}
                <button
                  onClick={() => setSidePanel((p) => (p === "board" ? "none" : "board"))}
                  className={`btn px-2.5 py-1.5 text-xs ${
                    sidePanel === "board"
                      ? "bg-amber-400/15 text-amber-300 border-amber-400/40"
                      : "btn-ghost"
                  }`}
                  aria-pressed={sidePanel === "board"}
                  title="Classement"
                  aria-label="Classement"
                >
                  <Trophy size={14} />
                  <span className="hidden xl:inline"> Classement</span>
                </button>
                <button
                  onClick={() => setShareOpen(true)}
                  className={toolButton}
                  title="Partager"
                  aria-label="Partager"
                >
                  <Globe size={14} />
                  <span className="hidden xl:inline"> Partager</span>
                </button>
                <button
                  onClick={fullscreen}
                  className={`${toolButton} hidden sm:inline-flex`}
                  title="Plein écran"
                  aria-label="Plein écran"
                >
                  <Maximize size={14} />
                </button>
                <button
                  onClick={downloadHtml}
                  className={`${toolButton} hidden sm:inline-flex`}
                  title="Télécharger le jeu (HTML autonome)"
                  aria-label="Télécharger le jeu"
                >
                  <Download size={14} />
                </button>
                {isOwner && (
                  <button
                    onClick={deleteGame}
                    className="btn btn-danger px-2.5 py-1.5 text-xs"
                    title="Supprimer ce jeu"
                    aria-label="Supprimer ce jeu"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Contenu */}
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0 relative bg-[var(--color-bg)]">
                {/* L'iframe est UNIQUE et stable : changer de vue ou d'appareil ne
                    la remonte jamais (la partie en cours n'est pas perdue). */}
                <div
                  className={
                    device === "mobile" && tab === "preview" && !busy
                      ? "w-full h-full flex items-center justify-center p-4"
                      : "w-full h-full"
                  }
                >
                  <div
                    className={
                      device === "mobile" && tab === "preview" && !busy
                        ? "w-[390px] max-w-full h-full max-h-[760px] rounded-[2rem] border-4 border-[var(--color-border-strong)] overflow-hidden shadow-2xl bg-white"
                        : "w-full h-full bg-white"
                    }
                  >
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

                {busy && tab !== "code" && (
                  <span className="absolute bottom-3 right-3 px-3 py-1.5 rounded-full bg-black/75 text-[11px] text-white flex items-center gap-2 pointer-events-none shadow-lg">
                    ✍️ l&apos;IA modifie le jeu — la v{game.version} reste jouable
                  </span>
                )}

                {/* Vue code : recouvre l'aperçu sans démonter l'iframe. */}
                {tab === "code" && (
                  <div className="absolute inset-0 bg-[var(--color-bg)]">
                    {busy ? (
                      <LiveStream api={generation} view="code" />
                    ) : (
                      <CodeView
                        code={codeText}
                        copyable
                        onCopied={() => toast("Code copié !", "success")}
                      />
                    )}
                  </div>
                )}
              </div>

              {sidePanel === "board" && (
                <aside className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto thin-scroll">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-sm flex items-center gap-2">
                        <Trophy size={15} className="text-amber-300" aria-hidden /> Classement
                      </h2>
                      <button
                        onClick={() => setSidePanel("none")}
                        className="p-1.5 rounded-lg text-[var(--color-ink-dim)] hover:text-white hover:bg-[var(--color-surface-2)] transition-colors"
                        aria-label="Fermer le classement"
                      >
                        <X size={15} />
                      </button>
                    </div>
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

              {sidePanel === "history" && isOwner && (
                <VersionsTimeline
                  versions={versions}
                  current={{
                    version: game.version,
                    title: game.title || game.topic,
                    summary: game.change_summary,
                  }}
                  canRestore={genState.status !== "running"}
                  onRestore={restoreVersion}
                  onClose={() => setSidePanel("none")}
                />
              )}
            </div>
          </section>
        </Panel>
      </PanelGroup>
    </main>
  );
}
