# Onglet Références

Toutes les fonctions de l'onglet sont disponibles. Le code est dans `src/editor/references/` (nœuds, commandes, plugins) ; les boîtes de dialogue
dans `src/components/dialogs/` (`CaptionDialog`, `NoteDialog`, `SourcesDialog`) ; le ruban dans `src/components/ribbon/ReferencesTab.tsx`.

## Table des matières

- Nœud `tableOfContents` (contient des `tocEntry`) : les lignes sont de vrais paragraphes du document, avec un pointillé et le numéro de page
  dessinés par la feuille de style. `Insertion` crée la table (1 à 3 niveaux) après le bloc du curseur ; **Mettre à jour** la reconstruit depuis les
  titres et les pages de la dernière mise en page (numérotation des sections, chiffres romains compris : `pageLabels.ts`). Ctrl+clic sur une ligne
  va au titre. Les tables sont mises à jour automatiquement avant l'enregistrement, l'export et l'impression.
- DOCX : champ `TOC \o "1-n" \h \z \u` avec ses lignes en cache (styles TOC 1-3, tabulation pointillée, lien et `PAGEREF` vers un signet par titre) ;
  lecture des champs TOC et des contrôles de contenu « Table des matières ». ODT : `text:table-of-content` (source + corps). Vérifié avec LibreOffice.
- Une ligne lue d'un fichier est rattachée au premier titre de même texte (`resolveTocTargets`).

## Légendes et table des illustrations

- Un paragraphe porte l'attribut `caption` (le libellé : Figure, Tableau, Équation ou un mot au choix) et contient un champ de numérotation `seqField` ; les
  numéros suivent l'ordre du document, par libellé (plugin, y compris après un collage ou un déplacement). Le tableau est légendé au-dessus, le reste en dessous.
- La **table des illustrations** est une table des matières de type `captions` pour un libellé.
- DOCX : style Caption, champ `SEQ Libellé \* ARABIC`, table `TOC \h \z \c "Libellé"` ; ODT : `text:sequence` (déclaré) et `text:illustration-index`.
  LibreOffice renomme la séquence « Tableau » en « Table » (compensé à la lecture).

## Notes de bas de page et de fin

- Nœud inline `footnote` (`kind` : `foot` ou `end`, `text` : texte brut). Numérotation 1, 2, 3 (bas de page) et i, ii, iii (fin) tenue par un plugin. Double-clic sur
  le numéro (ou sur la note en bas de page) : modification ; Ctrl+Alt+F / Ctrl+Alt+D : insertion.
- **Bas de page** : le moteur de pagination **réserve la place** des notes en bas de la page où se trouve la ligne qui les appelle (`Atom.noteHeights`,
  `Atom.noteTotal`, `PaginationResult.reserved`, séparateur `FOOTNOTE_SEPARATOR`) ; les notes sont dessinées par `PageSheets` (`.page-notes`), imprimées avec la feuille.
  Hauteur mesurée dans une copie cachée au style de la note (`makeNoteMeasurer`).
- **Notes de fin** : un bloc `endnotes` à la fin du document, régénéré par le plugin (créé, mis à jour ou supprimé avec les renvois).
- DOCX : vrais `w:footnoteReference` / `footnotes.xml` et `endnotes.xml` (ajouté par `addEndnotes`), ODT : `text:note` des deux classes. Vérifié avec LibreOffice.
- **Texte riche** : le corps d'une note est une liste de paragraphes avec gras, italique, souligné, exposant/indice et liens (`noteBody.ts`) ; éditeur dans `NoteDialog`.
- **Numérotation** (`notesNumbering.ts`, bouton « Options des notes… ») : format (1, i, I, a, A, symboles), premier numéro, continue / par section / par page (bas de page).
  Le recommencement par page est calculé par la mise en page (`computePageNotes`). Exporté en `w:footnotePr` / `w:endnotePr` (DOCX) et `text:notes-configuration` (ODT).
- **Colonnes** : la place des notes est retirée à toutes les colonnes de la page (`flow` du moteur). **Continuation** : les notes ne prennent pas plus d'une demi-page ; le reste
  continue en bas de la page suivante (`settle`, `PageNote.skip/clip`).
- **Limites** : la coupure d'une note continuée se fait au pixel (pas à la ligne) ; en colonnes, une note géante qui déborde sur la page suivante n'est vérifiée que par le moteur.

## Citations et bibliographie

- Les **sources** (livre, article, site, rapport, autre) et le **style** (APA, MLA, Chicago auteur-date, numérique) sont des attributs du document (`doc.attrs.sources`,
  `doc.attrs.citationStyle`) : ils suivent l'annulation, l'enregistrement `.loma` et la copie. `loadContent` demande la mise à jour des références après l'ouverture.
- Nœud inline `citation` (`tag`, `page`, `text` calculé) : « (Dupont & Martin, 2020, p. 12) ». Le bloc `bibliography` (sources citées ou toutes) est tenu à jour par un plugin
  dans le style choisi (ordre alphabétique, ou de première citation en style numérique ; titres en italique).
- DOCX : champs `CITATION tag \l 1036`, champ `BIBLIOGRAPHY`, et partie `customXml/item1.xml` au format bibliographie de Word (type, auteurs, année, éditeur… et style choisi) ;
  ODT : `text:bibliography-mark` (identifiant, auteur, titre, année… ; page dans `custom1`), `text:bibliography`, et toutes les sources + le style dans `meta.xml`.
  Vérifié avec LibreOffice (qui garde le renvoi et la bibliographie).
- **Styles** (`sources.ts`) : APA 7, MLA 9, Chicago auteur-date, ISO 690 et IEEE (numérique), avec les règles de ponctuation, d'italique et d'ordre des auteurs de ces feuilles de style
  (en français pour les mots de liaison, sauf IEEE). Word réécrit les entrées avec ses propres feuilles de style à la mise à jour du champ : le texte peut différer légèrement.
- **Limites** : les sources non citées ne passent par ODT que grâce aux métadonnées de Loma Writer ; pas de source à plusieurs types de contributeurs (éditeur scientifique, traducteur).
