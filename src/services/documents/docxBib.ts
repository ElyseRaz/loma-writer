import JSZip from "jszip";
import { cleanSources, isCitationStyle, type CitationStyle, type Source, type SourceType } from "../../editor/references/sources";
import type { PM } from "./pm";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NS = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";

const WORD_TYPE: Record<SourceType, string> = { book: "Book", article: "JournalArticle", web: "InternetSite", report: "Report", other: "Misc" };
const FROM_WORD: Record<string, SourceType> = { Book: "book", BookSection: "book", JournalArticle: "article", ArticleInAPeriodical: "article", InternetSite: "web", DocumentFromInternetSite: "web", Report: "report", Misc: "other" };

/** The style Word selects for each of ours (its own style sheets), and the way back. */
const WORD_STYLE: Record<CitationStyle, { file: string; name: string }> = {
  apa: { file: "\\APASixthEditionOfficeOnline.xsl", name: "APA" },
  mla: { file: "\\MLASeventhEditionOfficeOnline.xsl", name: "MLA" },
  chicago: { file: "\\ChicagoFifteenthEditionSimple.xsl", name: "Chicago" },
  numeric: { file: "\\IEEE2006OfficeOnline.xsl", name: "IEEE" },
};

/** `customXml/item1.xml`: the sources of the document in Word's bibliography format. */
export function sourcesXml(sources: Source[], style: CitationStyle): string {
  const ws = WORD_STYLE[style];
  const person = (p: { last: string; first: string }) => `<b:Person><b:Last>${xmlEsc(p.last)}</b:Last>${p.first ? `<b:First>${xmlEsc(p.first)}</b:First>` : ""}</b:Person>`;
  const items = sources.map((s, i) => `<b:Source><b:Tag>${xmlEsc(s.tag)}</b:Tag><b:SourceType>${WORD_TYPE[s.type]}</b:SourceType>${s.authors.length ? `<b:Author><b:Author><b:NameList>${s.authors.map(person).join("")}</b:NameList></b:Author></b:Author>` : ""}<b:Title>${xmlEsc(s.title)}</b:Title>${s.year ? `<b:Year>${xmlEsc(s.year)}</b:Year>` : ""}${s.city ? `<b:City>${xmlEsc(s.city)}</b:City>` : ""}${s.type === "article" ? `${s.publisher ? `<b:JournalName>${xmlEsc(s.publisher)}</b:JournalName>` : ""}` : s.type === "web" ? `${s.publisher ? `<b:InternetSiteTitle>${xmlEsc(s.publisher)}</b:InternetSiteTitle>` : ""}` : `${s.publisher ? `<b:Publisher>${xmlEsc(s.publisher)}</b:Publisher>` : ""}`}${s.volume ? `<b:Volume>${xmlEsc(s.volume)}</b:Volume>` : ""}${s.pages ? `<b:Pages>${xmlEsc(s.pages)}</b:Pages>` : ""}${s.url ? `<b:URL>${xmlEsc(s.url)}</b:URL>` : ""}<b:RefOrder>${i + 1}</b:RefOrder></b:Source>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><b:Sources SelectedStyle="${xmlEsc(ws.file)}" StyleName="${ws.name}" xmlns:b="${NS}" xmlns="${NS}">${items}</b:Sources>`;
}

/** Reads the sources (and the selected style) of a bibliography part; null when the XML is not one. */
export function readSourcesXml(xml: string): { sources: Source[]; style: CitationStyle | null } | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  const root = Array.from(doc.getElementsByTagName("*")).find((e) => e.localName === "Sources");
  if (!root) return null;
  const kids = (el: Element) => Array.from(el.children);
  const text = (el: Element, name: string) => kids(el).find((k) => k.localName === name)?.textContent?.trim() ?? "";
  const raw = kids(root).filter((k) => k.localName === "Source").map((s) => {
    const people = Array.from(s.getElementsByTagName("*")).filter((e) => e.localName === "Person").map((p) => ({ last: text(p, "Last"), first: text(p, "First") }));
    const type = FROM_WORD[text(s, "SourceType")] ?? "other";
    return { tag: text(s, "Tag"), type, authors: people, title: text(s, "Title"), year: text(s, "Year"), city: text(s, "City"), publisher: type === "article" ? text(s, "JournalName") || text(s, "JournalTitle") : type === "web" ? text(s, "InternetSiteTitle") || text(s, "WebSiteTitle") : text(s, "Publisher"), volume: text(s, "Volume"), pages: text(s, "Pages"), url: text(s, "URL") };
  });
  const name = (root.getAttribute("StyleName") ?? "").toLowerCase();
  const style: CitationStyle | null = isCitationStyle(name) ? name : name === "ieee" || name === "iso690" ? "numeric" : name.startsWith("chicago") ? "chicago" : null;
  return { sources: cleanSources(raw), style };
}

const run = (t: string, italic = false) => `<w:r>${italic ? "<w:rPr><w:i/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;

/** A bibliography as Word writes it: a title, then a BIBLIOGRAPHY field whose result is one paragraph per entry. */
export function bibliographyXml(node: PM): string {
  const title = String(node.attrs?.title ?? "");
  const out: string[] = [];
  if (title) out.push(`<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr>${run(title)}</w:p>`);
  const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> BIBLIOGRAPHY \\l 1036 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
  // The entries of the document (already in the order and style of the bibliography); Word rewrites them on update.
  const entries = (node.content ?? []).filter((e) => e.type === "bibEntry");
  entries.forEach((e, i) => {
    const runs = (e.content ?? []).map((c) => run(c.text ?? "", !!c.marks?.some((m) => m.type === "italic"))).join("");
    out.push(`<w:p><w:pPr><w:pStyle w:val="Bibliography"/></w:pPr>${i === 0 ? begin : ""}${runs}</w:p>`);
  });
  if (entries.length) out[out.length - 1] = out[out.length - 1].replace(/<\/w:p>$/, '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  else out.push(`<w:p>${begin}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`);
  return out.join("");
}

/** Adds the sources part (customXml) to the package, with its properties, relationship and content types. */
export async function addSourcesPart(bytes: Uint8Array, sources: Source[], style: CitationStyle): Promise<Uint8Array> {
  if (!sources.length) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const id = "{6B2F0E7C-1D4A-4C3B-8E5F-0A7B9C1D2E3F}";
  zip.file("customXml/item1.xml", sourcesXml(sources, style));
  zip.file("customXml/itemProps1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ds:datastoreItem ds:itemID="${id}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${NS}"/></ds:schemaRefs></ds:datastoreItem>`);
  zip.file("customXml/_rels/item1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>');
  const types = await zip.file("[Content_Types].xml")!.async("string");
  if (!types.includes("/customXml/itemProps1.xml")) zip.file("[Content_Types].xml", types.replace("</Types>", '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));
  const relsPath = "word/_rels/document.xml.rels";
  const rels = await zip.file(relsPath)!.async("string");
  if (!rels.includes("customXml/item1.xml")) zip.file(relsPath, rels.replace("</Relationships>", '<Relationship Id="rIdLomaSources" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

