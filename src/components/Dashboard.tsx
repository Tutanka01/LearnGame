"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Flag,
  Gamepad2,
  Globe,
  Loader2,
  LogOut,
  Play,
  Search,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import { useGeneration } from "./GenerationProvider";
import { useToast } from "./ui/ToastProvider";
import { useConfirm } from "./ui/ConfirmDialog";
import { apiFetch, HttpError } from "@/lib/clientApi";
import CommandPalette, { PaletteCommand } from "./ui/CommandPalette";

interface GameSummary {
  id: string;
  topic: string;
  difficulty: string;
  title: string;
  version: number;
  plays: number;
  is_public: number;
  public_slug: string | null;
  created_at: string;
  updated_at: string;
  user_id: number;
  author: string;
  completed_by_me: number;
  finishers: number;
}

interface Stats {
  completed: number;
  points: number;
}

const PAGE_SIZE = 60;

const SUGGESTION_POOL = [
  "Le modèle TCP/IP et l'encapsulation des paquets",
  "Les bases de SQL : SELECT, JOIN et GROUP BY",
  "La récursivité en programmation",
  "Le chiffrement asymétrique et les clés RSA",
  "Les sous-réseaux IPv4 et les masques",
  "La complexité algorithmique (notation Big O)",
  "Les structures de données : piles, files et arbres",
  "Le fonctionnement du DNS, étape par étape",
  "Les expressions régulières par la pratique",
  "La normalisation des bases de données (1NF → 3NF)",
  "Les processus et les threads d'un système d'exploitation",
  "Le protocole HTTP : méthodes, statuts et en-têtes",
];

const DIFFICULTIES = [
  { value: "débutant", label: "🌱 Débutant" },
  { value: "intermédiaire", label: "🚀 Intermédiaire" },
  { value: "avancé", label: "🔥 Avancé" },
];

// Couverture déterministe par jeu : dégradé + emoji dérivés de l'id.
const COVERS = [
  "from-violet-600/70 to-fuchsia-500/50",
  "from-cyan-600/70 to-blue-500/50",
  "from-emerald-600/70 to-teal-500/50",
  "from-orange-600/70 to-amber-500/50",
  "from-rose-600/70 to-pink-500/50",
  "from-indigo-600/70 to-sky-500/50",
];
const EMOJIS = ["🧠", "🚀", "🧩", "⚡", "🛰️", "🔬", "🗺️", "🎯", "🏗️", "🔐"];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export default function Dashboard({ username }: { username: string }) {
  const router = useRouter();
  const generation = useGeneration();
  const { toast } = useToast();
  const { confirmer } = useConfirm();

  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("intermédiaire");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({ completed: 0, points: 0 });
  const [userId, setUserId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"tous" | "miens" | "à-faire">("tous");
  const [sort, setSort] = useState<"récents" | "populaires">("récents");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const topicRef = useRef<HTMLTextAreaElement>(null);

  // Six suggestions : rendu serveur déterministe (pas d'aléatoire pendant le
  // SSR, sinon erreur d'hydratation React #418), mélange après le montage.
  const [suggestions, setSuggestions] = useState(() => SUGGESTION_POOL.slice(0, 6));
  useEffect(() => {
    setSuggestions([...SUGGESTION_POOL].sort(() => Math.random() - 0.5).slice(0, 6));
  }, []);

  const loadGames = useCallback(
    async (offset = 0) => {
      if (offset > 0) setLoadingMore(true);
      try {
        const data = await apiFetch<{
          games: GameSummary[];
          total: number;
          userId: number;
          stats: Stats;
        }>(`/api/games?limit=${PAGE_SIZE}&offset=${offset}`);
        setGames((prev) => (offset === 0 ? data.games : [...prev, ...data.games]));
        setTotal(data.total);
        setUserId(data.userId);
        setStats(data.stats);
      } catch (err) {
        if (err instanceof HttpError && err.status !== 401) {
          toast("Impossible de charger la bibliothèque.", "error");
        }
      } finally {
        setLoaded(true);
        setLoadingMore(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  // Raccourcis clavier : "/" → recherche · ⌘K / Ctrl+K → palette de commandes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const generate = useCallback(
    (t?: string) => {
      if (generation.state.status === "running") {
        // Une génération tourne déjà : on rouvre son Studio si c'est une création.
        if (generation.state.request && "topic" in generation.state.request) {
          router.push("/studio");
        } else {
          generation.restore();
        }
        return;
      }
      const finalTopic = (t ?? topic).trim();
      if (finalTopic.length < 3) return;
      // Façon Lovable : on ouvre le Studio immédiatement, la génération s'y affiche.
      if (generation.start({ topic: finalTopic, difficulty }, { embedded: true })) {
        router.push("/studio");
      }
    },
    [generation, router, topic, difficulty]
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function deleteGame(id: string) {
    const ok = await confirmer({
      title: "Supprimer définitivement ce jeu ?",
      description: "Toutes ses versions, sa conversation et ses scores seront perdus.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/games/${id}`, { method: "DELETE" });
      toast("Jeu supprimé.", "success");
      loadGames();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Suppression impossible.", "error");
    }
  }

  function hoverStart(id: string) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // Délai : pas d'iframe au simple survol de passage.
    hoverTimer.current = setTimeout(() => setHoveredId(id), 450);
  }
  function hoverEnd() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredId(null);
  }

  const visibleGames = useMemo(() => {
    let list = games;
    if (filter === "miens") list = list.filter((g) => g.user_id === userId);
    if (filter === "à-faire") list = list.filter((g) => !g.completed_by_me);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.topic.toLowerCase().includes(q) ||
          g.author.toLowerCase().includes(q)
      );
    }
    if (sort === "populaires") {
      list = [...list].sort((a, b) => b.finishers - a.finishers || b.plays - a.plays);
    }
    return list;
  }, [games, filter, sort, search, userId]);

  // Commandes de la palette ⌘K : créer, naviguer, ouvrir un jeu.
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [
      {
        id: "new-game",
        label: "Créer un nouveau jeu…",
        hint: "focus sur le champ de création",
        icon: Sparkles,
        run: () => topicRef.current?.focus(),
      },
      {
        id: "search",
        label: "Rechercher dans la bibliothèque",
        hint: "/",
        icon: Search,
        run: () => searchRef.current?.focus(),
      },
    ];
    for (const g of games) {
      cmds.push({
        id: `game-${g.id}`,
        label: g.title || g.topic,
        hint: `par ${g.user_id === userId ? "toi" : g.author} · v${g.version}`,
        icon: Gamepad2,
        keywords: `${g.topic} ${g.author}`,
        run: () => router.push(`/games/${g.id}`),
      });
    }
    return cmds;
  }, [games, userId, router]);

  return (
    <main className="min-h-screen">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
      />

      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold tracking-tight shrink-0">
            🎮 Learn<span className="text-[var(--color-accent)]">Game</span>
          </h1>
          <div className="flex items-center gap-3 sm:gap-4 text-sm min-w-0">
            <span
              className="px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs font-medium whitespace-nowrap inline-flex items-center gap-1.5"
              title="Tes points = la somme de tes meilleurs scores, en % par jeu (100 points max par jeu)"
            >
              <Trophy size={12} aria-hidden /> {stats.points} pts · {stats.completed} terminé
              {stats.completed > 1 ? "s" : ""}
            </span>
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-dim)] border border-[var(--color-border)] rounded-lg px-2 py-1 hover:text-white hover:border-[var(--color-border-strong)] transition-colors"
              title="Palette de commandes"
            >
              <kbd className="font-sans">⌘K</kbd>
            </button>
            <span className="text-[var(--color-ink-dim)] truncate hidden sm:inline">
              <span className="text-white font-medium">{username}</span>
            </span>
            <button
              onClick={logout}
              className="text-[var(--color-ink-dim)] hover:text-white transition-colors shrink-0 inline-flex items-center gap-1.5"
              aria-label="Se déconnecter"
            >
              <LogOut size={14} aria-hidden />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* --- Zone de création --- */}
        <section className="text-center mb-16 float-in">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3 text-balance">
            Qu&apos;est-ce que tu veux{" "}
            <span className="bg-gradient-to-r from-[var(--color-accent-strong)] to-[var(--color-accent-2)] bg-clip-text text-transparent">
              apprendre
            </span>{" "}
            aujourd&apos;hui ?
          </h2>
          <p className="text-[var(--color-ink-dim)] mb-8">
            Décris un concept, l&apos;IA crée un jeu sur mesure pour te l&apos;enseigner.
          </p>

          <div className="max-w-2xl mx-auto">
            <div className="card p-3 shadow-2xl focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_rgba(139,124,255,0.15),0_25px_50px_-12px_rgba(0,0,0,0.5)] transition-all">
              <textarea
                ref={topicRef}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    generate();
                  }
                }}
                rows={2}
                maxLength={500}
                placeholder='Ex : "Je veux comprendre comment fonctionne TCP/IP"'
                className="w-full bg-transparent resize-none px-3 py-2 focus:outline-none placeholder:text-[#5b6478]"
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1 flex-wrap">
                <div className="flex gap-1.5" role="radiogroup" aria-label="Niveau de difficulté">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setDifficulty(d.value)}
                      role="radio"
                      aria-checked={difficulty === d.value}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        difficulty === d.value
                          ? "bg-[var(--color-accent)]/20 text-[var(--color-accent-strong)] border border-[var(--color-accent)]/50"
                          : "text-[var(--color-ink-dim)] border border-transparent hover:text-white"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => generate()}
                  disabled={topic.trim().length < 3 && generation.state.status !== "running"}
                  className="btn btn-primary px-5"
                >
                  {generation.state.status === "running" ? (
                    <>
                      <Loader2 size={14} className="animate-spin" aria-hidden /> Génération en
                      cours…
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} aria-hidden /> Générer mon jeu
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setTopic(s);
                    generate(s);
                  }}
                  className="px-3 py-1.5 rounded-full text-xs text-slate-300 bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-white hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* --- Bibliothèque --- */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h3 className="text-xl font-semibold shrink-0">📚 Bibliothèque de jeux</h3>
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-dim)] pointer-events-none"
                aria-hidden
              />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un jeu, un sujet, un auteur…"
                aria-label="Rechercher dans la bibliothèque"
                className="field text-sm pl-9 pr-9"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-ink-dim)] border border-[var(--color-border)] rounded px-1.5 py-0.5 pointer-events-none">
                /
              </kbd>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <div
              className="flex rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-0.5 text-xs"
              role="tablist"
              aria-label="Filtrer les jeux"
            >
              {(
                [
                  ["tous", "Tous"],
                  ["à-faire", "À faire"],
                  ["miens", "Mes jeux"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  role="tab"
                  aria-selected={filter === value}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    filter === value
                      ? "bg-[var(--color-accent)] text-white"
                      : "text-[var(--color-ink-dim)] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-0.5 text-xs">
              {(
                [
                  ["récents", "🕒 Récents"],
                  ["populaires", "🔥 Populaires"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setSort(value)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    sort === value
                      ? "bg-[var(--color-surface-2)] text-white"
                      : "text-[var(--color-ink-dim)] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!loaded ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton h-44" />
              ))}
            </div>
          ) : visibleGames.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-2xl float-in">
              <div className="text-4xl mb-3" aria-hidden>
                🕹️
              </div>
              <p className="text-[var(--color-ink-dim)] mb-5">
                {search
                  ? "Aucun jeu ne correspond à ta recherche."
                  : filter === "miens"
                    ? "Tu n'as pas encore créé de jeu."
                    : filter === "à-faire"
                      ? "Bravo, tu as terminé tous les jeux disponibles ! 🎉"
                      : "Aucun jeu pour l'instant. Sois le premier à en créer un !"}
              </p>
              {!search && filter !== "à-faire" && (
                <button
                  onClick={() => {
                    topicRef.current?.focus();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="btn btn-primary"
                >
                  <Sparkles size={14} aria-hidden /> Créer mon premier jeu
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
                {visibleGames.map((g) => {
                  const h = hashCode(g.id);
                  return (
                    <div
                      key={g.id}
                      onClick={() => router.push(`/games/${g.id}`)}
                      onKeyDown={(e) => e.key === "Enter" && router.push(`/games/${g.id}`)}
                      onMouseEnter={() => hoverStart(g.id)}
                      onMouseLeave={hoverEnd}
                      tabIndex={0}
                      role="link"
                      aria-label={`Jouer à ${g.title || g.topic}`}
                      className="relative cursor-pointer card card-interactive overflow-hidden group"
                    >
                      <div
                        className={`relative h-24 bg-gradient-to-br ${COVERS[h % COVERS.length]} flex items-center justify-center text-4xl overflow-hidden`}
                      >
                        <span
                          className="drop-shadow-lg group-hover:scale-125 transition-transform"
                          aria-hidden
                        >
                          {EMOJIS[h % EMOJIS.length]}
                        </span>
                        {/* Aperçu réel du jeu au survol (chargé à la demande). */}
                        {hoveredId === g.id && (
                          <iframe
                            src={`/api/games/${g.id}/play?v=${g.version}`}
                            sandbox="allow-scripts"
                            className="absolute inset-0 w-full h-full border-0 bg-white pointer-events-none preview-fade-in"
                            tabIndex={-1}
                            aria-hidden
                            title=""
                          />
                        )}
                      </div>
                      <div className="absolute top-2 right-2 flex gap-1.5">
                        {Boolean(g.is_public) && (
                          <span
                            className="px-2 py-0.5 rounded-full bg-sky-500/90 text-[11px] font-semibold shadow inline-flex items-center gap-1"
                            title="Jeu public : jouable sans compte via son lien"
                          >
                            <Globe size={10} aria-hidden />
                          </span>
                        )}
                        {Boolean(g.completed_by_me) && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/90 text-[11px] font-semibold shadow">
                            ✓ Terminé
                          </span>
                        )}
                      </div>
                      {g.user_id === userId && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteGame(g.id);
                          }}
                          className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/40 text-red-300 hover:bg-red-900/70 text-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity inline-flex items-center justify-center"
                          title="Supprimer ce jeu"
                          aria-label="Supprimer ce jeu"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                      <div className="p-4">
                        <h4 className="font-semibold leading-snug group-hover:text-[var(--color-accent-strong)] transition-colors line-clamp-2">
                          {g.title || g.topic}
                        </h4>
                        <p className="text-xs text-[#5b6478] mt-1.5 line-clamp-2">{g.topic}</p>
                        <div className="flex items-center gap-2 mt-3 text-[11px] text-[var(--color-ink-dim)] flex-wrap">
                          <span className="px-2 py-0.5 rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] capitalize">
                            {g.difficulty}
                          </span>
                          <span>par {g.user_id === userId ? "toi" : g.author}</span>
                          <span className="inline-flex items-center gap-1">
                            <Play size={10} aria-hidden /> {g.plays}
                          </span>
                          {g.finishers > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Flag size={10} aria-hidden /> {g.finishers}
                            </span>
                          )}
                          {g.version > 1 && <span>v{g.version}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {games.length < total && !search && filter === "tous" && (
                <div className="text-center mt-8">
                  <button
                    onClick={() => loadGames(games.length)}
                    disabled={loadingMore}
                    className="btn btn-ghost px-6"
                  >
                    {loadingMore ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <ChevronDown size={14} aria-hidden />
                    )}
                    Charger plus ({games.length}/{total})
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
