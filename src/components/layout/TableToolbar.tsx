import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Table2, Trash2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { RibbonButton } from "../ui/RibbonButton";
import { RibbonSeparator } from "../ribbon/RibbonParts";

/** Contextual tools, shown only while the caret is inside a table. */
export function TableToolbar({ editor }: { editor: Editor }) {
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => fn(editor.chain().focus()).run();
  return (
    <div className="sticky top-5 z-10 mx-auto -mb-1 mt-2 flex w-fit items-center gap-0.5 rounded-lg border border-line bg-surface px-2 py-1 shadow-pop" role="toolbar" aria-label="Outils de tableau">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-accent">Outils de tableau</span>
      <RibbonButton icon={BetweenHorizontalStart} title="Insérer une ligne au-dessus" onClick={run((c) => c.addRowBefore())} />
      <RibbonButton icon={BetweenHorizontalEnd} title="Insérer une ligne en dessous" onClick={run((c) => c.addRowAfter())} />
      <RibbonButton icon={BetweenVerticalStart} title="Insérer une colonne à gauche" onClick={run((c) => c.addColumnBefore())} />
      <RibbonButton icon={BetweenVerticalEnd} title="Insérer une colonne à droite" onClick={run((c) => c.addColumnAfter())} />
      <RibbonSeparator />
      <RibbonButton icon={Table2} title="Activer/désactiver la ligne d'en-tête" onClick={run((c) => c.toggleHeaderRow())} />
      <RibbonButton icon={Trash2} title="Supprimer la ligne" onClick={run((c) => c.deleteRow())} />
      <RibbonButton icon={Trash2} title="Supprimer la colonne" onClick={run((c) => c.deleteColumn())} iconClassName="rotate-90" />
      <RibbonButton icon={Trash2} title="Supprimer le tableau" onClick={run((c) => c.deleteTable())} className="text-danger" />
    </div>
  );
}
