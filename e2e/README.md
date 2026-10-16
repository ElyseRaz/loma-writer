# Tests de bout en bout de la pagination

## Chrome (Playwright)

    npm run dev            # dans un terminal
    npm run test:e2e       # dans un autre (Chrome requis, CHROME_PATH pour un autre chemin)
                           # = pagination.mjs + home.mjs (onglet Accueil) + insert.mjs (onglet Insertion) + typography.mjs (polices, tailles, couleurs, puces, styles, tableaux) + page.mjs (papier, marges, orientation) + layout.mjs (retraits, espacement, sauts, filigrane) + sections.mjs (sections : papier, marges, en-têtes par section) + columns.mjs (colonnes, saut continu) + references.mjs (onglet Références : table des matières, légendes, notes, citations)

`audit.js` est exécuté dans la page : il mesure le rendu réel et liste les violations (caractère hors de la zone de
texte d'une page, ligne de tableau ou image coupée, titre séparé de ce qui le suit).

## Fenêtre native Tauri / WebKitGTK

Le webview ne peut pas être piloté par WebDriver ici (pas de `WebKitWebDriver`). `native.js` s'exécute donc dans la
page et envoie ses résultats à un petit collecteur local :

Scripts natifs : `native.js` (pagination), `native-home.js` (Accueil), `native-insert.js` (Insertion), `native-objects.js` (formes, zone de texte, en-têtes riches, équations natives, signets).

1. Collecteur : un serveur HTTP qui accepte les POST sur `127.0.0.1:9911` et journalise les corps.
2. Copier `native.js` en `public/selftest.js`, ajouter `<script src="/selftest.js"></script>` dans `index.html` et
   `http://127.0.0.1:9911` dans `devCsp` (`connect-src`) de `src-tauri/tauri.conf.json`.
3. `npm run tauri dev`, lire le journal (lignes `PASS` / `FAIL`).
4. **Retirer ces trois ajouts** avant de livrer.

Le crochet `window.__lomaEditor` n'existe qu'en mode développement.


## WebKitGTK (le moteur de l'application)

`python3 e2e/webkit.py` (ou `npm run test:webkit`) charge l'application dans WebKitGTK (python3-gi, WebKit2 4.1, `npm run dev` sur :1420)
et vérifie, dans le vrai moteur : le contrôle de chaque caractère (`audit.js`), puis un **vrai travail d'impression vers un PDF**
(nombre de pages = nombre de feuilles, texte de chaque page). `LOMA_WK_KEEP=dossier` garde les PDF, `LOMA_WK_ONLY=n` ne joue que le
scénario n, `LOMA_WK_PAPER=letter` et `LOMA_WK_MARGIN=5` changent le papier et les marges (un document A4 sur Letter échoue : limite connue). Nécessite `pdfinfo` / `pdftotext` (poppler-utils). Différences utiles avec Chrome : WebKit ignore le décalage relatif d'une
ligne de tableau (on décale les cellules) et ignore la taille `@page` (le papier vient de la boîte d'impression).
