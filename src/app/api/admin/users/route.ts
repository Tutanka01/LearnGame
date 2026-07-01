import { NextRequest } from "next/server";
import db from "@/lib/db";
import { handleApi, requireAdmin } from "@/lib/api";

// Liste des comptes en attente d'approbation (admin uniquement).
export async function GET(_req: NextRequest) {
  return handleApi(async () => {
    await requireAdmin();

    const users = db
      .prepare("SELECT id, username, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC")
      .all();

    return Response.json({ users });
  });
}
