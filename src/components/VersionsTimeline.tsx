"use client";

// Tiroir « Historique » du Studio : toutes les versions du jeu, de la plus
// récente à la plus ancienne, avec le résumé du changement qui a produit
// chacune. Restauration en un clic (créateur uniquement) — façon Lovable,
// restaurer crée une nouvelle version, rien n'est perdu.

import { History, RotateCcw, X } from "lucide-react";
import { formatWhen } from "./StudioShared";

export interface VersionEntry {
  version: number;
  title: string;
  summary: string;
  created_at: string;
}

export default function VersionsTimeline({
  versions,
  current,
  canRestore,
  onRestore,
  onClose,
}: {
  versions: VersionEntry[];
  current: { version: number; title: string; summary: string };
  canRestore: boolean;
  onRestore: (version: number) => void;
  onClose: () => void;
}) {
  const archived = [...versions].sort((a, b) => b.version - a.version);

  return (
    <aside
      className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto thin-scroll"
      aria-label="Historique des versions"
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <History size={15} aria-hidden /> Historique
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-ink-dim)] hover:text-white hover:bg-[var(--color-surface-2)] transition-colors"
            aria-label="Fermer l'historique"
          >
            <X size={15} />
          </button>
        </div>

        <ol className="space-y-2">
          {/* Version actuelle */}
          <li className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
                v{current.version} · actuelle
              </span>
            </div>
            <p className="text-sm font-medium mt-2 leading-snug">{current.title}</p>
            {current.summary && (
              <p className="text-xs text-[var(--color-ink-dim)] mt-1 line-clamp-3">
                {current.summary}
              </p>
            )}
          </li>

          {archived.map((v) => (
            <li
              key={v.version}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 group"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-ink-dim)]">
                  v{v.version}
                </span>
                <span className="text-[10px] text-[var(--color-ink-dim)]">
                  {formatWhen(v.created_at)}
                </span>
              </div>
              <p className="text-sm font-medium mt-2 leading-snug">{v.title}</p>
              {v.summary && (
                <p className="text-xs text-[var(--color-ink-dim)] mt-1 line-clamp-3">{v.summary}</p>
              )}
              {canRestore && (
                <button
                  onClick={() => onRestore(v.version)}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] text-[var(--color-accent-strong)] hover:underline"
                >
                  <RotateCcw size={12} aria-hidden /> Restaurer cette version
                </button>
              )}
            </li>
          ))}
        </ol>

        {archived.length === 0 && (
          <p className="text-xs text-[var(--color-ink-dim)] mt-3">
            Pas encore d&apos;anciennes versions : chaque amélioration archivera l&apos;état
            précédent ici.
          </p>
        )}
      </div>
    </aside>
  );
}
