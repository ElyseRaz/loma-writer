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

## Onglet Mise en page : paragraphe, sauts, filigrane

- **Retraits et espacement** (`src/editor/ParagraphFormat.ts`) : attributs de paragraphe `indentLeft`, `indentRight`, `firstLine`
  (négatif = suspendu), `spaceBefore`, `spaceAfter`. Saisie en cm et en pt dans le ruban ou dans « Paragraphe… ». DOCX : `w:ind`,
  `w:spacing before/after` ; ODT : `fo:margin-*`, `fo:text-indent`. Les retraits d'un paragraphe de liste appartiennent à la
  numérotation (non importés ni écrits).
- **Sauts** : « Saut de page avant », « Garder avec le paragraphe suivant », « Garder les lignes ensemble » sont lus par le moteur
  (`Atom.breakBefore`, `keepWithNext`, `keepLines`) ; DOCX `w:pageBreakBefore/keepNext/keepLines`, ODT `fo:break-before`,
  `fo:keep-with-next`, `fo:keep-together`. Un « saut de page avant » de Word est maintenant lu comme option du paragraphe
  (et plus comme un saut séparé).
- **Filigrane** (`src/editor/watermark.ts`) : texte, couleur, taille, diagonale ou horizontale, opacité ; dessiné derrière le texte
  sur chaque page, imprimé. DOCX : forme VML `PowerPlusWaterMarkObject` dans l'en-tête (créé si besoin), relue à l'ouverture ;
  vérifié avec LibreOffice (rendu PDF), pas avec Word. **ODT : non écrit** (avertissement à l'enregistrement).
- **Colonnes : non prises en charge.** Le moteur paginé suit un seul flux vertical par page ; deux colonnes demandent de répartir
  chaque page en deux zones de texte (même chantier que les sections, mais avec le texte lui-même à couper). Le bouton est désactivé
  avec cette explication. Pas de saut de colonne.

## Sections

Un **saut de section (page suivante)** (Mise en page > Sauts) commence une nouvelle section sur une nouvelle page, avec son
propre papier, orientation, marges, en-têtes et pieds de page.

- **Modèle** : nœud `sectionBreak` (`src/editor/Sections.ts`) portant la mise en page de la section qui le suit (`page`) et ses
  en-têtes/pieds (`hf`, `null` = identiques à la section précédente). La première section est décrite, comme avant, par la mise en
  page du document ; `readSections()` résout l'héritage.
- **Moteur** : `paginate(atoms, géométries[])` ; l'atome `section` change de géométrie et renvoie aussi les **feuilles** (position,
  taille, marges de chaque page) : les pages n'ont plus la même hauteur ni le même pas. Le texte d'une section a la largeur de sa
  feuille (marges gauche/droite portées par chaque bloc, variables CSS `--sec-l` / `--sec-r`).
- **Affichage** : feuilles de tailles différentes (centrées), en-têtes et pieds propres à chaque section, filigrane et repères sur
  chacune, règle et barre d'état suivant la section du curseur. Objets libres (formes, images, tableaux) placés par rapport à
  la feuille où ils se trouvent (`src/pagination/pageLayout.ts`). Les menus Marges, Orientation et Taille agissent sur la section
  du curseur ; la fenêtre « Mise en page » propose « cette section » ou « tout le document ». « En-tête » et « Pied de page » ont
  « Identique à la section précédente ».
- **Fichiers** : DOCX (`w:sectPr` par section, relues à l'ouverture ; héritage des en-têtes) et ODT (une page maître par section,
  `style:master-page-name` sur le premier paragraphe) ; vérifié avec LibreOffice dans les deux sens (tailles de page, en-têtes).
  Les sauts « continu » de Word sont lus comme des sauts de section avec page suivante (avertissement). `.doc` passe par LibreOffice.
- **Limites** : un seul type de saut (page suivante : pas de continu, page paire/impaire) ; la numérotation des pages est continue
  (pas de redémarrage par section) ; **l'impression utilise le format de la première section** (avertissement affiché si les sections
  diffèrent) — pour un résultat exact avec plusieurs formats, enregistrer en DOCX/ODT et imprimer depuis Word ou LibreOffice ; les
  formes d'un fichier DOCX/ODT sont positionnées d'après la mise en page de la première section.
