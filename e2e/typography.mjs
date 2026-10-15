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

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll typography checks passed");
process.exit(failed ? 1 : 0);
