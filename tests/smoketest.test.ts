// Test du smoke-test runtime. Lancer depuis la racine :
//   npx -y tsx tests/smoketest.test.ts

import {
  extractHandlerCallees,
  checkHandlerWiring,
  bootGameHtml,
  smokeTestGameHtml,
} from "../src/lib/smoketest";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

// --- Jeux de test ----------------------------------------------------------

const GOOD = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Test</title></head>
<body>
<button onclick="commencer()">Commencer</button>
<button onclick="repondre(2)">Réponse</button>
<div id="score">0</div>
<script>
let score = 0;
function commencer() { document.getElementById('score').textContent = '0'; }
function repondre(n) {
  score += n;
  document.getElementById('score').textContent = String(score);
  window.parent.postMessage({ type: "learngame:complete", score: score, maxScore: 10 }, "*");
}
commencer();
</script>
</body></html>`;

// Bouton mort : onclick="valider()" mais valider n'existe pas.
const DEAD_BUTTON = GOOD.replace('onclick="repondre(2)"', 'onclick="valider()"');

// Plante au démarrage : appelle une fonction inexistante au boot.
const BOOT_CRASH = GOOD.replace("commencer();", "demarrerLeJeuQuiNexistePas();");

// Jeu à base de canvas : valide mais jsdom n'implémente pas le contexte 2D.
// Ne doit PAS être rejeté (stub + filtrage du bruit jsdom).
const CANVAS_GAME = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Canvas</title></head>
<body>
<canvas id="c" width="300" height="150"></canvas>
<button onclick="dessiner()">Dessiner</button>
<script>
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
function dessiner() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 100, 100);
  const g = ctx.createLinearGradient(0, 0, 100, 0);
  g.addColorStop(0, '#000');
  const w = ctx.measureText('x').width;
}
ctx.fillRect(0, 0, 10, 10);
window.parent.postMessage({ type: "learngame:complete", score: 1, maxScore: 1 }, "*");
</script>
</body></html>`;

async function main() {
  // 1. Câblage (pur) — bon jeu : aucun appel manquant.
  check("câblage : bon jeu accepté", checkHandlerWiring(GOOD) === null);

  // 2. Extraction des callees (ignore les natifs / méthodes).
  const callees = extractHandlerCallees(GOOD).sort();
  check(
    "câblage : extrait commencer + repondre uniquement",
    callees.length === 2 && callees.includes("commencer") && callees.includes("repondre")
  );

  // 3. Bouton mort détecté.
  const dead = checkHandlerWiring(DEAD_BUTTON);
  check("câblage : bouton mort détecté", dead !== null && dead.includes("valider"));

  // 4. Boot — bon jeu : pas d'erreur.
  check("boot : bon jeu accepté", (await bootGameHtml(GOOD)) === null);

  // 5. Boot — crash au démarrage détecté.
  const crash = await bootGameHtml(BOOT_CRASH);
  check("boot : crash au démarrage détecté", crash !== null);

  // 6. Canvas : ni le câblage ni le boot ne doivent rejeter (pas de faux positif).
  check("canvas : câblage OK", checkHandlerWiring(CANVAS_GAME) === null);
  check("canvas : boot OK (jsdom stub, pas de faux rejet)", (await bootGameHtml(CANVAS_GAME)) === null);

  // 7. smokeTest complet : bon jeu OK, bouton mort rejeté (avant même le boot).
  check("smokeTest : bon jeu accepté", (await smokeTestGameHtml(GOOD)) === null);
  check("smokeTest : bouton mort rejeté", (await smokeTestGameHtml(DEAD_BUTTON)) !== null);

  console.log(failures === 0 ? "\nTous les tests passent." : `\n${failures} échec(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
