import { NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { assertSameOrigin, handleApi } from "@/lib/api";

// Déconnexion : révocation de la session EN BASE (un cookie volé ne vaut plus
// rien après) puis suppression du cookie. Idempotent : appeler sans session
// répond ok, pour que le bouton marche en toutes circonstances.
export async function POST(req: NextRequest) {
  return handleApi(async () => {
    assertSameOrigin(req);
    await clearSessionCookie();
    return Response.json({ ok: true });
  });
}
