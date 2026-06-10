import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import GenerationProvider from "@/components/GenerationProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

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
  themeColor: "#0a0c13",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="antialiased app-bg">
        <GenerationProvider>{children}</GenerationProvider>
      </body>
    </html>
  );
}
