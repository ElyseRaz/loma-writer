/** Bibliographic sources of a document and the way citations and bibliography entries are written. */

export type SourceType = "book" | "article" | "web" | "report" | "other";
export type CitationStyle = "apa" | "mla" | "chicago" | "numeric";

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
  { id: "numeric", label: "Numérique", sample: "[1]" },
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

const initials = (first: string) => first.split(/[\s-]+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join(" ");

/** "Dupont", "Dupont et Martin", "Dupont et al." (the "and" of the language: French here). */
function shortAuthors(authors: Person[], and: string): string {
  if (!authors.length) return "";
  if (authors.length === 1) return authors[0].last;
  if (authors.length === 2) return `${authors[0].last} ${and} ${authors[1].last}`;
  return `${authors[0].last} et al.`;
}

/** The text of a citation in the text. `order` is the rank of the source among those cited (numeric style). */
export function citationText(s: Source | undefined, style: CitationStyle, page: string, order: number): string {
  if (!s) return "[source manquante]";
  const loc = page.trim();
  const who = shortAuthors(s.authors, style === "apa" ? "&" : "et") || s.title.slice(0, 30);
  switch (style) {
    case "numeric": return `[${order}${loc ? `, p. ${loc}` : ""}]`;
    case "apa": return `(${who}${s.year ? `, ${s.year}` : ""}${loc ? `, p. ${loc}` : ""})`;
    case "mla": return `(${who}${loc ? ` ${loc}` : ""})`;
    case "chicago": return `(${who}${s.year ? ` ${s.year}` : ""}${loc ? `, ${loc}` : ""})`;
  }
}

/** A piece of a bibliography entry (the titles are in italics). */
export interface Segment {
  text: string;
  italic?: boolean;
}

const seg = (text: string, italic = false): Segment[] => (text ? [{ text, ...(italic ? { italic } : {}) }] : []);
const dot = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

/** The entry of a source in the bibliography, as text pieces. */
export function entrySegments(s: Source, style: CitationStyle, order: number): Segment[] {
  const a = s.authors;
  const where = s.city && s.publisher ? `${s.city} : ${s.publisher}` : s.publisher || s.city;
  const pieces: Segment[][] = [];
  const authorsInverted = (full: boolean) => a.map((p, i) => (i === 0 ? `${p.last}${p.first ? `, ${full ? p.first : initials(p.first)}` : ""}` : `${full ? p.first : initials(p.first)} ${p.last}`.trim()));
  const join = (list: string[], and: string) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")}${and}${list[list.length - 1]}`);
  switch (style) {
    case "apa": {
      const names = join(a.map((p) => `${p.last}${p.first ? `, ${initials(p.first)}` : ""}`), ", & ");
      pieces.push(seg(dot(names)), seg(s.year ? ` (${s.year}).` : " (s. d.)."));
      if (s.type === "article") pieces.push(seg(` ${dot(s.title)} `), seg(s.publisher, true), seg(`${s.volume ? `, ${s.volume}` : ""}${s.pages ? `, ${s.pages}` : ""}.`));
      else pieces.push(seg(" "), seg(s.title, s.type !== "web" || true), seg(`.${where ? ` ${dot(where)}` : ""}`));
      break;
    }
    case "mla": {
      const names = join(authorsInverted(true), a.length > 2 ? ", et " : " et ");
      pieces.push(seg(names ? `${dot(names)} ` : ""));
      if (s.type === "article") pieces.push(seg(`« ${dot(s.title)} » `), seg(s.publisher, true), seg(`${s.volume ? `, vol. ${s.volume}` : ""}${s.year ? `, ${s.year}` : ""}${s.pages ? `, p. ${s.pages}` : ""}.`));
      else pieces.push(seg(s.title, true), seg(`.${s.publisher ? ` ${s.publisher},` : ""}${s.year ? ` ${s.year}` : ""}.`));
      break;
    }
    case "chicago": {
      const names = join(authorsInverted(true), a.length > 2 ? ", et " : " et ");
      pieces.push(seg(names ? `${dot(names)} ` : ""), seg(s.year ? `${s.year}. ` : ""));
      if (s.type === "article") pieces.push(seg(`« ${dot(s.title)} » `), seg(s.publisher, true), seg(`${s.volume ? ` ${s.volume}` : ""}${s.pages ? `: ${s.pages}` : ""}.`));
      else pieces.push(seg(s.title, true), seg(`.${where ? ` ${dot(where)}` : ""}`));
      break;
    }
    case "numeric": {
      const names = join(a.map((p) => `${p.first ? `${initials(p.first)} ` : ""}${p.last}`), " et ");
      pieces.push(seg(`[${order}] ${names ? `${names}, ` : ""}`));
      if (s.type === "article") pieces.push(seg(`« ${s.title} », `), seg(s.publisher, true), seg(`${s.volume ? `, vol. ${s.volume}` : ""}${s.year ? `, ${s.year}` : ""}${s.pages ? `, p. ${s.pages}` : ""}.`));
      else pieces.push(seg(s.title, true), seg(`${s.publisher ? `, ${s.publisher}` : ""}${s.year ? `, ${s.year}` : ""}.`));
      break;
    }
  }
  if (s.url) pieces.push(seg(` ${s.url}`));
  // merge neighbours of the same look
  const out: Segment[] = [];
  for (const p of pieces.flat()) { const last = out[out.length - 1]; if (last && !!last.italic === !!p.italic) last.text += p.text; else out.push({ ...p }); }
  return out.map((p) => ({ ...p, text: p.text.replace(/\s+\./g, ".").replace(/\.\./g, ".").replace(/ {2,}/g, " ") })).filter((p) => p.text);
}

/** Sort key of the bibliography: author, year, title (the numeric style keeps the order of first citation instead). */
export const sortKey = (s: Source) => `${(s.authors[0]?.last || s.title).toLowerCase()}|${s.year}|${s.title.toLowerCase()}`;
