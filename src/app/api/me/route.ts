import { handleApi, requireUser } from "@/lib/api";

// L'utilisateur courant — le front n'a plus à le déduire d'autres réponses.
export async function GET() {
  return handleApi(async () => {
    const user = await requireUser();
    return Response.json({ user: { id: user.id, username: user.username } });
  });
}
