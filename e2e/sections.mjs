// End-to-end checks of sections: a section break starts a new page with its own paper, orientation and margins.
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/sections.mjs
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
const settle = () => page.waitForTimeout(600);
const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
const para = (t, n) => `<p>${t}. ${lorem.repeat(n)}</p>`;
const sheets = () => run(() => [...document.querySelectorAll(".page-sheet")].map((s) => [s.offsetWidth, s.offsetHeight, +s.dataset.section]));
const menu = async (label, item) => { await page.getByRole("button", { name: label, exact: true }).click(); await page.getByRole("menuitem", { name: item }).click(); };
const sectionsIn = () => run(() => { let n = 0; window.__lomaEditor.state.doc.descendants((x) => { if (x.type.name === "sectionBreak") n++; }); return n; });

await run((h) => window.__lomaEditor.commands.setContent(h), para("Début", 4) + para("Fin de la première section", 2) + para("Deuxième section", 6) + para("Encore", 6));
await settle();
ok((await sheets()).length === 1, "one section, one page to start with");

// --- Insert a section break after the second paragraph ---
await run(() => { const e = window.__lomaEditor; const d = e.state.doc; e.commands.setTextSelection(d.child(0).nodeSize + 4); });
await menu("Sauts", "Saut de section (page suivante)");
await settle();
ok((await sectionsIn()) === 1, "the break is in the document");
ok((await page.locator(".section-break").count()) === 1 && (await page.locator(".section-break").textContent()).includes("Saut de section"), "and shown in the text");
let sh = await sheets();
ok(sh.length === 2 && sh[0][2] === 1 && sh[1][2] === 2, `the new section starts on a new page (${sh.length} pages, sections ${sh.map((s) => s[2])})`);
ok((await page.getByText("Mise en page · section 2/2").count()) === 1, "the ribbon shows which section the caret is in");

// --- Section 2 in landscape, section 1 untouched ---
await run(() => { const e = window.__lomaEditor; const d = e.state.doc; let last = 0; d.forEach((n, off) => { last = off; }); e.commands.setTextSelection(last + 3); });
await menu("Orientation", /Paysage/);
await settle();
sh = await sheets();
ok(sh[0][0] === 794 && sh[0][1] === 1123, `section 1 is still portrait (${sh[0]})`);
ok(sh[1][0] === 1123 && sh[1][1] === 794 && sh.slice(1).every((s) => s[2] === 2), `section 2 is landscape (${sh.slice(1).map((s) => s.slice(0, 2).join("×"))})`);
const a = await run(() => window.__lomaAudit());
ok(a.problems.length === 0, "every character is inside the text area of its own page", a.problems.slice(0, 3).join(" | "));
const widths = await run(() => { const ps = [...document.querySelectorAll(".ProseMirror > p")]; return ps.map((p) => Math.round(p.getBoundingClientRect().width / (document.querySelector(".page-stack").getBoundingClientRect().width / document.querySelector(".page-stack").offsetWidth))); });
ok(widths[0] === 602 && widths[widths.length - 1] === 931, `the text is 602 px wide in section 1 and 931 px in section 2 (${widths})`);

// --- Margins of section 2 only ---
await menu("Marges", /^Étroites/);
await settle();
const narrow = await run(() => window.__lomaAudit());
ok(narrow.problems.length === 0, "margins of section 2 only", narrow.problems.slice(0, 2).join("|"));
const w2 = await run(() => { const ps = [...document.querySelectorAll(".ProseMirror > p")]; const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; return [ps[0], ps[ps.length - 1]].map((p) => Math.round(p.getBoundingClientRect().width / k)); });
ok(w2[0] === 602 && w2[1] === 1123 - 96, `Étroites (1,27 cm) only changed the second section (${w2})`);

// --- The dialog can apply to the whole document ---
await page.getByRole("button", { name: "Marges", exact: true }).click();
await page.getByRole("menuitem", { name: /Marges personnalisées/ }).click();
const dlg = page.getByRole("dialog");
await dlg.getByLabel("Appliquer à").selectOption("all");
await dlg.getByLabel("Haut (cm)").fill("4");
await dlg.getByRole("button", { name: "Appliquer" }).click();
await settle();
const tops = await run(() => [...document.querySelectorAll(".page-sheet")].map((s) => +s.dataset.insetTop));
ok(tops.every((t) => Math.abs(t - 151.2) < 1), `« Tout le document » changes every section (${tops.map(Math.round)})`);

// --- Headers: every section inherits the document's header ---
await run(() => window.__lomaEditor.commands.setContent("<p>a</p>"));

// --- Undo / remove ---
await run((h) => window.__lomaEditor.commands.setContent(h), para("A", 2) + para("B", 2));
await settle();
await run(() => window.__lomaEditor.commands.setTextSelection(3));
await menu("Sauts", "Saut de section (page suivante)");
await settle();
ok((await sheets()).length === 2, "a break gives two pages");
await run(() => { const e = window.__lomaEditor; let pos = -1; e.state.doc.forEach((n, off) => { if (n.type.name === "sectionBreak") pos = off; }); e.commands.setNodeSelection(pos); });
await page.keyboard.press("Backspace");
await settle();
ok((await sectionsIn()) === 0 && (await sheets()).length === 1, "deleting the break merges the sections again");
await page.keyboard.press("Control+z");
await settle();
ok((await sectionsIn()) === 1 && (await sheets()).length === 2, "and undo brings it back");

// --- Headers per section ---
await run((h) => window.__lomaEditor.commands.setContent(h), para("A", 3) + para("B", 3));
await settle();
await run(() => window.__lomaEditor.commands.setTextSelection(3));
await menu("Sauts", "Saut de section (page suivante)");
await settle();
const hfOf = () => run(() => [...document.querySelectorAll(".page-sheet")].map((s) => [...s.querySelectorAll(".hf-body")].map((h) => h.textContent).join("|")));
ok((await hfOf()).every((t) => t === ""), "no header at first");
await run(() => window.__lomaEditor.commands.setSectionHeaderFooter(1, { header: { default: { blocks: [{ type: "paragraph", content: [{ type: "text", text: "Entête section 2" }] }] } }, footer: {}, titlePage: false, evenOdd: false }));
await settle();
const hs = await hfOf();
ok(hs[0] === "" && hs[hs.length - 1].includes("Entête section 2"), `a section can have headers of its own (${JSON.stringify(hs)})`);
await run(() => window.__lomaEditor.commands.setSectionHeaderFooter(1, null));
await settle();
ok((await hfOf()).every((t) => t === ""), "and be linked to the previous section again");

// --- A shape dropped on a landscape section stays on its sheet ---
await run((h) => window.__lomaEditor.commands.setContent(h), para("A", 2) + para("B", 2));
await settle();
await run(() => window.__lomaEditor.commands.setTextSelection(3));
await menu("Sauts", "Saut de section (page suivante)");
await settle();
await run(() => { const e = window.__lomaEditor; let last = 0; e.state.doc.forEach((n, off) => { last = off; }); e.commands.setTextSelection(last + 3); });
await menu("Orientation", /Paysage/);
await run(() => { const e = window.__lomaEditor; e.commands.insertShape("rect"); });
await settle();
await page.locator(".shape-box").first().scrollIntoViewIfNeeded();
await settle();
const sb = await page.locator(".shape-box").first().boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(sb.x + sb.width / 2 + 200, sb.y + sb.height / 2 + 120, { steps: 6 });
await page.mouse.up();
await settle();
const shapeAttrs = await run(() => { let a; window.__lomaEditor.state.doc.descendants((n) => { if (n.type.name === "shape") a = n.attrs; }); return a; });
const onSheet = await run(() => { const st = document.querySelector(".page-stack"); const k = st.getBoundingClientRect().width / st.offsetWidth; const b = document.querySelector(".shape-box").getBoundingClientRect(); const sheetEls = [...document.querySelectorAll(".page-sheet")]; const hit = sheetEls.findIndex((s) => { const r = s.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }); return hit; });
ok(shapeAttrs.wrap === "front" && onSheet === 1, `a shape moved in the landscape section stays inside its (landscape) sheet (sheet ${onSheet + 1}, y=${shapeAttrs.y})`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is still valid");

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll section checks passed");
process.exit(failed ? 1 : 0);
