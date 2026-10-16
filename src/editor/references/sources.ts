/** Bibliographic sources of a document and the way citations and bibliography entries are written. */

export type SourceType = "book" | "article" | "web" | "report" | "other";
export type CitationStyle = "apa" | "mla" | "chicago" | "iso690" | "numeric";

export const SOURCE_TYPES: Array<{ id: SourceType; label: string }> = [
  { id: "book", label: "Livre" },
  { id: "article", label: "Article de revue" },
  { id: "web", label: "Site web" },
  { id: "report", label: "Rapport ou thèse" },
  { id: "other", label: "Autre" },
];

export const CITATION_STYLES: Array<{ id: CitationStyle; label: string; sample: string }> = [
  { id: "apa", label: "APA", sample: "(Dupont, 2020)" },
  { id: "mla", label: "MLA", sample: "(Dupont 12)" },
  { id: "chicago", label: "Chicago (auteur-date)", sample: "(Dupont 2020, 12)" },
  { id: "iso690", label: "ISO 690 (premier élément et date)", sample: "(DUPONT, 2020)" },
  { id: "numeric", label: "IEEE (numérique)", sample: "[1]" },
];

export interface Person {
  last: string;
  first: string;
}

export interface Source {
  /** Unique short name the citations point at. */
  tag: string;
  type: SourceType;
  authors: Person[];
  title: string;
  year: string;
  /** Publisher (book, report), journal (article) or site name (web). */
  publisher: string;
  city: string;
  volume: string;
  /** Issue (number) of the volume. */
  issue: string;
  pages: string;
  url: string;
}

export const MAX_SOURCES = 500;
const FIELD_MAX = 400;
const clip = (v: unknown, max = FIELD_MAX) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const TYPES = new Set<string>(SOURCE_TYPES.map((t) => t.id));

export const isCitationStyle = (v: unknown): v is CitationStyle => CITATION_STYLES.some((s) => s.id === v);

/** A source as the document may hold it: unknown or oversized values are dropped (documents are untrusted input). */
export function cleanSource(raw: unknown): Source | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tag = clip(r.tag, 60).replace(/[^\p{L}\p{N}_.:-]/gu, "");
  if (!tag) return null;
  const authors = (Array.isArray(r.authors) ? r.authors : []).slice(0, 20).flatMap((a): Person[] => {
    if (!a || typeof a !== "object") return [];
    const p = a as Record<string, unknown>;
    const last = clip(p.last, 80);
    return last ? [{ last, first: clip(p.first, 80) }] : [];
  });
  return {
    tag,
    type: TYPES.has(String(r.type)) ? (r.type as SourceType) : "other",
    authors,
    title: clip(r.title),
    year: clip(r.year, 12),
    publisher: clip(r.publisher),
    city: clip(r.city, 80),
    volume: clip(r.volume, 40),
    issue: clip(r.issue, 40),
    pages: clip(r.pages, 40),
    url: /^https?:\/\//i.test(clip(r.url, 600)) ? clip(r.url, 600) : "",
  };
}

export function cleanSources(raw: unknown): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw.slice(0, MAX_SOURCES) : []) {
    const s = cleanSource(r);
    if (s && !seen.has(s.tag)) { seen.add(s.tag); out.push(s); }
  }
  return out;
}

/** A tag that is not used yet: "Dupont2020", then "Dupont2020b", "Dupont2020c"… */
export function newTag(sources: Source[], s: Pick<Source, "authors" | "year" | "title">): string {
  const base = (s.authors[0]?.last || s.title.split(" ")[0] || "Source").replace(/[^\p{L}\p{N}]/gu, "") + (s.year.replace(/\D/g, "").slice(0, 4) || "");
  const used = new Set(sources.map((x) => x.tag));
  if (!used.has(base)) return base;
  for (let i = 0; i < 26; i++) { const t = base + String.fromCharCode(98 + i); if (!used.has(t)) return t; }
  return `${base}${used.size + 1}`;
}

/** Initials of a first name: "Jean-Pierre" -> "J.-P.", "Anne Marie" -> "A. M.". */
const initials = (first: string) => first.split(/\s+/).filter(Boolean).map((w) => w.split("-").filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join("-")).join(" ");

/** Surname in capitals (ISO 690). */
const caps = (s: string) => s.toLocaleUpperCase("fr");

const locator = (page: string) => (page.trim() ? `p. ${page.trim()}` : "");
const yearOf = (s: Source, none = "s. d.") => s.year || none;

/** "Dupont", "Dupont et Martin", "Dupont et al." for an in-text citation (`and` joins two authors, `max` is the number of authors listed). */
function inText(s: Source, and: string, max: number, upper = false): string {
  const a = s.authors.map((p) => (upper ? caps(p.last) : p.last));
  if (!a.length) return "";
  if (a.length > max) return `${a[0]} et al.`;
  if (a.length === 1) return a[0];
  return `${a.slice(0, -1).join(", ")}${a.length > 2 ? "," : ""} ${and} ${a[a.length - 1]}`;
}

/** The text of a citation in the text, as the style prescribes. `order` is the rank of the source among those cited (numeric style). */
export function citationText(s: Source | undefined, style: CitationStyle, page: string, order: number): string {
  if (!s) return "[source manquante]";
  const loc = page.trim();
  const title = s.title.length > 30 ? `${s.title.slice(0, 30).trim()}…` : s.title;
  switch (style) {
    case "numeric": return `[${order}${loc ? `, ${locator(loc)}` : ""}]`;
    case "apa": return `(${inText(s, "&", 2) || title}, ${yearOf(s)}${loc ? `, ${locator(loc)}` : ""})`;
    case "mla": return `(${inText(s, "et", 2) || `« ${title} »`}${loc ? ` ${loc}` : ""})`;
    case "chicago": return `(${inText(s, "et", 3) || title} ${s.year || "s. d."}${loc ? `, ${loc}` : ""})`;
    case "iso690": return `(${inText(s, "et", 3, true) || caps(title)}, ${yearOf(s)}${loc ? `, ${locator(loc)}` : ""})`;
  }
}

/** A piece of a bibliography entry (the titles are in italics). */
export interface Segment {
  text: string;
  italic?: boolean;
}

const seg = (text: string, italic = false): Segment[] => (text ? [{ text, ...(italic ? { italic } : {}) }] : []);
const dot = (t: string) => (!t || /[.!?…]$/.test(t) ? t : `${t}.`);
const range = (p: string) => p.replace(/(\d)\s*-\s*(\d)/, "$1–$2");
const sp = (...parts: Segment[][]): Segment[] => parts.flat();

/** The entry of a source in the bibliography, as text pieces. */
export function entrySegments(s: Source, style: CitationStyle, order: number): Segment[] {
  const a = s.authors;
  const article = s.type === "article";
  const web = s.type === "web";
  const pubPlace = s.city && s.publisher ? `${s.city}: ${s.publisher}` : s.publisher || s.city;
  const vol = s.volume;
  const out: Segment[] = [];
  const add = (...p: Segment[][]) => out.push(...p.flat());
  const andOf = (list: string[], and: string, comma = true, comma2 = false) => (list.length <= 1 ? list.join("") : list.length === 2 ? `${list[0]}${comma2 ? "," : ""} ${and} ${list[1]}` : `${list.slice(0, -1).join(", ")}${comma ? "," : ""} ${and} ${list[list.length - 1]}`);
  const inv = (p: Person, full: boolean) => (p.first ? `${p.last}, ${full ? p.first : initials(p.first)}` : p.last);
  const nat = (p: Person, full: boolean) => (p.first ? `${full ? p.first : initials(p.first)} ${p.last}` : p.last);
  switch (style) {
    case "apa": {
      // APA 7: up to 20 authors, "&" before the last one (with a comma); 21 or more: the first 19, an ellipsis and the last one.
      const names = a.length > 20 ? `${a.slice(0, 19).map((p) => inv(p, false)).join(", ")}, … ${inv(a[a.length - 1], false)}` : andOf(a.map((p) => inv(p, false)), "&", true, true);
      // without an author the title comes first (and the date after it)
      add(names ? seg(`${dot(names)} `) : sp(seg(s.title, true), seg(". ")), seg(`(${yearOf(s)}). `));
      if (article) add(seg(`${dot(s.title)} `), seg(s.publisher, true), seg(vol ? `, ` : ""), seg(vol ? `${vol}${s.issue ? "" : ""}` : "", true), seg(s.issue ? `(${s.issue})` : ""), seg(s.pages ? `, ${range(s.pages)}` : ""), seg("."));
      else add(names ? sp(seg(s.title, true), seg(". ")) : [], web ? sp(seg(s.publisher ? `${dot(s.publisher)}` : "")) : seg(dot(s.publisher)));
      break;
    }
    case "mla": {
      // MLA 9: the first author inverted, the others in natural order; three or more: the first one and "et al."
      const names = a.length > 2 ? `${inv(a[0], true)}, et al` : andOf(a.map((p, i) => (i === 0 ? inv(p, true) : nat(p, true))), "et", false);
      add(seg(names ? `${dot(names)} ` : ""));
      if (article) add(seg(`« ${dot(s.title)} » `), seg(s.publisher, true), seg([vol ? `, vol. ${vol}` : "", s.issue ? `, nº ${s.issue}` : "", s.year ? `, ${s.year}` : "", s.pages ? `, p. ${range(s.pages)}` : ""].join("")), seg("."));
      else if (web) add(seg(`« ${dot(s.title)} » `), seg(s.publisher, true), seg(`${s.year ? `, ${s.year}` : ""}.`));
      else add(seg(s.title, true), seg(`. ${[s.publisher, s.year].filter(Boolean).join(", ")}${s.publisher || s.year ? "." : ""}`));
      break;
    }
    case "chicago": {
      // Chicago author-date: the first author inverted, "and" before the last (comma when there are three or more); without an author the title comes first.
      const names = andOf(a.map((p, i) => (i === 0 ? inv(p, true) : nat(p, true))), "et", true);
      const year = seg(`${yearOf(s, "s. d.")}. `);
      if (article) add(names ? sp(seg(`${dot(names)} `), year) : [], seg(`« ${dot(s.title)} » `), names ? [] : year, seg(s.publisher, true), seg([vol ? ` ${vol}` : "", s.issue ? ` (${s.issue})` : "", s.pages ? `: ${range(s.pages)}` : ""].join("")), seg("."));
      else if (web) add(names ? sp(seg(`${dot(names)} `), year) : [], seg(`« ${dot(s.title)} » `), names ? [] : year, seg(s.publisher ? `${dot(s.publisher)}` : ""));
      else add(names ? sp(seg(`${dot(names)} `), year) : [], seg(s.title, true), seg(". "), names ? [] : year, seg(dot(pubPlace)));
      break;
    }
    case "iso690": {
      // ISO 690 (first element and date): surnames in capitals, "et" before the last author, the place and the publisher after a colon; without an author the title comes first.
      const names = a.length > 3 ? `${caps(a[0].last)}${a[0].first ? `, ${a[0].first}` : ""} et al.` : andOf(a.map((p) => `${caps(p.last)}${p.first ? `, ${p.first}` : ""}`), "et", false);
      const year = `${yearOf(s, "s. d.")}. `;
      const lead = names ? sp(seg(`${names}, `), seg(year)) : [];
      if (article) add(lead, seg(`${dot(s.title)} `), names ? [] : seg(year), seg(s.publisher, true), seg([vol ? `, ${vol}` : "", s.issue ? `(${s.issue})` : "", s.pages ? `, p. ${range(s.pages)}` : ""].join("")), seg("."));
      else add(lead, seg(s.title, true), seg(". "), names ? [] : seg(year), seg(s.city && s.publisher ? `${s.city} : ${s.publisher}.` : dot(s.publisher || s.city)));
      break;
    }
    case "numeric": {
      // IEEE: the initials first, "and" before the last author, the title of an article in quotes.
      const names = a.length > 6 ? `${nat(a[0], false)} et al.` : andOf(a.map((p) => nat(p, false)), "and", false);
      add(seg(`[${order}] ${names ? `${names}, ` : ""}`));
      if (article) add(seg(`“${s.title},” `), seg(s.publisher, true), seg([vol ? `, vol. ${vol}` : "", s.issue ? `, no. ${s.issue}` : "", s.pages ? `, pp. ${range(s.pages)}` : "", s.year ? `, ${s.year}` : ""].join("")), seg("."));
      else add(seg(s.title, true), seg(`. ${[pubPlace, s.year].filter(Boolean).join(", ")}${pubPlace || s.year ? "." : ""}`));
      break;
    }
  }
  if (s.url) add(seg(` ${s.url}`));
  // merge neighbours of the same look and tidy the punctuation
  const merged: Segment[] = [];
  for (const p of out) { const l = merged[merged.length - 1]; if (l && !!l.italic === !!p.italic) l.text += p.text; else merged.push({ ...p }); }
  return merged.map((p) => ({ ...p, text: p.text.replace(/\s+([.,;:])/g, "$1").replace(/\.{2,}(?!\.)/g, ".").replace(/\.\s*\./g, ".").replace(/ {2,}/g, " ") })).filter((p) => p.text);
}

/** Sort key of the bibliography: author, year, title (the numeric style keeps the order of first citation instead). */
export const sortKey = (s: Source) => `${(s.authors[0]?.last || s.title).toLowerCase()}|${s.year}|${s.title.toLowerCase()}`;
