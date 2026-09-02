"use client";

// Filet ultime : si le layout racine lui-même crashe, ce composant remplace
// TOUT le document (il doit donc redéclarer <html> et <body>). Message en
// français, cohérent avec la charte, et moyen de repartir proprement.

import { RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080910",
          color: "#eceefb",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
            🎮
          </div>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>LearnGame n&apos;a pas pu s&apos;afficher</h1>
          <p style={{ color: "#99a1bd", fontSize: 14, marginBottom: 20, maxWidth: 420 }}>
            Une erreur grave a interrompu le chargement de la page. Recharge pour
            reprendre — tes données sont enregistrées.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#8b7cff",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Recharger la page
          </button>
          {/* digest conservé pour le support (correspond aux logs serveur) */}
          <span hidden>{error?.digest}</span>
        </div>
      </body>
    </html>
  );
}
