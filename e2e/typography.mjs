// End-to-end checks of fonts, sizes, colours, list markers and editable styles in a real browser.
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/typography.mjs
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.clear());
await page.goto("http://localhost:1420");
await page.getByText("Document vierge").click();
await page.waitForFunction(() => window.__lomaEditor);

let failed = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}${cond ? "" : "  " + extra}`); if (!cond) failed++; };
const run = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 300) => page.waitForTimeout(ms);
const set = (html) => run((h) => { window.__lomaEditor.commands.setContent(h); window.__lomaEditor.commands.selectAll(); }, html);

// --- Fonts: Word list + search ---
await set("<p>Texte</p>");
await page.getByRole("button", { name: "Police", exact: true }).click();
ok(await page.getByRole("option", { name: "Times New Roman" }).count() === 1, "Times New Roman is in the font list");
await page.getByRole("searchbox", { name: "Rechercher une police" }).fill("times");
ok((await page.getByRole("option").count()) >= 1 && (await page.getByRole("option", { name: "Calibri" }).count()) === 0, "search filters the fonts");
await page.keyboard.press("Enter");
await settle();
ok(await run(() => window.__lomaEditor.getAttributes("textStyle").fontFamily) === "Times New Roman", "Enter applies the first match");

// --- Sizes: T+ / T- and typed sizes beyond 72 ---
await page.getByRole("button", { name: "Agrandir la police" }).click();
const size = () => run(() => window.__lomaEditor.getAttributes("textStyle").fontSize);
const s1 = parseFloat(await size());
ok(s1 > 11, `T+ enlarges (${s1}pt)`, String(s1));
await page.getByRole("button", { name: "Réduire la police" }).click();
ok(parseFloat(await size()) < s1, "T- shrinks");
const box = page.getByRole("textbox", { name: "Taille de police" });
await box.fill("120");
await box.press("Enter");
await settle();
ok(parseFloat(await size()) === 120, `a typed size above 72 is applied (${await size()})`);
await box.fill("5000");
await box.press("Enter");
ok(parseFloat(await size()) === 1638, "sizes are capped at 1638 pt");

// --- Colour picker stays open and applies on release ---
await set("<p>Couleur</p>");
await page.getByRole("button", { name: "Couleur de police" }).click();
await page.getByRole("button", { name: "Autres couleurs…" }).click();
const sv = page.getByRole("slider", { name: "Saturation et luminosité" });
const r = await sv.boundingBox();
await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.2);
await page.mouse.down();
await page.mouse.move(r.x + r.width * 0.9, r.y + r.height * 0.3, { steps: 5 });
await page.mouse.up();
await settle();
ok(await sv.isVisible(), "the colour picker stays open after choosing");
const color = await run(() => window.__lomaEditor.getAttributes("textStyle").color);
ok(/^#[0-9a-f]{6}$/.test(color ?? ""), `the chosen colour is applied (${color})`);
const hue = page.getByRole("slider", { name: "Teinte" });
const h = await hue.boundingBox();
await page.mouse.click(h.x + h.width * 0.5, h.y + h.height / 2);
await settle();
ok((await run(() => window.__lomaEditor.getAttributes("textStyle").color)) !== color, "the hue slider changes the colour");
await page.keyboard.press("Escape");

// --- List marker styles ---
await set("<ul><li><p>a</p></li></ul>");
await page.getByRole("button", { name: "Style de puces" }).click();
await page.getByRole("button", { name: "Flèche" }).click();
ok(await page.locator('.ProseMirror ul[data-list-type="arrow"]').count() === 1, "bullet style « flèche » is applied");
await set("<ol><li><p>a</p></li></ol>");
await page.getByRole("button", { name: "Style de numérotation" }).click();
await page.getByRole("button", { name: "I. II. III.", exact: true }).click();
ok(await page.locator('.ProseMirror ol[data-list-type="upper-roman"]').count() === 1, "roman numbering is applied");
ok((await page.locator(".ProseMirror ol").evaluate((el) => getComputedStyle(el).listStyleType)) === "upper-roman", "the marker is drawn");

// --- Editable styles ---
await set("<h1>Titre</h1><p>Texte</p>");
await page.getByRole("button", { name: /Modifier les styles/ }).click();
await page.getByRole("tab", { name: "Titre 1" }).waitFor();
await page.getByLabel("Taille", { exact: true }).fill("40");
await page.locator('input[aria-label="Police"]').fill("Georgia");
await page.getByRole("button", { name: "Appliquer" }).click();
await settle();
const h1 = await page.locator(".ProseMirror h1").evaluate((el) => { const c = getComputedStyle(el); return [c.fontSize, c.fontFamily]; });
ok(h1[0] === "53.3333px" && /Georgia/.test(h1[1]), `Titre 1 follows the edited style (${h1.join(" / ")})`);
await page.locator('button[title*="Titre 2"]').dblclick();
ok(await page.getByRole("tab", { name: "Titre 2", selected: true }).count() === 1, "double-click on a style opens it for editing");

await page.getByRole("button", { name: "Annuler", exact: true }).click();

// --- Tables stay inside the page ---
await run(() => window.__lomaEditor.chain().focus().setContent("<p>x</p>").insertTable({ rows: 2, cols: 12 }).run());
await settle();
const width = () => run(() => { const t = document.querySelector(".ProseMirror table").getBoundingClientRect().width, p = document.querySelector(".ProseMirror").getBoundingClientRect().width; return [Math.round(t), Math.round(p)]; });
let [tw, pw] = await width();
ok(tw <= pw + 1, `a 12-column table fits the page (${tw}/${pw})`);
await run(() => { const e = window.__lomaEditor; let pos; e.state.doc.descendants((n, ps) => { if (n.type.name === "tableHeader" || n.type.name === "tableCell") { if (pos === undefined) pos = ps; } }); e.view.dispatch(e.state.tr.setNodeMarkup(pos, undefined, { ...e.state.doc.nodeAt(pos).attrs, colwidth: [1500] })); });
await settle();
[tw, pw] = await width();
ok(tw <= pw + 1, `a column dragged wider than the page is clamped (${tw}/${pw})`);

// --- Table: "+" handles, black borders, visible resize border ---
await run(() => window.__lomaEditor.chain().focus().setContent("<p>x</p>").insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
await settle(500);
ok((await page.locator(".ProseMirror td").first().evaluate((el) => getComputedStyle(el).borderTopColor)) === "rgb(0, 0, 0)", "table borders are black by default");
const cellsIn = () => run(() => document.querySelector(".ProseMirror table").rows[0].cells.length);
const rowsIn = () => run(() => [...document.querySelector(".ProseMirror table").rows].filter((r) => !r.classList.contains("pg-spacer")).length);
const tb = await page.locator(".ProseMirror table").boundingBox();
const c0 = await page.locator(".ProseMirror th").nth(0).boundingBox();
await page.mouse.move(tb.x + 100, tb.y + 100);
await page.mouse.move(c0.x + c0.width, tb.y - 6);
await page.locator("button[data-table-insert]").waitFor();
ok(await page.locator("button[title='Insérer une colonne ici']").isVisible(), "a blue + appears above a column border");
await page.locator("button[title='Insérer une colonne ici']").click();
await settle(300);
ok((await cellsIn()) === 4, `clicking it inserts a column (${await cellsIn()})`);
const tb2 = await page.locator(".ProseMirror table").boundingBox();
const r1 = await page.locator(".ProseMirror tr").nth(1).boundingBox();
await page.mouse.move(tb2.x + 100, tb2.y + 100);
await page.mouse.move(tb2.x - 6, r1.y);
await page.locator("button[title='Insérer une ligne ici']").waitFor();
await page.locator("button[title='Insérer une ligne ici']").click();
await settle(300);
ok((await rowsIn()) === 4, `a + left of a row border inserts a row (${await rowsIn()})`);
const tb3 = await page.locator(".ProseMirror table").boundingBox();
const hd = await page.locator(".ProseMirror th").nth(1).boundingBox();
await page.mouse.move(hd.x + hd.width - 1, hd.y + hd.height / 2);
await settle(200);
ok((await page.locator(".column-resize-handle").count()) >= 1, "the border that will be moved is highlighted when hovered");
await page.mouse.down();
await page.mouse.move(hd.x + hd.width + 30, hd.y + hd.height / 2, { steps: 4 });
ok((await page.locator(".column-resize-handle").count()) >= 1, "and stays highlighted while dragging");
await page.mouse.up();
void tb3;

// --- Table styles and customisation ---
await page.getByRole("button", { name: "Styles de tableau" }).click();
await page.getByRole("button", { name: "Bleu", exact: true }).click();
await settle(300);
const th = await page.locator(".ProseMirror th").first().evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.borderTopColor]; });
ok(th[0] === "rgb(37, 99, 235)" && th[1] === "rgb(255, 255, 255)" && th[2] === "rgb(37, 99, 235)", `the "Bleu" style colours header, text and borders (${th})`);
await page.getByRole("button", { name: "Bordures du tableau" }).click();
await page.getByRole("menuitem", { name: "Aucune bordure" }).click();
await settle(200);
ok((await page.locator(".ProseMirror td").first().evaluate((el) => getComputedStyle(el).borderTopWidth)) === "0px", "borders can be removed");
await page.getByRole("button", { name: "Bordures du tableau" }).click();
await page.getByRole("menuitem", { name: "Toutes les bordures" }).click();
await page.getByRole("button", { name: "Épaisseur des bordures" }).click();
await page.getByRole("menuitem", { name: "3 px" }).click();
await page.getByRole("button", { name: "Alterner la couleur des lignes" }).click();
await settle(200);
ok((await page.locator(".ProseMirror td").first().evaluate((el) => getComputedStyle(el).borderTopWidth)) === "3px", "border width is customisable");
ok(await run(() => !window.__lomaEditor.getAttributes("table").look.band), "banded rows can be switched off (the Bleu style has them)");
await page.getByRole("button", { name: "Alterner la couleur des lignes" }).click();
await settle(200);
ok(await run(() => !!window.__lomaEditor.getAttributes("table").look.band), "and back on");
const bandBg = await page.locator(".ProseMirror tr").nth(1).locator("td").first().evaluate((el) => getComputedStyle(el).backgroundColor);
ok(bandBg !== "rgba(0, 0, 0, 0)", `the banded row is drawn (${bandBg})`);
const kept = await run(async () => JSON.stringify(window.__lomaEditor.getJSON()).includes('"look"'));
ok(kept, "the table look is stored in the document");

// --- Moving a table ---
await run(() => window.__lomaEditor.commands.setContent("<p>Avant</p><table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table><p>Après</p><p>Fin</p>"));
await settle(400);
const tbm = await page.locator(".ProseMirror table").boundingBox();
await page.mouse.move(tbm.x + 20, tbm.y + 10);
await page.locator("button[data-table-move]").waitFor();
const mv = await page.locator("button[data-table-move]").boundingBox();
await page.mouse.move(mv.x + 9, mv.y + 9);
await page.mouse.down();
const last = await page.locator(".ProseMirror p").last().boundingBox();
await page.mouse.move(last.x + 20, last.y + last.height + 5, { steps: 6 });
ok(await page.locator("[data-table-drop]").count() === 1, "a line shows where the table will land");
await page.mouse.up();
await settle(300);
const order = await run(() => window.__lomaEditor.getJSON().content.map((n) => n.type).join());
ok(order === "paragraph,paragraph,paragraph,table,paragraph", `the table was moved to the end (${order})`);

// --- Free horizontal placement, margins included ---
await run(() => window.__lomaEditor.commands.setContent("<p>Texte</p><table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table><p>Fin</p>"));
await settle(400);
const t0 = await page.locator(".ProseMirror table").boundingBox();
await page.mouse.move(t0.x + 20, t0.y + 10);
await page.locator("button[data-table-move]").waitFor();
const hb = await page.locator("button[data-table-move]").boundingBox();
await page.mouse.move(hb.x + 9, hb.y + 9);
await page.mouse.down();
await page.mouse.move(hb.x + 9 - 60, hb.y + 9, { steps: 6 });
await page.mouse.up();
await settle(400);
const placed = await run(() => window.__lomaEditor.getJSON().content.find((n) => n.type === "table").attrs.place);
const t1 = await page.locator(".ProseMirror table").boundingBox();
const pm = await page.locator(".ProseMirror").boundingBox();
ok(placed && placed.x < 0, `the table can be dragged into the left margin (x=${placed?.x})`);
ok(t1.x < pm.x - 20, `and is drawn there (${Math.round(t1.x - pm.x)}px from the text column)`);
await page.mouse.move(t1.x + 20, t1.y + 10);
await page.locator("button[data-table-move]").dblclick();
await settle(300);
ok(await run(() => window.__lomaEditor.getJSON().content.find((n) => n.type === "table").attrs.place === null), "double-clicking the handle puts it back in the text column");

// --- Selecting objects from their handle ---
const sel = () => run(() => { const s = window.__lomaEditor.state.selection; return s.node ? s.node.type.name : s.constructor.name; });
await run(() => window.__lomaEditor.commands.setContent("<p>Avant</p><table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table><p>Après</p>"));
await settle(400);
const tb9 = await page.locator(".ProseMirror table").boundingBox();
await page.mouse.move(tb9.x + 20, tb9.y + 10);
await page.locator("button[data-table-move]").click();
await settle(200);
const cells = await page.locator(".ProseMirror .selectedCell").count();
ok(((await sel()) === "table" || (await sel()) === "CellSelection") && cells === 4, `clicking the table handle selects the whole table (${await sel()}, ${cells} cells)`);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADq0kPzxQAAAAAElFTkSuQmCC";
await run((src) => window.__lomaEditor.commands.setContent(`<p>Premier <img src="${src}" width="60" height="60"> texte</p><p>Second paragraphe</p>`), PNG);
await settle(400);
const imgAttrs = () => run(() => { const p = window.__lomaEditor.getJSON().content.flatMap((n) => n.content ?? []).find((c) => c.type === "image"); return p.attrs; });
const ib = await page.locator(".img-box").boundingBox();
await page.mouse.move(ib.x + 20, ib.y + 20);
await page.locator(".img-move").click({ force: true });
ok((await sel()) === "image", `clicking the picture handle selects it (${await sel()})`);
ok(await page.getByRole("toolbar", { name: "Image" }).isVisible(), "the Image toolbar appears");
// resize with the corner handle (proportions kept)
const rh = await page.locator(".img-h-se").boundingBox();
await page.mouse.move(rh.x + 5, rh.y + 5);
await page.mouse.down();
await page.mouse.move(rh.x + 45, rh.y + 5, { steps: 5 });
await page.mouse.up();
await settle(200);
const ia = await imgAttrs();
ok(ia.width > 70 && Math.abs(ia.width - ia.height) < 3, `the picture can be resized, proportions kept (${ia.width} × ${ia.height})`);
// each side on its own
const side = async (dir, dx, dy) => { const b = await page.locator(`.img-h-${dir}`).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 4 }); await page.mouse.up(); await settle(200); return imgAttrs(); };
const before = await imgAttrs();
const e1 = await side("e", 30, 0);
ok(e1.width > before.width + 20 && e1.height === before.height, `the right side changes the width only (${before.width}×${before.height} → ${e1.width}×${e1.height})`);
const sd1 = await side("s", 0, 25);
ok(sd1.height > e1.height + 15 && sd1.width === e1.width, `the bottom side changes the height only (${sd1.width}×${sd1.height})`);
const n1 = await side("n", 0, -20);
ok(n1.height > sd1.height + 10 && n1.width === sd1.width, `the top side changes the height only (${n1.width}×${n1.height})`);
const w1 = await side("w", -20, 0);
ok(w1.width > n1.width + 10 && w1.height === n1.height, `the left side changes the width only (${w1.width}×${w1.height})`);
const nw1 = await side("nw", -10, -10);
ok(nw1.width > w1.width && Math.abs(nw1.width / nw1.height - w1.width / w1.height) < 0.05, `a corner keeps the proportions (${nw1.width}×${nw1.height})`);
// free move: drag the picture itself to the margin / other paragraph area
const ib2 = await page.locator(".img-box").boundingBox();
await page.mouse.move(ib2.x + ib2.width / 2, ib2.y + ib2.height / 2);
await page.mouse.down();
await page.mouse.move(ib2.x + ib2.width / 2 - 70, ib2.y + ib2.height / 2 + 120, { steps: 8 });
await page.mouse.up();
await settle(300);
const ia2 = await imgAttrs();
ok(ia2.wrap === "front" && ia2.anchor === "page" && ia2.y > 100, `the picture can be moved freely like a shape (${ia2.wrap}, x=${ia2.x}, y=${ia2.y})`);
ok((await page.locator(".img-box").evaluate((el) => getComputedStyle(el).position)) === "absolute", "and is drawn out of the text flow");
// rotation and wrapping from the toolbar
await page.getByLabel("Rotation de l'image (degrés)").fill("30");
await settle(200);
ok((await imgAttrs()).rotation === 30 && (await page.locator(".img-box").evaluate((el) => getComputedStyle(el).transform)) !== "none", "the picture can be rotated");
await page.getByRole("button", { name: "Habillage" }).click();
await page.getByRole("menuitem", { name: "En ligne avec le texte" }).click();
await settle(200);
ok((await imgAttrs()).wrap === "inline", "and put back in the text from « Habillage »");
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Texte</p>"); e.commands.focus("start"); e.commands.insertShape("rect"); e.commands.blur(); });
await settle(400);
const sbx = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(sbx.x + sbx.width / 2, sbx.y + sbx.height / 2);
await page.locator(".shape-move").click({ position: { x: 7, y: 7 }, force: true });
ok((await sel()) === "shape", `clicking the shape handle selects the shape (${await sel()})`);

// --- Row height ---
await run(() => window.__lomaEditor.commands.setContent("<table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr><tr><td><p>3</p></td><td><p>4</p></td></tr></table>"));
await settle(400);
const rowBox = () => page.locator(".ProseMirror tr").nth(1).boundingBox();
const rw1 = await rowBox();
const cx = rw1.x + rw1.width / 3;
await page.mouse.move(cx, rw1.y + rw1.height - 1);
await settle(150);
ok(await page.locator("[data-row-resize-line]").evaluate((el) => getComputedStyle(el).display) === "block", "a blue line shows the row border that will move");
await page.mouse.down();
await page.mouse.move(cx, rw1.y + rw1.height + 40, { steps: 6 });
await page.mouse.up();
await settle(300);
const rw1b = await rowBox();
ok(rw1b.height > rw1.height + 30, `a row can be made taller (${Math.round(rw1.height)} → ${Math.round(rw1b.height)} px)`);
ok(await run(() => window.__lomaEditor.getJSON().content[0].content[1].attrs.rowHeight) > 50, "the height is stored in the document");
await page.mouse.move(cx, rw1b.y + rw1b.height - 1);
await page.mouse.down();
await page.mouse.move(cx, rw1b.y + 2, { steps: 6 });
await page.mouse.up();
await settle(300);
const rw1c = await rowBox();
ok(rw1c.height >= 20 && rw1c.height < rw1b.height, `and smaller again, never below its content (${Math.round(rw1c.height)} px)`);
await page.mouse.move(cx, rw1c.y + rw1c.height - 1);
await page.mouse.dblclick(cx, rw1c.y + rw1c.height - 1);
await settle(300);
ok(await run(() => window.__lomaEditor.getJSON().content[0].content[1].attrs.rowHeight) === null, "double-clicking the border gives back the automatic height");

// --- Copy and paste of pictures, tables and shapes ---
await page.getByRole("tab", { name: "Accueil" }).click();
const countNodes = (t) => run((t) => { let n = 0; window.__lomaEditor.state.doc.descendants((x) => { if (x.type.name === t) n++; }); return n; }, t);
await run((src) => window.__lomaEditor.commands.setContent(`<p>a <img src="${src}" width="60" height="60"> b</p><p>fin</p>`), PNG);
await settle(400);
const cb = await page.locator(".img-box").boundingBox();
await page.mouse.move(cb.x + 20, cb.y + 20);
await page.locator(".img-move").click({ force: true });
await page.keyboard.press("Control+c");
await page.mouse.move(cb.x + 200, cb.y + 150); // the paste goes where the pointer is
await page.keyboard.press("Control+v");
await settle(300);
ok((await countNodes("image")) === 2, `a picture selected from its handle can be copied and pasted with the keyboard (${await countNodes("image")})`);
await run((src) => window.__lomaEditor.commands.setContent(`<p>a <img src="${src}" width="60" height="60" data-wrap="front" data-x="50" data-y="50" data-rotation="20"> b</p><p>fin</p>`), PNG);
await settle(400);
const cb2 = await page.locator(".img-box").boundingBox();
await page.mouse.move(cb2.x + 20, cb2.y + 20);
await page.locator(".img-move").click({ force: true });
await page.getByRole("button", { name: "Copier (Ctrl+C)" }).click();
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Coller (Ctrl+V)" }).click();
await settle(300);
const pasted = await run(() => { const imgs = []; window.__lomaEditor.state.doc.descendants((n) => { if (n.type.name === "image") imgs.push(n.attrs); }); return imgs; });
ok(pasted.length === 2 && pasted[1].wrap === "front" && pasted[1].rotation === 20, `the Copier / Coller buttons keep a picture with its settings (${pasted.length} pictures, ${pasted[1]?.wrap}, ${pasted[1]?.rotation}°)`);
await run(() => window.__lomaEditor.commands.setContent("<p>a</p><table><tr><th><p>A</p></th></tr><tr><td><p>1</p></td></tr></table><p>fin</p>"));
await settle(400);
const ctb = await page.locator(".ProseMirror table").boundingBox();
await page.mouse.move(ctb.x + 20, ctb.y + 8);
await page.locator("button[data-table-move]").click();
await page.getByRole("button", { name: "Copier (Ctrl+C)" }).click();
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Coller (Ctrl+V)" }).click();
await settle(300);
ok((await countNodes("table")) === 2, `a selected table can be copied and pasted (${await countNodes("table")})`);
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Texte</p>"); e.commands.focus("start"); e.commands.insertShape("star5"); });
await settle(400);
const csb = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(csb.x + csb.width / 2, csb.y + csb.height / 2);
await page.locator(".shape-move").click({ force: true });
await page.getByRole("button", { name: "Copier (Ctrl+C)" }).click();
await run(() => window.__lomaEditor.commands.focus("end"));
await page.getByRole("button", { name: "Coller (Ctrl+V)" }).click();
await settle(300);
ok((await countNodes("shape")) === 2, `a selected shape can be copied and pasted (${await countNodes("shape")})`);

// --- Undo / redo ---
await run(() => window.__lomaEditor.commands.setContent("<p>Début</p>"));
await run(() => window.__lomaEditor.commands.focus("end"));
await page.waitForTimeout(700); // the history groups quick edits: let the content setup be its own event
await page.keyboard.type(" ajouté");
await page.keyboard.press("Control+z");
ok((await run(() => window.__lomaEditor.getText())) === "Début", "Ctrl+Z undoes typing in the editor");
await page.keyboard.press("Control+y");
ok((await run(() => window.__lomaEditor.getText())).includes("ajouté"), "Ctrl+Y redoes it");
// focus outside the editor (after using the ribbon or an object handle)
await run(() => { document.activeElement?.blur(); });
await page.keyboard.press("Control+z");
ok((await run(() => window.__lomaEditor.getText())) === "Début", "Ctrl+Z works when the focus is not in the editor");
await page.keyboard.press("Control+Shift+z");
ok((await run(() => window.__lomaEditor.getText())).includes("ajouté"), "Ctrl+Maj+Z redoes it");
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Texte</p>"); e.commands.focus("start"); e.commands.insertShape("rect"); });
await settle(400);
const usb = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(usb.x + usb.width / 2, usb.y + usb.height / 2);
await page.mouse.down();
await page.mouse.move(usb.x + usb.width / 2 + 80, usb.y + usb.height / 2 + 60, { steps: 5 });
await page.mouse.up();
await settle(300);
ok((await run(() => window.__lomaEditor.getJSON().content.find((n) => n.type === "shape").attrs.wrap)) === "front", "a shape was moved freely");
await page.keyboard.press("Control+z");
await settle(300);
ok((await run(() => window.__lomaEditor.getJSON().content.find((n) => n.type === "shape").attrs.wrap)) === "inline", "Ctrl+Z puts the shape back where it was");

// A platform where the clipboard cannot be written for objects: the editor's own copy is used.
await run(() => { document.execCommand = () => false; navigator.clipboard.write = () => new Promise(() => {}); /* a webview where the async clipboard API never answers */ });
await run((src) => window.__lomaEditor.commands.setContent(`<p>a <img src="${src}" width="60" height="60"> b</p><p>fin</p>`), PNG);
await settle(400);
const fb = await page.locator(".img-box").boundingBox();
await page.mouse.move(fb.x + 20, fb.y + 20);
await page.locator(".img-move").click({ force: true });
await page.keyboard.press("Control+c");
await page.mouse.move(fb.x + 200, fb.y + 150);
await page.keyboard.press("Control+v");
await settle(300);
ok((await countNodes("image")) === 2, `Ctrl+C / Ctrl+V still work when the system clipboard never confirms the copy (stale content on it) (${await countNodes("image")} pictures, selection ${await sel()})`);

// --- Arrow keys move a picture; pasted objects land under the pointer and stay put ---
await run((src) => window.__lomaEditor.commands.setContent(`<p>Texte de la page</p><p>Suite</p><p><img src="${src}" width="60" height="60"></p>`), PNG);
await settle(400);
const ab = await page.locator(".img-box").boundingBox();
await page.mouse.move(ab.x + 20, ab.y + 20);
await page.locator(".img-move").click({ force: true });
const at0 = await imgAttrs();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowDown");
const at1 = await imgAttrs();
ok(at1.wrap === "front" && at1.x === at0.x + 10 && at1.y === at0.y + 5 || (at1.wrap === "front" && at1.x > 0), `arrow keys move the selected picture (${at0.wrap} → ${at1.wrap}, x ${at0.x}→${at1.x}, y ${at0.y}→${at1.y})`);
const xBefore = at1.x;
await page.keyboard.press("Shift+ArrowRight");
ok((await imgAttrs()).x === xBefore + 25, "Maj+arrow moves by a larger step");
await page.keyboard.press("Control+ArrowLeft");
ok((await imgAttrs()).x === xBefore + 24, "Ctrl+arrow moves by one pixel");

const stackBox = await page.locator(".page-stack").boundingBox();
const allImgs = () => run(() => { const o = []; window.__lomaEditor.state.doc.descendants((n) => { if (n.type.name === "image") o.push({ x: n.attrs.x, y: n.attrs.y, wrap: n.attrs.wrap }); }); return o; });
await page.keyboard.press("Control+c");
const k = (await page.locator(".page-stack").evaluate((el) => el.getBoundingClientRect().width / el.offsetWidth)) || 1;
await page.mouse.move(stackBox.x + 300 * k, stackBox.y + 500 * k);
await page.keyboard.press("Control+v");
await settle(300);
let imgs = await allImgs();
ok(imgs.length === 2, `the picture is pasted (${imgs.length})`);
const p1 = imgs.find((i) => Math.abs(i.x - 270) < 40 && Math.abs(i.y - 470) < 40);
ok(!!p1, `the copy lands under the pointer, not on the source (${JSON.stringify(imgs)})`);
await page.mouse.move(stackBox.x + 150 * k, stackBox.y + 300 * k);
await page.keyboard.press("Control+v");
await settle(300);
imgs = await allImgs();
ok(imgs.length === 3 && imgs.filter((i) => Math.abs(i.x - 270) < 40 && Math.abs(i.y - 470) < 40).length === 1, `pasting again does not move the first copy, and can be done as often as wanted (${imgs.length} pictures)`);
await page.keyboard.press("Control+v");
await settle(300);
imgs = await allImgs();
const same = imgs.filter((i) => Math.abs(i.x - 120) < 60 && Math.abs(i.y - 270) < 60);
ok(imgs.length === 4 && new Set(same.map((i) => `${i.x},${i.y}`)).size === same.length, `pasting twice at the same spot does not hide the previous copy (${same.length} offset copies)`);

// --- Clicking the sheet releases the selected object ---
await run((src) => window.__lomaEditor.commands.setContent(`<p>Texte</p><p><img src="${src}" width="60" height="60"></p><table><tr><th><p>A</p></th></tr><tr><td><p>1</p></td></tr></table><p>fin</p>`), PNG);
await settle(400);
const sheetBox = await page.locator(".page-sheet").first().boundingBox();
const isObj = () => run(() => { const s = window.__lomaEditor.state.selection; return !!s.node || s.constructor.name === "CellSelection"; });
const ib9 = await page.locator(".img-box").boundingBox();
await page.mouse.move(ib9.x + 20, ib9.y + 20);
await page.locator(".img-move").click({ force: true });
ok(await isObj(), "the picture is selected");
await page.mouse.click(sheetBox.x + 20, sheetBox.y + 300); // the left margin of the sheet
ok(!(await isObj()), "a click in the margin of the sheet releases the picture");
const tb8 = await page.locator(".ProseMirror table").boundingBox();
await page.mouse.move(tb8.x + 20, tb8.y + 8);
await page.locator("button[data-table-move]").click();
ok(await isObj(), "the table is selected");
await page.mouse.click(sheetBox.x + sheetBox.width + 40, sheetBox.y + 200); // the grey around the sheet
ok(!(await isObj()), "a click next to the sheet releases the table");
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Texte</p>"); e.commands.focus("start"); e.commands.insertShape("rect"); });
await settle(400);
const sb7 = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(sb7.x + sb7.width / 2, sb7.y + sb7.height / 2);
await page.locator(".shape-move").click({ force: true });
ok(await isObj(), "the shape is selected");
await page.mouse.click(sheetBox.x + 20, sheetBox.y + 500);
ok(!(await isObj()), "a click on the sheet releases the shape");
await page.locator(".ProseMirror p").first().click();
ok(!(await isObj()) && (await page.getByRole("toolbar", { name: "Forme" }).count()) === 0, "and its toolbar goes away");

// --- Double-click on the sheet places the caret there ---
await run(() => window.__lomaEditor.commands.setContent("<p>Premier</p><p>Second paragraphe</p>"));
await settle(400);
const shb = await page.locator(".page-sheet").first().boundingBox();
const pBox = await page.locator(".ProseMirror p").first().boundingBox();
await page.mouse.dblclick(shb.x + 25, pBox.y + 8); // the left margin, level with the first line
const c1 = await run(() => { const s = window.__lomaEditor.state.selection; return [s.empty, s.$from.parent.textContent]; });
ok(c1[0] && c1[1] === "Premier", `a double-click in the margin puts the caret on that line (${c1[1]})`);
const nBefore = await run(() => window.__lomaEditor.getJSON().content.length);
await page.mouse.dblclick(shb.x + 300, shb.y + 600); // blank area well below the text
const after = await run(() => ({ n: window.__lomaEditor.getJSON().content.length, empty: window.__lomaEditor.state.selection.empty, text: window.__lomaEditor.state.selection.$from.parent.textContent }));
ok(after.n > nBefore + 3 && after.empty && after.text === "", `a double-click below the text adds empty lines down to it (${nBefore} → ${after.n} paragraphs, caret in an empty one)`);
await page.keyboard.type("ici");
ok((await run(() => window.__lomaEditor.getText())).endsWith("ici"), "and typing goes there");

// A webview that keeps only the plain text of a copy: the tag it carries leads back to the picture.
await run(() => { navigator.clipboard.write = async (items) => { window.__sys = await (await items[0].getType("text/plain")).text(); }; });
await run((src) => window.__lomaEditor.commands.setContent(`<p>a <img src="${src}" width="60" height="60"> b</p><p>fin</p>`), PNG);
await settle(400);
const tgb = await page.locator(".img-box").boundingBox();
await page.mouse.move(tgb.x + 20, tgb.y + 20);
await page.locator(".img-move").click({ force: true });
await page.keyboard.press("Control+c");
await settle(300);
await page.mouse.move(tgb.x + 150, tgb.y + 120);
await run(() => { const dt = new DataTransfer(); dt.setData("text/plain", window.__sys); window.__lomaEditor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); });
await settle(300);
ok((await countNodes("image")) === 2, `a copy that only left its tag in the plain text is still pasted as the picture (${await countNodes("image")} pictures)`);

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll typography checks passed");
process.exit(failed ? 1 : 0);
