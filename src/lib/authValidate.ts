// Règles de validation des identifiants — module PUR (aucune dépendance Next),
// partagé par les routes API ET le formulaire client : une seule source de
// vérité, donc des messages identiques des deux côtés et des tests sans
// serveur. Toute règle nouvelle se change ICI et nulle part ailleurs.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

// Lettres et chiffres Unicode (accents inclus), plus _ . - ; un séparateur ne
// peut ni ouvrir ni fermer le nom (« .marie » ou « marie- » sont refusés).
const USERNAME_REGEX = /^[\p{L}\p{N}](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}])?$/u;

/** Message d'erreur en français, ou null si le nom est valide. */
export function validateUsername(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Choisis un nom d'utilisateur.";
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return `Le nom d'utilisateur doit contenir entre ${USERNAME_MIN} et ${USERNAME_MAX} caractères.`;
  }
  if (!USERNAME_REGEX.test(name)) {
    return "Caractères autorisés : lettres, chiffres, _ . - (pas aux extrémités).";
  }
  return null;
}

/** Message d'erreur en français, ou null si le mot de passe est acceptable. */
export function validatePassword(password: string): string | null {
  if (!password) return "Choisis un mot de passe.";
  if (password.length < PASSWORD_MIN) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX} caractères.`;
  }
  return null;
}

/**
 * Destination « ?next= » sûre : chemin local strictement relatif, sinon "/".
 * Refuse tout ce qui pourrait quitter l'application : URLs absolues,
 * protocol-relative (« //hôte »), backslash-hôte, caractères de contrôle, et
 * chemins d'API (boucle de redirection auto-entretenue via /api/auth/oidc/*).
 * Partagé client (formulaire) et serveur (flux SSO) : une seule implémentation.
 */
export function isSafeLocalPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  // Pas de destination vers nos propres routes d'API : ?next=/api/auth/oidc/start
  // créerait une boucle de redirections auto-entretenue après chaque login.
  if (raw.startsWith("/api/")) return "/";
  // Barrière supplémentaire : doit rester un chemin relatif vers la même origine.
  try {
    const u = new URL(raw, "https://app.invalid");
    if (u.origin !== "https://app.invalid") return "/";
  } catch {
    return "/";
  }
  return raw;
}

// --- Force du mot de passe (retour honnête, sans bluff) ---------------------

export interface PasswordStrength {
  /** 0 (vide) à 4 (excellent). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

// Échantillon de mots de passe trop répandus pour être sauvés par leur forme.
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password1!",
  "motdepasse",
  "motdepasse1",
  "motdepasse123",
  "12345678",
  "123456789",
  "1234567890",
  "azerty12",
  "azerty123",
  "azertyuiop",
  "qwerty123",
  "qwertyuiop",
  "iloveyou",
  "administrateur",
  "bienvenue",
  "bienvenue1",
  "apprendre1",
]);

/**
 * Score qualitatif : longueur (≥ 8 puis ≥ 12) + diversité de classes de
 * caractères (minuscules, majuscules, chiffres, spéciaux). Un mot de passe
 * trop répandu est plafonné à « faible », quelle que soit sa forme.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "" };

  let score = 0;
  if (password.length >= PASSWORD_MIN) score += 1;
  if (password.length >= 12) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  score += classes >= 3 ? 2 : classes >= 2 ? 1 : 0;

  if (COMMON_PASSWORDS.has(password.toLowerCase())) score = Math.min(score, 1);

  const clamped = Math.max(0, Math.min(4, score)) as PasswordStrength["score"];
  const labels = ["", "Faible", "Moyen", "Bon", "Excellent"] as const;
  return { score: clamped, label: labels[clamped] };
}
