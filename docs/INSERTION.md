# Onglet Insertion : objets et formats

Tout ce que l'onglet insère est un objet du document, enregistré dans les fichiers DOCX, DOC (via LibreOffice) et ODT.

| Objet | Modèle | DOCX | ODT |
|---|---|---|---|
| **Formes** (35 géométries) | nœud `shape` : forme, taille, remplissage, contour, texte ; redimensionnable à la souris | forme DrawingML (`wps:wsp`, `a:prstGeom`) | `draw:custom-shape` (`ooxml-*`) |
| **Zone de texte** | nœud `shape` de type `textbox`, qui grandit avec son texte | `wps:wsp` avec `txBox="1"` | `draw:frame` + `draw:text-box` |
| **Équation** | nœud `equation` (LaTeX, rendu KaTeX) | équation native Word (`m:oMath`, OMML) | objet formule MathML intégré |
| **Signet / Renvoi** | nœud `bookmark` + lien `#nom` | `w:bookmarkStart`, `w:hyperlink w:anchor` | `text:bookmark`, `text:a` |
| **En-tête / pied de page** | blocs riches (paragraphes mis en forme, images, tableaux, champs `pageField`) par variante (toutes pages, première, paires) | parties `header*.xml` / `footer*.xml`, champs `PAGE` / `NUMPAGES` | `style:header` / `style:footer` (`-first`, `-left`), `text:page-number` / `text:page-count` |
| Page de garde, page vierge, saut de page | blocs et nœud `pageBreak` | saut de page `w:br` | `fo:break-after` |
| Icônes, graphiques | images PNG (le texte alternatif d'un graphique contient ses données) | image | image |

## Limites

- **Position, habillage, effets** : les formes et zones de texte sont dans le texte ou **libres** (devant / derrière le texte, avec
  coordonnées X/Y par rapport à la page ou au paragraphe d'ancrage), ou avec habillage carré / haut-bas. Rotation, dégradé
  (linéaire, radial), ombre et groupes sont conservés en DOCX (`wp:anchor`, `a:xfrm`, `a:gradFill`, `a:outerShdw`, `wpg:wgp`) et en
  ODT (`draw:transform`, `draw:gradient`, `draw:shadow`, `draw:g`).
- **Limites des effets** : dégradés à deux couleurs en ODT (davantage d'arrêts : seuls les extrêmes sont écrits) ; la rotation d'un
  groupe n'est pas conservée en ODT ; on ne peut grouper que des formes qui se suivent dans le document ; en DOCX, les effets de Word
  au-delà de ceux ci-dessus (reflet, 3D, lueur, texture, image en remplissage) sont ignorés. Le format `.doc` (via LibreOffice)
  passe par la conversion de LibreOffice : positions et effets peuvent y être simplifiés.
- **Une forme contient du texte simple** (paragraphes mis en forme) : pas de liste, de tableau ni d'image à l'intérieur d'une forme.
- **Géométrie** : le dessin à l'écran est celui de Loma Writer ; Word et LibreOffice redessinent la forme à partir de son nom
  (`rect`, `star5`…), donc de petites différences de contour sont possibles. Les formes inconnues sont remplacées par un rectangle.
- **Équations** : sous-ensemble courant de LaTeX (fractions, racines, exposants, indices, sommes, intégrales, limites, matrices,
  accents, lettres grecques, fonctions usuelles). Une équation saisie dans Word est relue en LaTeX équivalent, pas à l'identique.
  La conversion OMML est vérifiée par des tests de structure ; elle n'a pas pu être vérifiée avec Word ni avec LibreOffice Math
  (paquet non installé ici).
- **En-têtes et pieds de page** : une seule section. Pas de formes, d'équations ni de listes dans un en-tête (les listes sont aplaties).
- **Icônes et graphiques** sont des images : ils ne se modifient pas après insertion.
- **Signets** : visibles par défaut dans le texte (drapeau bleu), masqués à l'impression ; Affichage > Signets pour les masquer.

## Typographie et styles

- **Polices** : liste des polices de Word (toujours proposées) puis polices installées (fontconfig via la commande Tauri `list_fonts`),
  avec recherche. Calibri, Cambria, Arial, Times New Roman et Courier New, absentes de Linux, sont dessinées avec leurs équivalents
  métriques (Carlito, Caladea, Liberation) ; le nom de la police Word reste écrit dans le fichier.
- **Taille** : saisie libre de 1 à 1638 pt ; T+ / T− suivent la liste puis varient d'un dixième.
- **Puces et numérotation** : 8 puces et 5 numérotations (attribut `listType`), écrites dans DOCX (`w:numFmt`, `w:lvlText`) et ODT
  (`text:list-style`). Les niveaux imbriqués reprennent les puces par défaut.
- **Styles modifiables** (Normal, Titre 1-3, Citation, Code) : clic droit / double-clic sur un style ou « Modifier ». Écrits dans
  `styles.xml` (DOCX/ODT) et relus à l'ouverture ; la police et la taille de Normal sont celles du document.
- **En-tête de tableau répété** : sur chaque page où un tableau continue, la ou les lignes d'en-tête (cellules d'en-tête) sont
  réaffichées en haut de page (copies d'affichage, pas du contenu ; `w:tblHeader` / `table:table-header-rows` à l'export).
