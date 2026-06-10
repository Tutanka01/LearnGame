"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

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
      router.push("/");
      router.refresh();
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,rgba(124,108,255,0.18),transparent_60%)]">
      <div className="w-full max-w-md float-in">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎮</div>
          <h1 className="text-3xl font-bold tracking-tight">
            Learn<span className="text-[var(--color-accent)]">Game</span>
          </h1>
          <p className="text-slate-400 mt-2">
            Décris ce que tu veux apprendre, joue pour le maîtriser.
          </p>
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8 shadow-2xl">
          <div className="flex rounded-xl bg-[var(--color-bg)] p-1 mb-6">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {m === "login" ? "Connexion" : "Inscription"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Nom d&apos;utilisateur</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                placeholder="ex : marie.dupont"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                placeholder="••••••••"
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">
                  Code d&apos;inscription{" "}
                  <span className="text-slate-500">(si fourni par ton enseignant)</span>
                </label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                  placeholder="optionnel"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[var(--color-accent)] hover:bg-[#8d7fff] disabled:opacity-50 font-semibold transition-colors"
            >
              {loading ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
