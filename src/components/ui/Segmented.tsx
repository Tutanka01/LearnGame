"use client";

// Contrôle segmenté unifié, avec pouce glissant. Remplace les quatre variantes
// réimplémentées à la main (filtres/tri du Dashboard, vue/appareil du Studio,
// onglets de connexion). Le pouce se positionne par mesure du DOM : il glisse
// proprement quelle que soit la largeur variable des options.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: LucideIcon;
  title?: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** "accent" = pouce violet (sélection forte) · "subtle" = surface neutre. */
  tone?: "accent" | "subtle";
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
  /** role tab/radio selon le contexte (onglets vs réglage). */
  role?: "tablist" | "radiogroup";
}

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "subtle",
  size = "md",
  ariaLabel,
  className = "",
  role = "tablist",
}: SegmentedProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  // Mesure de l'option active → position/largeur du pouce. Recalculé sur
  // changement de valeur, de jeu d'options et de taille du conteneur.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const el = list.children[activeIndex] as HTMLElement | undefined;
      if (!el) return;
      setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(list);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm";
  const itemRole = role === "tablist" ? "tab" : "radio";

  return (
    <div
      ref={listRef}
      role={role}
      aria-label={ariaLabel}
      className={`seg ${className}`}
    >
      {thumb && (
        <span
          aria-hidden
          className={`seg-thumb ${tone === "accent" ? "seg-thumb-accent" : "seg-thumb-subtle"}`}
          style={{ transform: `translateX(${thumb.left - 3}px)`, width: thumb.width }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role={itemRole}
            aria-selected={role === "tablist" ? active : undefined}
            aria-checked={role === "radiogroup" ? active : undefined}
            data-active={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`seg-item ${pad}`}
          >
            {Icon && <Icon size={size === "sm" ? 13 : 14} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
