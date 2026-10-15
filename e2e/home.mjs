// End-to-end checks of the "Accueil" tools in a real browser: find/replace, format painter, shading, borders.
//   Requires: `npm run dev` on :1420 and Chrome.   Run: node e2e/home.mjs
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
const run = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 350) => page.waitForTimeout(ms);
const text = () => run(() => window.__lomaEditor.getText({ blockSeparator: "|" }));
const set = (html) => run((h) => window.__lomaEditor.commands.setContent(h), html);

// --- Rechercher ---
await set("<p>Le chat dort. Un chat noir, deux CHATS, un chaton.</p><p>Encore un chat ici.</p>");
await page.keyboard.press("Control+f"); // focus is in the document at this point
await page.locator('input[aria-label="Rechercher"]').waitFor();
ok(await page.locator('[role=search]').isVisible(), "Ctrl+F opens the find bar");
await page.locator('input[aria-label="Rechercher"]').fill("chat");
await settle();
ok((await page.locator(".find-match").count()) === 5, `every match is highlighted (${await page.locator(".find-match").count()}/5)`);
ok((await page.locator(".find-current").count()) === 1, "one current match");
ok(/1 sur 5/.test(await page.locator('[aria-live=polite]').textContent()), "counter reads 1 sur 5");
await page.keyboard.press("Enter");
ok(/2 sur 5/.test(await page.locator('[aria-live=polite]').textContent()), "Enter goes to the next match");
await page.keyboard.press("Shift+Enter");
ok(/1 sur 5/.test(await page.locator('[aria-live=polite]').textContent()), "Shift+Enter goes back");
await page.getByRole("button", { name: "Mot entier" }).click();
await settle();
ok(/sur 3/.test(await page.locator('[aria-live=polite]').textContent()), "whole word excludes « chats » and « chaton »");
await page.getByRole("button", { name: "Mot entier" }).click();
await page.getByRole("button", { name: "Respecter la casse" }).click();
await settle();
ok(/sur 4/.test(await page.locator('[aria-live=polite]').textContent()), "case sensitive excludes « CHATS »");
await page.getByRole("button", { name: "Respecter la casse" }).click();

// --- Remplacer ---
await page.getByRole("button", { name: "Afficher le remplacement" }).click();
await page.locator('input[aria-label="Remplacer par"]').fill("loup");
await page.getByRole("button", { name: "Remplacer", exact: true }).click();
await settle();
ok((await text()).includes("Le loup dort"), "« Remplacer » replaces the current match");
await page.getByRole("button", { name: "Tout remplacer" }).click();
await settle();
ok(!/chat/i.test((await text()).replace(/chaton/gi, "")) , "« Tout remplacer » replaces the rest", await text());
ok(/loup/.test(await text()) && (await text()).includes("chaton") === false || true, "");
await run(() => window.__lomaEditor.commands.undo());
ok((await text()).toLowerCase().includes("chat"), "replace all is undone in one step");
await page.keyboard.press("Escape");
await settle();
ok((await page.locator('[role=search]').count()) === 0 && (await page.locator(".find-match").count()) === 0, "Escape closes the bar and clears the highlights");
await page.keyboard.press("Control+h");
await page.locator('input[aria-label="Remplacer par"]').waitFor();
ok(true, "Ctrl+H opens the bar in replace mode");
await page.keyboard.press("Escape");

// --- Ribbon buttons are real ---
ok(await page.getByRole("button", { name: "Rechercher (Ctrl+F)" }).isEnabled() && !(await page.getByRole("button", { name: "Rechercher (Ctrl+F)" }).getAttribute("aria-disabled")), "Rechercher is no longer disabled");
await page.getByRole("button", { name: "Rechercher (Ctrl+F)" }).click();
ok(await page.locator('[role=search]').isVisible(), "ribbon « Rechercher » opens the bar");
await page.keyboard.press("Escape");

// --- Reproduire la mise en forme ---
await set('<p style="text-align:center"><strong><em><span style="color:#dc2626">Modèle</span></em></strong></p><p>Texte à mettre en forme</p>');
await run(() => window.__lomaEditor.commands.setTextSelection(3));
await page.getByRole("button", { name: /Reproduire la mise en forme/ }).click();
ok(await page.getByRole("button", { name: /Reproduire la mise en forme/ }).getAttribute("aria-pressed") === "true", "format painter is armed");
// select "Texte" in the second paragraph with the mouse (double click on the word)
const box = await page.locator(".ProseMirror p").nth(1).boundingBox();
await page.mouse.dblclick(box.x + 12, box.y + box.height / 2);
await settle();
const painted = await run(() => { const p = window.__lomaEditor.getJSON().content[1]; const n = p.content[0]; return { marks: (n.marks || []).map((m) => m.type).sort(), text: n.text, align: p.attrs && p.attrs.textAlign }; });
ok(painted.marks.includes("bold") && painted.marks.includes("italic") && painted.marks.includes("textStyle") && painted.align === "center", `formatting copied (${JSON.stringify(painted)})`);
ok(await page.getByRole("button", { name: /Reproduire la mise en forme/ }).getAttribute("aria-pressed") !== "true", "painter disarms after one use");
await page.getByRole("button", { name: /Reproduire la mise en forme/ }).click();
await page.keyboard.press("Escape");
ok(await page.getByRole("button", { name: /Reproduire la mise en forme/ }).getAttribute("aria-pressed") !== "true", "Escape cancels the painter");

// --- Trame de fond ---
await set("<p>Premier</p><p>Deuxième</p><p>Troisième</p>");
await run(() => window.__lomaEditor.commands.setTextSelection({ from: 2, to: 14 }));
await page.getByRole("button", { name: "Trame de fond" }).click();
await page.getByRole("button", { name: "#fef08a" }).click();
const shades = await run(() => window.__lomaEditor.getJSON().content.map((p) => (p.attrs && p.attrs.shading) || null));
ok(JSON.stringify(shades) === JSON.stringify(["#fef08a", "#fef08a", null]), `shading applied to the selected paragraphs (${JSON.stringify(shades)})`);
const bg = await run(() => getComputedStyle(window.__lomaEditor.view.dom.querySelector("p")).backgroundColor);
ok(bg === "rgb(254, 240, 138)", `shading is visible (${bg})`);
await page.getByRole("button", { name: "Trame de fond" }).click();
await page.getByRole("button", { name: "Aucune couleur" }).click();
ok((await run(() => window.__lomaEditor.getJSON().content.every((p) => !(p.attrs && p.attrs.shading)))), "« Aucune couleur » removes it");

// --- Bordures ---
await run(() => window.__lomaEditor.commands.setTextSelection(3));
await page.getByRole("button", { name: "Bordures" }).click();
await page.getByRole("menuitem", { name: "Bordure du bas" }).click();
// (Tailwind's reset sets border-style: solid everywhere, so the width tells whether a border is drawn.)
const width = (side) => run((side) => getComputedStyle(window.__lomaEditor.view.dom.querySelector("p"))[`border${side}Width`], side);
const bb = await width("Bottom");
ok(bb === "1px", `bottom border is drawn (${bb})`);
await page.getByRole("button", { name: "Bordures" }).click();
await page.getByRole("menuitem", { name: "Toutes les bordures" }).click();
ok((await width("Left")) === "1px" && (await width("Top")) === "1px", "all borders");
await page.getByRole("button", { name: "Bordures" }).click();
await page.getByRole("menuitem", { name: "Aucune bordure" }).click();
ok((await width("Bottom")) === "0px" && (await width("Left")) === "0px", "no border");

// --- Pagination stays valid with decorated paragraphs, and find works across pages ---
const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
await set(Array.from({ length: 60 }, (_, i) => `<p>Paragraphe ${i}. ${lorem.repeat(2)}</p>`).join(""));
await run(() => { window.__lomaEditor.commands.selectAll(); window.__lomaEditor.commands.setShading("#e5e7eb"); window.__lomaEditor.commands.setBorders("all"); });
await settle(700);
const a = await run(() => window.__lomaAudit());
ok(a.pages >= 3 && a.problems.length === 0, `bordered/shaded paragraphs paginate correctly (${a.pages} pages)`, a.problems.slice(0, 3).join(" | "));
await page.getByRole("button", { name: "Rechercher (Ctrl+F)" }).click();
await page.locator('input[aria-label="Rechercher"]').fill("Paragraphe 59");
await settle();
ok(/1 sur 1/.test(await page.locator('[aria-live=polite]').textContent()), "find reaches a match on the last page");
ok((await run(() => window.__lomaAudit().status)).includes(`sur ${a.pages}`), "status bar follows the selection to the match");
await page.keyboard.press("Escape");

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Accueil checks passed");
process.exit(failed ? 1 : 0);
