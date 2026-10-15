# Pagination

## Principe

Le document reste **un seul document ProseMirror** : le curseur, l'historique d'annulation, TipTap et les
adaptateurs DOCX/DOC/ODT ne voient jamais de « pages ». La pagination est une couche de vue en trois parties :

| Partie | Fichier | Rôle |
|---|---|---|
| Modèle | `src/pagination/model.ts`, `headerFooter.ts` | géométrie d'une page (format, orientation, marges, en-tête/pied), atomes de mise en page, structure des sections |
| Calcul | `src/pagination/engine.ts` | **pur**, sans DOM : décide où couper (testé seul) |
| Rendu | `measure.ts`, `extension.ts`, `components/layout/PageSheets.tsx` | mesure du rendu réel, espaceurs ProseMirror, feuilles blanches dessinées derrière le texte |

Autres stratégies étudiées et écartées : un éditeur par page (le curseur ne survit pas au passage d'une page à l'autre),
une découpe à hauteur fixe en pixels (coupe le texte au milieu des lignes, ne tient pas compte des marges réelles).

### Algorithme

1. Le DOM réel est mesuré **sans espaceurs** (mise en page naturelle) : paragraphes, titres, blocs de code, lignes de
   tableau, filets, sauts de page manuels.
2. `paginate()` parcourt ces atomes et décide, dans l'ordre : ce qui tient, ce qui passe à la page suivante, ce qui se
   coupe par lignes (au moins 2 lignes avant et après la coupure), quels titres restent avec ce qui les suit, les sauts
   manuels.
3. Chaque coupure devient un espaceur (widget) inséré à la position décidée ; une passe de vérification corrige
   l'espaceur de quelques pixels pour que la première ligne de chaque page tombe exactement en haut de sa zone de texte.
4. L'état de la barre d'état (nombre de pages, page du curseur) vient de ce calcul, pas d'une hauteur.

Le zoom est un `transform: scale()` : la mise en page logique est identique à 25 % comme à 300 %. (La propriété CSS
`zoom` a été écartée : sous WebKitGTK elle change les retours à la ligne et donc le nombre de pages.)

À l'impression, l'espace entre les feuilles est retiré des espaceurs et `@page` reprend le format du document.

## Modèle documentaire

- Saut de page manuel : nœud `pageBreak` (Ctrl+Entrée), lu et écrit en DOCX (`w:br type="page"`, `w:pageBreakBefore`)
  et en ODT (`fo:break-before` / `fo:break-after`).
- Marges : préréglages ou **personnalisées** (cm), conservées exactement en DOCX/ODT.
- En-têtes / pieds de page : modifiables (onglet Insertion : En-tête, Pied de page, Numéro), avec première page
  différente, pages paires/impaires et champs `{PAGE}` / `{PAGES}`. Dessinés sur chaque feuille, imprimés, et lus/écrits en
  DOCX, DOC (via LibreOffice) et ODT. Contenu riche (plusieurs lignes, mise en forme, images, tableaux) ; un en-tête plus
  haut que la marge réduit la zone de texte (sa hauteur est mesurée). Pas de numéro de départ ni de sections multiples
  dans l'interface.

## Limites connues

- Une ligne de tableau plus haute qu'une page, ou une image plus haute que la zone de texte, déborde au lieu d'être coupée.
- Les lignes de tableau se coupent *entre* les lignes, jamais à l'intérieur d'une cellule ; les en-têtes de tableau ne
  sont pas répétés sur chaque page.
- Pas de colonnes, de sections multiples, de notes de bas de page, d'images flottantes.
- Pas de contrôle « lignes veuves/orphelines » ni « conserver avec le suivant » réglable par l'utilisateur.
- L'impression passe par la boîte d'impression système (WebKitGTK) ; l'alignement des pages imprimées avec les coupures
  calculées n'est pas démontré par un test automatique.
- Une forme ou une zone de texte est un bloc insécable : elle passe entière à la page suivante si elle ne tient pas.
- Pendant la frappe, les coupures sont recalculées après une courte pause (60 ms) ; un très gros document (centaines de
  pages) n'a pas été mesuré.

## Tests

| Niveau | Commande | Ce qui est vérifié |
|---|---|---|
| Automatisé, moteur pur | `npm test` | invariants du moteur (aucune ligne coupée, titres, orphelines/veuves, sauts manuels, format/orientation/marges, déterminisme, documents aléatoires) |
| Automatisé, navigateur réel | `npm run dev` puis `npm run test:e2e` (Chrome) | mise en page réelle : chaque caractère dans une page, texte intact, marges/format/orientation, zoom, frappe, suppression, annulation, saut manuel, tableau, images, listes |
| Automatisé, WebKitGTK natif | `e2e/native.js` injecté dans `index.html` (voir `e2e/README.md`) | mêmes contrôles dans la vraie fenêtre Tauri, plus correspondance clic/caractère à 25 %, 100 %, 300 % |
| **Manuel** | — | impression/PDF, sensation de fluidité du défilement, saisie au clavier réelle (les tests natifs utilisent `execCommand`) |

## Mise en page : papier, marges, orientation

Modèle unique : `PageSetup` (`src/state/types.ts`), calculs dans `src/state/page.ts` (centimètres pour l'utilisateur, px CSS à 96 dpi
pour le moteur). Il fait partie du **document** (`DocumentModel.page`), pas des préférences globales ; il est enregistré avec lui
(DOCX, ODT, DOC via LibreOffice, `.loma`) et dans le brouillon automatique. `pageGeometry()` en tire la zone de texte : le moteur de
pagination mesure alors le texte réellement reformaté dans cette largeur et recalcule les sauts de page, sans toucher au contenu.

- **Papiers** : A0–A6, B5, Letter, Legal, Executive, Tabloid (dimensions en portrait) et « Personnalisé » (5 à 120 cm).
- **Marges** : Normales, Étroites, Modérées, Larges, Miroir, personnalisées (0 à 50 cm), plus marge de reliure (gauche ou haut).
  `validatePage()` refuse les valeurs négatives ou qui laissent moins de 3 cm de texte ; un changement de papier ou d'orientation
  réduit les marges qui ne tiennent plus (`fitMargins`).
- **DOCX** : `w:pgSz` / `w:pgMar` (dont `w:gutter`), `w:mirrorMargins` dans `settings.xml` ; relus à l'ouverture. Une reliure en haut est
  ajoutée à la marge haute (la bibliothèque n'écrit que la reliure gauche).
- **ODT** : dimensions exactes en cm, `style:page-usage="mirrored"` ; ODF n'a pas de marge de reliure : elle est ajoutée à la marge concernée.
- **Papier inconnu à l'import** : lu comme « Personnalisé » avec ses dimensions exactes (plus de remplacement par A4).
- **Limites** : marges en miroir — l'éditeur affiche toutes les pages avec la marge intérieure à gauche (l'alternance recto verso est
  écrite dans le fichier et appliquée par Word/LibreOffice) ; une seule section, donc une seule orientation par document (l'architecture
  `PageSetup` peut devenir par section, mais rien n'est simulé) ; `.doc` passe par la conversion de LibreOffice.
- **Affichage** : repères d'angle de la zone de texte (Affichage > Limites du texte), non imprimés.
