import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hashPassword, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password, code } = await req.json().catch(() => ({}));

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const name = username.trim();
  if (name.length < 3 || name.length > 32 || !/^[\p{L}\p{N}_.-]+$/u.test(name)) {
    return NextResponse.json(
      { error: "Nom d'utilisateur : 3 à 32 caractères (lettres, chiffres, _ . -)." },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Le mot de passe doit faire au moins 6 caractères." },
      { status: 400 }
    );
  }

  const requiredCode = process.env.REGISTRATION_CODE?.trim();
  if (requiredCode && code !== requiredCode) {
    return NextResponse.json({ error: "Code d'inscription incorrect." }, { status: 403 });
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
  if (existing) {
    return NextResponse.json({ error: "Ce nom d'utilisateur est déjà pris." }, { status: 409 });
  }

  const result = db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(name, hashPassword(password));

  await setSessionCookie(Number(result.lastInsertRowid));
  return NextResponse.json({ ok: true });
}
