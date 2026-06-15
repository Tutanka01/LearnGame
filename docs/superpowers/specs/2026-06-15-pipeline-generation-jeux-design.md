# Pipeline de génération de jeux : Director → Builder → QA

**Date :** 2026-06-15
**Statut :** approuvé, en implémentation

## Problème

Les jeux générés déçoivent sur trois axes (le visuel, le gameplay, la fiabilité/variété) ;
la pédagogie est jugée correcte. Cause racine commune : **tout naît en un seul appel
LLM**. Le modèle (Qwen moyen via gateway) doit simultanément choisir une mécanique,
inventer une direction artistique, écrire du JS sans bug, structurer la pédagogie et ne
pas se faire tronquer. Sous cette charge il fait les choix les plus sûrs : QCM déguisé,
dégradé violet générique, structure minimale, et `validateGameHtml()` ne vérifie que la
syntaxe — un jeu cassé au runtime passe.

## Objectif

Découper la **création** en un pipeline de 3 étapes qui réutilise l'infrastructure
existante, plus deux briques transverses (randomiseur d'art direction, smoke-test
runtime). Le mode **édition** (amélioration d'un jeu existant) reste inchangé — c'est déjà
une session agentique chirurgicale.

## Principe directeur : dégradation gracieuse

Pendant de la règle « un jeu invalide n'atteint jamais la base » : **on ne perd jamais un
jeu valide à cause d'une étape d'amélioration**.

- Director échoue (erreur, brief vide) → on retombe sur le single-shot actuel.
- QA n'aboutit pas → on sert le HTML de l'étape Builder.
- Smoke-test dans le doute (lacune jsdom) → on laisse passer.

On ne régresse jamais en dessous du comportement actuel.

## Architecture

```
topic + difficulty
   │  art direction tirée côté serveur (déterministe, seedée)
   ├─▶ [1] DIRECTOR  → brief de design (texte structuré, passé verbatim au Builder)
   │      prompt court · reçoit l'art direction imposée · décide mécanique
   │      précise (non-QCM), concepts, "moment wow"
   ├─▶ [2] BUILDER   → HTML complet (= runCreateFlow actuel, 3 tentatives)
   │      GAME_SYSTEM_PROMPT allégé : n'décide plus rien, IMPLÉMENTE le brief
   ├─▶ validateGameHtml() puis smoke-test jsdom
   └─▶ [3] QA        → blocs CHERCHER/REMPLACER (réutilise editor.ts), 1-2 tours
          checklist auto : bugs runtime, fadeur, mécanique molle, cas limites
          best-effort : échec → on garde le HTML de l'étape 2
```

### 1. Randomiseur d'art direction — `src/lib/artDirection.ts` (neuf, pur)

Table curée de combos `{ theme, palette (hex), fontStack (système uniquement), motion }`.
Tirage déterministe seedé (testable). Imposé au Director comme contrainte qu'il enrichit.
**Contrainte : polices système uniquement** (pas de CDN) → identités via stacks système
contrastés (serif éditorial / sans géométrique / mono rétro) + poids + letter-spacing.
Garantit que deux jeux sur le même sujet ont un look franchement différent.

### 2. Prompts — `src/lib/prompts.ts`

`GAME_SYSTEM_PROMPT` scindé en :
- **règles communes** (techniques : autonomie, sandbox, postMessage, responsive ; qualité
  visuelle ; exactitude) — inchangées au maximum, ce sont des règles durement acquises ;
- tête **DIRECTOR** : méthode de conception + catalogue de mécaniques + intégration de
  l'art direction → produit le brief ;
- tête **BUILDER** : « implémente fidèlement le brief, ne décide rien ».

Nouvelles fonctions : `buildDirectorPrompt(topic, difficulty, artDirection)`,
`buildBuilderPrompt(topic, difficulty, brief)`, prompt + checklist QA.

### 3. Smoke-test runtime — `src/lib/smoketest.ts` (neuf, jsdom)

Appelé **après** `validateGameHtml()`. Même contrat : `null` si OK, sinon raison en
français (réutilisée pour le feedback au modèle et à l'élève).

Avec jsdom (`runScripts: "dangerously"`, aucune ressource réseau) :
1. **Boot** : charge et exécute le script au load → capture les exceptions de démarrage
   (cause n°1 des écrans blancs : `ReferenceError` au boot).
2. **Câblage** : parse les attributs `onclick`/`oninput`/`onchange`, confirme que chaque
   fonction racine existe sur `window` → attrape les boutons morts.

**Conservateur (éviter les faux rejets) :** jsdom n'implémente pas `<canvas>.getContext`,
`scrollTo`, `matchMedia`… On *stub* les API courantes et on **ignore** les erreurs
« Not implemented » de jsdom. On ne rejette que sur signal franc (fonction onclick absente,
ou vraie exception non liée à une lacune jsdom). Un faux rejet coûte une régénération.

Un échec devient un `problem` ordinaire → réinjecté dans la boucle de correction (QA ou
retry Builder), comme une erreur de `validateGameHtml`. Bénéfice : le mode édition en
profite (validation commune).

### 4. Protocole d'événements — `src/lib/genEvents.ts` + surfaces

`GenPhase` étendu : `connect → briefing → thinking → coding → applying → validating →
polishing`.
- `briefing` = Director (sa réflexion est streamée comme `reasoning`, pas dans l'aperçu
  HTML live) ;
- `polishing` = QA (réflexion comme `reasoning`, pas de chunks dans l'aperçu).

`fullCode` (aperçu live) n'accumule QUE pendant le `coding` du Builder → aperçu propre.

Mise à jour dans le **même commit** : `genEvents.ts` + l'émetteur (`generation.ts`) +
les 3 surfaces (`GenerationPanel` stepper/phaseTitle, `GenerationOverlay` logique d'onglet,
`StudioShared` état sans aperçu).

## Tests

- Modules purs `npx tsx` : `artDirection.ts` (tirage seedé déterministe), extracteur de
  câblage onclick (pur), smoke-test (jeu sain + jeu cassé : bouton mort, ReferenceError).
- `tests/jobs.test.mts` : mock LLM étendu pour répondre aux 3 étapes (brief → HTML → blocs
  QA).
- `npm run build` (type-check complet) + smoke test `PORT=3457`.

## Hors périmètre (YAGNI)

- Bibliothèque de moteurs pré-construits (option C) : chantier de fond séparé.
- Click-through Playwright : jsdom boot+câblage suffit pour l'instant.
- Refonte du mode édition.
