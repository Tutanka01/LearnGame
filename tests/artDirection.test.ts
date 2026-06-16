// Test du randomiseur d'art direction. Lancer depuis la racine :
//   npx -y tsx tests/artDirection.test.ts

import {
  ART_DIRECTIONS,
  pickArtDirection,
  describeArtDirection,
} from "../src/lib/artDirection";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

// 1. Le tirage seedé est déterministe (même seed → même direction).
const a = pickArtDirection("photosynthèse");
const b = pickArtDirection("photosynthèse");
check("tirage seedé déterministe", a.id === b.id);

// 2. Des seeds différents couvrent plusieurs directions (pas un seul bucket).
const ids = new Set(
  Array.from({ length: 200 }, (_, i) => pickArtDirection(`sujet-${i}`).id)
);
check("le seed distribue sur plusieurs directions", ids.size >= 4);

// 3. Toute direction a une palette complète en hex et un fontStack non vide.
const hex = /^#[0-9a-f]{6}$/i;
const allValid = ART_DIRECTIONS.every(
  (ad) =>
    ad.fontStack.length > 0 &&
    Object.values(ad.palette).every((c) => hex.test(c))
);
check("palettes hex valides + fontStack présent", allValid);

// 4. Aucune police distante (pas de http/https dans le fontStack).
const noRemoteFonts = ART_DIRECTIONS.every((ad) => !/https?:/i.test(ad.fontStack));
check("polices système uniquement (pas de CDN)", noRemoteFonts);

// 5. La description injecte bien les hex de la palette.
const desc = describeArtDirection(a);
check("la description contient les hex de la palette", desc.includes(a.palette.accent));

// 6. Ids uniques.
check(
  "ids de direction uniques",
  new Set(ART_DIRECTIONS.map((d) => d.id)).size === ART_DIRECTIONS.length
);

console.log(failures === 0 ? "\nTous les tests passent." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
