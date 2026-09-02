"use client";

// Panneau admin : liste des comptes en attente d'approbation, avec actions
// d'approbation/refus. Utilisé par la page serveur src/app/admin/page.tsx
// (qui gère déjà le contrôle d'accès admin+auth).

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, UserRound, UserX } from "lucide-react";
import { apiFetch, HttpError } from "@/lib/clientApi";
import { useToast } from "./ui/ToastProvider";
import { useConfirm } from "./ui/ConfirmDialog";

interface PendingUser {
  id: number;
  username: string;
  created_at: string;
}

/** Parse une date SQLite (UTC, "YYYY-MM-DD HH:MM:SS"). */
function parseSqliteDate(s: string): Date {
  return new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
}

/** Formate une date SQLite (UTC, "YYYY-MM-DD HH:MM:SS") en date/heure locale. */
function formatCreatedAt(s: string): string {
  const d = parseSqliteDate(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format relatif français : « il y a 5 min », « il y a 3 h », « il y a 2 j », sinon la date complète. */
function formatRelatif(s: string): string {
  const d = parseSqliteDate(s);
  if (Number.isNaN(d.getTime())) return s;
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  if (jours < 7) return `il y a ${jours} j`;
  // Au-delà d'une semaine, la date complète est plus parlante.
  return formatCreatedAt(s);
}

export default function AdminUsers() {
  const { toast } = useToast();
  const { confirmer } = useConfirm();

  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ users: PendingUser[] }>("/api/admin/users");
      setUsers(data.users);
    } catch (err) {
      toast(err instanceof HttpError ? err.message : "Impossible de charger la liste.", "error");
    } finally {
      setLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(user: PendingUser) {
    setPendingActionId(user.id);
    try {
      await apiFetch(`/api/admin/users/${user.id}/approve`, { method: "POST" });
      setUsers((list) => list.filter((u) => u.id !== user.id));
      toast(`Compte "${user.username}" approuvé.`, "success");
    } catch (err) {
      toast(err instanceof HttpError ? err.message : "Approbation impossible.", "error");
    } finally {
      setPendingActionId(null);
    }
  }

  async function reject(user: PendingUser) {
    const ok = await confirmer({
      title: `Refuser le compte "${user.username}" ?`,
      description: "Le compte sera définitivement supprimé. Cette action est irréversible.",
      confirmLabel: "Refuser et supprimer",
      danger: true,
    });
    if (!ok) return;

    setPendingActionId(user.id);
    try {
      await apiFetch(`/api/admin/users/${user.id}/reject`, { method: "POST" });
      setUsers((list) => list.filter((u) => u.id !== user.id));
      toast(`Compte "${user.username}" refusé et supprimé.`, "success");
    } catch (err) {
      toast(err instanceof HttpError ? err.message : "Refus impossible.", "error");
    } finally {
      setPendingActionId(null);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-[var(--color-ink-dim)] text-sm py-8">
        <Loader2 size={16} className="animate-spin" aria-hidden /> Chargement…
      </div>
    );
  }

  // Badge de comptage sous le titre de la page — visible même quand la liste est vide.
  const nb = users.length;
  const badgeComptage = (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
        nb > 0
          ? "text-amber-300 bg-amber-400/10 border-amber-400/30"
          : "text-[var(--color-ink-dim)] bg-[var(--color-surface-2)] border-[var(--color-border)]"
      }`}
    >
      {nb} {nb > 1 ? "comptes" : "compte"} en attente
    </span>
  );

  if (users.length === 0) {
    return (
      <div>
        <div className="mb-4">{badgeComptage}</div>
        <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-2xl">
          <div
            className="mx-auto mb-4 w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 grid place-items-center"
            aria-hidden
          >
            <UserRound size={22} />
          </div>
          <p className="font-medium">Aucun compte en attente</p>
          <p className="text-sm text-[var(--color-ink-dim)] mt-1">
            Tous les comptes demandés ont été traités.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">{badgeComptage}</div>
      <div className="flex flex-col gap-3">
        {users.map((u) => {
          const busy = pendingActionId === u.id;
          return (
            <div key={u.id} className="card p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0 w-9 h-9 rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent-strong)] flex items-center justify-center">
                  <UserRound size={16} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{u.username}</p>
                  {/* Date relative, avec la date/heure complète au survol (title). */}
                  <p
                    className="text-xs text-[var(--color-ink-dim)]"
                    title={formatCreatedAt(u.created_at)}
                  >
                    Inscrit {formatRelatif(u.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => reject(u)}
                  disabled={busy}
                  className="btn btn-ghost text-sm"
                >
                  <UserX size={14} aria-hidden /> Refuser
                </button>
                <button
                  onClick={() => approve(u)}
                  disabled={busy}
                  className="btn btn-primary text-sm"
                >
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck size={14} aria-hidden />
                  )}
                  Approuver
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
