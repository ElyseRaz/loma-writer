import { createElement, type ReactNode } from "react";
import type { NoteParagraph } from "../../editor/references/noteBody";

const TAGS: Record<string, string> = { bold: "strong", italic: "em", underline: "u", strike: "s", subscript: "sub", superscript: "sup" };

/** The paragraphs of a note as React elements (no raw HTML: marks become elements, links keep a checked address). */
export function NoteBody({ body, lead }: { body: NoteParagraph[]; lead?: ReactNode }) {
  const paragraphs = body.length ? body : [{ type: "paragraph" as const, content: [] }];
  return (
    <>
      {paragraphs.map((p, i) => (
        <div key={i} className="note-par">
          {i === 0 && lead}
          {i === 0 && lead ? " " : null}
          {p.content.length === 0 && " "}
          {p.content.map((c, k) => {
            if (c.type === "hardBreak") return <br key={k} />;
            let node: ReactNode = c.text;
            for (const m of c.marks ?? []) node = m.type === "link" && m.attrs ? <a href={m.attrs.href} rel="noopener noreferrer" onClick={(e) => e.preventDefault()}>{node}</a> : createElement(TAGS[m.type], null, node);
            return <span key={k}>{node}</span>;
          })}
        </div>
      ))}
    </>
  );
}
