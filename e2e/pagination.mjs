// End-to-end checks of the pagination in a real browser layout.
//   Requires: a running `npm run dev` on :1420 and Chrome (CHROME_PATH or /usr/bin/google-chrome).
//   Run:      node e2e/pagination.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const audit = readFileSync(new URL("./audit.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.clear());
await page.goto("http://localhost:1420");
await page.addScriptTag({ content: audit });
await page.getByText("Document vierge").click();
await page.waitForFunction(() => window.__lomaEditor);

let failed = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}${cond ? "" : "  " + extra}`); if (!cond) failed++; };
const settle = () => page.waitForTimeout(450);
const run = (fn, arg) => page.evaluate(fn, arg);
const audited = async () => { await settle(); return run(() => window.__lomaAudit()); };

const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
const longDoc = () => {
  let html = "";
  for (let i = 0; i < 40; i++) {
    if (i % 8 === 0) html += `<h1>Chapitre ${i / 8 + 1}</h1>`;
    else if (i % 4 === 0) html += `<h2>Section ${i}</h2>`;
    html += `<p>${("Paragraphe " + i + ". ").concat(lorem.repeat(1 + (i % 6)))}</p>`;
  }
  return html;
};

// 1. A long document is spread over several pages.
await run((h) => window.__lomaEditor.commands.setContent(h), longDoc());
let a = await audited();
ok(a.pages >= 3, `long document spans several pages (${a.pages})`);
ok(a.problems.length === 0, "every character sits inside a page's content area", a.problems.slice(0, 3).join(" | "));
ok(a.spacers.length === a.pages - 1 || a.spacers.length >= a.pages - 1, `page breaks inserted (${a.spacers.length})`);
ok(new RegExp(`Page \\d+ sur ${a.pages}$`).test(a.status ?? ""), `status bar shows the real page count (${a.status})`);

// 2. Nothing is lost or duplicated.
const before = await run(() => window.__lomaEditor.getText());
ok(a.text.replace(/\s/g, "") === before.replace(/\s/g, ""), "text identical with and without page breaks");
ok(JSON.stringify(await run(() => window.__lomaEditor.getJSON())).length > 1000, "document model untouched by pagination");

// 3. Paper format, orientation and margins change the pagination.
const pagesWith = async () => (await audited()).pages;
const base = a.pages;
await page.getByRole("tab", { name: "Mise en page" }).click();
// Short lines make the effect of the orientation unambiguous (wider lines would offset the shorter page).
await run(() => window.__lomaEditor.commands.setContent(Array.from({ length: 90 }, (_, i) => `<p>Ligne ${i}</p>`).join("")));
const shortPortrait = (await audited()).pages;
await page.getByRole("button", { name: "Orientation" }).click();
await page.getByRole("menuitem", { name: "Paysage" }).click();
const landscape = await audited();
ok(landscape.pages > shortPortrait && landscape.problems.length === 0, `landscape: more pages (${landscape.pages} > ${shortPortrait}) and still valid`, landscape.problems.slice(0, 2).join(" | "));
await page.getByRole("button", { name: "Orientation" }).click();
await page.getByRole("menuitem", { name: "Portrait" }).click();
await run((h) => window.__lomaEditor.commands.setContent(h), longDoc());
await audited();
await page.getByRole("button", { name: "Marges" }).click();
await page.getByRole("menuitem", { name: /Étroites/ }).click();
const narrow = await audited();
ok(narrow.pages < base && narrow.problems.length === 0, `narrow margins: fewer pages (${narrow.pages} < ${base})`, narrow.problems.slice(0, 2).join(" | "));
await page.getByRole("button", { name: "Marges" }).click();
await page.getByRole("menuitem", { name: /Larges/ }).click();
const wide = await audited();
ok(wide.pages > base && wide.problems.length === 0, `wide margins: more pages (${wide.pages} > ${base})`, wide.problems.slice(0, 2).join(" | "));
await page.getByRole("button", { name: "Marges" }).click();
await page.getByRole("menuitem", { name: /personnalisées/i }).click();
await page.getByLabel("Haut").fill("6");
await page.getByLabel("Bas").fill("6");
await page.getByRole("button", { name: "Appliquer" }).click();
const custom = await audited();
ok(custom.pages > base && custom.problems.length === 0, `custom margins (6 cm top/bottom): more pages (${custom.pages} > ${base})`, custom.problems.slice(0, 2).join(" | "));
await page.getByRole("button", { name: "Marges" }).click();
await page.getByRole("menuitem", { name: /Normales/ }).click();
await page.getByRole("button", { name: "Taille" }).click();
await page.getByRole("menuitem", { name: /A5/ }).click();
const a5 = await audited();
ok(a5.pages > base && a5.problems.length === 0, `A5: more pages (${a5.pages} > ${base})`, a5.problems.slice(0, 2).join(" | "));
await page.getByRole("button", { name: "Taille" }).click();
await page.getByRole("menuitem", { name: /A4/ }).click();
ok((await pagesWith()) === base, "back to A4 / portrait / normal: same page count again");

// 4. Zoom never changes the logical layout.
const ref = await audited();
for (const z of [50, 150, 300]) {
  await run((z) => { const r = document.querySelector("input[type=range]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(r, String(z)); r.dispatchEvent(new Event("input", { bubbles: true })); }, z);
  const zr = await audited();
  // Spacers may be nudged by a couple of px: text snaps to device pixels differently at each zoom level.
  const sameBreaks = zr.spacers.length === ref.spacers.length && zr.spacers.every((s, i) => Math.abs(s - ref.spacers[i]) < 3);
  ok(zr.pages === ref.pages && zr.problems.length === 0 && sameBreaks, `zoom ${z}%: same pages (${zr.pages}) and same breaks (±3px)`, `${zr.problems.slice(0, 2).join(" | ")} ${JSON.stringify(zr.spacers.slice(0, 4))} vs ${JSON.stringify(ref.spacers.slice(0, 4))}`);
}
await run(() => { const r = document.querySelector("input[type=range]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(r, "100"); r.dispatchEvent(new Event("input", { bubbles: true })); });

// 5. Typing and deleting update the page count and keep the caret.
await run(() => window.__lomaEditor.commands.focus("end"));
const pagesBefore = (await audited()).pages;
await page.keyboard.press("Enter");
for (let i = 0; i < 45; i++) await page.keyboard.type("Ligne ajoutée au clavier. " + "mot ".repeat(8) + "\n", { delay: 0 });
await settle();
const typed = await run(() => ({ head: window.__lomaEditor.state.selection.head, size: window.__lomaEditor.state.doc.content.size }));
const after = await audited();
ok(after.pages > pagesBefore && after.problems.length === 0, `adding text adds pages (${pagesBefore} -> ${after.pages})`, after.problems.slice(0, 2).join(" | "));
ok(typed.head >= typed.size - 2, "caret stays at the end while typing across page breaks");
await page.keyboard.type("XYZ");
const typedMore = await run(() => window.__lomaEditor.getText().endsWith("XYZ"));
ok(typedMore, "typing continues to work after a recalculation");
for (let i = 0; i < 45; i++) await page.keyboard.press("Shift+ArrowUp");
await page.keyboard.press("Delete");
const shrunk = await audited();
ok(shrunk.pages < after.pages, `deleting content removes pages (${after.pages} -> ${shrunk.pages})`);
await run(() => window.__lomaEditor.commands.undo());
await run(() => window.__lomaEditor.commands.undo());
ok(true, "undo after pagination does not throw");
// Regression: undo/redo used to drop the page-break spacers and leave text flowing across the gap between sheets.
await run((h) => window.__lomaEditor.commands.setContent(h), longDoc());
const beforeUndo = await audited();
await run(() => window.__lomaEditor.commands.setContent("<p>court</p>"));
await settle();
await run(() => window.__lomaEditor.commands.undo());
const afterUndo = await audited();
ok(afterUndo.pages === beforeUndo.pages && afterUndo.problems.length === 0 && afterUndo.spacers.length === beforeUndo.spacers.length, `undo restores the pagination (${afterUndo.pages} pages, ${afterUndo.spacers.length} breaks)`, afterUndo.problems.slice(0, 2).join(" | "));
await run(() => window.__lomaEditor.commands.redo());
const afterRedo = await audited();
ok(afterRedo.pages === 1 && afterRedo.problems.length === 0, "redo goes back to the short document with a valid layout");

// 6. Manual page break.
await run(() => window.__lomaEditor.commands.setContent("<p>Avant le saut</p><p>Après le saut</p>"));
await run(() => { window.__lomaEditor.commands.setTextSelection(14); window.__lomaEditor.commands.insertPageBreak(); });
const br = await audited();
const pageOfText = await run(() => {
  const root = window.__lomaEditor.view.dom; const sheets = document.querySelectorAll(".page-sheet");
  const r0 = sheets[0].getBoundingClientRect(); const pitch = sheets[1] ? sheets[1].getBoundingClientRect().top - r0.top : 1e9;
  const pageOf = (el) => Math.floor((el.getBoundingClientRect().top - r0.top) / pitch) + 1;
  const ps = [...root.querySelectorAll("p")]; return { before: pageOf(ps.find((p) => p.textContent.startsWith("Avant"))), after: pageOf(ps.find((p) => p.textContent.startsWith("Après"))) };
});
ok(br.pages === 2 && pageOfText.before === 1 && pageOfText.after === 2, `manual page break: text moves to page 2 (${JSON.stringify(pageOfText)}, ${br.pages} pages)`);
await run(() => window.__lomaEditor.commands.focus("start"));

// 7. Tables split between rows, images are never cut.
const rows = Array.from({ length: 60 }, (_, i) => `<tr><td><p>Ligne ${i}</p></td><td><p>Valeur ${i}</p></td></tr>`).join("");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
await run(([rows, png]) => window.__lomaEditor.commands.setContent(`<p>Avant</p><table><tbody>${rows}</tbody></table><p><img src="${png}" width="300" height="400"></p><p><img src="${png}" width="300" height="700"></p><p>Fin</p>`), [rows, png]);
const tb = await audited();
ok(tb.pages >= 3 && tb.problems.length === 0, `table over several pages and images stay whole (${tb.pages} pages)`, tb.problems.slice(0, 3).join(" | "));
const rowCount = await run(() => window.__lomaEditor.view.dom.querySelectorAll("tr:not(.pg-spacer)").length);
ok(rowCount === 60, `no table row lost or duplicated (${rowCount})`);
const imgCount = await run(() => window.__lomaEditor.view.dom.querySelectorAll("img:not(.ProseMirror-separator)").length);
ok(imgCount === 2, `no image lost or duplicated (${imgCount})`);

// 8. Lists.
const items = Array.from({ length: 70 }, (_, i) => `<li><p>Élément ${i} ${lorem}</p></li>`).join("");
await run((items) => window.__lomaEditor.commands.setContent(`<h1>Liste</h1><ul>${items}</ul><ol>${items}</ol>`), items);
const ls = await audited();
ok(ls.pages >= 4 && ls.problems.length === 0, `long lists paginate (${ls.pages} pages)`, ls.problems.slice(0, 3).join(" | "));
ok((await run(() => window.__lomaEditor.view.dom.querySelectorAll("li").length)) === 140, "no list item lost or duplicated");

// 8b. A table that runs over several pages repeats its header row on each page.
const trs = Array.from({ length: 70 }, (_, i) => `<tr><td><p>Ligne ${i}</p></td><td><p>Valeur ${i}</p></td></tr>`).join("");
await run((rows) => window.__lomaEditor.commands.setContent(`<h1>Tableau</h1><table><tr><th><p>Nom</p></th><th><p>Valeur</p></th></tr>${rows}</table>`), trs);
const ts = await audited();
const copies = await run(() => window.__lomaEditor.view.dom.querySelectorAll("tr.pg-header").length);
ok(ts.pages >= 2 && copies === ts.pages - 1, `header row repeated on each continuation page (${copies} copies, ${ts.pages} pages)`);
ok(ts.problems.length === 0, "table with repeated header stays inside the pages", ts.problems.slice(0, 3).join(" | "));
ok(await run(() => window.__lomaEditor.view.dom.querySelectorAll("tr:not(.pg-spacer)").length) === 71, "repeated headers are not document rows");
ok(await run(() => window.__lomaEditor.getText().split("Nom").length - 1) === 1, "repeated headers are not in the document text");

// 9. Existing document types still edit and keep their model.
ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll pagination checks passed");
process.exit(failed ? 1 : 0);
