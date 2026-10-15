// End-to-end checks of the "Mise en page" tab: indents, spacing, page-flow options (sauts) and watermark.
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/layout.mjs
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
const settle = () => page.waitForTimeout(500);
const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
const css = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
const typeIn = async (label, value) => { const f = page.getByLabel(label, { exact: true }); await f.fill(value); await f.press("Enter"); await settle(); };

// --- Indents and spacing ---
await run(() => { const e = window.__lomaEditor; e.commands.setContent("<p>Premier</p><p>Second</p>"); e.commands.setTextSelection(3); });
await typeIn("Gauche (cm)", "2");
ok(Math.abs(parseFloat(await css(".ProseMirror p", "marginLeft")) - 96 - 75.6) < 1, `left indent 2 cm → ${await css(".ProseMirror p", "marginLeft")}`);
await typeIn("Droite (cm)", "1,5");
ok(Math.abs(parseFloat(await css(".ProseMirror p", "marginRight")) - 96 - 56.7) < 1, "right indent 1,5 cm (comma accepted)");
await typeIn("Avant (pt)", "18");
ok(Math.abs(parseFloat(await css(".ProseMirror p", "marginTop")) - 24) < 1, "space before 18 pt");
await typeIn("Après (pt)", "30");
ok(Math.abs(parseFloat(await css(".ProseMirror p", "marginBottom")) - 40) < 1, "space after 30 pt");
ok((await css(".ProseMirror p:nth-of-type(2)", "marginLeft")) === "96px", "the other paragraph is untouched (just the margin of the page)");
await page.getByLabel("Gauche (cm)", { exact: true }).fill("-3");
await page.getByLabel("Gauche (cm)", { exact: true }).press("Enter");
await settle();
ok(Math.abs(parseFloat(await css(".ProseMirror p", "marginLeft")) - 96 - 75.6) < 1, "an invalid (negative) indent is refused");

// --- Paragraph dialog: hanging indent and page flow ---
await page.getByRole("button", { name: /Retraits, espacement/ }).click();
const dlg = page.getByRole("dialog");
await dlg.getByLabel("Retrait spécial").selectOption("hanging");
await dlg.getByLabel("De (cm)").fill("1");
await dlg.getByRole("button", { name: "Appliquer" }).click();
await settle();
ok(Math.abs(parseFloat(await css(".ProseMirror p", "textIndent")) + 37.8) < 1, `hanging indent of 1 cm (text-indent ${await css(".ProseMirror p", "textIndent")})`);
await page.getByRole("button", { name: /Retraits, espacement/ }).click();
await dlg.getByLabel("Avant (pt)").fill("-5");
ok(await dlg.getByRole("button", { name: "Appliquer" }).isDisabled(), "the dialog refuses invalid values");
await dlg.getByRole("button", { name: "Annuler" }).click();

// --- Sauts ---
await run((h) => window.__lomaEditor.commands.setContent(h), Array.from({ length: 12 }, (_, i) => `<p>Paragraphe ${i}. ${lorem.repeat(2)}</p>`).join(""));
await settle();
const pagesOf = async () => (await run(() => window.__lomaAudit())).pages;
const p0 = await pagesOf();
await run(() => window.__lomaEditor.commands.setTextSelection(window.__lomaEditor.state.doc.child(0).nodeSize + 3)); // in the second paragraph
await page.getByRole("button", { name: "Sauts", exact: true }).click();
await page.getByRole("menuitem", { name: "Saut de page avant ce paragraphe" }).click();
await settle();
const a1 = await run(() => window.__lomaAudit());
ok(a1.pages === p0 + 1 && a1.problems.length === 0, `« saut de page avant » pushes the paragraph to a new page (${p0} → ${a1.pages} pages)`, a1.problems.slice(0, 2).join("|"));
const top2 = await run(() => { const p = document.querySelectorAll(".ProseMirror p")[1]; const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; return Math.round((p.getBoundingClientRect().top - st.getBoundingClientRect().top) / k); });
ok(top2 >= 1147, `and that paragraph starts on page 2 (y=${top2})`);
await page.getByRole("button", { name: "Sauts", exact: true }).click();
ok((await page.getByRole("menuitem", { name: "Saut de page avant ce paragraphe" }).getAttribute("aria-checked").catch(() => null)) !== "false", "the option is shown as active");
await page.keyboard.press("Escape");
await run(() => window.__lomaEditor.chain().focus().setParagraphLayout({ pageBreakBefore: false }).run());
await settle();
ok((await pagesOf()) === p0, "and removing it restores the layout");

// keep lines together: a paragraph straddling a page end is moved whole
await run((h) => window.__lomaEditor.commands.setContent(h), Array.from({ length: 6 }, (_, i) => `<p>Bloc ${i}. ${lorem.repeat(12)}</p>`).join(""));
await settle();
const splitsBefore = await run(() => document.querySelectorAll(".pg-inline").length);
ok(splitsBefore >= 1, `a long paragraph is split across pages by default (${splitsBefore} split)`);
await run(() => { const e = window.__lomaEditor; e.commands.selectAll(); e.commands.setParagraphLayout({ keepLines: true }); });
await settle();
const splitsAfter = await run(() => document.querySelectorAll(".pg-inline").length);
ok(splitsAfter === 0, `« garder les lignes ensemble » keeps paragraphs whole (${splitsAfter} splits left)`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and every character is still inside a page");

// --- Watermark ---
await page.getByRole("button", { name: "Filigrane", exact: true }).click();
await page.getByRole("menuitem", { name: "BROUILLON" }).click();
await settle();
const pagesNow = await pagesOf();
ok((await page.locator("[data-watermark]").count()) === pagesNow && (await page.locator("[data-watermark]").first().textContent()) === "BROUILLON", `the watermark is drawn on every page (${pagesNow})`);
ok((await page.locator("[data-watermark] span").first().evaluate((el) => getComputedStyle(el).transform)) !== "none", "diagonally");
await page.getByRole("button", { name: "Filigrane", exact: true }).click();
await page.getByRole("menuitem", { name: "Filigrane personnalisé…" }).click();
const wd = page.getByRole("dialog");
await wd.getByLabel("Texte du filigrane").fill("");
ok(await wd.getByRole("button", { name: "Appliquer" }).isDisabled(), "an empty watermark text is refused");
await wd.getByLabel("Texte du filigrane").fill("MON TEXTE");
await wd.getByRole("radio", { name: "Horizontale" }).click();
await wd.getByRole("button", { name: "Appliquer" }).click();
await settle();
ok((await page.locator("[data-watermark]").first().textContent()) === "MON TEXTE" && (await page.locator("[data-watermark] span").first().evaluate((el) => getComputedStyle(el).transform)) === "none", "a custom horizontal watermark");
await page.getByRole("button", { name: "Filigrane", exact: true }).click();
await page.getByRole("menuitem", { name: "Supprimer le filigrane" }).click();
await settle();
ok((await page.locator("[data-watermark]").count()) === 0, "the watermark can be removed");

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll layout checks passed");
process.exit(failed ? 1 : 0);
