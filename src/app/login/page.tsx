import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage() {
  // Déjà connecté : le formulaire n'a plus rien à faire ici.
  const user = await getCurrentUser();
  if (user) redirect("/");

  // Suspense : requis autour de LoginForm, qui lit les search params (?next=).
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
