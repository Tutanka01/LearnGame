// Smoke-test runtime du HTML généré, APRÈS validateGameHtml() (qui ne vérifie
// que la syntaxe). Objectif : attraper ce qu'un parseur ne voit pas — un jeu
// qui plante au démarrage (écran blanc) ou un bouton qui appelle une fonction
// inexistante (bouton mort). Tourne uniquement côté serveur.
//
// Deux contrôles, du plus sûr au plus délicat :
//  1. CÂBLAGE (pur, statique) : toute fonction appelée depuis un attribut
//     onclick/oninput/… doit être définie quelque part dans le script.
//  2. BOOT (jsdom) : exécute le script au chargement et capture les exceptions
//     de démarrage.
//
// Principe directeur : CONSERVATEUR. Un faux rejet coûte une régénération
// entière. On ignore les lacunes de jsdom (canvas, scrollTo…) et, au moindre
// doute sur notre propre outillage, on laisse passer (retourne null).

import { JSDOM, VirtualConsole } from "jsdom";

// Identifiants à NE PAS considérer comme des fonctions du jeu : mots-clés JS et
// fonctions natives globales (elles existent toujours, ou ne sont pas des
// handlers du jeu). Évite les faux positifs du contrôle de câblage.
const IGNORED_CALLEES = new Set([
  // mots-clés / opérateurs suivis de "("
  "if", "for", "while", "switch", "catch", "return", "typeof", "function", "do",
  "else", "new", "delete", "void", "in", "of", "instanceof", "await", "yield",
  // natifs globaux usuels
  "alert", "confirm", "prompt", "parseInt", "parseFloat", "isNaN", "isFinite",
  "Number", "String", "Boolean", "Array", "Object", "Math", "JSON", "Date",
  "RegExp", "Map", "Set", "Symbol", "Promise", "setTimeout", "setInterval",
  "clearTimeout", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
  "encodeURIComponent", "decodeURIComponent", "Audio", "Image", "console",
  "window", "document", "event", "parseFloat", "structuredClone", "fetch",
]);

// Attribut événementiel inline : on...="...". On capture le corps du handler.
const INLINE_HANDLER = /\bon[a-z]+\s*=\s*("([^"]*)"|'([^']*)')/gi;
// Identifiant immédiatement suivi de "(", NON précédé d'un "." ou d'un autre
// caractère de mot (donc un appel "racine", pas une méthode obj.foo()).
const ROOT_CALL = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;

/** Noms de fonctions appelées depuis les attributs onclick/oninput/… (pures). */
export function extractHandlerCallees(html: string): string[] {
  const names = new Set<string>();
  for (const m of html.matchAll(INLINE_HANDLER)) {
    const body = m[2] ?? m[3] ?? "";
    for (const c of body.matchAll(ROOT_CALL)) {
      const name = c[1];
      if (!IGNORED_CALLEES.has(name)) names.add(name);
    }
  }
  return [...names];
}

/** Une fonction nommée est-elle définie quelque part dans le HTML/script ? */
function isDefined(html: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // function NAME(…) · NAME = … (var/let/const/window.NAME=) · NAME : function
  const def = new RegExp(
    `(function\\s+${n}\\b)|(\\b${n}\\s*=)|(\\b${n}\\s*:\\s*(?:async\\s+)?function)`,
  );
  return def.test(html);
}

/**
 * Contrôle de câblage (pur, sans jsdom) : chaque fonction appelée depuis un
 * handler inline doit être définie. Retourne la raison du rejet, ou null.
 */
export function checkHandlerWiring(html: string): string | null {
  const missing = extractHandlerCallees(html).filter((n) => !isDefined(html, n));
  if (missing.length === 0) return null;
  const list = missing.slice(0, 4).join(", ");
  return `un bouton appelle une ou des fonctions jamais définies dans le script (${list}) : il ne ferait rien au clic`;
}

// Messages jsdom à IGNORER : lacunes de l'implémentation, pas des bugs du jeu.
function isJsdomNoise(message: string): boolean {
  return (
    /not implemented/i.test(message) ||
    /could not load|failed to load|resource/i.test(message) ||
    /css/i.test(message) // erreurs de parsing CSS jsdom : non bloquantes
  );
}

// Stub universel "chaînable & appelable" : neutralise les API non implémentées
// par jsdom (canvas 2D surtout) sans faire planter le jeu.
function makeAnythingStub(): unknown {
  const handler: ProxyHandler<() => void> = {
    get(_t, prop) {
      if (prop === "width" || prop === "height") return 0;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "data") return [];
      return stub;
    },
    apply: () => stub,
    set: () => true,
  };
  const stub: unknown = new Proxy(function () {}, handler);
  return stub;
}

/**
 * Boot via jsdom : exécute le script au chargement, capture les exceptions de
 * démarrage. Retourne la raison du rejet, ou null (y compris en cas de doute :
 * on ne bloque jamais un jeu sur une limite de notre outillage).
 */
export async function bootGameHtml(html: string): Promise<string | null> {
  const errors: string[] = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err: Error) => {
    const msg = err?.message ?? String(err);
    if (!isJsdomNoise(msg)) {
      // jsdom préfixe les exceptions de script par "Uncaught [Type: msg]".
      errors.push(msg);
    }
  });

  let dom: JSDOM | null = null;
  try {
    dom = new JSDOM(html, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(window) {
        // Neutralise les API que jsdom n'implémente pas, pour ne pas confondre
        // une lacune de jsdom avec un bug du jeu. Cast permissif assumé : on
        // pose des stubs sur des propriétés que jsdom laisse vides.
        const w = window as unknown as Record<string, unknown> & {
          HTMLCanvasElement: { prototype: Record<string, unknown> };
          HTMLElement: { prototype: Record<string, unknown> };
          HTMLMediaElement: { prototype: Record<string, unknown> };
          setTimeout: (cb: () => void, ms: number) => number;
          clearTimeout: (id: number) => void;
          requestAnimationFrame?: unknown;
          AudioContext?: unknown;
        };
        try {
          w.HTMLCanvasElement.prototype.getContext = () => makeAnythingStub();
          w.scrollTo = () => {};
          w.scroll = () => {};
          w.matchMedia = () => ({
            matches: false,
            media: "",
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() {
              return false;
            },
          });
          w.HTMLElement.prototype.scrollIntoView = () => {};
          if (typeof w.requestAnimationFrame !== "function") {
            w.requestAnimationFrame = (cb: () => void) => w.setTimeout(() => cb(), 16);
            w.cancelAnimationFrame = (id: number) => w.clearTimeout(id);
          }
          // Audio / Web Audio : jeux à effets sonores → no-op.
          w.HTMLMediaElement.prototype.play = () => Promise.resolve();
          w.HTMLMediaElement.prototype.pause = () => {};
          w.AudioContext = w.AudioContext || (() => makeAnythingStub());
        } catch {
          /* best-effort : un stub raté ne doit pas faire échouer le boot */
        }
      },
    });

    // Les scripts en fin de <body> s'exécutent pendant la construction ; on
    // laisse un court instant aux callbacks immédiats (rAF/setTimeout 0) de
    // tourner, puis on coupe pour ne pas laisser de timers actifs.
    await new Promise((r) => setTimeout(r, 50));
  } catch (err) {
    // Une exception du constructeur est presque toujours une limite de jsdom,
    // pas un bug du jeu : on ne bloque pas là-dessus.
    return null;
  } finally {
    try {
      dom?.window.close();
    } catch {
      /* ignore */
    }
  }

  if (errors.length === 0) return null;
  // On résume la première vraie erreur, nettoyée du bruit jsdom.
  const first = errors[0].replace(/^Uncaught\s*\[?/i, "").replace(/\]$/, "").trim();
  return `le jeu plante au démarrage (${first.slice(0, 160)})`;
}

/**
 * Smoke-test complet : câblage (pur) puis boot (jsdom). Même contrat que
 * validateGameHtml() — retourne null si OK, sinon la raison en français.
 */
export async function smokeTestGameHtml(html: string): Promise<string | null> {
  const wiring = checkHandlerWiring(html);
  if (wiring) return wiring;
  return bootGameHtml(html);
}
