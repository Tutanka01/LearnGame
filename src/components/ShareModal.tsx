"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Download, Globe, X } from "lucide-react";
import QRCode from "qrcode";

// Modal de partage : publication du jeu, lien public court et QR code
// téléchargeable — pensé pour être collé dans un support de cours (PDF, slides).
export default function ShareModal({
  gameId,
  title,
  isOwner,
  initialPublic,
  initialSlug,
  onClose,
  onToast,
}: {
  gameId: string;
  title: string;
  isOwner: boolean;
  initialPublic: boolean;
  initialSlug: string | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [slug, setSlug] = useState(initialSlug);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  const publicUrl = slug && isPublic ? `${window.location.origin}/p/${slug}` : null;

  useEffect(() => {
    if (!publicUrl) {
      setQr("");
      return;
    }
    QRCode.toDataURL(publicUrl, {
      width: 640,
      margin: 2,
      color: { dark: "#0a0c13", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setQr, () => setQr(""));
  }, [publicUrl]);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/games/${gameId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public: !isPublic }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(data.error || "La publication a échoué.");
        return;
      }
      setIsPublic(data.isPublic);
      setSlug(data.slug);
      onToast(data.isPublic ? "🌐 Jeu publié ! Le lien est actif." : "Jeu repassé en privé.");
    } finally {
      setBusy(false);
    }
  }, [gameId, isPublic, onToast]);

  async function copyUrl() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadQr() {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = qr;
    a.download = `qr-${(title || "jeu").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 50)}.png`;
    a.click();
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm dialog-overlay-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-lg card p-6 shadow-2xl dialog-pop max-h-[90vh] overflow-y-auto thin-scroll">
          <div className="flex items-start justify-between gap-3 mb-1">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
              <Globe size={18} className="text-[var(--color-accent-strong)]" aria-hidden />
              Partager ce jeu
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="p-1.5 rounded-lg text-[var(--color-ink-dim)] hover:text-white hover:bg-[var(--color-surface-2)] transition-colors -mt-1"
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-[var(--color-ink-dim)] mb-5">
            Un jeu publié est jouable par n&apos;importe qui via son lien —{" "}
            <strong className="text-[var(--color-ink)]">aucun compte requis</strong>. Idéal pour un
            support de cours : PDF, slides, Moodle…
          </Dialog.Description>

          {isOwner && (
            <button
              onClick={toggle}
              disabled={busy}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors mb-5 ${
                isPublic
                  ? "bg-emerald-500/10 border-emerald-500/40"
                  : "bg-[var(--color-bg)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
              }`}
              role="switch"
              aria-checked={isPublic}
            >
              <span className="text-sm font-medium text-left">
                {isPublic ? "Jeu publié" : "Publier ce jeu"}
                <span className="block text-xs font-normal text-[var(--color-ink-dim)] mt-0.5">
                  {isPublic
                    ? "Le lien public est actif. Clique pour repasser en privé."
                    : "Génère un lien public permanent."}
                </span>
              </span>
              <span
                aria-hidden
                className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${
                  isPublic ? "bg-emerald-500" : "bg-[var(--color-border-strong)]"
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    isPublic ? "translate-x-5" : ""
                  }`}
                />
              </span>
            </button>
          )}

          {publicUrl ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[var(--color-ink-dim)] mb-1.5">
                  Lien public permanent
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={publicUrl}
                    onFocus={(e) => e.target.select()}
                    className="field text-sm font-mono flex-1 min-w-0"
                  />
                  <button onClick={copyUrl} className="btn btn-primary shrink-0">
                    {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                    {copied ? "Copié" : "Copier"}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-white">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`QR code vers ${publicUrl}`} className="w-28 h-28 rounded" />
                ) : (
                  <div className="w-28 h-28 rounded bg-slate-200 animate-pulse" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">QR code à imprimer</p>
                  <p className="text-xs text-slate-500 mt-0.5 mb-2.5">
                    Colle-le dans ton PDF ou tes slides : les élèves le scannent et jouent
                    immédiatement.
                  </p>
                  <button
                    onClick={downloadQr}
                    disabled={!qr}
                    className="btn text-xs px-3 py-1.5 bg-slate-900 text-white hover:bg-slate-700"
                  >
                    <Download size={13} aria-hidden /> Télécharger le PNG
                  </button>
                </div>
              </div>
            </div>
          ) : (
            !isOwner && (
              <p className="text-sm text-[var(--color-ink-dim)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl px-4 py-3">
                L&apos;auteur n&apos;a pas encore publié ce jeu. Tu peux copier le lien interne, mais
                il nécessite un compte LearnGame.
              </p>
            )
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
