import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import GenerationProvider from "@/components/GenerationProvider";
import ToastProvider from "@/components/ui/ToastProvider";
import ConfirmProvider from "@/components/ui/ConfirmDialog";
import "./globals.css";

// Couples typographiques : un grotesque de titrage à fort caractère (Bricolage)
// pour la marque et les en-têtes, un corps de texte d'interface très lisible
// (Geist), et un mono pour le code et les compteurs (timers, scores).
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});
const sans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: {
    default: "LearnGame — Apprends en jouant",
    template: "%s · LearnGame",
  },
  description:
    "Décris ce que tu veux apprendre, l'IA crée un jeu sur mesure pour te l'enseigner.",
  applicationName: "LearnGame",
};

export const viewport: Viewport = {
  themeColor: "#080910",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="antialiased app-bg">
        <ToastProvider>
          <ConfirmProvider>
            <GenerationProvider>{children}</GenerationProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
