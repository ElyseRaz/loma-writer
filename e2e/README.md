# Tests de bout en bout de la pagination

## Chrome (Playwright)

    npm run dev            # dans un terminal
    npm run test:e2e       # dans un autre (Chrome requis, CHROME_PATH pour un autre chemin)
                           # = pagination.mjs + home.mjs (onglet Accueil) + insert.mjs (onglet Insertion) + typography.mjs (polices, tailles, couleurs, puces, styles)

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
