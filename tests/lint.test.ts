// Test ad hoc de lintGameHtml (lint de qualité, src/lib/lint.ts) et de la
// normalisation du viewport (normalizeGameHtml, src/lib/prompts.ts).
// Exécuter : npx -y tsx tests/lint.test.ts
// Les fixtures reprennent des défauts RÉELS observés dans des jeux générés
// (commentaires de réflexion livrés, .sort(() => Math.random() - 0.5),
// user-scalable=no…) et des cas sains qui ne doivent PAS être signalés.

import { lintGameHtml } from "../src/lib/lint";
import { normalizeGameHtml } from "../src/lib/prompts";

let failures = 0;
function checkLint(name: string, html: string, expected: RegExp[]) {
  const result = lintGameHtml(html);
  for (const re of expected) {
    if (!result.some((f) => re.test(f))) {
      failures++;
      console.error(`✗ ${name} → finding manquant : ${re} (reçu : ${JSON.stringify(result)})`);
      return;
    }
  }
  if (result.length !== expected.length) {
    failures++;
    console.error(
      `✗ ${name} → ${result.length} finding(s) au lieu de ${expected.length} : ${JSON.stringify(result)}`
    );
    return;
  }
  console.log(`✓ ${name}`);
}

const game = (body: string) =>
  `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

// --- Jeu propre : aucun finding ----------------------------------------------

checkLint(
  "jeu propre : zéro finding",
  game(`<script>
    // Mélange de Fisher-Yates
    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    function startGame() { console.error("départ"); }
    parent.postMessage({type:"learngame:complete",score:1,maxScore:1},"*");
  </script>`),
  []
);

// Un texte de jeu contenant ces mots dans une CHAÎNE n'est pas une réflexion.
checkLint(
  "chaînes de jeu avec apostrophes/URL : pas de faux positif",
  game(`<script>
    const msg = "Let's go! Clique https://example.com pour l'aide";
    const base = 'https://api.exemple.fr/chemin';
    parent.postMessage({type:"learngame:complete",score:1,maxScore:1},"*");
  </script>`),
  []
);

// --- Commentaires de réflexion du modèle (défaut réel constaté) ---------------

checkLint(
  "commentaire de réflexion en ligne",
  game(`<script>
    // Actually, let's keep the old logic here
    parent.postMessage({type:"learngame:complete"},"*");
  </script>`),
  [/réflexion/]
);

checkLint(
  "commentaire de réflexion en bloc",
  game(`<script>
    /* Hmm, wait, maybe we should shuffle here? No, keep order. */
    parent.postMessage({type:"learngame:complete"},"*");
  </script>`),
  [/réflexion/]
);

// --- Mélange biaisé (défaut réel constaté) ------------------------------------

checkLint(
  "mélange .sort(() => Math.random() - 0.5) signalé",
  game(
    `<script>const a = [1,2,3].sort(() => Math.random() - 0.5); parent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  [/Fisher-Yates/]
);

checkLint(
  "mélange variante fonction anonyme signalé",
  game(
    `<script>const a = [1,2,3].sort(function(){ return Math.random() - 0.5; }); parent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  [/Fisher-Yates/]
);

// --- console.log et TODO ------------------------------------------------------

checkLint(
  "console.log restant signalé (console.error toléré)",
  game(
    `<script>console.log("debug", 42); console.error("gardé"); parent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  [/console\.log/]
);

checkLint(
  "TODO dans un commentaire signalé",
  game(
    `<script>// TODO: ajouter le niveau 5\nparent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  [/TODO/]
);

checkLint(
  "le mot « todo » dans une chaîne de jeu n'est pas signalé",
  game(
    `<script>const page = "Ta todo-liste du jour"; // affichage\nparent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  []
);

// --- Fonctions définies deux fois (défaut réel constaté) -----------------------

checkLint(
  "double définition de fonction signalée",
  game(
    `<script>function dropItem(x) { return x; } function dropItem(y) { return y; } parent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  [/même nom.*dropItem/]
);

checkLint(
  "deux fonctions de noms différents : rien à signaler",
  game(
    `<script>function dropItem(x) { return x; } function takeItem(y) { return y; } parent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  []
);

// --- Normalisation du viewport (normalizeGameHtml) -----------------------------

let pass = true;
function checkNorm(name: string, input: string, predicate: (out: string) => boolean) {
  const out = normalizeGameHtml(input);
  if (!predicate(out)) {
    failures++;
    console.error(`✗ ${name} → ${JSON.stringify(out)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

checkNorm(
  "user-scalable=no et maximum-scale retirés, le reste conservé",
  `<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"></head></html>`,
  (out) => out.includes("initial-scale=1.0") && !out.includes("user-scalable") && !out.includes("maximum-scale")
);
checkNorm(
  "user-scalable=yes conservé (choix explicite valide)",
  `<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes"></head></html>`,
  (out) => out.includes("user-scalable=yes")
);
checkNorm(
  "viewport vide après nettoyage : fallback complet",
  `<html><head><meta name="viewport" content="user-scalable=no"></head></html>`,
  (out) => out.includes("width=device-width, initial-scale=1")
);
checkNorm(
  "viewport absente : injectée",
  `<html><head><title>t</title></head></html>`,
  (out) => out.includes('<meta name="viewport" content="width=device-width, initial-scale=1">')
);
checkNorm(
  "viewport correcte : inchangée",
  `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head></html>`,
  (out) =>
    out ===
    `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head></html>`
);

if (failures > 0) {
  console.error(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log("\nTous les tests lint passent.");
