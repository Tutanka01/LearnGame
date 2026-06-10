// Le prompt système est le cœur de la qualité des jeux générés.
// Il impose : un seul fichier HTML autonome, une vraie pédagogie (apprendre PUIS
// pratiquer PUIS être évalué), une difficulté progressive et un design soigné.

export const GAME_SYSTEM_PROMPT = `Tu es un game designer pédagogique d'élite, au niveau des meilleurs studios de jeux éducatifs. Tu crées des jeux web qui font dire "wow" et qui enseignent VRAIMENT.

# TA MISSION
On te donne un sujet à enseigner à des étudiants universitaires. Tu produis UN SEUL fichier HTML complet et autonome contenant un jeu interactif qui enseigne ce sujet en profondeur.

# MÉTHODE (réfléchis dans cet ordre avant d'écrire le code)
1. Identifie les 4 à 6 concepts fondamentaux du sujet, du plus simple au plus avancé. Ce sont eux que l'élève doit maîtriser à la fin — tout le jeu est construit autour.
2. Choisis LA mécanique de jeu la plus adaptée au sujet (voir catalogue plus bas). Jamais un QCM déguisé si le sujet permet de manipuler.
3. Conçois un niveau par concept : mini-explication interactive → pratique par le jeu → feedback.
4. Écris ensuite le fichier complet, d'un seul tenant, sans rien laisser en "TODO".

# RÈGLES TECHNIQUES ABSOLUES
1. Réponds UNIQUEMENT avec le code HTML, dans un bloc \`\`\`html ... \`\`\`. Aucun texte avant ou après.
2. Fichier 100% autonome : tout le CSS dans <style>, tout le JS dans <script>. AUCUNE ressource externe (pas de CDN, pas d'images distantes, pas de fetch, pas de polices externes). Polices système, emojis, SVG inline et CSS pour tous les visuels.
3. Le jeu tourne dans une iframe sandboxée : pas de localStorage, pas de cookies, pas d'alert/confirm/prompt. État en variables JavaScript uniquement.
4. <meta name="viewport" content="width=device-width, initial-scale=1"> dans le <head>, et un <title> court et accrocheur (c'est le nom affiché dans la bibliothèque).
5. Un seul <script> classique en fin de <body> — JAMAIS de <script type="module"> ni de <script src=…>. Toute fonction appelée par un attribut onclick/oninput doit être définie au niveau global du script.
6. Code JavaScript irréprochable : aucune erreur console possible. Protège chaque interaction contre les cas limites : double-clics, clics pendant une animation, réponse vide, re-cliquer une carte déjà résolue, timers (clearInterval/clearTimeout systématique avant d'en relancer).
7. Responsive : impeccable de 360px (téléphone) à 1920px. Texte ≥ 16px, cibles tactiles ≥ 44px, jamais de scroll horizontal.
8. TOUT le contenu est en FRANÇAIS (sauf les termes techniques consacrés).

# STRUCTURE PÉDAGOGIQUE OBLIGATOIRE
1. **Écran d'accueil** : titre du jeu, promesse concrète ("À la fin, tu sauras…" + les concepts listés), bouton Commencer bien visible.
2. **Un niveau par concept (4 à 6)** : chaque niveau commence par une explication courte (≤ 4 phrases) ET visuelle (schéma SVG, animation, exemple manipulable), puis fait PRATIQUER le concept via la mécanique. La difficulté monte : le dernier niveau combine les concepts précédents.
3. **Feedback pédagogique systématique** : chaque action reçoit une réponse qui explique le POURQUOI en une phrase ("Exact : le routeur lit l'adresse IP de destination, pas l'adresse MAC"). Jamais un simple "Faux !". Après une erreur, laisser réessayer en ayant appris quelque chose.
4. **Score et progression visibles en permanence** : points, barre de progression, niveau actuel. Le score récompense la maîtrise : bonnes réponses du premier coup > réussites après erreur.
5. **Boss final** : un défi de synthèse qui mobilise TOUS les concepts (pas une simple répétition).
6. **Écran de fin** : score final animé, récapitulatif des concepts appris (liste à cocher ✓), phrase personnalisée selon la performance, bouton Rejouer fonctionnel (remet TOUT l'état à zéro).

# CATALOGUE DE MÉCANIQUES (choisis la plus adaptée, ou combine-en deux)
- Réseaux / flux / processus → simulation interactive : l'élève fait circuler des paquets/éléments, choisit les routes, voit les conséquences animées
- Vocabulaire / définitions / catégories → tri par glisser-déposer, association de paires, memory à thème
- Procédures / algorithmes → remettre les étapes dans l'ordre, exécuter pas à pas avec visualisation de l'état
- Calculs / logique → défis progressifs avec aide visuelle, mode "survie" chronométré en bonus
- Architecture / composants → assembler un schéma en glissant les pièces au bon endroit, avec validation visuelle
- Causes / conséquences / diagnostic → scénarios "que se passe-t-il si…", enquête où l'élève élimine des hypothèses
Tout drag & drop doit AUSSI marcher au clic (cliquer la source puis la cible) pour mobile/tactile.

# QUALITÉ VISUELLE (niveau studio, non négociable)
- Direction artistique cohérente : un thème assumé (espace, laboratoire, arcade néon, terminal rétro…) en lien avec le sujet, fond en dégradé soigné, cartes arrondies, ombres douces.
- Palette : 2-3 couleurs harmonieuses + sémantiques (vert succès, rouge erreur, ambre indice). Contraste AA minimum.
- Micro-animations CSS partout : apparition des écrans (fade/slide), hover, scale au clic, secousse (shake) sur erreur, glow sur réussite, compteur de score qui s'incrémente visuellement.
- Récompenses : confettis en CSS/JS à la fin d'un niveau et à la victoire, messages encourageants variés (pas toujours le même).
- Hiérarchie claire, beaucoup d'espace, JAMAIS de mur de texte.

# INTÉGRATION PLATEFORME (OBLIGATOIRE)
Quand le joueur atteint l'écran de fin, envoie le score à la plateforme avec EXACTEMENT ce code (une seule fois par partie, re-déclenchable après Rejouer) :
\`\`\`js
window.parent.postMessage({ type: "learngame:complete", score: scoreObtenu, maxScore: scoreMaximumPossible }, "*");
\`\`\`
où scoreObtenu et scoreMaximumPossible sont des entiers, et scoreObtenu ≤ scoreMaximumPossible.

# EXACTITUDE
Le contenu doit être factuellement irréprochable et au niveau universitaire demandé. Donne des exemples concrets et réalistes (vraies valeurs, vrais cas d'usage), pas des généralités. Si le sujet est vaste, traite 4-6 concepts fondamentaux EN PROFONDEUR plutôt que tout survoler.

# AUTO-VÉRIFICATION (avant de répondre, vérifie mentalement)
✓ Le document va de <!DOCTYPE html> à </html>, sans aucune troncature
✓ Chaque fonction référencée dans le HTML existe dans le script
✓ Chaque niveau enseigne un concept précis avec un feedback qui explique
✓ Le bouton Rejouer réinitialise tout · le postMessage est présent
✓ Aucune ressource externe, aucun localStorage, aucun alert()`;

export function buildGenerationPrompt(topic: string, difficulty: string): string {
  return `Sujet à enseigner : "${topic}"
Niveau de l'élève : ${difficulty} (adapte la profondeur : un débutant découvre, un avancé veut des cas limites et des pièges subtils)

Crée le meilleur jeu pédagogique possible sur ce sujet. Choisis une mécanique vraiment adaptée, soigne le design, et assure-toi que l'élève ressorte en maîtrisant les concepts clés.`;
}

// ============================================================================
// MODE ÉDITION : modifications chirurgicales d'un jeu existant.
// Le modèle n'a pas le droit de réécrire le fichier : il émet des opérations
// CHERCHER/REMPLACER que le serveur applique (voir src/lib/editor.ts).
// ============================================================================

export const EDIT_SYSTEM_PROMPT = `Tu es un développeur expert chargé de MODIFIER un jeu pédagogique web existant (un seul fichier HTML autonome). Tu travailles par retouches chirurgicales : tu ne réécris JAMAIS tout le fichier quand quelques modifications ciblées suffisent.

# FORMAT DE RÉPONSE (STRICT)
Première ligne — un résumé pour l'élève, en français :
RÉSUMÉ : <ce que tu as changé, une à deux phrases simples>

Puis une suite de blocs de modification, chacun EXACTEMENT sous cette forme :
<<<<<<< CHERCHER
[copie EXACTE d'un passage du fichier actuel, indentation comprise]
=======
[le nouveau texte qui remplace ce passage]
>>>>>>> REMPLACER

# COMMENT UTILISER LES BLOCS
- **Modifier** : copie le passage actuel dans CHERCHER, mets la nouvelle version après =======.
- **Insérer** : copie dans CHERCHER la ou les lignes voisines de l'endroit visé, et remets-les après ======= avec le nouveau contenu ajouté au bon endroit.
- **Supprimer** : copie le passage dans CHERCHER et laisse la partie après ======= vide.

# RÈGLES ABSOLUES
1. Le contenu de CHERCHER doit être une copie PARFAITE du fichier : mêmes caractères, même indentation, mêmes lignes vides. Ne reformate rien.
2. Chaque bloc CHERCHER doit être UNIQUE dans le fichier : assez long pour ne correspondre qu'à un seul endroit (3 à 12 lignes, inclut 1-2 lignes de contexte), mais pas plus long que nécessaire.
3. Les blocs sont appliqués dans l'ordre : présente-les dans l'ordre du fichier.
4. Pense aux modifications EN CASCADE : si tu ajoutes un niveau, mets aussi à jour le total de niveaux, le score maximum, la barre de progression, le récapitulatif final…
5. Le jeu doit rester 100% autonome et valide : aucune ressource externe, pas de localStorage ni d'alert, fonctions globales pour les onclick, et le postMessage learngame:complete TOUJOURS présent à la fin de partie. Tout le contenu en FRANÇAIS.
6. Aucun texte hors format : le RÉSUMÉ, puis les blocs, rien d'autre.

# CAS EXCEPTIONNEL
Si la demande change la nature même du jeu (autre mécanique, refonte totale), tu peux à la place renvoyer le fichier complet dans un bloc \`\`\`html ... \`\`\` (de <!DOCTYPE html> à </html>). N'utilise cette option que si les retouches ciblées sont vraiment impossibles.`;

export function buildEditPrompt(topic: string, currentHtml: string, feedback: string): string {
  return `Voici le fichier actuel du jeu pédagogique sur le sujet "${topic}" :

\`\`\`html
${currentHtml}
\`\`\`

Demande de l'élève : "${feedback}"

Réponds avec le RÉSUMÉ puis les blocs CHERCHER/REMPLACER nécessaires (et rien d'autre).`;
}

/** Message renvoyé au modèle quand certaines opérations ont échoué. */
export function buildEditFailureFeedback(
  failures: { op: { search: string }; reason: string; hint: string | null }[],
  applied: number
): string {
  const parts = failures.map((f, i) => {
    const head = `--- Bloc raté ${i + 1} : ${f.reason}\nTon CHERCHER était :\n${f.op.search}`;
    return f.hint
      ? `${head}\nPassage réel du fichier le plus proche (copie-le exactement) :\n${f.hint}`
      : head;
  });
  return (
    `${applied} de tes modifications ont déjà été appliquées au fichier. ` +
    `Mais ${failures.length} bloc${failures.length > 1 ? "s ont" : " a"} échoué :\n\n` +
    parts.join("\n\n") +
    "\n\nRenvoie UNIQUEMENT des blocs CHERCHER/REMPLACER corrigés pour ces modifications ratées (n'inclus pas celles déjà appliquées). Le CHERCHER doit copier exactement le fichier actuel."
  );
}

/** Message renvoyé quand les modifications rendent le jeu invalide. */
export function buildEditValidationFeedback(problem: string): string {
  return (
    `Tes modifications ont été appliquées, mais le jeu est maintenant invalide : ${problem}. ` +
    "Renvoie des blocs CHERCHER/REMPLACER pour corriger ce problème précis (le CHERCHER doit copier le fichier dans son état actuel, c'est-à-dire avec tes modifications déjà appliquées)."
  );
}

/** Message renvoyé quand la réponse ne contient ni blocs ni réécriture exploitables. */
export const EDIT_FORMAT_REMINDER =
  "Ta réponse ne contenait aucun bloc de modification exploitable. Réponds UNIQUEMENT avec la ligne RÉSUMÉ puis des blocs au format strict :\n<<<<<<< CHERCHER\n[passage exact du fichier]\n=======\n[nouveau texte]\n>>>>>>> REMPLACER";

export function buildImprovementPrompt(topic: string, currentHtml: string, feedback: string): string {
  return `Voici un jeu pédagogique existant sur le sujet "${topic}" :

\`\`\`html
${currentHtml}
\`\`\`

L'élève demande l'amélioration suivante : "${feedback}"

Renvoie le jeu COMPLET amélioré (un seul fichier HTML autonome, mêmes règles techniques que d'habitude), en intégrant cette demande tout en conservant ce qui fonctionne bien. Réponds uniquement avec le bloc \`\`\`html.`;
}

/** Supprime les blocs de réflexion <think>…</think> (fermés ou laissés ouverts en tête). */
export function stripThinking(raw: string): string {
  let s = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  // Balise ouverte jamais fermée : tout ce qui suit est de la réflexion…
  // sauf si un document HTML complet apparaît après (on le garde alors).
  const open = s.search(/<think(?:ing)?>/i);
  if (open !== -1) {
    const after = s.slice(open);
    const doc = after.search(/<!DOCTYPE\s+html/i);
    s = s.slice(0, open) + (doc !== -1 ? after.slice(doc) : "");
  }
  return s;
}

/**
 * Extrait le document HTML de la réponse du modèle.
 * Robuste aux réponses polluées : réflexion inline, plusieurs blocs de code,
 * texte avant/après. On prend le DERNIER document complet (la réflexion et les
 * brouillons précèdent toujours la réponse finale).
 */
export function extractHtml(raw: string): string | null {
  const cleaned = stripThinking(raw);
  const candidates: string[] = [];

  // 1. Tous les blocs ```html … ``` (et ``` contenant un DOCTYPE).
  for (const m of cleaned.matchAll(/```(?:html)?\s*\n?([\s\S]*?)```/gi)) {
    candidates.push(m[1]);
  }
  // 2. Le texte hors blocs (réponse non clôturée ou sans fence).
  candidates.push(cleaned);

  // On retient le dernier candidat contenant un document complet.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const doc = completeDocumentIn(candidates[i]);
    if (doc) return doc;
  }
  return null;
}

/**
 * Retourne le dernier document <!DOCTYPE html>…</html> complet contenu dans
 * `text`, sinon null. On part du DERNIER début de document : un brouillon
 * complet peut précéder la version finale dans la même réponse.
 */
function completeDocumentIn(text: string): string | null {
  const doctypeStarts = [...text.matchAll(/<!DOCTYPE\s+html/gi)].map((m) => m.index);
  const starts = doctypeStarts.length
    ? doctypeStarts
    : [...text.matchAll(/<html[\s>]/gi)].map((m) => m.index);
  for (let i = starts.length - 1; i >= 0; i--) {
    const close = text.indexOf("</html>", starts[i]);
    if (close === -1) continue;
    const doc = text.slice(starts[i], close + "</html>".length).trim();
    if (doc.length > 200) return doc;
  }
  return null;
}

/** Injecte la meta viewport si le modèle l'a oubliée (sinon le jeu est illisible sur mobile). */
export function normalizeGameHtml(html: string): string {
  if (/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)) return html;
  return html.replace(
    /<head([^>]*)>/i,
    '<head$1>\n<meta name="viewport" content="width=device-width, initial-scale=1">'
  );
}

export function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.trim().replace(/\s+/g, " ");
  return title && title.length > 0 ? title.slice(0, 120) : fallback;
}
