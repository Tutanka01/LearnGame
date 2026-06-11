"use client";

// Palette de commandes (⌘K / Ctrl+K) : recherche de jeux, création, navigation.
// Maison et minimaliste : un champ, une liste filtrée, navigation au clavier.

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CornerDownLeft, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  /** Texte supplémentaire pris en compte par le filtre (sujet, auteur…). */
  keywords?: string;
  run: () => void;
}

const MAX_RESULTS = 8;

export default function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? commands.filter((c) =>
          `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q)
        )
      : commands;
    return pool.slice(0, MAX_RESULTS);
  }, [commands, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(results.length - 1, 0)));
  }, [results.length]);

  function runCommand(cmd: PaletteCommand | undefined) {
    if (!cmd) return;
    onClose();
    cmd.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(results[active]);
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm dialog-overlay-in" />
        <Dialog.Content
          className="fixed left-1/2 top-24 z-[55] -translate-x-1/2 w-[calc(100vw-2rem)] max-w-lg card shadow-2xl overflow-hidden dialog-pop"
          style={{ transform: "translateX(-50%)" }}
          aria-describedby=""
        >
          <Dialog.Title className="sr-only">Palette de commandes</Dialog.Title>
          <div className="flex items-center gap-2.5 px-4 border-b border-[var(--color-border)]">
            <Search size={15} className="text-[var(--color-ink-dim)] shrink-0" aria-hidden />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              autoFocus
              placeholder="Rechercher un jeu, une action…"
              aria-label="Rechercher une commande"
              className="w-full bg-transparent py-3.5 text-sm focus:outline-none placeholder:text-[#5b6478]"
            />
            <kbd className="text-[10px] text-[var(--color-ink-dim)] border border-[var(--color-border)] rounded px-1.5 py-0.5 shrink-0">
              esc
            </kbd>
          </div>
          <ul ref={listRef} className="max-h-80 overflow-y-auto thin-scroll p-1.5" role="listbox">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-dim)]">
                Aucun résultat.
              </li>
            ) : (
              results.map((cmd, i) => {
                const Icon = cmd.icon;
                return (
                  <li key={cmd.id} data-index={i} role="option" aria-selected={i === active}>
                    <button
                      onClick={() => runCommand(cmd)}
                      onMouseMove={() => setActive(i)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                        i === active
                          ? "bg-[var(--color-accent)]/15 text-white"
                          : "text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      {Icon && (
                        <Icon
                          size={15}
                          className={
                            i === active
                              ? "text-[var(--color-accent-strong)] shrink-0"
                              : "text-[var(--color-ink-dim)] shrink-0"
                          }
                          aria-hidden
                        />
                      )}
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="text-[11px] text-[var(--color-ink-dim)] shrink-0 max-w-[40%] truncate">
                          {cmd.hint}
                        </span>
                      )}
                      {i === active && (
                        <CornerDownLeft
                          size={13}
                          className="text-[var(--color-ink-dim)] shrink-0"
                          aria-hidden
                        />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
