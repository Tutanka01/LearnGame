import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LearnGame — Apprends en jouant",
  description:
    "Décris ce que tu veux apprendre, l'IA crée un jeu sur mesure pour te l'enseigner.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
