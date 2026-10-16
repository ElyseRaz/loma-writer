// End-to-end checks of the Références tab: table of contents (more to come: captions, notes, citations).
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/references.mjs
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

let failed = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}${cond ? "" : "  " + extra}`); if (!cond) failed++; };
const run = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 900) => page.waitForTimeout(ms);
const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
const chapters = (n) => Array.from({ length: n }, (_, i) => `<h1>Chapitre ${i + 1}</h1><h2>Section ${i + 1}.1</h2><p>${lorem.repeat(14)}</p><h3>Détail ${i + 1}.1.1</h3><p>${lorem.repeat(10)}</p>`).join("");
const entries = () => run(() => [...document.querySelectorAll(".toc-entry")].map((e) => ({ text: e.textContent, page: e.dataset.page, level: +e.dataset.level, target: e.dataset.target })));
const pages = () => run(() => document.querySelectorAll(".page-sheet").length);

await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Introduction. ${lorem}</p>${chapters(6)}`);
await settle(1200);
await run(() => window.__lomaEditor.commands.setTextSelection(1));
await page.getByRole("tab", { name: "Références" }).click();

// --- insertion ---
await page.getByRole("button", { name: "Table des matières", exact: true }).click();
await page.getByRole("menuitem", { name: "Table automatique : 3 niveaux" }).click();
await settle(2500);
let e = await entries();
ok(e.length === 18, `a table of 18 lines (6 x 3 headings) is inserted (${e.length})`);
ok(e[0].text === "Chapitre 1" && e[0].level === 1 && e[1].level === 2 && e[2].level === 3, "with the text and the level of each heading");
const pageNums = e.map((x) => +x.page);
ok(pageNums.every((n, i) => i === 0 || n >= pageNums[i - 1]) && pageNums[0] >= 1, `page numbers never go back (${pageNums.join(",")})`);
const lastHeadingPage = await run(() => { const h = [...document.querySelectorAll(".ProseMirror h1")].pop(); const sheets = [...document.querySelectorAll(".page-sheet")]; const y = h.getBoundingClientRect().top; let idx = 0; sheets.forEach((s, i) => { if (s.getBoundingClientRect().top <= y + 1) idx = i; }); return idx + 1; });
ok(+e[e.length - 1].page <= (await pages()) && Math.abs(pageNums[15] - lastHeadingPage) <= 1, `the last chapter is on the page the table says (${pageNums[15]} / ${lastHeadingPage})`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid", (await run(() => window.__lomaAudit())).problems.slice(0, 2).join("|"));

// --- update after a change ---
await run(() => { const ed = window.__lomaEditor; let pos = 0; ed.state.doc.descendants((n, p) => { if (n.type.name === "heading" && n.textContent === "Chapitre 2") pos = p; }); ed.commands.setTextSelection(pos + 1 + "Chapitre 2".length); ed.commands.insertContent(" modifié"); });
await settle(1200);
await page.getByRole("button", { name: /Met à jour les tables/ }).click();
await settle(1500);
e = await entries();
ok(e.some((x) => x.text === "Chapitre 2 modifié"), "« Mettre à jour » takes a renamed heading into account");
// a new heading adds a line
await run(() => { const ed = window.__lomaEditor; ed.commands.focus("end"); ed.commands.insertContent("<h1>Annexe</h1><p>fin</p>"); });
await settle(1200);
await page.getByRole("button", { name: /Met à jour les tables/ }).click();
await settle(1500);
e = await entries();
ok(e.length === 19 && e[18].text === "Annexe", `a new heading adds a line (${e.length})`);

// --- levels ---
await run(() => { const ed = window.__lomaEditor; ed.commands.setTextSelection(1); });
await page.getByRole("button", { name: "Table des matières", exact: true }).click();
await page.getByRole("menuitem", { name: "Supprimer la table des matières" }).click();
await settle();
ok((await entries()).length === 0, "the table is removed");
await page.getByRole("button", { name: "Table des matières", exact: true }).click();
await page.getByRole("menuitem", { name: "Table automatique : 1 niveau" }).click();
await settle(2500);
e = await entries();
ok(e.length === 7 && e.every((x) => x.level === 1), `a one-level table only lists the titles (${e.length})`);

// --- Ctrl+click goes to the heading ---
await run(() => window.__lomaEditor.commands.setTextSelection(1));
const before = await run(() => window.__lomaEditor.state.selection.from);
const box = await page.locator(".toc-entry").nth(3).boundingBox();
await page.keyboard.down("Control");
await page.mouse.click(box.x + 20, box.y + box.height / 2);
await page.keyboard.up("Control");
await settle(400);
const where = await run(() => { const s = window.__lomaEditor.state; const $p = s.doc.resolve(s.selection.from); return { type: $p.parent.type.name, text: $p.parent.textContent }; });
ok(where.type === "heading" && where.text === "Chapitre 4", `Ctrl+click on a line goes to its heading (${where.text})`);

// --- captions ---
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
await run((h) => window.__lomaEditor.commands.setContent(h), `<p>Intro</p><p><img src="${png}" width="120" height="80"></p><p>Entre deux.</p><table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table><p><img src="${png}" width="60" height="40"></p>`);
await settle(1000);
const captionVia = async (selectPos, text) => {
  await run((p) => window.__lomaEditor.commands.setTextSelection(p), selectPos);
  await page.getByRole("button", { name: /Numérote une figure/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Texte de la légende (facultatif)").fill(text);
  await dlg.getByRole("button", { name: "Insérer" }).click();
  await settle(700);
};
const imgParagraph = (i) => run((i) => { let n = 0, at = 0; window.__lomaEditor.state.doc.forEach((node, off) => { if (node.type.name === "paragraph" && node.content.childCount && node.firstChild.type.name === "image") { if (n++ === i) at = off + 2; } }); return at; }, i);
const caps = () => run(() => [...document.querySelectorAll(".ProseMirror p[data-caption]")].map((p) => p.textContent));
await captionVia(await imgParagraph(1), "Dernière image");
await captionVia(await imgParagraph(0), "Première image");
let c = await caps();
ok(c.length === 2 && c[0] === "Figure 1 : Première image" && c[1] === "Figure 2 : Dernière image", `captions are numbered in the order of the document (${JSON.stringify(c)})`);
// a table: caption above, own label
await run(() => { const ed = window.__lomaEditor; let at = 0; ed.state.doc.descendants((n, p) => { if (n.type.name === "paragraph" && n.textContent === "a") at = p + 1; }); ed.commands.setTextSelection(at); });
await page.getByRole("button", { name: /Numérote une figure/ }).click();
await page.getByRole("dialog").getByRole("button", { name: "Insérer" }).click();
await settle(700);
const tableCap = await run(() => { const t = document.querySelector(".ProseMirror table"); const wrapper = t.closest(".tableWrapper") ?? t; const prev = wrapper.previousElementSibling; return prev?.textContent ?? ""; });
ok(tableCap === "Tableau 1", `a table caption goes above the table with its own numbering (${tableCap})`);
// list of figures
await run(() => window.__lomaEditor.commands.setTextSelection(1));
await page.getByRole("button", { name: "Table des illustrations", exact: true }).click();
await page.getByRole("menuitem", { name: "Figure", exact: true }).click();
await settle(2500);
const fig = (await entries());
ok(fig.length === 2 && fig[0].text === "Figure 1 : Première image", `a list of figures lists the captions of its label (${fig.map((x) => x.text).join(" / ")})`);
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid", (await run(() => window.__lomaAudit())).problems.slice(0, 3).join(" | "));

// --- notes ---
const loremP = (n) => `<p>${lorem.repeat(n)}</p>`;
await run((h) => window.__lomaEditor.commands.setContent(h), loremP(3) + loremP(3) + loremP(3));
await settle(1000);
const insertNote = async (pos, buttonName, text) => {
  await run((p) => window.__lomaEditor.commands.setTextSelection(p), pos);
  await page.getByRole("button", { name: buttonName }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Texte de la note").fill(text);
  await dlg.getByRole("button", { name: "Insérer" }).click();
  await settle(900);
};
await insertNote(40, /Insère une note en bas de la page/, "Première note de bas de page.");
await insertNote(400, /Insère une note en bas de la page/, "Seconde note.");
await insertNote(60, /Insère une note réunie à la fin/, "Note de fin.");
const nums = await run(() => [...document.querySelectorAll(".note-ref")].map((e) => `${e.dataset.note}:${e.textContent}`));
ok(JSON.stringify(nums) === JSON.stringify(["foot:1", "end:i", "foot:2"]), `references are numbered (footnotes 1, 2; endnote i): ${nums}`);
const bottom = await run(() => [...document.querySelectorAll(".page-sheet")].map((s) => [...s.querySelectorAll(".footnote-item")].map((n) => n.textContent.trim())));
ok(bottom[0].length === 2 && bottom[0][0].includes("Première note"), `the footnotes are at the bottom of their page (${JSON.stringify(bottom[0])})`);
const gap = await run(() => { const s = document.querySelector(".page-sheet"); const n = s.querySelector(".page-notes"); let maxB = 0; const sr = s.getBoundingClientRect(); const range = document.createRange(); const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { if (t.parentElement.closest(".endnotes")) continue; range.selectNodeContents(t); for (const rc of range.getClientRects()) if (rc.top >= sr.top && rc.bottom <= sr.bottom) maxB = Math.max(maxB, rc.bottom); } return n.getBoundingClientRect().top - maxB; });
ok(gap > 0, `the text stays above the footnotes (${Math.round(gap)}px)`);
const end = await run(() => [...document.querySelectorAll(".endnote-item")].map((e) => e.textContent));
ok(end.length === 1 && end[0] === "Note de fin.", `the endnotes are gathered at the end of the document (${JSON.stringify(end)})`);
// double-click on a reference edits its text
await page.locator(".note-ref.note-foot").first().dblclick();
const dlg2 = page.getByRole("dialog");
await dlg2.getByLabel("Texte de la note").fill("Note corrigée.");
await dlg2.getByRole("button", { name: "Appliquer" }).click();
await settle(900);
ok((await run(() => document.querySelector(".page-sheet .footnote-item")?.textContent ?? "")).includes("Note corrigée."), "a double-click on a number edits the note");
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid", (await run(() => window.__lomaAudit())).problems.slice(0, 2).join("|"));
// the notes follow when text is added above: the page they are on may change
await run((html) => { const ed = window.__lomaEditor; ed.commands.setTextSelection(1); ed.commands.insertContent(html); }, Array.from({ length: 12 }, () => "<p>" + lorem.repeat(2) + "</p>").join(""));
await settle(1500);
const pagesWithNotes = await run(() => [...document.querySelectorAll(".page-sheet")].map((s) => s.querySelectorAll(".footnote-item").length));
ok(pagesWithNotes.reduce((a, b) => a + b, 0) === 2 && (await run(() => window.__lomaAudit())).problems.length === 0, `each footnote is on exactly one page, and nothing is hidden (${pagesWithNotes})`);

// --- sources, citations, bibliography ---
await run((h) => window.__lomaEditor.commands.setContent(h), "<p>Une phrase qui cite une source.</p><p>Fin.</p>");
await settle(800);
await run(() => window.__lomaEditor.commands.setTextSelection(10));
await page.getByRole("button", { name: "Insérer une citation", exact: true }).click();
await page.getByRole("menuitem", { name: "Ajouter une nouvelle source…" }).click();
let sd = page.getByRole("dialog");
await sd.getByLabel("Auteurs (un par ligne : Nom, Prénom)").fill("Dupont, Jean\nMartin, Anne");
await sd.getByLabel("Titre", { exact: true }).fill("Les chats");
await sd.getByLabel("Année").fill("2020");
await sd.getByLabel("Éditeur").fill("Seuil");
await sd.getByRole("button", { name: "Enregistrer" }).click();
await settle(600);
const srcCount = await run(() => window.__lomaEditor.state.doc.attrs.sources.length);
ok(srcCount === 1, `a source is added from the dialog (${srcCount})`);
await page.getByRole("button", { name: "Insérer une citation", exact: true }).click();
await page.getByRole("menuitem", { name: /Dupont, 2020 — Les chats/ }).click();
await settle(600);
let cite = await run(() => document.querySelector(".citation")?.textContent);
ok(cite === "(Dupont & Martin, 2020)", `a citation is inserted in the style APA (${cite})`);
await page.getByRole("button", { name: /^Style :/ }).click();
await page.getByRole("menuitem", { name: /MLA/ }).click();
await settle(600);
cite = await run(() => document.querySelector(".citation")?.textContent);
ok(cite === "(Dupont et Martin)", `the citation follows a change of style (${cite})`);
await page.getByRole("button", { name: "Bibliographie", exact: true }).click();
await page.getByRole("menuitem", { name: "Bibliographie : sources citées" }).click();
await settle(900);
const bib = await run(() => [...document.querySelectorAll(".bib-entry")].map((e) => e.textContent));
ok(bib.length === 1 && bib[0].startsWith("Dupont, Jean et Anne Martin. Les chats."), `the bibliography lists the cited source (${JSON.stringify(bib)})`);
ok(await run(() => document.querySelector(".bib-entry em, .bib-entry i") !== null), "its title is in italics");
// double-click on a citation opens its source
await page.locator(".citation").dblclick();
sd = page.getByRole("dialog");
ok(await sd.getByLabel("Titre", { exact: true }).inputValue() === "Les chats", "a double-click on a citation opens its source");
await sd.getByRole("button", { name: "Annuler" }).click();
ok((await run(() => window.__lomaAudit())).problems.length === 0, "and the layout is valid", (await run(() => window.__lomaAudit())).problems.slice(0, 2).join("|"));

// --- undo ---
await run(() => window.__lomaEditor.commands.focus());
await page.keyboard.press("Control+z");
await settle(400);
ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll references checks passed");
process.exit(failed ? 1 : 0);
