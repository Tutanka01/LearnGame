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

/**
 * IP du client, pour clé des fenêtres anti-abus.
 *
 * `x-forwarded-for` est forgable par le client : on ne s'y fie que si
 * l'opérateur déclare un proxy de confiance qui ÉCRASE l'en-tête
 * (`TRUST_PROXY=1` dans l'environnement). Sinon — conteneur exposé
 * directement, ou chaîne de proxy inconnue — tout le monde partage la clé
 * "local" : les plafonds par IP deviennent des plafonds globaux, dimensionnés
 * pour une salle de classe entière (60 connexions/minute). La protection fine
 * par COMPTE (10 tentatives/minute sur `login:${ip}:${compte}`) reste
 * intacte dans tous les cas : c'est elle qui borne le test des mots de passe.
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "local";
}
