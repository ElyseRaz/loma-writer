import { corrupt } from "./types";

export function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement) throw corrupt(`${what} illisible`);
  return doc;
}

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Element children only (DOM `children` is not guaranteed on XML documents in every engine). */
export function kids(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

export const first = (el: Element | Document, tag: string): Element | null => el.getElementsByTagName(tag)[0] ?? null;

/** Direct child with the given qualified name. */
export const child = (el: Element, tag: string): Element | null => kids(el).find((k) => k.nodeName === tag) ?? null;

export const attr = (el: Element | null, name: string): string | null => el?.getAttribute(name) ?? null;

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export const base64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };
export const mimeForPath = (path: string): string | null => MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? null;
export const toDataUri = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${bytesToBase64(bytes)}`;

export function parseDataUri(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(src);
  return m ? { mime: m[1], bytes: base64ToBytes(m[2]) } : null;
}

/** Natural pixel size of PNG/JPEG/GIF images, read from their headers (no canvas needed). */
export function imageSize(bytes: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) };
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}
