import { handleApi, requireUser } from "@/lib/api";

// L'utilisateur courant — le front n'a plus à le déduire d'autres réponses.
// Objet sanitisé : jamais de hash de mot de passe ici.
export async function GET() {
  return handleApi(async () => {
    const { id, username, role, status } = await requireUser();
    return Response.json({ user: { id, username, role, status } });
  });
}
