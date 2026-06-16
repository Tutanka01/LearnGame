// Randomiseur d'art direction — module PUR (aucun import Next/DB/réseau).
//
// La fadeur visuelle des jeux vient surtout du fait que le modèle, livré à
// lui-même, pioche toujours le même dégradé violet. On lui IMPOSE donc une
// direction artistique tirée d'une table curée : palette hex précise, stack de
// polices SYSTÈME (jamais de CDN — contrainte d'autonomie du fichier) et un
// "langage de mouvement". Deux jeux sur le même sujet auront alors un look
// franchement différent, de façon déterministe.
//
// La direction est injectée dans le prompt du DIRECTOR (cf. prompts.ts), qui la
// développe en brief, puis le BUILDER l'implémente.

export interface ArtDirection {
  id: string;
  /** Thème assumé, nommé — donne l'ambiance générale. */
  theme: string;
  /** Palette en hex, avec rôles sémantiques. */
  palette: {
    bg1: string; // dégradé de fond, début
    bg2: string; // dégradé de fond, fin
    surface: string; // cartes / panneaux
    ink: string; // texte principal (contraste AA sur surface)
    accent: string; // couleur de marque
    accent2: string; // couleur secondaire
    success: string;
    error: string;
    warn: string;
  };
  /** Stack de polices SYSTÈME uniquement (pas de @font-face distant). */
  fontStack: string;
  /** Style typographique (poids, casse, letter-spacing) — distingue les identités. */
  typography: string;
  /** "Langage de mouvement" : comment les choses bougent. */
  motion: string;
}

// Table curée. Chaque entrée a une identité visuelle nette et distincte des
// autres — c'est ce qui crée la variété perçue entre deux jeux.
export const ART_DIRECTIONS: ArtDirection[] = [
  {
    id: "arcade-neon",
    theme: "Arcade néon cyberpunk : nuit électrique, enseignes lumineuses, énergie d'une borne d'arcade",
    palette: {
      bg1: "#0a0a1f", bg2: "#1a0b2e", surface: "#15162e", ink: "#e8e9ff",
      accent: "#22d3ee", accent2: "#f472b6", success: "#34d399", error: "#fb7185", warn: "#fbbf24",
    },
    fontStack: '"Segoe UI", system-ui, -apple-system, sans-serif',
    typography: "Titres en MAJUSCULES, gras, letter-spacing large ; chiffres de score en mono. Lueurs (text-shadow néon) sur les éléments forts.",
    motion: "Vif et punchy : flashs de lueur (glow) sur réussite, secousse glitch sur erreur, scale rapide au clic, scanlines subtiles.",
  },
  {
    id: "labo-scientifique",
    theme: "Laboratoire scientifique moderne : propre, précis, instruments de mesure, lumière clinique",
    palette: {
      bg1: "#f8fafc", bg2: "#eef2f7", surface: "#ffffff", ink: "#1e293b",
      accent: "#0d9488", accent2: "#f97316", success: "#16a34a", error: "#dc2626", warn: "#d97706",
    },
    fontStack: 'ui-sans-serif, "Helvetica Neue", Arial, system-ui, sans-serif',
    typography: "Sans-serif net, beaucoup de blanc, libellés en petites capitales espacées, données alignées en grille.",
    motion: "Mesuré et précis : transitions douces (ease), apparitions par fondu, jauges qui se remplissent progressivement, coches animées.",
  },
  {
    id: "terminal-retro",
    theme: "Terminal rétro / hacker : phosphore vert sur fond noir, esthétique CRT des années 80",
    palette: {
      bg1: "#020805", bg2: "#04140a", surface: "#06180d", ink: "#7dffa0",
      accent: "#39ff14", accent2: "#00e5ff", success: "#39ff14", error: "#ff5555", warn: "#ffcc00",
    },
    fontStack: '"SF Mono", "Cascadia Code", "Consolas", ui-monospace, monospace',
    typography: "Tout en monospace, curseur clignotant, préfixes type prompt ($ >), effet machine à écrire sur les textes.",
    motion: "Effet typewriter (texte qui s'écrit), clignotement du curseur, léger flicker CRT, pas d'animations rondes.",
  },
  {
    id: "manuscrit-parchemin",
    theme: "Manuscrit / cabinet de curiosités : parchemin, encre sépia, élégance d'un vieux grimoire savant",
    palette: {
      bg1: "#f4ecd8", bg2: "#e8dcc0", surface: "#fbf6e9", ink: "#3b2f2f",
      accent: "#8b2e2e", accent2: "#1f6f5c", success: "#4d7c2f", error: "#a83232", warn: "#b5740f",
    },
    fontStack: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    typography: "Serif éditorial, lettrines, italiques pour l'emphase, filets de séparation fins, mise en page de livre.",
    motion: "Doux et organique : fondu façon encre qui sèche, pages qui tournent (slide horizontal), aucune brusquerie.",
  },
  {
    id: "cosmos",
    theme: "Cosmos / exploration spatiale : nuit étoilée profonde, nébuleuses, voyage interstellaire",
    palette: {
      bg1: "#0b1026", bg2: "#241546", surface: "#141a38", ink: "#e6ebff",
      accent: "#fbbf24", accent2: "#a78bfa", success: "#4ade80", error: "#f87171", warn: "#fb923c",
    },
    fontStack: '"Avenir Next", "Segoe UI", system-ui, sans-serif',
    typography: "Sans-serif aéré, titres lumineux (étoile/or), beaucoup d'espace négatif évoquant le vide spatial.",
    motion: "Flottant et parallaxe : éléments qui dérivent lentement, étoiles scintillantes (CSS), apparitions par zoom léger.",
  },
  {
    id: "neo-brutalisme",
    theme: "Néo-brutalisme : couleurs vives à plat, bordures noires épaisses, ombres dures, ludique et franc",
    palette: {
      bg1: "#ffe5ec", bg2: "#ffd6a5", surface: "#fffefb", ink: "#111111",
      accent: "#ff4d6d", accent2: "#3a86ff", success: "#06d6a0", error: "#ef233c", warn: "#ffd60a",
    },
    fontStack: '"Arial Black", "Helvetica Neue", system-ui, sans-serif',
    typography: "Très gras, contours noirs (2-3px), ombres portées dures et décalées, pas d'arrondis ou très peu.",
    motion: "Sec et franc : décalages nets au survol (translate), pas de fondu mou, rebonds courts, feedback immédiat.",
  },
  {
    id: "pastel-doux",
    theme: "Pastel doux / cosy : tons tendres, formes rondes, ambiance bienveillante et rassurante",
    palette: {
      bg1: "#fdf2f8", bg2: "#ecfeff", surface: "#ffffff", ink: "#334155",
      accent: "#f472b6", accent2: "#38bdf8", success: "#34d399", error: "#fb7185", warn: "#fbbf24",
    },
    fontStack: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
    typography: "Coins très arrondis, poids moyens et chaleureux, beaucoup d'air, emojis bienvenus, contrastes doux mais AA.",
    motion: "Rebondissant et amical : micro-rebonds (bounce), apparitions par scale élastique, confettis pastel, riens d'agressif.",
  },
  {
    id: "blueprint",
    theme: "Blueprint technique : plan d'ingénieur, lignes blanches sur bleu, grille, esthétique CAO",
    palette: {
      bg1: "#0c2a4d", bg2: "#0a3a66", surface: "#0e3358", ink: "#e6f0ff",
      accent: "#7dd3fc", accent2: "#fde047", success: "#86efac", error: "#fca5a5", warn: "#fdba74",
    },
    fontStack: '"Consolas", "SF Mono", ui-monospace, "Segoe UI", monospace',
    typography: "Fond quadrillé subtil, traits fins blancs/cyan, libellés techniques en mono, cotes et annotations façon plan.",
    motion: "Tracé qui se dessine (stroke-dashoffset SVG), apparitions par lignes, transitions nettes et techniques.",
  },
];

/** Hash déterministe simple (FNV-1a) d'une chaîne → entier non signé. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Tire une direction artistique. Avec un `seed` (ex. l'id du jeu ou le sujet),
 * le tirage est déterministe et reproductible (utile pour les tests et pour
 * qu'un même jeu garde son identité). Sans seed, tirage aléatoire.
 */
export function pickArtDirection(seed?: string): ArtDirection {
  const idx =
    seed != null
      ? hashSeed(seed) % ART_DIRECTIONS.length
      : Math.floor(Math.random() * ART_DIRECTIONS.length);
  return ART_DIRECTIONS[idx];
}

/** Bloc de texte (français) injecté dans le prompt du Director. */
export function describeArtDirection(ad: ArtDirection): string {
  const p = ad.palette;
  return `THÈME IMPOSÉ : ${ad.theme}
PALETTE (utilise ces hex précis, pas d'autres couleurs dominantes) :
- Fond (dégradé) : ${p.bg1} → ${p.bg2}
- Surfaces/cartes : ${p.surface}
- Texte : ${p.ink}
- Accent principal : ${p.accent}
- Accent secondaire : ${p.accent2}
- Succès : ${p.success} · Erreur : ${p.error} · Indice/alerte : ${p.warn}
TYPOGRAPHIE (polices SYSTÈME uniquement) : font-family ${ad.fontStack}. ${ad.typography}
MOUVEMENT : ${ad.motion}`;
}
