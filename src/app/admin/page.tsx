import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AdminUsers from "@/components/AdminUsers";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <h1 className="font-display text-xl shrink-0">
            🎮 Learn<span className="text-[var(--color-accent)]">Game</span>
          </h1>
          <a
            href="/"
            className="text-[var(--color-ink-dim)] hover:text-white transition-colors text-sm"
          >
            ← Retour à l&apos;accueil
          </a>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="font-display text-2xl">Comptes en attente d&apos;approbation</h2>
        <p className="text-sm text-[var(--color-ink-dim)] mt-1.5 mb-6">
          Les nouveaux élèves s&apos;inscrivent librement ; leur compte reste inactif tant que tu ne
          l&apos;approuves pas ici.
        </p>
        <AdminUsers />
      </div>
    </main>
  );
}
