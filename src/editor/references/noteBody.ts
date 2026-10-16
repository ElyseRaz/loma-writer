/** The content of a note: a few paragraphs of formatted text (kept in the note's attributes as plain JSON, checked here). */

export interface NoteMark {
  type: "bold" | "italic" | "underline" | "strike" | "subscript" | "superscript" | "link";
  attrs?: { href: string };
}

export interface NoteInline {
  type: "text" | "hardBreak";
  text?: string;
  marks?: NoteMark[];
}

export interface NoteParagraph {
  type: "paragraph";
  content: NoteInline[];
}

export const MAX_NOTE_PARAGRAPHS = 20;
export const MAX_NOTE_CHARS = 4000;

const MARKS = new Set(["bold", "italic", "underline", "strike", "subscript", "superscript", "link"]);
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s"<>]{1,500}$/i;

/** A mark a note may carry (links only to web or mail addresses). */
function cleanMark(m: unknown): NoteMark | null {
  if (!m || typeof m !== "object") return null;
  const t = (m as { type?: unknown }).type;
  if (typeof t !== "string" || !MARKS.has(t)) return null;
  if (t === "link") {
    const href = (m as { attrs?: { href?: unknown } }).attrs?.href;
    return typeof href === "string" && SAFE_HREF.test(href) ? { type: "link", attrs: { href } } : null;
  }
  return { type: t as NoteMark["type"] };
}

/** Paragraphs of formatted text as the document may hold them: anything else is dropped (documents are untrusted input). */
export function cleanBody(raw: unknown): NoteParagraph[] {
  const out: NoteParagraph[] = [];
  let chars = 0;
  for (const p of Array.isArray(raw) ? raw.slice(0, MAX_NOTE_PARAGRAPHS) : []) {
    if (!p || typeof p !== "object" || (p as { type?: unknown }).type !== "paragraph") continue;
    const content: NoteInline[] = [];
    for (const c of Array.isArray((p as { content?: unknown }).content) ? (p as { content: unknown[] }).content : []) {
      if (!c || typeof c !== "object") continue;
      const node = c as { type?: unknown; text?: unknown; marks?: unknown };
      if (node.type === "hardBreak") { content.push({ type: "hardBreak" }); continue; }
      if (node.type !== "text" || typeof node.text !== "string" || !node.text) continue;
      const text = node.text.slice(0, Math.max(0, MAX_NOTE_CHARS - chars));
      if (!text) break;
      chars += text.length;
      const marks = (Array.isArray(node.marks) ? node.marks : []).map(cleanMark).filter((m): m is NoteMark => !!m);
      content.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
    }
    out.push({ type: "paragraph", content });
  }
  return out;
}

/** The body of a note: its `body`, or (notes written before the formatted text existed) its plain `text`. */
export function bodyOf(attrs: { body?: unknown; text?: unknown }): NoteParagraph[] {
  const body = cleanBody(attrs.body);
  if (body.length) return body;
  const text = typeof attrs.text === "string" ? attrs.text.trim() : "";
  return text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [];
}

export const bodyFromText = (text: string): NoteParagraph[] =>
  text.split(/\n+/).map((t) => t.trim()).filter(Boolean).map((t): NoteParagraph => ({ type: "paragraph", content: [{ type: "text", text: t }] }));

/** The text of a note without its formatting (paragraphs separated by a space). */
export const bodyText = (body: NoteParagraph[]): string => body.map((p) => p.content.map((c) => (c.type === "hardBreak" ? " " : c.text ?? "")).join("")).join(" ").replace(/\s+/g, " ").trim();

const TAGS: Record<string, string> = { bold: "strong", italic: "em", underline: "u", strike: "s", subscript: "sub", superscript: "sup" };

/** The paragraphs of a note as DOM nodes (a `div` each; the first one also receives `lead`, the number of the note). */
export function renderBody(body: NoteParagraph[], lead?: Node): HTMLElement[] {
  const paragraphs = body.length ? body : [{ type: "paragraph" as const, content: [] }];
  return paragraphs.map((p, i) => {
    const div = document.createElement("div");
    div.className = "note-par";
    if (i === 0 && lead) div.append(lead, document.createTextNode(" "));
    for (const c of p.content) {
      if (c.type === "hardBreak") { div.append(document.createElement("br")); continue; }
      let node: Node = document.createTextNode(c.text ?? "");
      for (const m of c.marks ?? []) {
        const el = document.createElement(m.type === "link" ? "a" : TAGS[m.type]);
        if (m.type === "link" && m.attrs) { (el as HTMLAnchorElement).href = m.attrs.href; el.setAttribute("rel", "noopener noreferrer"); }
        el.append(node);
        node = el;
      }
      div.append(node);
    }
    if (!div.childNodes.length || (i === 0 && lead && div.childNodes.length === 2)) div.append(document.createTextNode(" "));
    return div;
  });
}
