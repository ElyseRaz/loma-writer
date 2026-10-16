import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { paperWarning, PRINT_SUB } from "../printSections";

describe("printSections", () => {
  it("the gap removed under a page break on paper is the same in the code and in the stylesheet", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/index.css"), "utf8");
    expect(css).toContain(`--pg-print-sub: ${PRINT_SUB}px`);
  });

  it("no paper warning outside WebKit, a single hint for an A4 document in WebKit, a warning for another paper", () => {
    const sheet = (w: number, h: number) => { const el = document.createElement("div"); el.className = "page-sheet"; Object.defineProperty(el, "offsetWidth", { value: w }); Object.defineProperty(el, "offsetHeight", { value: h }); document.body.append(el); return el; };
    const ua = (v: string) => Object.defineProperty(navigator, "userAgent", { value: v, configurable: true });
    const original = navigator.userAgent;
    const a4 = sheet(794, 1123);
    ua("Mozilla/5.0 Chrome/120 Safari/537.36");
    expect(paperWarning()).toBeNull();
    ua("Mozilla/5.0 (X11; Linux) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15");
    expect(paperWarning()).toContain("papier A4"); // an A4 document: a hint, once
    expect(paperWarning()).toBeNull();
    const letter = sheet(816, 1056);
    expect(paperWarning()).toContain("mélange");
    a4.remove();
    expect(paperWarning()).toContain("pas l'A4");
    letter.remove();
    ua(original);
  });
});
