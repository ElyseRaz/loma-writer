import { BookOpenText, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { useLomaEditor } from "../../editor/EditorProvider";
import { sourcesOf } from "../../editor/references/Citations";
import { cleanSource, newTag, SOURCE_TYPES, type Person, type Source } from "../../editor/references/sources";
import { useApp } from "../../state/store";
import { Button, Dialog } from "../ui/Dialog";

const field = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const lbl = "block text-[11px] font-medium uppercase tracking-wide text-muted";

const blank = (): Source => ({ tag: "", type: "book", authors: [], title: "", year: "", publisher: "", city: "", volume: "", pages: "", url: "" });
const authorsToText = (a: Person[]) => a.map((p) => (p.first ? `${p.last}, ${p.first}` : p.last)).join("\n");
const textToAuthors = (t: string): Person[] => t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [last, ...rest] = l.split(","); return { last: last.trim(), first: rest.join(",").trim() }; });
const label = (s: Source) => `${s.authors[0]?.last ?? "(sans auteur)"}${s.year ? `, ${s.year}` : ""} — ${s.title || "(sans titre)"}`;

/** "Gérer les sources" : the bibliographic sources of the document (what citations and the bibliography are written from). */
export function SourcesDialog() {
  const editor = useLomaEditor();
  const { state, set } = useApp();
  const [list, setList] = useState<Source[]>(() => (editor ? sourcesOf(editor.state.doc) : []));
  const startNew = state.sourceEdit === "__new";
  const [selected, setSelected] = useState<string | null>(() => (startNew ? null : state.sourceEdit ?? list[0]?.tag ?? null));
  const [draft, setDraft] = useState<Source>(() => (startNew || !(state.sourceEdit ?? list[0]) ? blank() : { ...(list.find((s) => s.tag === (state.sourceEdit ?? list[0]?.tag)) ?? blank()) }));
  const [authorsText, setAuthorsText] = useState(() => authorsToText(draft.authors));
  const isNew = selected === null;
  const candidate = useMemo(() => cleanSource({ ...draft, tag: draft.tag || newTag(list.filter((s) => s.tag !== selected), { authors: textToAuthors(authorsText), year: draft.year, title: draft.title }), authors: textToAuthors(authorsText) }), [draft, authorsText, list, selected]);
  const valid = !!candidate && (candidate.title || candidate.authors.length > 0);
  const close = () => set({ dialog: null, sourceEdit: null });
  const pick = (tag: string | null) => {
    setSelected(tag);
    const s = tag ? list.find((x) => x.tag === tag) ?? blank() : blank();
    setDraft({ ...s });
    setAuthorsText(authorsToText(s.authors));
  };
  const commit = (): Source[] | null => {
    if (!candidate || !valid) return list;
    const next = isNew ? [...list, candidate] : list.map((s) => (s.tag === selected ? { ...candidate, tag: s.tag } : s));
    setList(next);
    setSelected(isNew ? candidate.tag : selected);
    return next;
  };
  const save = () => {
    const next = commit();
    if (next && editor) editor.chain().focus().setSources(next).run();
    set((s) => ({ dialog: null, sourceEdit: null, doc: { ...s.doc, dirty: true } }));
  };
  const remove = () => {
    if (isNew) return;
    const next = list.filter((s) => s.tag !== selected);
    setList(next);
    pick(next[0]?.tag ?? null);
  };
  const text = (key: keyof Source, name: string, width = "") => (
    <label className={cn(lbl, width)}>{name}<input value={String(draft[key] ?? "")} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className={cn(field, "mt-1 normal-case tracking-normal text-fg")} /></label>
  );
  return (
    <Dialog title="Gérer les sources" icon={BookOpenText} onClose={close} width={760}
      footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" onClick={save} disabled={!valid && !isNew && false}>Enregistrer</Button></>}>
      <div className="grid grid-cols-[230px_1fr] gap-0">
        <div className="flex max-h-[420px] flex-col border-r border-line">
          <div className="flex-1 overflow-y-auto p-2">
            {list.length === 0 && <p className="px-2 py-3 text-[12px] text-muted">Aucune source. Remplissez le formulaire pour ajouter la première.</p>}
            {list.map((s) => (
              <button key={s.tag} onClick={() => { commit(); pick(s.tag); }} className={cn("mb-0.5 block w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-hover", selected === s.tag && "bg-accent-soft text-accent")} title={label(s)}>{label(s)}</button>
            ))}
          </div>
          <div className="flex gap-1 border-t border-line p-2">
            <Button onClick={() => { commit(); pick(null); }}><Plus size={13} /> Nouvelle</Button>
            <Button onClick={remove} disabled={isNew}><Trash2 size={13} /> Supprimer</Button>
          </div>
        </div>
        <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>Type
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Source["type"] })} className={cn(field, "mt-1 normal-case tracking-normal text-fg")}>
                {SOURCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {text("year", "Année")}
          </div>
          <label className={lbl}>Auteurs (un par ligne : Nom, Prénom)
            <textarea value={authorsText} onChange={(e) => setAuthorsText(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface p-2 text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </label>
          {text("title", "Titre")}
          <div className="grid grid-cols-2 gap-3">
            {text("publisher", draft.type === "article" ? "Revue" : draft.type === "web" ? "Site" : "Éditeur")}
            {text("city", "Lieu d'édition")}
            {text("volume", "Volume / numéro")}
            {text("pages", "Pages")}
          </div>
          {text("url", "Adresse web (https://…)")}
          {!valid && <p role="alert" className="text-[12px] text-danger">Indiquez au moins un auteur ou un titre.</p>}
          <p className="text-[12px] text-muted">Nom court de la source : <b className="text-fg">{candidate?.tag ?? "…"}</b>. Le style des citations se choisit dans l'onglet Références.</p>
        </div>
      </div>
    </Dialog>
  );
}
