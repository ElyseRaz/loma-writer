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

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll column checks passed");
process.exit(failed ? 1 : 0);
