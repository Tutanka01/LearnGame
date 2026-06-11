// Validation mécanique du HTML généré, AVANT sauvegarde en base.
// Un prompt ne garantit jamais l'absence d'erreur (troncature, syntaxe…) :
// on vérifie donc le document lui-même, et on relance la génération s'il est invalide.
// Tourne uniquement côté serveur (node:vm).

import vm from "node:vm";

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * Vérifie qu'un jeu généré est complet et exécutable.
 * Retourne `null` si tout est bon, sinon la raison du rejet (en français,
 * réutilisée telle quelle dans le message renvoyé au modèle et à l'élève).
 */
export function validateGameHtml(html: string): string | null {
  if (!/<\/html>\s*$/i.test(html)) {
    return "le document ne se termine pas par </html> (réponse tronquée)";
  }

  // Les commentaires HTML et les blocs <script>…</script> COMPLETS sont retirés
  // avant de chercher une ouverture orpheline : un "<script" dans une chaîne JS
  // (à l'intérieur d'un bloc complet) ne déclenche plus de faux rejet, alors
  // qu'une vraie balise jamais fermée reste détectée — comme dans le navigateur.
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const blocks = [...withoutComments.matchAll(SCRIPT_BLOCK)];
  const residue = withoutComments.replace(SCRIPT_BLOCK, "");

  if (blocks.length === 0 && !/<script\b/i.test(residue)) {
    return "le document ne contient aucun <script> : le jeu n'a pas de logique";
  }
  if (/<script\b/i.test(residue)) {
    return "une balise <script> n'est jamais fermée (réponse tronquée)";
  }

  for (const [, attrs, code] of blocks) {
    if (/type\s*=\s*["']?module/i.test(attrs)) {
      return "un <script type=\"module\"> est utilisé : les fonctions ne seraient pas accessibles depuis les attributs onclick";
    }
    if (/\bsrc\s*=/i.test(attrs)) {
      return "un <script src=…> externe est utilisé : le jeu doit être 100% autonome";
    }
    // Parse le JS sans l'exécuter : toute erreur de syntaxe (accolade non fermée
    // après troncature, etc.) casserait TOUT le script dans le navigateur.
    try {
      new vm.Script(code, { filename: "jeu.js" });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return `le JavaScript contient une erreur de syntaxe (${detail})`;
    }
  }

  if (!html.includes("learngame:complete")) {
    return "le postMessage learngame:complete est absent : le score ne serait jamais enregistré";
  }

  return null;
}
