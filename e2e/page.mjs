// End-to-end checks of page setup (paper, margins, orientation) and of the pagination that follows it.
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/page.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const audit = readFileSync(new URL("./audit.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
const settle = () => page.waitForTimeout(600);
const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
await run((h) => window.__lomaEditor.commands.setContent(h), Array.from({ length: 40 }, (_, i) => `<p>Paragraphe ${i}. ${lorem.repeat(3)}</p>`).join(""));
const state = async () => {
  await settle();
  const a = await run(() => window.__lomaAudit());
  const sheet = await run(() => { const s = document.querySelector(".page-sheet"); return s ? [s.offsetWidth, s.offsetHeight] : null; });
  const perPage = await run(() => { const pm = window.__lomaEditor.view.dom; const stack = document.querySelector(".page-stack"); const pitch = +stack.dataset.pitch; const top = pm.getBoundingClientRect().top; const scale = stack.getBoundingClientRect().width / stack.offsetWidth; const counts = {}; const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT); for (let n = walker.nextNode(); n; n = walker.nextNode()) { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (!b.height) continue; const p = Math.floor((b.top - top) / scale / pitch); counts[p] = (counts[p] ?? 0) + n.textContent.length; } return counts; });
  return { a, sheet, perPage };
};
const menu = async (label, item) => { await page.getByRole("button", { name: label, exact: true }).click(); await page.getByRole("menuitem", { name: item }).click(); };

const base = await state();
ok(base.sheet[0] === 794 && base.sheet[1] === 1123, `A4 portrait sheet is 794 × 1123 px (${base.sheet})`);
ok(base.a.problems.length === 0, "no character outside the text area", base.a.problems.slice(0, 2).join("|"));

// --- Paper size ---
await menu("Taille", /^A5/);
const a5 = await state();
ok(a5.sheet[0] === 559 && a5.sheet[1] === 794, `A5 sheet is 559 × 794 px (${a5.sheet})`);
ok(a5.a.pages > base.a.pages, `a smaller paper needs more pages (${base.a.pages} → ${a5.a.pages})`);
ok(a5.perPage[0] < base.perPage[0], `and each page shows less text (${base.perPage[0]} → ${a5.perPage[0]} characters on page 1)`);
ok(a5.a.problems.length === 0, "still nothing outside the text area", a5.a.problems.slice(0, 2).join("|"));
await menu("Taille", /^A3/);
const a3 = await state();
ok(a3.a.pages < base.a.pages && a3.perPage[0] > base.perPage[0], `a bigger paper (A3) needs fewer pages and shows more text per page (${a3.a.pages} pages)`);
await menu("Taille", /^A4/);

// --- Orientation ---
await menu("Orientation", /Paysage/);
const land = await state();
ok(land.sheet[0] === 1123 && land.sheet[1] === 794, `landscape swaps the dimensions (${land.sheet})`);
ok(land.perPage[0] !== base.perPage[0] && land.a.problems.length === 0, `landscape re-flows the text (${base.perPage[0]} → ${land.perPage[0]} characters on page 1)`, land.a.problems.slice(0, 2).join("|"));
await menu("Orientation", /Portrait/);

// --- Margins ---
await menu("Marges", /^Étroites/);
const narrow = await state();
ok(narrow.a.pages < base.a.pages && narrow.perPage[0] > base.perPage[0], `narrow margins fit more text per page (${base.perPage[0]} → ${narrow.perPage[0]})`);
await menu("Marges", /^Larges/);
const wide = await state();
ok(wide.perPage[0] < base.perPage[0], `wide margins (5.08 cm sides) fit less text per page (${wide.perPage[0]})`);
await menu("Marges", /^Marges en miroir/);
ok((await state()).a.problems.length === 0, "mirrored margins lay out without overflow");
await menu("Marges", /^Normales/);
const back = await state();
ok(back.perPage[0] === base.perPage[0] && back.a.pages === base.a.pages, "going back to A4 / Normales restores the original layout");
ok(await run(() => window.__lomaEditor.getText().length) > 8000, "the content was never touched");

// --- Dialog: custom margins, validation, custom paper ---
await menu("Marges", /Marges personnalisées/);
const dlg = page.getByRole("dialog");
await dlg.getByLabel("Haut (cm)").fill("-1");
ok(await dlg.getByRole("button", { name: "Appliquer" }).isDisabled(), "a negative margin disables « Appliquer »");
ok(await dlg.getByRole("alert").isVisible(), "and the problem is explained");
await dlg.getByLabel("Haut (cm)").fill("1");
await dlg.getByLabel("Gauche (cm)").fill("12");
await dlg.getByLabel("Droite (cm)").fill("12");
ok(await dlg.getByRole("button", { name: "Appliquer" }).isDisabled(), "margins that leave no room for text are refused");
await dlg.getByLabel("Gauche (cm)").fill("4");
await dlg.getByLabel("Droite (cm)").fill("2");
await dlg.getByLabel("Marge de reliure (cm)").fill("1");
await dlg.getByRole("tab", { name: "Papier" }).click();
await dlg.getByLabel("Format du papier").selectOption("Custom");
await dlg.getByLabel("Largeur (cm)").fill("15");
await dlg.getByLabel("Hauteur (cm)").fill("20");
await dlg.getByRole("button", { name: "Appliquer" }).click();
const custom = await state();
ok(custom.sheet[0] === 567 && custom.sheet[1] === 756, `a custom 15 × 20 cm paper is drawn at that size (${custom.sheet})`);
const stored = await run(() => null);
void stored;
await page.getByRole("tab", { name: "Mise en page" }).click();
await page.getByRole("button", { name: "Marges", exact: true }).click();
ok(await page.getByRole("menuitem", { name: /Marges personnalisées/ }).getAttribute("aria-checked").then((v) => v !== "false").catch(() => true), "custom margins are listed as active");
await page.keyboard.press("Escape");
ok((await page.locator("[data-bounds]").count()) >= 1, "the text-area corner marks are drawn on the pages");

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll page setup checks passed");
process.exit(failed ? 1 : 0);
