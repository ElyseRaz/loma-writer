import { LomaWordmark } from "../layout/LomaLogo";
import { Hash, Info, Link as LinkIcon, Palette, Save, Settings, TriangleAlert, Type, Keyboard, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { FONT_FAMILIES, FONT_SIZES, useCommandMap } from "../../editor/commands";
import { useLomaEditor } from "../../editor/EditorProvider";
import { useEditorSnapshot } from "../../editor/useEditorSnapshot";
import { useActions } from "../../state/actions";
import { THEME_LABELS, useApp } from "../../state/store";
import { marginsPx, pageDimensions, type ThemeMode } from "../../state/types";
import { pxToCm } from "../../services/documents/page";
import { Button, Dialog, Kbd, Switch } from "../ui/Dialog";

// ---------- Préférences ----------
const SECTIONS = [
  { id: "appearance", label: "Apparence", icon: Palette },
  { id: "editing", label: "Édition", icon: Type },
  { id: "autosave", label: "Sauvegarde auto", icon: Save },
  { id: "shortcuts", label: "Raccourcis", icon: Keyboard },
] as const;

export function PreferencesDialog() {
  const { state, set } = useApp();
  const cmds = useCommandMap();
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("appearance");
  const [theme, setTheme] = useState<ThemeMode>(state.theme);
  const [prefs, setPrefs] = useState(state.prefs);
  const close = () => set({ dialog: null });
  const apply = () => set({ theme, prefs, dialog: null });
  const shortcuts = useMemo(() => Object.values(cmds).filter((c) => c.shortcut), [cmds]);

  return (
    <Dialog
      title="Préférences de Loma Writer"
      icon={Settings}
      onClose={close}
      width={720}
      backdropClose={false}
      footer={
        <>
          <Button onClick={close}>Annuler</Button>
          <Button variant="primary" onClick={apply}><Check size={14} /> Enregistrer les modifications</Button>
        </>
      }
    >
      <div className="flex h-[400px]">
        <nav className="w-[190px] shrink-0 border-r border-line p-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn("mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-[13px] hover:bg-hover", section === s.id && "bg-accent-soft font-medium text-accent hover:bg-accent-soft")}
            >
              <s.icon size={15} /> {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {section === "appearance" && (
            <>
              <h3 className="mb-3 text-[14px] font-semibold">Thème de l'interface</h3>
              <div className="grid grid-cols-3 gap-3">
                {(["light", "dark", "system"] as ThemeMode[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    aria-pressed={theme === t}
                    className={cn("rounded-lg border p-2 text-[12px] hover:bg-hover", theme === t ? "border-accent ring-1 ring-accent" : "border-line")}
                  >
                    <div
                      className="mb-2 h-14 rounded-md border border-black/10 p-2"
                      style={{ background: t === "light" ? "#fff" : t === "dark" ? "#1f1f1f" : "linear-gradient(105deg,#fff 50%,#1f1f1f 50%)" }}
                    >
                      <div className="mb-1 h-2 rounded-sm bg-[#2563eb]" />
                      <div className="h-1.5 w-2/3 rounded-sm bg-gray-400/60" />
                    </div>
                    {THEME_LABELS[t]}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-muted">« Système » suit la préférence claire/sombre de votre environnement de bureau.</p>
            </>
          )}
          {section === "editing" && (
            <>
              <h3 className="text-[14px] font-semibold">Police et corps par défaut</h3>
              <p className="mb-3 text-[12px] text-muted">S'applique au texte sans mise en forme explicite.</p>
              <div className="flex gap-3">
                <label className="flex-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                  Famille typographique
                  <select value={prefs.fontFamily} onChange={(e) => setPrefs({ ...prefs, fontFamily: e.target.value })} className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] normal-case tracking-normal text-fg">
                    {FONT_FAMILIES.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </label>
                <label className="w-24 text-[11px] font-medium uppercase tracking-wide text-muted">
                  Taille
                  <select value={prefs.fontSizePt} onChange={(e) => setPrefs({ ...prefs, fontSizePt: Number(e.target.value) })} className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] normal-case tracking-normal text-fg">
                    {FONT_SIZES.map((n) => <option key={n} value={n}>{n} pt</option>)}
                  </select>
                </label>
              </div>
            </>
          )}
          {section === "autosave" && (
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h3 className="text-[14px] font-semibold">Récupération de brouillon</h3>
                <p className="text-[12px] text-muted">Conserve localement les modifications non enregistrées et les restaure au prochain démarrage. N'écrase jamais votre fichier.</p>
              </div>
              <Switch checked={prefs.autosave} onChange={(autosave) => setPrefs({ ...prefs, autosave })} label="Récupération de brouillon" />
            </div>
          )}
          {section === "shortcuts" && (
            <table className="w-full text-[12.5px]">
              <tbody>
                {shortcuts.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="py-1.5">{c.label}</td>
                    <td className="py-1.5 text-right"><Kbd>{c.shortcut}</Kbd></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---------- À propos ----------
export function AboutDialog() {
  const { set } = useApp();
  return (
    <Dialog title="À propos de Loma Writer" icon={Info} onClose={() => set({ dialog: null })} width={440} footer={<Button variant="primary" onClick={() => set({ dialog: null })}>Fermer</Button>}>
      <div className="space-y-3 p-5 text-[13px]">
        <div className="flex justify-center rounded-md bg-white py-2"><LomaWordmark height={64} /></div>
        <p className="text-[15px] font-semibold">Loma Writer 0.1.0</p>
        <p className="text-muted">Traitement de texte de bureau pour Linux. React · TypeScript · Tauri 2 · TipTap/ProseMirror.</p>
        <p className="rounded-md bg-chrome p-3 text-[12px] text-muted">
          Première étape : interface et édition. Pagination automatique, import/export DOCX et PDF natifs, en-têtes, pieds de page et images avancées arrivent ensuite. Les commandes marquées « Bientôt » ne sont pas encore actives.
        </p>
      </div>
    </Dialog>
  );
}

// ---------- Lien ----------
export function LinkDialog() {
  const editor = useLomaEditor();
  const { set } = useApp();
  const [url, setUrl] = useState(() => (editor?.getAttributes("link").href as string | undefined) ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const close = () => set({ dialog: null });
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const href = url.trim();
    if (!editor) return;
    if (!href) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else {
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
      if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) return setError("Seuls les liens http, https, mailto et tel sont autorisés.");
      if (!scheme && /\s/.test(href)) return setError("Cette adresse n'est pas valide.");
      const safe = scheme ? href : `https://${href}`;
      if (editor.state.selection.empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href: safe } }] }).run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
    }
    close();
  };
  return (
    <Dialog
      title="Lien hypertexte"
      icon={LinkIcon}
      onClose={close}
      width={460}
      footer={
        <>
          {editor?.isActive("link") && <Button className="mr-auto" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); close(); }}>Supprimer le lien</Button>}
          <Button onClick={close}>Annuler</Button>
          <Button variant="primary" onClick={apply}>Appliquer</Button>
        </>
      }
    >
      <label className="block p-5 text-[11px] font-medium uppercase tracking-wide text-muted">
        Adresse
        <input
          ref={input} value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && apply()}
          aria-invalid={error !== null} aria-describedby={error ? "link-error" : undefined}
          placeholder="https://exemple.org" autoFocus
          className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        {error && <span id="link-error" role="alert" className="mt-1.5 block text-[12px] normal-case tracking-normal text-danger">{error}</span>}
      </label>
    </Dialog>
  );
}

// ---------- Statistiques ----------
export function WordCountDialog() {
  const editor = useLomaEditor();
  const snap = useEditorSnapshot(editor);
  const { set } = useApp();
  const text = editor?.getText() ?? "";
  const noSpaces = text.replace(/\s/g, "").length;
  const paragraphs = editor ? (() => { let n = 0; editor.state.doc.descendants((node) => { if (node.isTextblock && node.textContent.trim()) n++; }); return n; })() : 0;
  const rows: Array<[string, number]> = [
    ["Mots", snap.words],
    ["Caractères (espaces compris)", snap.characters],
    ["Caractères (sans espaces)", noSpaces],
    ["Paragraphes", paragraphs],
  ];
  return (
    <Dialog title="Statistiques du document" icon={Hash} onClose={() => set({ dialog: null })} width={380} footer={<Button variant="primary" onClick={() => set({ dialog: null })}>Fermer</Button>}>
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-line last:border-0"><td className="px-5 py-2.5">{k}</td><td className="px-5 py-2.5 text-right font-medium tabular-nums">{v}</td></tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

// ---------- Modifications non enregistrées ----------
export function UnsavedDialog() {
  const { state, set } = useApp();
  const actions = useActions();
  const close = () => set({ dialog: null, pendingAction: null });
  const proceed = () => {
    const next = state.pendingAction;
    set({ dialog: null, pendingAction: null });
    next?.();
  };
  return (
    <Dialog
      title="Modifications non enregistrées"
      icon={TriangleAlert}
      onClose={close}
      width={460}
      footer={
        <>
          <Button onClick={close}>Annuler</Button>
          <Button onClick={proceed}>Ne pas enregistrer</Button>
          <Button variant="primary" onClick={async () => { if (await actions.save()) proceed(); }}>Enregistrer</Button>
        </>
      }
    >
      <p className="p-5 text-[13px]">« {state.doc.title} » contient des modifications qui seront perdues si vous continuez.</p>
    </Dialog>
  );
}

// ---------- Rapport d'importation ----------
export function ImportReportDialog() {
  const { state, set } = useApp();
  const report = state.importReport;
  const close = () => set({ dialog: null });
  return (
    <Dialog title="Importation avec avertissements" icon={TriangleAlert} onClose={close} width={520} footer={<Button variant="primary" onClick={close}>Compris</Button>}>
      <div className="space-y-3 p-5 text-[13px]">
        <p>« {report?.name} » a été ouvert, mais Loma Writer ne sait pas encore reproduire fidèlement :</p>
        <ul className="list-disc space-y-1 pl-5 text-[12.5px]">
          {report?.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
        <p className="text-[12px] text-muted">Le fichier d'origine n'est pas modifié tant que vous n'enregistrez pas. Si vous enregistrez par-dessus, ces éléments seront perdus : Loma Writer vous le redemandera.</p>
      </div>
    </Dialog>
  );
}

// ---------- Enregistrer par-dessus un fichier partiellement importé ----------
export function LossySaveDialog() {
  const { state, set } = useApp();
  const actions = useActions();
  const close = () => set({ dialog: null });
  return (
    <Dialog
      title="Éléments non conservés"
      icon={TriangleAlert}
      onClose={close}
      width={520}
      footer={
        <>
          <Button onClick={close}>Annuler</Button>
          <Button onClick={() => { set({ dialog: null }); void actions.saveAs(); }}>Enregistrer sous…</Button>
          <Button variant="primary" onClick={() => { set({ dialog: null }); void actions.save(true); }}>Enregistrer quand même</Button>
        </>
      }
    >
      <div className="space-y-3 p-5 text-[13px]">
        <p>Enregistrer par-dessus « {state.doc.title}.{state.doc.format} » supprimera définitivement des éléments que Loma Writer n'a pas pu importer :</p>
        <ul className="list-disc space-y-1 pl-5 text-[12.5px]">
          {state.doc.lossy.map((w) => <li key={w}>{w}</li>)}
        </ul>
        <p className="text-[12px] text-muted">Conseil : « Enregistrer sous… » conserve l'original intact.</p>
      </div>
    </Dialog>
  );
}

// ---------- Marges personnalisées ----------
export function MarginsDialog() {
  const { state, set } = useApp();
  const current = marginsPx(state.page);
  const [cm, setCm] = useState({ top: pxToCm(current.top), right: pxToCm(current.right), bottom: pxToCm(current.bottom), left: pxToCm(current.left) });
  const { w, h } = pageDimensions(state.page);
  const close = () => set({ dialog: null });
  const field = (k: keyof typeof cm) => (
    <label key={k} className="text-[11px] font-medium uppercase tracking-wide text-muted">
      {{ top: "Haut", bottom: "Bas", left: "Gauche", right: "Droite" }[k]}
      <div className="relative mt-1">
        <input type="number" min={0} max={10} step={0.1} value={cm[k]} onChange={(e) => setCm({ ...cm, [k]: e.target.valueAsNumber })}
          className="h-8 w-full rounded-md border border-line bg-surface px-2 pr-8 text-[13px] normal-case tracking-normal text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] normal-case text-muted">cm</span>
      </div>
    </label>
  );
  const valid = Object.values(cm).every((v) => Number.isFinite(v) && v >= 0 && v <= 10);
  // The text area must keep a usable size.
  const textW = pxToCm(w) - cm.left - cm.right;
  const textH = pxToCm(h) - cm.top - cm.bottom;
  const usable = valid && textW >= 3 && textH >= 3;
  const apply = () => {
    set((s) => ({ page: { ...s.page, margins: "custom", customMarginsCm: { ...cm } }, doc: { ...s.doc, dirty: true }, dialog: null }));
  };
  return (
    <Dialog title="Marges personnalisées" icon={Settings} onClose={close} width={420} footer={<><Button onClick={close}>Annuler</Button><Button variant="primary" disabled={!usable} onClick={apply}>Appliquer</Button></>}>
      <div className="grid grid-cols-2 gap-3 p-5">
        {(["top", "bottom", "left", "right"] as const).map(field)}
        {!usable && <p role="alert" className="col-span-2 text-[12px] text-danger">{valid ? "La zone de texte doit mesurer au moins 3 cm de large et de haut." : "Chaque marge doit être comprise entre 0 et 10 cm."}</p>}
      </div>
    </Dialog>
  );
}
