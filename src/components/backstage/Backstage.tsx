import { ArrowLeft, FileCode, FilePlus2, FileText, FolderOpen, Home, Info, Printer, Save, SaveAll, Search, Settings, Plus, FileType } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { TEMPLATES, type DocumentTemplate } from "../../editor/templates";
import { useCommandMap } from "../../editor/commands";
import { useActions } from "../../state/actions";
import { useApp } from "../../state/store";
import { dirName } from "../../services/files";
import { forgetRecent, loadRecent, type RecentFile } from "../../services/recent";
import { LomaLogo } from "../layout/LomaLogo";
import { Kbd } from "../ui/Dialog";

function NavItem({ icon: Icon, label, shortcut, onClick, active }: { icon: typeof Home; label: string; shortcut?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] transition-colors hover:bg-hover", active && "bg-surface font-medium text-accent shadow-sm hover:bg-surface")}
    >
      <Icon size={16} strokeWidth={1.7} />
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}

/** Miniature page preview for a template card. */
function Thumb({ t }: { t: DocumentTemplate }) {
  if (t.id === "blank") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-accent">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white dark:text-[#0b1220]"><Plus size={24} /></span>
        <span className="text-[12px] font-medium">Créer</span>
        <span className="rounded bg-surface px-1.5 text-[10px] font-medium uppercase text-muted">.docx</span>
      </div>
    );
  }
  const bar = "h-1.5 rounded-full bg-muted/40";
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className={cn("h-2 w-1/2 rounded-full", t.id === "letter" ? "ml-auto bg-muted/50" : "bg-accent")} />
      <div className="mt-1 flex flex-col gap-1.5"><div className={bar} /><div className={cn(bar, "w-5/6")} /><div className={cn(bar, "w-2/3")} /></div>
      {t.id !== "letter" && <div className="mt-1 h-2 w-2/5 rounded-full bg-muted/60" />}
      <div className="flex flex-col gap-1.5"><div className={bar} /><div className={cn(bar, "w-3/4")} /></div>
    </div>
  );
}

export function Backstage() {
  const { state, set } = useApp();
  const actions = useActions();
  const cmds = useCommandMap();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<RecentFile[]>(loadRecent);

  const q = query.trim().toLowerCase();
  const templates = useMemo(() => TEMPLATES.filter((t) => !q || `${t.name} ${t.category}`.toLowerCase().includes(q)), [q]);
  const recents = useMemo(() => recent.filter((r) => !q || `${r.name} ${r.path}`.toLowerCase().includes(q)), [recent, q]);
  const back = () => set({ view: "editor" });
  const openRecent = (r: RecentFile) => {
    actions.openDocument(r.path);
    // A moved/deleted file raises a toast from openDocument; keep the list honest on next visit.
    setTimeout(() => setRecent(loadRecent()), 400);
  };
  const run = (id: string) => () => { cmds[id]?.run(); };

  return (
    <div className="flex min-h-0 flex-1 bg-surface">
      <aside className="flex w-[256px] shrink-0 flex-col gap-0.5 border-r border-line bg-chrome p-3">
        <div className="mb-3 flex items-center gap-3 px-1">
          <button onClick={back} aria-label="Retour au document" title="Retour au document" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-accent shadow-sm hover:bg-hover">
            <ArrowLeft size={17} />
          </button>
          <div>
            <div className="text-[15px] font-semibold leading-5">Loma Writer</div>
            <div className="text-[11px] text-muted">Édition Document</div>
          </div>
        </div>
        <NavItem icon={Home} label="Accueil" active />
        <NavItem icon={FilePlus2} label="Nouveau (.docx)" shortcut="Ctrl+N" onClick={run("file.new")} />
        <NavItem icon={FolderOpen} label="Ouvrir" shortcut="Ctrl+O" onClick={run("file.open")} />
        <div className="my-2 h-px bg-line" />
        <NavItem icon={Save} label="Enregistrer" shortcut="Ctrl+S" onClick={run("file.save")} />
        <NavItem icon={SaveAll} label="Enregistrer sous… (DOCX, ODT, DOC)" onClick={run("file.saveAs")} />
        <NavItem icon={FileCode} label="Exporter en HTML" onClick={run("file.exportHtml")} />
        <NavItem icon={FileText} label="Exporter en texte" onClick={run("file.exportTxt")} />
        <NavItem icon={FileType} label="Exporter en PDF (impression)" onClick={run("file.print")} />
        <NavItem icon={Printer} label="Imprimer" shortcut="Ctrl+P" onClick={run("file.print")} />
        <div className="my-2 h-px bg-line" />
        <NavItem icon={Settings} label="Paramètres" onClick={run("app.preferences")} />
        <NavItem icon={Info} label="À propos" onClick={run("app.about")} />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[980px] px-10 py-9">
          <div className="flex items-start gap-6">
            <div className="flex-1">
              <h1 className="flex items-center gap-3 whitespace-nowrap text-[26px] font-bold leading-9 tracking-[-0.02em]"><LomaLogo size={28} />Bienvenue dans Loma Writer</h1>
              <p className="mt-1 max-w-[460px] text-[13px] text-muted">Créez un nouveau document ou reprenez là où vous vous étiez arrêté.</p>
            </div>
            <label className="flex h-10 w-[240px] shrink-0 items-center gap-2 rounded-lg bg-chrome px-3 text-muted focus-within:ring-2 focus-within:ring-accent/40">
              <Search size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher modèles ou documents…" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted" />
            </label>
            <button onClick={run("file.open")} className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-white shadow-sm hover:brightness-110 dark:text-[#0b1220]">
              <FolderOpen size={15} /> Parcourir… <span className="text-[10px] opacity-80">Ctrl+O</span>
            </button>
          </div>

          <h2 className="mb-4 mt-9 text-[17px] font-semibold">Nouveau document</h2>
          {templates.length === 0 ? (
            <p className="text-[13px] text-muted">Aucun modèle ne correspond.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-4">
              {templates.map((t) => (
                <button key={t.id} onClick={() => actions.newDocument(t)} className="group text-center">
                  <div className="relative h-[176px] overflow-hidden rounded-lg bg-chrome shadow-sm ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent">
                    <Thumb t={t} />
                    {t.category && <span className="absolute bottom-2 left-3 text-[10px] uppercase tracking-wide text-muted">{t.category}</span>}
                  </div>
                  <div className="mt-2 text-[13px] font-medium">{t.name}</div>
                </button>
              ))}
            </div>
          )}

          <h2 className="mb-3 mt-10 text-[17px] font-semibold">Documents récents</h2>
          {recents.length === 0 ? (
            <p className="rounded-lg bg-chrome px-4 py-6 text-center text-[13px] text-muted">
              {recent.length === 0 ? "Les documents Loma Writer que vous enregistrez ou ouvrez apparaîtront ici." : "Aucun document ne correspond."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg ring-1 ring-line">
              <div className="grid grid-cols-[1.2fr_1.6fr_150px] bg-chrome px-4 py-2 text-[11px] font-medium text-muted">
                <span>Nom du document</span><span>Emplacement</span><span className="text-right">Dernière ouverture</span>
              </div>
              {recents.map((r) => (
                <button key={r.path} onClick={() => openRecent(r)} onContextMenu={(e) => { e.preventDefault(); setRecent(forgetRecent(r.path)); }} title="Clic droit : retirer de la liste" className="grid w-full grid-cols-[1.2fr_1.6fr_150px] items-center border-t border-line px-4 py-2.5 text-left text-[13px] hover:bg-hover">
                  <span className="flex items-center gap-3 truncate"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-white dark:text-[#0b1220]"><FileText size={15} /></span><span className="truncate font-medium">{r.name}</span><span className="shrink-0 rounded bg-chrome px-1.5 text-[10px] font-semibold uppercase text-muted">{r.format ?? r.name.split(".").pop()}</span></span>
                  <span className="truncate text-[12px] text-muted">{dirName(r.path)}</span>
                  <span className="text-right text-[12px] text-muted">{new Date(r.openedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
                </button>
              ))}
            </div>
          )}
          {state.doc.dirty && <p className="mt-6 text-[12px] text-muted">Un document modifié est ouvert : « {state.doc.title} ».</p>}
        </div>
      </main>
    </div>
  );
}
