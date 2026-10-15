import type { Editor } from "@tiptap/react";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function exportHtml(editor: Editor, title: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:Inter,"Segoe UI",Ubuntu,sans-serif;line-height:1.55;max-width:794px;margin:2rem auto;padding:0 2rem;color:#1b1c1c}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #d1d5db;padding:6px 10px}th{background:#f3f4f6}
blockquote{border-left:3px solid #2563eb;margin-left:0;padding-left:1em;color:#3f4a63}img{max-width:100%}
</style></head><body>
${editor.getHTML()}
</body></html>`;
}

export function exportText(editor: Editor): string {
  return editor.getText({ blockSeparator: "\n\n" });
}
