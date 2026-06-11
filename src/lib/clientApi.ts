"use client";

// Wrapper fetch côté client : fin des échecs silencieux.
//  - 401 → redirection vers /login (avec retour à la page courante) ;
//  - autres erreurs → HttpError portant le message français du serveur,
//    que l'appelant affiche en toast.

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new HttpError(0, "Impossible de contacter le serveur. Vérifie ta connexion.");
  }

  if (res.status === 401) {
    // Session expirée : on renvoie à la connexion en gardant la destination.
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    throw new HttpError(401, "Session expirée — reconnecte-toi.");
  }

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new HttpError(res.status, data.error || `Erreur serveur (${res.status}).`);
  }
  return data;
}
