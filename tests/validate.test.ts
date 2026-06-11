// Test ad hoc de validateGameHtml — exécuter : npx -y tsx tests/validate.test.ts
// Vérifie les deux directions : plus de faux rejets ("<script" dans une chaîne
// JS ou un commentaire), ET la détection de troncature toujours intacte.

import { validateGameHtml } from "../src/lib/validate";

let failures = 0;
function check(name: string, html: string, expected: "ok" | RegExp) {
  const result = validateGameHtml(html);
  const pass = expected === "ok" ? result === null : result !== null && expected.test(result);
  if (!pass) {
    failures++;
    console.error(`✗ ${name} → ${JSON.stringify(result)} (attendu : ${expected})`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const game = (body: string) =>
  `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

// --- Cas valides --------------------------------------------------------------

check(
  "jeu minimal valide",
  game(`<script>postMessage({type:"learngame:complete",score:1,maxScore:1});</script>`),
  "ok"
);

check(
  `"<script" dans une chaîne JS d'un bloc complet (ancien faux rejet)`,
  game(
    `<script>const ex = "<script>alert(1)<\\/script>"; parent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  "ok"
);

check(
  "<script dans un commentaire HTML",
  game(
    `<!-- exemple : <script src="x"> --><script>parent.postMessage({type:"learngame:complete"},"*");</script>`
  ),
  "ok"
);

check(
  "deux blocs script complets",
  game(
    `<script>const a = 1;</script><script>parent.postMessage({type:"learngame:complete",score:a,maxScore:1},"*");</script>`
  ),
  "ok"
);

// --- Cas invalides (la détection ne doit PAS s'être affaiblie) ------------------

check("document tronqué (pas de </html>)", "<!DOCTYPE html><html><body><script>", /tronquée/);

check(
  "balise <script> jamais fermée",
  game(`<script>const x = 1; // learngame:complete`),
  /jamais fermée/
);

check("aucun script", game("<p>rien</p>"), /aucun <script>/);

check(
  "erreur de syntaxe JS",
  game(`<script>function f( { // learngame:complete</script>`),
  /erreur de syntaxe/
);

check(
  "script type=module",
  game(`<script type="module">parent.postMessage({type:"learngame:complete"},"*");</script>`),
  /module/
);

check(
  "script src externe",
  game(
    `<script src="https://cdn.example/x.js"></script><script>/* learngame:complete */</script>`
  ),
  /autonome/
);

check(
  "postMessage learngame:complete absent",
  game(`<script>const x = 1;</script>`),
  /learngame:complete/
);

if (failures > 0) {
  console.error(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log("\nTous les tests validate.ts passent.");
