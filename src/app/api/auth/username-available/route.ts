import db from "@/lib/db";
import { apiError, handleApi } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { validateUsername } from "@/lib/authValidate";

// Vérification en direct de la disponibilité d'un nom, pour le formulaire
// d'inscription. Le refus d'un nom pris au moment de la soumission existe déjà ;
// ici on évite juste de faire taper un formulaire complet pour rien.
// Débit plafonné : praticable à l'usage, pas énumérable massivement.
export async function GET(req: Request) {
  return handleApi(async () => {
    if (!rateLimit(`name-check:${clientIp(req)}`, 30, 60_000)) {
      return apiError(429, "Trop de vérifications. Patiente un instant.");
    }
    const name = (new URL(req.url).searchParams.get("name") ?? "").trim();
    const invalid = validateUsername(name);
    if (invalid) return Response.json({ available: false, reason: invalid });
    const taken = db.prepare("SELECT 1 FROM users WHERE username = ?").get(name);
    return Response.json({ available: !taken });
  });
}
