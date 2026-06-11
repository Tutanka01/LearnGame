"use client";

// Dialogue de confirmation accessible (Radix : focus trap, Échap, aria) qui
// remplace tous les confirm() natifs. Usage :
//   const { confirmer } = useConfirm();
//   if (await confirmer({ title: "Supprimer ce jeu ?", danger: true })) …

import { createContext, useCallback, useContext, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, HelpCircle } from "lucide-react";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructrice : bouton rouge. */
  danger?: boolean;
}

interface ConfirmApi {
  confirmer: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm doit être utilisé sous <ConfirmProvider>");
  return ctx;
}

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirmer = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // Une seule confirmation à la fois : la précédente est refusée.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirmer }}>
      {children}
      <Dialog.Root open={options !== null} onOpenChange={(open) => !open && close(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm dialog-overlay-in" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-md card p-6 shadow-2xl dialog-pop"
            aria-describedby={options?.description ? undefined : ""}
          >
            <div className="flex items-start gap-3.5">
              <span
                className={`shrink-0 mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center ${
                  options?.danger
                    ? "bg-red-500/15 text-red-400"
                    : "bg-[var(--color-accent)]/15 text-[var(--color-accent-strong)]"
                }`}
                aria-hidden
              >
                {options?.danger ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
              </span>
              <div className="min-w-0">
                <Dialog.Title className="font-semibold text-[15px] leading-snug">
                  {options?.title}
                </Dialog.Title>
                {options?.description && (
                  <Dialog.Description className="text-sm text-[var(--color-ink-dim)] mt-1.5">
                    {options.description}
                  </Dialog.Description>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => close(false)} className="btn btn-ghost text-sm">
                {options?.cancelLabel ?? "Annuler"}
              </button>
              <button
                onClick={() => close(true)}
                autoFocus
                className={`btn text-sm ${
                  options?.danger
                    ? "bg-red-600 hover:bg-red-500 text-white font-semibold"
                    : "btn-primary"
                }`}
              >
                {options?.confirmLabel ?? "Confirmer"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}
