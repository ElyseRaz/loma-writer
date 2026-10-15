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

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll typography checks passed");
process.exit(failed ? 1 : 0);
