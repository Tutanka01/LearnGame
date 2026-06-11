// Limiteur de débit en mémoire (fenêtre fixe). Suffisant pour ce déploiement :
// un seul process Node (build standalone en Docker). Aucune dépendance.

const buckets = new Map<string, { count: number; resetAt: number }>();

/** true si l'appel est autorisé, false s'il dépasse `max` appels par fenêtre. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  // GC paresseux : on purge les fenêtres expirées quand la table grossit.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/** IP du client (derrière un éventuel reverse proxy). */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
