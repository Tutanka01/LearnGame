"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Segmented from "@/components/ui/Segmented";

const FEATURES = [
  ["✨", "Décris un concept, l'IA crée un jeu sur mesure"],
  ["🏆", "Scores, classements et progression"],
  ["🌐", "Partage tes jeux par simple lien ou QR code"],
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Une erreur est survenue.");
        return;
      }
      // Retour à la page d'origine si la session avait expiré (?next=…).
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md float-in">
        <div className="text-center mb-8">
          <div
            className="mx-auto mb-4 w-16 h-16 rounded-2xl grid place-items-center text-3xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shadow-[var(--shadow-glow)] pulse-glow"
            aria-hidden
          >
            🎮
          </div>
          <h1 className="font-display text-4xl">
            Learn<span className="text-[var(--color-accent)]">Game</span>
          </h1>
          <p className="text-[var(--color-ink-dim)] mt-2.5">
            Décris ce que tu veux apprendre, joue pour le maîtriser.
          </p>
        </div>

        <div className="card p-8 shadow-[var(--shadow-lg)]">
          <Segmented
            className="w-full mb-6 [&_.seg-item]:flex-1"
            ariaLabel="Connexion ou inscription"
            tone="accent"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError("");
            }}
            options={[
              { value: "login", label: "Connexion" },
              { value: "register", label: "Inscription" },
            ]}
          />

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm text-slate-300 mb-1.5">
                Nom d&apos;utilisateur
              </label>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                className="field"
                placeholder="ex : marie.dupont"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm text-slate-300 mb-1.5">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="field"
                placeholder="••••••••"
              />
            </div>
            {mode === "register" && (
              <div>
                <label htmlFor="code" className="block text-sm text-slate-300 mb-1.5">
                  Code d&apos;inscription{" "}
                  <span className="text-[#5b6478]">(si fourni par ton enseignant)</span>
                </label>
                <input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="field"
                  placeholder="optionnel"
                />
              </div>
            )}

            {error && (
              <p
                className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2"
                role="alert"
              >
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full py-3">
              {loading ? (
                <Loader2 size={16} className="animate-spin" aria-label="Connexion en cours" />
              ) : mode === "login" ? (
                "Se connecter"
              ) : (
                "Créer mon compte"
              )}
            </button>
          </form>
        </div>

        <ul className="mt-6 space-y-2">
          {FEATURES.map(([icon, text]) => (
            <li
              key={text}
              className="flex items-center gap-2.5 text-xs text-[var(--color-ink-dim)] justify-center"
            >
              <span aria-hidden>{icon}</span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
