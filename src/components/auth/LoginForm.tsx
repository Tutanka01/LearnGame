"use client";

// Formulaire de connexion / inscription — la porte d'entrée de LearnGame.
//
// Ce que le formulaire garantit, au-delà d'un simple POST :
//  - les règles affichées sont CELLES DU SERVEUR (module partagé authValidate) :
//    pas de message qui promettrait une règle différente ;
//  - validation en direct : format du pseudo, disponibilité (requête debouncée
//    et annulable), force du mot de passe, cohérence des deux saisies ;
//  - alerte Verr. Maj sur les champs mot de passe ;
//  - erreurs de champ sous chaque saisie (aria-invalid + aria-describedby),
//    bannière pour les réponses serveur, secousse au rejet ;
//  - le compte « en attente d'approbation » a son écran dédié, qui dit quoi
//    faire ensuite — pas un simple message d'erreur.

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Eye,
  EyeOff,
  Hourglass,
  Loader2,
  ShieldCheck,
  Share2,
  Sparkles,
  TriangleAlert,
  Trophy,
  X,
} from "lucide-react";
import Segmented from "@/components/ui/Segmented";
import { PASSWORD_MIN, passwordStrength, validatePassword, validateUsername } from "@/lib/authValidate";

const FEATURES = [
  { icon: Sparkles, text: "Décris un concept, l'IA crée un jeu sur mesure" },
  { icon: Trophy, text: "Scores, classements et progression" },
  { icon: Share2, text: "Partage tes jeux par lien ou QR code" },
] as const;

type Mode = "login" | "register";
type Availability = "idle" | "checking" | "ok" | "taken";
type FieldErrors = { username?: string; password?: string; confirm?: string };

/** Destination sûre du ?next= : jamais de redirection vers l'extérieur. */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Couleurs de la jauge de robustesse (remplissage + libellé). */
function strengthStyle(score: number): { bar: string; text: string } {
  if (score <= 1) return { bar: "bg-red-500", text: "text-red-400" };
  if (score === 2) return { bar: "bg-amber-500", text: "text-amber-400" };
  return { bar: "bg-[var(--color-accent-2)]", text: "text-[var(--color-accent-2)]" };
}

export default function LoginForm() {
  const router = useRouter();
  // ?next= (destination d'origine après une session expirée) — lu côté serveur
  // comme côté client via le router, donc sans flash à l'hydratation.
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [availability, setAvailability] = useState<Availability>("idle");
  const [shaking, setShaking] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const name = username.trim();
  const usernameFormatError = useMemo(
    () => (mode === "register" && name ? validateUsername(name) : null),
    [mode, name]
  );

  // Disponibilité du pseudo, en direct (inscription seulement) : debouncée à
  // 400 ms, annulable, et seulement pour un nom déjà bien formé — inutile de
  // solliciter le serveur pour un format qui sera refusé de toute façon.
  useEffect(() => {
    if (mode !== "register" || !name || usernameFormatError) {
      setAvailability("idle");
      return;
    }
    setAvailability("checking");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/auth/username-available?name=${encodeURIComponent(name)}`, {
        signal: controller.signal,
      })
        .then((res) => res.json().catch(() => null))
        .then((data: { available?: boolean } | null) => {
          setAvailability(data?.available ? "ok" : "taken");
        })
        .catch(() => {
          if (!controller.signal.aborted) setAvailability("idle");
        });
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [name, mode, usernameFormatError]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setPassword("");
    setConfirm("");
    setShowPassword(false);
    setFieldErrors({});
    setBanner(null);
    setAvailability("idle");
  }

  function triggerShake() {
    setShaking(true);
  }

  /** Validation côté client, miroir exact des règles serveur. */
  function validateAll(): FieldErrors {
    const errors: FieldErrors = {};
    const usernameError = validateUsername(username);
    if (usernameError) errors.username = usernameError;
    const passwordError = validatePassword(password);
    if (passwordError) errors.password = passwordError;
    if (mode === "register" && !passwordError && confirm !== password) {
      errors.confirm = "Les deux mots de passe ne correspondent pas.";
    }
    return errors;
  }

  function focusFirstError(errors: FieldErrors) {
    if (errors.username) usernameRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
    else if (errors.confirm) confirmRef.current?.focus();
  }

  const trackCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setBanner(null);

    const errors = validateAll();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      triggerShake();
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { pending?: boolean; error?: string };
      if (!res.ok) {
        // Compte en attente = information, pas une faute de saisie.
        setBanner({
          kind: res.status === 403 ? "info" : "error",
          text: data.error || "Une erreur est survenue.",
        });
        triggerShake();
        return;
      }
      if (mode === "register" && data.pending) {
        setPending(true);
        return;
      }
      router.push(safeNext());
      router.refresh();
    } catch {
      setBanner({ kind: "error", text: "Impossible de contacter le serveur." });
      triggerShake();
    } finally {
      setLoading(false);
    }
  }

  const fieldClass = (hasError?: string) => `field ${hasError ? "field-error" : ""}`;

  // Alerte Verr. Maj — id optionnel : le champ « Mot de passe » y référence
  // via aria-describedby ; le champ « Confirmer » l'affiche sans doublon d'id.
  const capsLockHint = (id?: string) =>
    capsLock && (
      <p id={id} className="flex items-center gap-1.5 text-xs text-amber-400 mt-1.5">
        <TriangleAlert size={12} aria-hidden /> Verr. Maj activé
      </p>
    );

  const eyeToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--color-ink-dim)] hover:text-white transition-colors"
      aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
      aria-pressed={showPassword}
      tabIndex={-1}
    >
      {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
    </button>
  );

  const brand = (
    <section className="hidden lg:flex flex-col justify-between min-h-[540px] py-6 pr-4">
      <div>
        <div
          className="mb-6 w-14 h-14 rounded-2xl grid place-items-center text-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shadow-[var(--shadow-glow)] pulse-glow"
          aria-hidden
        >
          🎮
        </div>
        <h1 className="font-display text-5xl leading-tight">
          Learn<span className="text-[var(--color-accent)]">Game</span>
        </h1>
        <p className="text-[var(--color-ink-dim)] mt-3 max-w-sm leading-relaxed">
          Décris ce que tu veux apprendre, l&apos;IA crée un jeu sur mesure pour te le faire
          maîtriser.
        </p>
      </div>
      <ul className="space-y-4 my-10">
        {FEATURES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3.5">
            <span
              className="shrink-0 w-9 h-9 rounded-xl grid place-items-center bg-[var(--color-surface-2)] border border-[var(--color-border)]"
              aria-hidden
            >
              <Icon size={16} className="text-[var(--color-accent)]" />
            </span>
            <span className="text-sm text-[var(--color-ink-dim)]">{text}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
        <ShieldCheck size={14} aria-hidden /> Plateforme sur invitation : les comptes sont validés
        par un enseignant.
      </p>
    </section>
  );

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-10 items-center float-in">
        {brand}

        <div className="w-full max-w-md mx-auto">
          {/* En-tête compact sur mobile (le panneau de marque est masqué). */}
          <div className="lg:hidden text-center mb-7">
            <div
              className="mx-auto mb-4 w-14 h-14 rounded-2xl grid place-items-center text-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shadow-[var(--shadow-glow)] pulse-glow"
              aria-hidden
            >
              🎮
            </div>
            <h1 className="font-display text-3xl">
              Learn<span className="text-[var(--color-accent)]">Game</span>
            </h1>
          </div>

          <div
            className={`card p-6 sm:p-8 shadow-[var(--shadow-lg)] ${shaking ? "shake" : ""}`}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) setShaking(false);
            }}
          >
            {pending ? (
              <div className="space-y-5 text-center">
                <div
                  className="mx-auto w-14 h-14 rounded-2xl grid place-items-center bg-[var(--color-surface-2)] border border-[var(--color-border)]"
                  aria-hidden
                >
                  <Hourglass size={22} className="text-[var(--color-accent-2)]" />
                </div>
                <div>
                  <h2 className="font-display text-xl">Compte créé&nbsp;!</h2>
                  <p className="text-sm text-[var(--color-ink-dim)] mt-1.5">
                    Bienvenue, <span className="text-[var(--color-ink)] font-medium">{name}</span>.
                    Une dernière étape avant de jouer&nbsp;:
                  </p>
                </div>
                <ol className="text-left text-sm space-y-2.5 text-[var(--color-ink-dim)] list-none">
                  <li className="flex gap-2.5">
                    <span className="text-[var(--color-accent)] font-semibold" aria-hidden>
                      1.
                    </span>
                    Un enseignant valide ton inscription.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-[var(--color-accent)] font-semibold" aria-hidden>
                      2.
                    </span>
                    Reviens te connecter dès que c&apos;est fait — tu peux fermer cet onglet
                    d&apos;ici là.
                  </li>
                </ol>
                <button
                  type="button"
                  onClick={() => {
                    setPending(false);
                    switchMode("login");
                  }}
                  className="btn btn-primary w-full py-3"
                >
                  Retour à la connexion
                </button>
              </div>
            ) : (
              <>
                <Segmented
                  className="w-full mb-6 [&_.seg-item]:flex-1"
                  ariaLabel="Connexion ou inscription"
                  tone="accent"
                  value={mode}
                  onChange={switchMode}
                  options={[
                    { value: "login", label: "Connexion" },
                    { value: "register", label: "Inscription" },
                  ]}
                />

                {nextPath && (
                  <p className="text-xs text-[var(--color-ink-faint)] mb-4 text-center">
                    Connecte-toi pour reprendre là où tu t&apos;étais arrêté.
                  </p>
                )}

                <form onSubmit={submit} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="username" className="block text-sm text-slate-300 mb-1.5">
                      Nom d&apos;utilisateur
                    </label>
                    <div className="relative">
                      <input
                        id="username"
                        ref={usernameRef}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoFocus
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        className={fieldClass(fieldErrors.username) + " pr-9"}
                        placeholder="ex : marie.dupont"
                        aria-invalid={!!fieldErrors.username}
                        aria-describedby={
                          [
                            fieldErrors.username ? "username-error" : null,
                            mode === "register" ? "username-status" : null,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                      />
                      {mode === "register" && (
                        <div
                          className="absolute right-2.5 top-1/2 -translate-y-1/2"
                          aria-hidden
                        >
                          {availability === "checking" && (
                            <Loader2 size={15} className="animate-spin text-[var(--color-ink-faint)]" />
                          )}
                          {availability === "ok" && <Check size={15} className="text-emerald-400" />}
                          {availability === "taken" && <X size={15} className="text-red-400" />}
                        </div>
                      )}
                    </div>
                    {fieldErrors.username && (
                      <p id="username-error" className="text-xs text-red-400 mt-1.5">
                        {fieldErrors.username}
                      </p>
                    )}
                    {mode === "register" && (
                      <p id="username-status" aria-live="polite" className="text-xs mt-1.5 min-h-[1rem]">
                        {availability === "ok" && (
                          <span className="text-emerald-400">Ce nom est disponible.</span>
                        )}
                        {availability === "taken" && (
                          <span className="text-red-400">Ce nom est déjà pris.</span>
                        )}
                        {usernameFormatError && !fieldErrors.username && (
                          <span className="text-red-400">{usernameFormatError}</span>
                        )}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="password" className="block text-sm text-slate-300 mb-1.5">
                      Mot de passe
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        ref={passwordRef}
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={trackCapsLock}
                        onKeyUp={trackCapsLock}
                        onBlur={() => setCapsLock(false)}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        className={fieldClass(fieldErrors.password) + " pr-10"}
                        placeholder="••••••••"
                        aria-invalid={!!fieldErrors.password}
                        aria-describedby={
                          [
                            fieldErrors.password ? "password-error" : null,
                            capsLock ? "capslock-hint" : null,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                      />
                      {eyeToggle}
                    </div>
                    {fieldErrors.password && (
                      <p id="password-error" className="text-xs text-red-400 mt-1.5">
                        {fieldErrors.password}
                      </p>
                    )}
                    {capsLockHint("capslock-hint")}

                    {mode === "register" && password && (
                      <div className="flex items-center gap-2.5 mt-2">
                        <div className="flex-1 grid grid-cols-4 gap-1" aria-hidden>
                          {[1, 2, 3, 4].map((i) => (
                            <div
                              key={i}
                              className={`h-1 rounded-full transition-colors duration-300 ${
                                i <= strength.score ? strengthStyle(strength.score).bar : "bg-[var(--color-surface-3)]"
                              }`}
                            />
                          ))}
                        </div>
                        <span
                          className={`text-xs w-16 text-right ${strengthStyle(strength.score).text}`}
                          aria-live="polite"
                        >
                          {strength.label}
                        </span>
                      </div>
                    )}
                    {mode === "register" && !password && (
                      <p className="text-xs text-[var(--color-ink-faint)] mt-1.5">
                        {PASSWORD_MIN} caractères minimum. Mélange lettres, chiffres et symboles.
                      </p>
                    )}
                  </div>

                  {mode === "register" && (
                    <div>
                      <label htmlFor="confirm" className="block text-sm text-slate-300 mb-1.5">
                        Confirmer le mot de passe
                      </label>
                      <div className="relative">
                        <input
                          id="confirm"
                          ref={confirmRef}
                          type={showPassword ? "text" : "password"}
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          onKeyDown={trackCapsLock}
                          onKeyUp={trackCapsLock}
                          onBlur={() => setCapsLock(false)}
                          autoComplete="new-password"
                          className={fieldClass(fieldErrors.confirm) + " pr-10"}
                          placeholder="••••••••"
                          aria-invalid={!!fieldErrors.confirm}
                          aria-describedby={fieldErrors.confirm ? "confirm-error" : undefined}
                        />
                        {eyeToggle}
                      </div>
                      {fieldErrors.confirm && (
                        <p id="confirm-error" className="text-xs text-red-400 mt-1.5">
                          {fieldErrors.confirm}
                        </p>
                      )}
                      {!fieldErrors.confirm && capsLockHint()}
                    </div>
                  )}

                  {banner && (
                    <p
                      role="alert"
                      className={`text-sm rounded-lg px-3 py-2.5 border ${
                        banner.kind === "error"
                          ? "text-red-400 bg-red-950/40 border-red-900/50"
                          : "text-emerald-300 bg-emerald-950/40 border-emerald-900/50"
                      }`}
                    >
                      {banner.text}
                    </p>
                  )}

                  <button type="submit" disabled={loading} className="btn btn-primary w-full py-3">
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden />
                        {mode === "login" ? "Connexion…" : "Création du compte…"}
                      </>
                    ) : mode === "login" ? (
                      "Se connecter"
                    ) : (
                      "Créer mon compte"
                    )}
                  </button>
                </form>

                <p className="text-xs text-center text-[var(--color-ink-faint)] mt-5">
                  {mode === "login"
                    ? "Mot de passe oublié ? Demande à un enseignant de le réinitialiser."
                    : "Ton compte sera validé par un enseignant avant ton premier accès."}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
