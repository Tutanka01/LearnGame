"use client";

// Error boundary racine de l'app : un crash client ne laisse plus un écran
// anglais brut à un élève, mais une page LearnGame qui propose de reprendre.
// (La génération, elle, vit côté serveur : elle n'est pas affectée par un
// crash d'interface — la pilule réapparaîtra au rechargement.)

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Erreur d'interface :", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 text-center max-w-md w-full float-in">
        <div className="mx-auto mb-4 w-12 h-12 rounded-xl grid place-items-center bg-red-500/15 text-red-400">
          <TriangleAlert size={22} aria-hidden />
        </div>
        <h1 className="font-display text-xl mb-2">Oups, une erreur est survenue</h1>
        <p className="text-sm text-[var(--color-ink-dim)] mb-6">
          Un problème inattendu a interrompu cette page. Tes jeux et tes scores sont
          intacts — réessaie, ou retourne à l&apos;accueil.
        </p>
        <div className="flex justify-center gap-3">
          <a href="/" className="btn btn-ghost px-5 py-2.5">
            Accueil
          </a>
          <button onClick={reset} className="btn btn-primary px-5 py-2.5">
            <RefreshCw size={15} aria-hidden /> Réessayer
          </button>
        </div>
      </div>
    </main>
  );
}
