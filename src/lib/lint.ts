// Lint mécanique du HTML généré : attrape les défauts de QUALITÉ qu'un prompt
// ne garantit pas et que validateGameHtml() (syntaxe seule) ne voit pas —
// commentaires de réflexion du modèle livrés dans le fichier, mélange biaisé,
// console.log restants, TODO, fonctions définies deux fois…
//
// Complémentaire de validate.ts et smoketest.ts :
//  - validate décide si un jeu PEUT être sauvegardé (bloquant) ;
//  - smoketest teste le runtime (conservateur, quasi bloquant) ;
//  - lint liste ce qui DEVRAIT être amélioré (jamais bloquant) : ses findings
//    nourrissent la relecture QA (runQaSession dans generation.ts), qui est le
//    seul juge de ce qui mérite une retouche. Un faux positif ne coûte donc
//    jamais une régénération — d'où un seuil de tolérance plus bas qu'ailleurs.
//
// Module PUR : regex uniquement, aucune exécution, testable avec npx tsx.

/**
 * Retire les chaînes littérales (", ', `) du code. On ne cherche les
 * commentaires QUE hors chaînes : une URL "https://…" ne doit pas ressembler
 * à un commentaire de ligne, et « Let's play » dans un texte de jeu n'est pas
 * une réflexion du modèle. Approximation volontaire (les template literals
 * imbriqués ne sont pas parsés finement) : suffisante pour un lint non bloquant.
 */
function stripStrings(code: string): string {
  return code.replace(
    /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
    '""'
  );
}

// Marqueurs de « dialogue intérieur » du modèle, typiques des commentaires
// qu'il laisse derrière lui ("// Actually, let's keep the old logic…").
const REFLECTION = /\b(?:let'?s|actually|hmm+|oops|wait,\s*(?:no|maybe|let'?s))\b/i;
const TODO_MARKER = /\b(?:TODO|FIXME|XXX)\b/;
// Le mélange par tri aléatoire est biaisé (chaque permutation n'a pas la même
// probabilité) : le prompt impose Fisher-Yates, on détecte l'anti-pattern.
const BIASED_SHUFFLE =
  /\.sort\s*\(\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*\{[^}]{0,80})\s*Math\.random\s*\(\s*\)/;
const CONSOLE_LOG = /\bconsole\s*\.\s*log\s*\(/;
// Déclarations de fonctions (pas les méthodes d'objet, trop de faux positifs
// légitimes : deux objets distincts peuvent avoir une méthode de même nom).
const FN_DECL = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;

/**
 * Analyse un HTML de jeu et retourne une liste de défauts, chacun en une
 * phrase française actionnable (destinée au modèle de QA). Vide si rien à
 * signaler — le lint ne juge jamais la recevabilité du jeu.
 */
export function lintGameHtml(html: string): string[] {
  const findings: string[] = [];

  // On analyse script par script : les chaînes sont retirées d'abord, puis on
  // collecte les commentaires (ligne + bloc) pour y chercher les réflexions.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const allComments: string[] = [];
  const fnCounts = new Map<string, number>();
  let hasBiasedShuffle = false;
  let hasConsoleLog = false;

  for (const [, code] of scripts) {
    const stripped = stripStrings(code);
    // Commentaires de ligne : "//…" (les "://" des URL ont disparu avec les
    // chaînes) ; commentaires de bloc : /*…*/.
    for (const m of stripped.matchAll(/\/\/[^\n]*/g)) allComments.push(m[0]);
    for (const m of stripped.matchAll(/\/\*[\s\S]*?\*\//g)) allComments.push(m[0]);

    if (BIASED_SHUFFLE.test(stripped)) hasBiasedShuffle = true;
    if (CONSOLE_LOG.test(stripped)) hasConsoleLog = true;
    for (const m of stripped.matchAll(FN_DECL)) {
      fnCounts.set(m[1], (fnCounts.get(m[1]) ?? 0) + 1);
    }
  }

  // TODO/FIXME ne sont cherchés que dans les commentaires : un "todo" dans
  // une chaîne de jeu est du contenu, pas du travail restant.
  const hasTodo = allComments.some((c) => TODO_MARKER.test(c));

  if (allComments.some((c) => REFLECTION.test(c))) {
    findings.push(
      'des commentaires de réflexion interne du modèle (« Let\'s… », « Actually… », « Wait, no… ») restent dans le code : supprime tous ces commentaires, le fichier livré doit être définitif'
    );
  }
  if (hasTodo) {
    findings.push(
      "le code contient des marqueurs TODO/FIXME : le jeu livré doit être complet, aucun travail restant ne doit être mentionné"
    );
  }
  if (hasBiasedShuffle) {
    findings.push(
      "le mélange des éléments repose sur .sort(() => Math.random() - 0.5), ce qui est biaisé : remplace-le par un mélange de Fisher-Yates (boucle inversée avec échange aléatoire)"
    );
  }
  if (hasConsoleLog) {
    findings.push(
      "des console.log de débogage subsistent dans le script : supprime-les (le jeu n'a rien à écrire en console en production)"
    );
  }
  const dupes = [...fnCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([name]) => name);
  if (dupes.length > 0) {
    findings.push(
      `plusieurs fonctions portent le même nom (${dupes.slice(0, 3).join(", ")}) : la seconde définition écrase silencieusement la première — fusionne ou renomme`
    );
  }

  return findings;
}
