// End-to-end checks of text columns and continuous section breaks.
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/columns.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const audit = readFileSync(new URL("./audit.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.clear());
await page.goto("http://localhost:1420");
await page.addScriptTag({ content: audit });
await page.getByText("Document vierge").click();
await page.waitForFunction(() => window.__lomaEditor);
await page.getByRole("tab", { name: "Mise en page" }).click();

let failed = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}${cond ? "" : "  " + extra}`); if (!cond) failed++; };
const run = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(700);
const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
const para = (t, n) => `<p>${t}. ${lorem.repeat(n)}</p>`;
const menu = async (label, item) => { await page.getByRole("button", { name: label, exact: true }).click(); await page.getByRole("menuitem", { name: item }).click(); };
const geo = () => run(() => { const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; const s0 = st.getBoundingClientRect(); return [...document.querySelectorAll(".ProseMirror > p")].map((p) => { const r = p.getBoundingClientRect(); return { x: Math.round((r.left - s0.left) / k), y: Math.round((r.top - s0.top) / k), w: Math.round(r.width / k), h: Math.round(r.height / k) }; }); });
const pages = () => run(() => document.querySelectorAll(".page-sheet").length);

const body = Array.from({ length: 30 }, (_, i) => para(`Paragraphe ${i}`, 4)).join("");
await run((h) => window.__lomaEditor.commands.setContent(h), body);
await settle();
const p1 = await pages();
await menu("Colonnes", "Deux");
await settle();
const g = await geo();
const colW = (794 - 192 - 47.24) / 2; // text width minus the 1.25 cm gap, in two
ok(g.every((p) => Math.abs(p.w - colW) < 2 || Math.abs(p.w - (2 * colW + 47.24)) < 2), `every paragraph is one column wide, or two when it runs over both (${[...new Set(g.map((p) => p.w))]}; expected ${Math.round(colW)})`);
ok(g.some((p) => p.x < 100) && g.some((p) => p.x > 300), `the text is in two columns (x = ${[...new Set(g.map((p) => p.x))]})`);
ok(g[0].y === 96 && g[0].x === 96, "the text starts at the top left of the text area");
const a1 = await run(() => window.__lomaAudit());
ok(a1.problems.length === 0, "every character is inside its page and its column area", a1.problems.slice(0, 3).join(" | "));
ok((await pages()) <= p1, `two columns need no more pages than one (${p1} → ${await pages()})`);
// no two blocks of a column overlap
let overlap = false;
for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
  const a = g[i], b = g[j];
  if (a.w > 500 || b.w > 500) continue; // a paragraph that runs over two columns is a box of its own
  if (a.x === b.x && Math.abs(a.y - b.y) < 1000 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) overlap = true;
}
ok(!overlap, "the blocks of a column never overlap");

// typing in a column keeps working
await run(() => window.__lomaEditor.commands.focus("end"));
await page.keyboard.type(" Fin ajoutée.");
await settle();
ok((await run(() => window.__lomaEditor.getText())).includes("Fin ajoutée."), "typing in the columns works");
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout stays valid");

// --- 3 columns, with a line between ---
await page.getByRole("button", { name: "Colonnes", exact: true }).click();
await page.getByRole("menuitem", { name: "Autres colonnes…" }).click();
const dlg = page.getByRole("dialog");
await dlg.getByRole("button", { name: "3 colonnes" }).click();
await dlg.getByLabel("Ligne entre les colonnes").check();
await dlg.getByRole("button", { name: "Appliquer" }).click();
await settle();
const g3 = await geo();
ok(g3.some((p) => Math.abs(p.w - 169) < 3) && g3.some((p) => p.x + p.w > 690 && p.x > 300), "three columns (blocks 169px wide, the text reaches the third one)");
ok((await run(() => document.querySelectorAll(".page-column-rule").length)) >= 2, "with a line between the columns");
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and a valid layout", (await run(() => window.__lomaAudit())).problems.slice(0, 2).join("|"));

// --- invalid input ---
await page.getByRole("button", { name: "Colonnes", exact: true }).click();
await page.getByRole("menuitem", { name: "Autres colonnes…" }).click();
await dlg.getByLabel("Nombre de colonnes (autre)").fill("9");
ok(await dlg.getByRole("button", { name: "Appliquer" }).isDisabled(), "more than 6 columns is refused");
await dlg.getByLabel("Nombre de colonnes (autre)").fill("6");
await dlg.getByLabel("Espacement entre colonnes (cm)").fill("4");
ok(await dlg.getByRole("button", { name: "Appliquer" }).isDisabled(), "columns narrower than 2 cm are refused");
await dlg.getByRole("button", { name: "Annuler" }).click();

// --- back to one column ---
await menu("Colonnes", "Une");
await settle();
ok(new Set((await geo()).map((p) => p.x)).size === 1, "one column again");

// --- continuous section: one column, then two, in the same page ---
await run((h) => window.__lomaEditor.commands.setContent(h), para("Titre en une colonne", 2) + Array.from({ length: 4 }, (_, i) => para(`Colonne ${i}`, 3)).join("") + para("Fin en une colonne", 2));
await settle();
await run(() => { const e = window.__lomaEditor; e.commands.setTextSelection(e.state.doc.child(0).nodeSize + 3); });
await settle();
await page.getByRole("button", { name: "Colonnes", exact: true }).click();
await page.getByRole("menuitem", { name: "Autres colonnes…" }).click();
await dlg.getByRole("button", { name: "2 colonnes" }).click();
await dlg.getByLabel("Appliquer à").selectOption("from-here");
await dlg.getByRole("button", { name: "Appliquer" }).click();
await settle();
ok((await run(() => { let n = 0; window.__lomaEditor.state.doc.descendants((x) => { if (x.type.name === "sectionBreak" && x.attrs.kind === "continuous") n++; }); return n; })) === 1, "a continuous section break was inserted");
const gc = await geo();
ok(gc[0].w > 500, `the first paragraph is full width (${gc[0].w}px)`);
ok(gc.slice(1).some((p) => p.w < 300), "the following ones are in columns");
ok((await pages()) === 1, `everything is still on one page (${await pages()})`);
// back to one column after the region: add a continuous break with one column before the last paragraph
await run(() => { const e = window.__lomaEditor; let last = 0; e.state.doc.forEach((n, off) => { last = off; }); e.commands.setTextSelection(last + 2); });
await settle();
await page.getByRole("button", { name: "Colonnes", exact: true }).click();
await page.getByRole("menuitem", { name: "Autres colonnes…" }).click();
await dlg.getByRole("button", { name: "Une colonne" }).click();
await dlg.getByLabel("Appliquer à").selectOption("from-here");
await dlg.getByRole("button", { name: "Appliquer" }).click();
await settle();
const gf = await geo();
const last = gf[gf.length - 1];
ok(last.w > 500, `the last paragraph is full width again (${last.w}px)`);
const colsBottom = Math.max(...gf.slice(1, -1).map((p) => p.y + p.h));
ok(last.y >= colsBottom - 2, `and it comes below the columns (y=${last.y}, columns end at ${colsBottom})`);
const ends = [0, 1].map((c) => Math.max(...gf.slice(1, -1).filter((p) => (c === 0 ? p.x < 300 : p.x > 300)).map((p) => p.y + p.h)));
ok(Math.abs(ends[0] - ends[1]) < 140, `the two columns are balanced (end at ${ends.join(" and ")})`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid", (await run(() => window.__lomaAudit())).problems.slice(0, 2).join("|"));

// --- lists, quotes and column breaks ---
const li = (i) => `<li><p>Item ${i}. ${lorem}</p></li>`;
await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Intro. ${lorem}</p><ol>${Array.from({ length: 14 }, (_, i) => li(i + 1)).join("")}</ol><blockquote><p>Citation un. ${lorem.repeat(2)}</p><p>Citation deux. ${lorem.repeat(2)}</p></blockquote><ul>${Array.from({ length: 6 }, (_, i) => li(i + 1)).join("")}</ul><p>Fin. ${lorem}</p>`);
await settle();
await page.getByRole("tab", { name: "Mise en page" }).click();
await menu("Colonnes", "Deux");
await settle();
const units = await run(() => { const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; const s0 = st.getBoundingClientRect(); return [...document.querySelectorAll(".ProseMirror [data-col]")].map((p) => { const r = p.getBoundingClientRect(); return { t: p.tagName, q: p.hasAttribute("data-col-quote"), x: Math.round((r.left - s0.left) / k), y: Math.round((r.top - s0.top) / k), w: Math.round(r.width / k), h: Math.round(r.height / k) }; }); });
const lis = units.filter((u) => u.t === "LI");
ok(lis.length === 20, `every list item is placed on its own (${lis.length}/20)`);
ok(lis.some((u) => u.x < 200) && lis.some((u) => u.x > 400), "the items of a list run over both columns");
ok(units.filter((u) => u.q).length === 2, "the paragraphs of the quote are placed one by one, with the look of a quote");
let overlap2 = false;
for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) { const a = units[i], b = units[j]; if (Math.abs(a.x - b.x) < 5 && Math.abs(a.y - b.y) < 1000 && a.w < 300 && b.w < 300 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) overlap2 = true; }
ok(!overlap2, "no two items overlap");
// a list item keeps its number in the second column
ok(await run(() => { const ol = document.querySelector(".ProseMirror ol"); const items = [...ol.children].filter((e) => e.tagName === "LI"); return items.length === 14 && getComputedStyle(items[0]).display === "list-item"; }), "the items are still a numbered list");
const aL = await run(() => window.__lomaAudit());
ok(aL.problems.length === 0, "the layout is valid", aL.problems.slice(0, 2).join(" | "));
// typing inside a list item that sits in the second column
await run(() => { const e = window.__lomaEditor; let pos = 0; e.state.doc.descendants((n, p) => { if (n.isText && n.text.startsWith("Item 12.")) pos = p + 3; }); e.commands.focus(); e.commands.setTextSelection(pos); });
await page.keyboard.type("XYZ");
await settle();
ok((await run(() => window.__lomaEditor.getText())).includes("IteXYZm 12."), "typing in an item of the second column works");

await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Un. ${lorem}</p><p>Deux. ${lorem}</p><div data-column-break><span>Saut de colonne</span></div><p>Trois. ${lorem}</p><div data-column-break></div><p>Quatre. ${lorem}</p>`);
await settle();
const cb = await geo();
ok(cb.length === 4 && cb[0].x === 96 && cb[1].x === 96, "before the column break: first column");
ok(cb[2].x > 300 && cb[2].y === 96, `after the column break: top of the second column (x=${cb[2].x}, y=${cb[2].y})`);
ok((await pages()) === 2 && cb[3].x === 96, `a second break on the last column goes to the next page (${await pages()} pages)`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid");
await page.keyboard.press("Control+Shift+Enter");
await settle();
ok((await run(() => { let n = 0; window.__lomaEditor.state.doc.descendants((x) => { if (x.type.name === "columnBreak") n++; }); return n; })) >= 2, "Ctrl+Shift+Enter is wired (no crash)");

// --- text, tables and pictures that run on over columns and pages ---
const rowsHtml = Array.from({ length: 40 }, (_, r) => `<tr><td><p>a${r}</p></td><td><p>b${r}</p></td></tr>`).join("");
const tiny = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="3000"><rect width="1200" height="3000" fill="#2563eb"/></svg>');
await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Intro. ${lorem}</p><p>LONG ${lorem.repeat(60)}</p><table><tbody>${rowsHtml}</tbody></table><p>Après. ${lorem}</p><ul><li><p>GROSSE ${lorem.repeat(30)}</p></li></ul><p>Fin. ${lorem}</p>`);
await menu("Colonnes", "Une");
await settle();
await menu("Colonnes", "Deux");
await page.waitForTimeout(1200);
const nPages = await pages();
ok(nPages >= 4 && nPages <= 7, `the long content fills several pages of two columns (${nPages})`);
const shifts = await run(() => document.querySelectorAll(".ProseMirror .col-shift").length);
ok(shifts > 5, `lines and rows are moved to their own column or page (${shifts} moved parts)`);
const cross = await run(() => {
  const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; const s0 = st.getBoundingClientRect();
  const sheets = [...document.querySelectorAll(".page-sheet")].map((e) => ({ top: (e.getBoundingClientRect().top - s0.top) / k, h: e.offsetHeight }));
  const pg = (y) => sheets.findIndex((s) => y >= s.top && y < s.top + s.h);
  const pagesOf = new Set(); const cols = new Set();
  for (const sp of document.querySelectorAll(".ProseMirror .col-shift")) { for (const r of sp.getClientRects()) { const y = (r.top - s0.top) / k; pagesOf.add(pg(y)); cols.add(Math.round((r.left - s0.left) / k / 100)); } }
  return { pages: [...pagesOf].sort(), cols: [...cols].length };
});
ok(cross.pages.length >= 2, `moved text lands on several pages (${cross.pages})`);
const aBig = await run(() => window.__lomaAudit());
ok(aBig.problems.length === 0, "every character stays inside its page and column", aBig.problems.slice(0, 3).join(" | "));
// a click on moved text puts the caret there; typing goes into the right paragraph
const hit = await run(() => {
  const e = window.__lomaEditor; const sp = [...document.querySelectorAll(".ProseMirror p .col-shift")][3]; if (!sp) return null;
  const tn = (function f(n) { for (const c of n.childNodes) { if (c.nodeType === 3 && c.length > 6) return c; const r = f(c); if (r) return r; } return null; })(sp);
  sp.scrollIntoView({ block: "start" });
  const at = Math.floor(tn.length / 2);
  const range = document.createRange(); range.setStart(tn, at); range.setEnd(tn, at + 1);
  const r = range.getClientRects()[0];
  const want = e.view.posAtDOM(tn, at);
  const got = e.view.posAtCoords({ left: r.left + 1, top: r.top + r.height / 2 });
  return { want, got: got?.pos, y: r.top };
});
ok(hit && Math.abs(hit.want - hit.got) <= 1, `a click on moved text finds its position (${hit && hit.want}/${hit && hit.got} at y=${hit && Math.round(hit.y)})`);
await run(() => { const e = window.__lomaEditor; const sp = [...document.querySelectorAll(".ProseMirror p .col-shift")][3]; const tn = (function f(n) { for (const c of n.childNodes) { if (c.nodeType === 3 && c.length > 6) return c; const r = f(c); if (r) return r; } return null; })(sp); e.commands.focus(); e.commands.setTextSelection(e.view.posAtDOM(tn, 2)); });
await page.keyboard.type("QQQ");
await page.waitForTimeout(900);
ok((await run(() => window.__lomaEditor.getText())).includes("QQQ"), "typing in moved text works");
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is still valid");
// balanced at the end of the document
const lastPageCols = await run(() => { const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; const s0 = st.getBoundingClientRect(); const sheets = [...document.querySelectorAll(".page-sheet")]; const last = sheets[sheets.length - 1].getBoundingClientRect(); const ends = [0, 0]; for (const el of document.querySelectorAll(".ProseMirror [data-col], .ProseMirror .col-shift")) for (const r of el.getClientRects()) { if (r.top < last.top) continue; const c = (r.left - s0.left) / k < 400 ? 0 : 1; ends[c] = Math.max(ends[c], (r.bottom - last.top) / k); } return ends; });
ok(lastPageCols[0] > 0 && lastPageCols[1] > 0 && Math.abs(lastPageCols[0] - lastPageCols[1]) < 300, `the last page is balanced (${lastPageCols.map(Math.round)})`);

// the picture (1200 x 3000 px) is brought down to the column
await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Avant.</p><p><img src="${tiny}"></p><p>Après.</p>`);
await settle();
const imgBox = await run(() => { const b = document.querySelector(".ProseMirror .img-box"); if (!b) return null; const r = b.getBoundingClientRect(); const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; return { w: r.width / k, h: r.height / k }; });
ok(imgBox && imgBox.w <= 290 && imgBox.h <= 1000, `a picture taller than a column is brought down to it (${imgBox && Math.round(imgBox.w)}x${imgBox && Math.round(imgBox.h)})`);
// --- a row taller than a column, a list item holding a table, framed paragraphs ---
await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Intro. ${lorem}</p><table><tbody><tr><td><p>GEANTE ${lorem.repeat(45)}</p></td><td><p>court</p></td></tr></tbody></table><ul><li><p>Puce. ${lorem}</p><table><tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table><p>Après. ${lorem.repeat(25)}</p></li></ul><p data-shading="#fecaca">ENCADRE ${lorem.repeat(30)}</p><p>Fin. ${lorem}</p>`);
await menu("Colonnes", "Une");
await settle();
await menu("Colonnes", "Deux");
await page.waitForTimeout(1500);
ok((await pages()) >= 5, `the giant row and the long items spread over pages (${await pages()})`);
ok((await run(() => document.querySelectorAll(".ProseMirror .col-rowcut").length)) >= 1, "the giant row is shared line by line");
const aRow = await run(() => window.__lomaAudit());
ok(aRow.problems.length === 0, "every character stays inside its page and column", aRow.problems.slice(0, 3).join(" | "));
ok((await run(() => document.querySelectorAll(".ProseMirror p > .col-frame").length)) >= 2, "the shaded paragraph keeps its background on every run");
const frameOk = await run(() => [...document.querySelectorAll(".ProseMirror p > .col-frame")].every((f) => { const r = f.getBoundingClientRect(); return r.width > 100 && r.height > 20 && getComputedStyle(f).backgroundColor !== "rgba(0, 0, 0, 0)"; }));
ok(frameOk, "and the frames have the paragraph's colour and size");
const rowFrames = await run(() => [...document.querySelectorAll(".ProseMirror .col-rowframe")].map((b) => b.children.length));
ok(rowFrames.length >= 2 && rowFrames.every((n) => n === 2), `the giant row redraws its two cells on every run (${rowFrames.length} runs)`);

// --- repeated table header, shaded paragraph inside a list item that is cut ---
const bodyRows = Array.from({ length: 60 }, (_, r) => `<tr><td><p>a${r}</p></td><td><p>b${r}</p></td></tr>`).join("");
await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Intro. ${lorem}</p><table><tbody><tr><th><p>ENTETE1</p></th><th><p>ENTETE2</p></th></tr>${bodyRows}</tbody></table><ul><li><p data-shading="#fecaca">PUCE ${lorem.repeat(40)}</p></li></ul><p>Fin. ${lorem}</p>`);
await menu("Colonnes", "Une");
await settle();
await menu("Colonnes", "Deux");
await page.waitForTimeout(1500);
const heads = await run(() => { const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; const s0 = st.getBoundingClientRect(); return [...document.querySelectorAll(".ProseMirror .col-header")].map((t) => { const r = t.getBoundingClientRect(); return { y: Math.round((r.top - s0.top) / k), h: Math.round(r.height / k), txt: t.textContent }; }); });
ok(heads.length >= 2 && heads.every((h) => h.txt.includes("ENTETE1") && h.h > 20), `the header is repeated at the top of each column the table goes on in (${heads.length} copies)`);
const firstRows = await run(() => { const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; const s0 = st.getBoundingClientRect(); return [...document.querySelectorAll(".ProseMirror .col-header")].map((t) => { const hr = t.getBoundingClientRect(); const td = t.closest("td").getBoundingClientRect(); return Math.round(td.top - hr.bottom); }); });
ok(firstRows.every((d) => Math.abs(d) <= 2), `each copy sits right above its row (${firstRows})`);
const uf = await run(() => [...document.querySelectorAll(".ProseMirror li > .col-frame")].length);
ok(uf >= 2, `the shaded paragraph of a cut list item is framed on every run (${uf} frames)`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid", (await run(() => window.__lomaAudit())).problems.slice(0, 2).join("|"));

// --- a cell spanning rows moves with the rows it covers ---
const spanRows = Array.from({ length: 24 }, (_, r) => `<tr><td><p>a${r}</p></td><td><p>b${r}</p></td></tr>`).join("");
await run((h) => window.__lomaEditor.commands.setContent(h), `<table><tbody>${spanRows}<tr><td rowspan="3"><p>SPANCELL</p></td><td><p>s1</p></td></tr><tr><td><p>s2</p></td></tr><tr><td><p>s3</p></td></tr>${spanRows.replace(/a(\d+)/g, "z$1")}</tbody></table>`);
await menu("Colonnes", "Une");
await settle();
await menu("Colonnes", "Deux");
await page.waitForTimeout(1500);
const spanOk = await run(() => {
  const at = (txt) => { const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.trim() === txt) { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top }; } return null; };
  const s = at("SPANCELL"), a = at("s1"), b = at("s3");
  return s && a && b ? { dxA: Math.abs(a.x - s.x), dyA: a.y - s.y, dyB: b.y - s.y } : null;
});
ok(spanOk && spanOk.dxA > 20 && spanOk.dxA < 300 && spanOk.dyB >= 0 && spanOk.dyB < 150, `the three rows covered by a spanning cell stay beside it (${JSON.stringify(spanOk)})`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid", (await run(() => window.__lomaAudit())).problems.slice(0, 2).join("|"));

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll column checks passed");
process.exit(failed ? 1 : 0);
