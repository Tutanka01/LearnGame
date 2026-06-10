import { NextRequest, NextResponse } from "next/server";
import db, { User } from "@/lib/db";
import { verifyPassword, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username.trim()) as unknown as User | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json(
      { error: "Nom d'utilisateur ou mot de passe incorrect." },
      { status: 401 }
    );
  }

  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
