import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Converter } from "../converter";

export const hasLibreOffice = (() => {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** LibreOffice Math (formulas) is a separate package; without it LibreOffice drops equations in both directions. */
export const hasLibreOfficeMath = hasLibreOffice && ["/usr/lib/libreoffice/program/libsmlo.so", "/opt/libreoffice/program/libsmlo.so"].some((p) => existsSync(p));

/** Converts bytes with a real headless LibreOffice: an independent implementation to test against. */
export function libreOffice(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "loma-test-"));
  try {
    writeFileSync(join(dir, `in.${from}`), bytes);
    const filter = ({ doc: "doc:MS Word 97", docx: "docx:MS Word 2007 XML", odt: "odt", txt: "txt:Text (encoded):UTF8" } as Record<string, string>)[to] ?? to;
    execFileSync("soffice", [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--norestore", "--convert-to", filter, "--outdir", join(dir, "out"), join(dir, `in.${from}`)], { stdio: "ignore", timeout: 90000 });
    const out = join(dir, "out", `in.${to}`);
    if (!existsSync(out)) throw new Error("LibreOffice n'a rien produit");
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const nodeConverter: Converter = {
  async isAvailable() { return hasLibreOffice; },
  async convert(bytes, from, to) { return libreOffice(bytes, from, to); },
};

export const missingConverter: Converter = {
  async isAvailable() { return false; },
  async convert() {
    const { DocumentError } = await import("../types");
    throw new DocumentError("converter-missing", "LibreOffice est requis");
  },
};
