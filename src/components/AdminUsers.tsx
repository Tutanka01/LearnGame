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

/** Formate une date SQLite (UTC, "YYYY-MM-DD HH:MM:SS") en date/heure locale. */
function formatCreatedAt(s: string): string {
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  if (users.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-2xl">
        <div className="text-4xl mb-3" aria-hidden>
          🧑‍🎓
        </div>
        <p className="text-[var(--color-ink-dim)]">Aucune demande en attente.</p>
      </div>
    );
  }

  return (
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
                <p className="text-xs text-[var(--color-ink-dim)]">
                  Inscrit le {formatCreatedAt(u.created_at)}
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
  );
}
