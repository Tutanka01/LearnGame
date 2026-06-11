"use client";

// Toasts unifiés de l'application : succès / erreur / info, empilés en haut,
// annoncés aux lecteurs d'écran (aria-live). Remplace les toasts locaux et
// les échecs silencieux : tout passe par useToast().

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  toast: (message: string, type?: ToastType, durationMs?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé sous <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastType, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const TONES: Record<ToastType, string> = {
  success: "border-emerald-500/50 text-emerald-300",
  error: "border-red-500/50 text-red-300",
  info: "border-[var(--color-accent)]/50 text-[var(--color-accent-strong)]",
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", durationMs = 4000) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, type, message }]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-full max-w-md px-4"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className={`toast-pop pointer-events-auto card flex items-center gap-2.5 pl-4 pr-2 py-2.5 shadow-2xl text-sm font-medium max-w-full ${TONES[t.type]}`}
            >
              <Icon size={16} className="shrink-0" aria-hidden />
              <span className="text-[var(--color-ink)] min-w-0">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 p-1 rounded-md text-[var(--color-ink-dim)] hover:text-white hover:bg-[var(--color-surface-2)] transition-colors"
                aria-label="Fermer la notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
