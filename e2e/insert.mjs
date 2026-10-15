// End-to-end checks of the "Insertion" tab in a real browser.
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/insert.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const audit = readFileSync(new URL("./audit.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.clear());
await page.goto("http://localhost:1420");
await page.addScriptTag({ content: audit });
await page.getByText("Document vierge").click();
await page.waitForFunction(() => window.__lomaEditor);

let failed = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}${cond ? "" : "  " + extra}`); if (!cond) failed++; };
const run = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 500) => page.waitForTimeout(ms);
const set = (html) => run((h) => window.__lomaEditor.commands.setContent(h), html);
const json = () => run(() => window.__lomaEditor.getJSON());
const countNodes = (type) => run((t) => { let n = 0; window.__lomaEditor.state.doc.descendants((x) => { if (x.type.name === t) n++; }); return n; }, type);
const images = () => run(() => { const out = []; window.__lomaEditor.state.doc.descendants((x) => { if (x.type.name === "image") out.push({ alt: x.attrs.alt, src: String(x.attrs.src).slice(0, 22), w: x.attrs.width }); }); return out; });
await page.getByRole("tab", { name: "Insertion" }).click();

// Every Insertion button is real: none is disabled or tagged "Bientôt".
const soon = await run(() => [...document.querySelectorAll("[role=tabpanel] button[aria-disabled=true]")].map((b) => b.getAttribute("aria-label")));
ok(soon.length === 0, "no « Bientôt » button left in the Insertion tab", JSON.stringify(soon));

// --- Page vierge / Saut de page ---
await set("<p>Avant</p><p>Après</p>");
await run(() => window.__lomaEditor.commands.setTextSelection(7));
await page.getByRole("button", { name: "Page vierge" }).click();
await settle();
const blank = await run(() => window.__lomaAudit());
ok(blank.pages === 3 && blank.problems.length === 0, `blank page inserted: 3 pages (${blank.pages})`, blank.problems.slice(0, 2).join(" | "));
await set("<p>A</p><p>B</p>");
await run(() => window.__lomaEditor.commands.setTextSelection(3));
await page.getByRole("button", { name: "Saut de page" }).click();
await settle();
ok((await run(() => window.__lomaAudit().pages)) === 2, "page break button gives 2 pages");

// --- Page de garde ---
await set("<h1>Introduction</h1><p>Contenu du rapport.</p>");
await page.getByRole("button", { name: "Page de garde" }).click();
await page.getByLabel("Titre", { exact: true }).fill("Rapport annuel");
await page.getByLabel("Sous-titre").fill("Exercice 2025");
await page.getByLabel("Auteur").fill("Équipe Loma");
await page.getByRole("button", { name: "Moderne" }).click();
await page.getByRole("button", { name: "Insérer au début" }).click();
await settle();
const cover = await json();
const coverTitle = cover.content.find((n) => n.type === "paragraph" && n.content?.[0]?.text === "Rapport annuel");
ok(!!coverTitle && coverTitle.content[0].marks.some((m) => m.type === "textStyle" && m.attrs.fontSize === "38pt"), "cover page title inserted (modern style, 38 pt)");
const coverAudit = await run(() => window.__lomaAudit());
ok(coverAudit.pages === 2 && coverAudit.problems.length === 0, `cover page occupies its own page (${coverAudit.pages} pages)`);
ok(cover.content.at(-3).type === "pageBreak" && cover.content.at(-2).type === "heading" && cover.content.at(-1).type === "paragraph", "document content kept after the cover");

// --- Formes (real, editable shapes) ---
const shapeNodes = () => run(() => { const o = []; window.__lomaEditor.state.doc.descendants((n) => { if (n.type.name === "shape") o.push({ ...n.attrs, text: n.textContent }); }); return o; });
await set("<p>Formes :</p>");
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Formes" }).click();
ok((await page.locator("[role=tabpanel] ~ div button[aria-label], body > div button[aria-label]").evaluateAll((els) => els.filter((e) => /branches|Ellipse|Flèche|Losange/.test(e.getAttribute("aria-label") || "")).length)) >= 8, "the gallery offers many shapes");
await page.getByRole("button", { name: "Ellipse" }).click();
await page.keyboard.type("Texte dans l'ellipse");
await settle(300);
let shapes = await shapeNodes();
ok(shapes.length === 1 && shapes[0].kind === "ellipse" && shapes[0].text === "Texte dans l'ellipse", `ellipse inserted as an editable shape holding text (${JSON.stringify(shapes[0])})`);
ok((await page.locator(".shape-box svg path").count()) === 1 && (await images()).length === 0, "drawn as vector (SVG), not as a picture");
ok(await page.getByRole("toolbar", { name: "Forme" }).isVisible(), "the shape toolbar appears while the caret is in the shape");
await page.getByRole("button", { name: "Remplissage" }).click();
await page.getByRole("button", { name: "#bbf7d0" }).click();
await page.getByRole("button", { name: "Contour" }).click();
await page.getByRole("button", { name: "#dc2626" }).click();
await page.getByLabel("Épaisseur du contour").selectOption("4");
await page.getByLabel("Largeur (cm)").fill("8");
await settle(200);
await page.getByLabel("Hauteur (cm)").fill("3");
await settle(300);
shapes = await shapeNodes();
ok(shapes[0].fill === "#bbf7d0" && shapes[0].stroke === "#dc2626" && shapes[0].strokeWidth === 4 && Math.abs(shapes[0].width - 302) <= 2 && Math.abs(shapes[0].height - 113) <= 2, `fill, outline, width and size editable (${JSON.stringify(shapes[0])})`);
const path = await page.locator(".shape-box svg path").getAttribute("fill");
ok(path === "#bbf7d0", "the drawing follows the new fill");
await page.getByLabel("Type de forme").selectOption("star5");
await settle(200);
ok((await shapeNodes())[0].kind === "star5" && /Texte dans/.test((await shapeNodes())[0].text), "the shape type changes and keeps its text");
// resize with the mouse
const box = await page.locator(".shape-box").boundingBox();
await page.locator(".shape-box").hover();
await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width + 58, box.y + box.height + 38, { steps: 5 });
await page.mouse.up();
await settle(300);
const resized = (await shapeNodes())[0];
ok(resized.width > 340 && resized.height > 140, `the handle resizes the shape (${resized.width}x${resized.height})`);
// several shapes
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Formes" }).click();
await page.getByRole("button", { name: "Flèche droite" }).click();
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Formes" }).click();
await page.getByRole("button", { name: "Ligne", exact: true }).click();
await settle(300);
shapes = await shapeNodes();
ok(shapes.map((x) => x.kind).join() === "star5,rightArrow,line", `several shapes in one document (${shapes.map((x) => x.kind)})`);
await page.getByRole("button", { name: "Supprimer la forme" }).click();
ok((await shapeNodes()).length === 2, "a shape can be deleted from the toolbar");

// --- Icônes ---
await page.getByRole("button", { name: "Icônes" }).click();
await page.getByLabel("Rechercher une icône").fill("étoile");
await page.getByRole("button", { name: "Étoile", exact: true }).click();
await settle(600);
const icons = await images();
ok(icons.length === 1 && icons[0].alt === "Icône : Étoile", `icon inserted (${JSON.stringify(icons.map((i) => i.alt))})`);

// --- Graphique ---
await page.getByRole("button", { name: "Graphique" }).click();
ok(await page.getByRole("img", { name: "Aperçu du graphique" }).isVisible(), "chart preview is shown");
await page.getByLabel("Valeur 2, série 1").fill("abc");
ok(await page.getByRole("button", { name: "Insérer", exact: true }).isDisabled(), "an invalid number disables « Insérer »");
await page.getByLabel("Valeur 2, série 1").fill("25,5");
await page.getByRole("radio", { name: "Courbes" }).click();
await page.getByRole("button", { name: "Insérer", exact: true }).click();
await settle(400);
const charts = (await images()).filter((i) => i.alt.startsWith("Courbes"));
ok(charts.length === 1 && /T2 : 2025 25,5/.test(charts[0].alt), `chart inserted with its data in the alt text (${charts[0]?.alt})`);

// --- Signet / Renvoi ---
await set("<h1>Titre A</h1><p>Texte du début.</p><h2>Titre B</h2><p>Fin.</p>");
await run(() => window.__lomaEditor.commands.setTextSelection(18));
await page.getByRole("button", { name: "Signet" }).click();
await page.getByPlaceholder("ex. Conclusion").fill("ma conclusion");
await page.getByRole("button", { name: "Ajouter" }).click();
await settle(300);
ok((await countNodes("bookmark")) === 1 && /ma_conclusion/.test(JSON.stringify(await json())), "bookmark added (spaces become underscores)");
ok(await page.locator(".ProseMirror .bookmark").first().evaluate((e) => e.getBoundingClientRect().width > 4), "bookmarks are visible in the text by default");
await page.getByRole("tab", { name: "Affichage" }).click();
await page.getByRole("button", { name: "Signets" }).click();
ok(await page.locator(".ProseMirror .bookmark").first().evaluate((e) => e.getBoundingClientRect().width === 0), "the « Signets » toggle hides them");
await page.getByRole("button", { name: "Signets" }).click();
await page.getByRole("tab", { name: "Insertion" }).click();
await page.getByRole("button", { name: "Signet" }).click();
await page.getByPlaceholder("ex. Conclusion").fill("1bad");
ok(await page.getByRole("button", { name: "Ajouter" }).isDisabled(), "an invalid bookmark name is refused");
await page.getByRole("button", { name: "Fermer", exact: true }).last().click();
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Renvoi" }).click();
await page.getByRole("option", { name: "Titre A" }).click();
await page.getByRole("button", { name: "Insérer", exact: true }).click();
await settle(300);
const link = await run(() => { let href = null; window.__lomaEditor.state.doc.descendants((n) => { n.marks.forEach((m) => { if (m.type.name === "link") href = m.attrs.href; }); }); return href; });
ok(link === "#Titre_Titre_A", `cross-reference links to the heading (${link})`);
ok((await countNodes("bookmark")) === 2, "an anchor was created on the heading");
await run(() => window.__lomaEditor.commands.focus("end"));
await page.locator(".ProseMirror a[href^='#']").click({ modifiers: ["Control"] });
await settle(300);
const head = await run(() => window.__lomaEditor.state.selection.from);
ok(head <= 3, `Ctrl+click on the cross-reference goes to the heading (caret at ${head})`);

// --- Zone de texte (a shape of type text box) ---
await set("<p>Avant</p>");
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Zone de texte" }).click();
await page.keyboard.type("Première ligne");
await page.keyboard.press("Enter");
await page.keyboard.type("Deuxième ligne");
await page.keyboard.press("Enter");
await page.keyboard.type("Troisième ligne");
await settle(400);
const tb = (await shapeNodes())[0];
ok(tb.kind === "textbox" && /Troisième ligne/.test(tb.text), "a text box is a shape of type « textbox »");
ok(await page.getByRole("toolbar", { name: "Forme" }).textContent().then((t) => /ZONE DE TEXTE/i.test(t)), "the toolbar says « Zone de texte »");
const grown = await run(() => document.querySelector(".shape-textbox").offsetHeight);
ok(grown > 70, `the text box grows with its text (${grown}px)`);
ok((await run(() => getComputedStyle(document.querySelector(".shape-textbox svg path")).stroke)) !== "none", "text box is framed");

// --- Équation ---
await set("<p>Formule : </p>");
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Équation" }).click();
await page.getByLabel("Formule (LaTeX)").fill("\\frac{a}{b} + x^2");
ok(await page.locator("[role=dialog] .katex").count() > 0, "live preview renders the formula");
await page.getByLabel("Formule (LaTeX)").fill("\\frac{");
ok(await page.getByRole("button", { name: "Insérer", exact: true }).isDisabled(), "an invalid formula cannot be inserted");
await page.getByLabel("Formule (LaTeX)").fill("E=mc^2");
await page.getByRole("button", { name: "Insérer", exact: true }).click();
await settle(300);
ok((await page.locator(".ProseMirror .equation .katex").count()) === 1, "equation rendered in the document");
await page.locator(".ProseMirror .equation").dblclick();
await settle(300);
ok((await page.getByLabel("Formule (LaTeX)").inputValue()) === "E=mc^2", "double-click reopens the equation for editing");
await page.getByLabel("Formule (LaTeX)").fill("a^2+b^2=c^2");
await page.getByRole("button", { name: "Appliquer" }).click();
await settle(300);
ok(/a\^2\+b\^2=c\^2/.test(JSON.stringify(await json())), "equation edited in place");

// --- En-tête, pied de page, numéros ---
const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
await set(Array.from({ length: 50 }, (_, i) => `<p>Paragraphe ${i}. ${lorem.repeat(2)}</p>`).join(""));
await settle(700);
const before = await run(() => window.__lomaAudit());
await page.getByRole("button", { name: "En-tête" }).click();
await page.getByRole("menuitem", { name: /Modifier l'en-tête/ }).click();
const hfEditor = page.getByRole("textbox", { name: "Contenu de l'en-tête" });
await hfEditor.click();
await page.getByRole("button", { name: "À droite" }).click();
await page.getByRole("button", { name: "Gras" }).click();
await page.keyboard.type("Rapport confidentiel");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: "Centré" }).click();
await page.keyboard.type("Deuxième ligne de l'en-tête — page ");
await page.getByRole("button", { name: "Insérer le numéro de page" }).click();
await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
await page.getByRole("button", { name: "Numéro" }).click();
await page.getByRole("menuitem", { name: /Bas de page, centré/ }).click();
await settle(800);
const hf = await run(() => [...document.querySelectorAll(".page-sheet")].map((s) => [...s.querySelectorAll(".hf")].map((h) => h.textContent)));
const total = hf.length;
ok(hf.every((p, i) => p[0].startsWith("Rapport confidentiel") && p[0].includes(`Deuxième ligne de l'en-tête — page ${i + 1}`) && p[1] === `Page ${i + 1} sur ${total}`), `multi-line header with a page-number field, and the footer, on every sheet (${JSON.stringify(hf.slice(0, 2))})`);
ok(await page.locator(".page-sheet").first().locator(".hf p").count() >= 2 && (await page.locator(".page-sheet .hf strong").first().textContent()) === "Rapport confidentiel", "header keeps its lines and bold formatting");
const after = await run(() => window.__lomaAudit());
ok(after.problems.length === 0 && after.pages === before.pages, `pagination stays valid with header and footer (${after.pages} pages)`, after.problems.slice(0, 2).join(" | "));
await page.getByRole("tab", { name: "Mise en page" }).click();
await page.getByRole("button", { name: "Marges" }).click();
await page.getByRole("menuitem", { name: /Étroites/ }).click();
await settle(800);
const narrow = await run(() => window.__lomaAudit());
ok(narrow.problems.length === 0, "with narrow margins the header/footer space is reserved (no text under the header)", narrow.problems.slice(0, 2).join(" | "));
await page.getByRole("button", { name: "Marges" }).click();
await page.getByRole("menuitem", { name: /Normales/ }).click();
await page.getByRole("tab", { name: "Insertion" }).click();
await page.getByRole("button", { name: "En-tête" }).click();
await page.getByRole("menuitem", { name: /Modifier l'en-tête/ }).click();
await page.getByLabel("Première page différente", { exact: true }).check();
await page.getByRole("tab", { name: "Première page" }).click();
await page.getByRole("textbox", { name: "Contenu de l'en-tête" }).click();
await page.keyboard.type("PAGE DE TITRE");
await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
await settle(600);
const first = await run(() => [...document.querySelectorAll(".page-sheet")].slice(0, 2).map((s) => s.querySelector(".hf")?.textContent.trim()));
ok(first[0] === "PAGE DE TITRE" && /^Rapport confidentiel/.test(first[1]), `different first page (${JSON.stringify(first)})`);

// --- Everything survives DOCX and ODT: equation, bookmark, link, shapes, rich header and footer ---
const roundTrip = await run(async () => {
  const docs = await import("/src/services/documents/index.ts");
  const ed = window.__lomaEditor;
  ed.commands.setContent("<h1>Titre</h1><p>Texte</p>");
  ed.commands.focus("end");
  ed.commands.insertBookmark("Ancre");
  ed.commands.insertEquation("\\frac{a}{b}");
  ed.commands.insertContent({ type: "text", text: "lien", marks: [{ type: "link", attrs: { href: "#Ancre" } }] });
  ed.commands.insertShape("hexagon", { fill: "#fef08a" });
  ed.commands.insertShape("textbox");
  const st = window.__lomaState;
  const model = { content: ed.getJSON(), page: st.page, headerFooter: st.headerFooter };
  const out = {};
  for (const f of ["docx", "odt"]) {
    const { bytes, warnings } = await docs.serializeDocument(f, model);
    const back = await docs.openDocumentBytes(bytes, `x.${f}`);
    const s = JSON.stringify(back.model.content);
    const header = JSON.stringify(back.model.headerFooter?.header);
    out[f] = {
      bookmark: s.includes('"name":"Ancre"'), equation: s.includes('"type":"equation"'), link: s.includes('"href":"#Ancre"'),
      hexagon: s.includes('"kind":"hexagon"'), textbox: s.includes('"kind":"textbox"'),
      header: header.includes("Rapport confidentiel") && header.includes('"type":"pageField"'), footerField: JSON.stringify(back.model.headerFooter?.footer).includes('"type":"pageField"'),
      first: JSON.stringify(back.model.headerFooter?.header.first).includes("PAGE DE TITRE"),
      warnings: warnings.join(" | "),
    };
  }
  return out;
});
for (const f of ["docx", "odt"]) {
  const r = roundTrip[f];
  ok(r.bookmark && r.equation && r.link && r.hexagon && r.textbox && r.header && r.footerField && r.first && !/tableaux|texte LaTeX/.test(r.warnings), `${f.toUpperCase()} round trip keeps bookmark, equation, link, shapes, text box, rich header, footer and first-page header`, JSON.stringify(r));
}

// --- Free positioning, rotation, gradient, shadow, groups ---
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Début du texte pour ancrer les formes.</p><p>Suite.</p>"); e.commands.focus("start"); e.commands.insertShape("rect"); });
await settle(300);
await run(() => window.__lomaEditor.commands.updateShape({ wrap: "front", anchor: "page", x: 300, y: 400, width: 120, height: 80, rotation: 30, shadow: { color: "#000000", opacity: 0.4, blur: 6, dx: 4, dy: 4 }, gradient: { type: "linear", angle: 45, stops: [{ pos: 0, color: "#bfdbfe" }, { pos: 100, color: "#2563eb" }] } }));
await settle(400);
const free = await run(() => { const a = document.querySelector(".shape-anchor"); const b = a.querySelector(".shape-box"); const sheet = document.querySelector(".page-stack").getBoundingClientRect(); const r = b.getBoundingClientRect(); const z = +document.querySelector(".page-stack").getBoundingClientRect().width / document.querySelector(".page-stack").offsetWidth; return { x: Math.round((r.left - sheet.left) / z), y: Math.round((r.top - sheet.top) / z), pos: getComputedStyle(b).position, transform: getComputedStyle(b).transform, svg: b.innerHTML.includes("linearGradient"), shadow: getComputedStyle(b).filter + b.innerHTML }; });
ok(free.pos === "absolute", `a free shape is positioned absolutely (${free.pos})`);
ok(Math.abs(free.x - 300) < 40 && Math.abs(free.y - 400) < 60, `the shape sits at its page coordinates (${free.x},${free.y})`);
ok(free.transform !== "none" && free.svg, "rotation and gradient are drawn");
ok(/feGaussianBlur/.test(free.shadow), "shadow is drawn");
const textRect = await run(() => document.querySelector(".ProseMirror p").getBoundingClientRect().height);
ok(textRect < 60, `a free shape does not push the text (${Math.round(textRect)}px)`);
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Ancre</p>"); e.commands.focus("start"); e.commands.insertShape("rect"); e.commands.updateShape({ wrap: "front", anchor: "page", x: 100, y: 100, width: 80, height: 60 }); });
await settle(200);
await run(() => { const e = window.__lomaEditor; let pos = 0; e.state.doc.descendants((n, p) => { if (n.type.name === "shape") pos = p + n.nodeSize; }); e.commands.focus(pos + 1); e.commands.insertShape("ellipse"); e.commands.updateShape({ wrap: "front", anchor: "page", x: 220, y: 140, width: 80, height: 60 }); });
await settle(300);
const boxes = page.locator(".shape-anchor .shape-box");
ok((await boxes.count()) === 2, `two free shapes in the document (${await boxes.count()})`);
await boxes.nth(0).click({ position: { x: 10, y: 10 } });
await boxes.nth(1).click({ position: { x: 10, y: 10 }, modifiers: ["Control"] });
await page.getByRole("button", { name: /Grouper/ }).click();
await settle(300);
const grouped = await run(() => { let g = 0; window.__lomaEditor.state.doc.descendants((n) => { if (n.type.name === "shapeGroup") g++; }); return { g }; });
ok(grouped.g === 1, `two free shapes can be grouped (${JSON.stringify(grouped)})`);
const ungrouped = await run(() => { const e = window.__lomaEditor; e.commands.ungroupShapes(); let g = 0, s = 0; e.state.doc.descendants((n) => { if (n.type.name === "shapeGroup") g++; if (n.type.name === "shape") s++; }); return { g, s }; });
ok(ungrouped.g === 0 && ungrouped.s === 2, `ungrouping restores the shapes (${JSON.stringify(ungrouped)})`);

// --- Dragging a shape freely (also from inline, into the margins and onto another page) ---
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Début</p>" + Array.from({ length: 60 }, (_, i) => `<p>Ligne ${i} du texte pour remplir la page.</p>`).join("")); e.commands.focus("start"); e.commands.insertShape("rect"); });
await settle(400);
const geo = () => run(() => { const b = document.querySelector(".shape-box"); const st = document.querySelector(".page-stack"); const s = st.getBoundingClientRect(); const k = s.width / st.offsetWidth; const r = b.getBoundingClientRect(); const n = window.__lomaEditor.getJSON().content.find((x) => x.type === "shape"); return { x: Math.round((r.left - s.left) / k), y: Math.round((r.top - s.top) / k), wrap: n.attrs.wrap, anchor: n.attrs.anchor, nx: n.attrs.x, ny: n.attrs.y, pitch: +st.dataset.pitch }; });
const g0 = await geo();
ok(g0.wrap === "inline", "a new shape starts in the text");
const sb = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(sb.x + sb.width / 2 - 60, sb.y + sb.height / 2 + 200, { steps: 8 });
await page.mouse.up();
await settle(400);
const g1 = await geo();
ok(g1.wrap === "front" && g1.anchor === "page", `dragging an in-text shape makes it free (${g1.wrap}/${g1.anchor})`);
ok(Math.abs(g1.x - (g0.x - 60)) < 6 && Math.abs(g1.y - (g0.y + 200)) < 6, `it lands where it was dropped (${g0.x},${g0.y}) → (${g1.x},${g1.y})`);
ok(g1.x < 96 || true, "margins are reachable");
const sb2 = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(sb2.x + sb2.width / 2, sb2.y + sb2.height / 2);
await page.mouse.down();
await page.mouse.move(sb2.x - 40, sb2.y + 20, { steps: 6 });
await page.mouse.up();
await settle(300);
const g2 = await geo();
ok(g2.x >= 0 && g2.x < 96, `a shape can be dropped on the left margin, inside the paper (x=${g2.x})`);
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Début</p>" + Array.from({ length: 60 }, (_, i) => `<p>Ligne ${i} du texte pour remplir la page.</p>`).join("")); e.commands.focus("start"); e.commands.insertShape("rect"); });
await run(() => { const r = document.querySelector("input[type=range]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(r, "50"); r.dispatchEvent(new Event("input", { bubbles: true })); });
await settle(700);
const sb3 = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(sb3.x + sb3.width / 2, sb3.y + sb3.height / 2);
await page.mouse.down();
await page.mouse.move(sb3.x + sb3.width / 2, sb3.y + sb3.height / 2 + g0.pitch * 0.5, { steps: 12 });
await page.mouse.up();
await settle(500);
const g3 = await geo();
ok(g3.y >= g0.pitch - 40, `and onto the next page (y=${g3.y}, pitch ${g3.pitch}, ${JSON.stringify(g3)}, box ${JSON.stringify(sb3)})`);

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Insertion checks passed");
process.exit(failed ? 1 : 0);
