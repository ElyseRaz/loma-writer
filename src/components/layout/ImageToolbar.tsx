import { useEditorState, type Editor } from "@tiptap/react";
import { BringToFront, Layers, Maximize, SendToBack, Trash2 } from "lucide-react";
import { NodeSelection } from "@tiptap/pm/state";
import { cleanPicture, isFloating, MIN_PICTURE, PICTURE_WRAPS, PICTURE_WRAP_LABELS, type PictureAttrs } from "../../editor/ImageView";
import { pxToCm } from "../../services/documents/page";
import { cmToPx } from "../../state/types";
import { RibbonButton } from "../ui/RibbonButton";
import { DropdownButton } from "../ui/Dropdown";
import { RibbonSeparator } from "../ribbon/RibbonParts";

const num = "h-6 w-14 rounded border border-line bg-surface px-1 text-right text-[12px] text-fg outline-none focus:border-accent";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="flex items-center gap-1 text-[11px] text-muted">{label}{children}</label>;

/** Contextual "Image" toolbar, like the shape one: wrap, position, size, rotation, order. Shown while a picture is selected. */
export function ImageToolbar({ editor }: { editor: Editor }) {
  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const sel = e?.state.selection;
      return sel instanceof NodeSelection && sel.node.type.name === "image" ? { pos: sel.from, attrs: sel.node.attrs as PictureAttrs } : null;
    },
  });
  if (!info) return null;
  const a = info.attrs;
  const img = editor.view.nodeDOM(info.pos) as HTMLElement | null;
  const el = img?.querySelector("img");
  const natural = { w: el?.naturalWidth || 200, h: el?.naturalHeight || 150 };
  const aw = a.width ? Number(a.width) : null, ah = a.height ? Number(a.height) : null;
  const cur = { w: aw ?? Math.min(natural.w, 650), h: ah ?? Math.round(((aw ?? Math.min(natural.w, 650)) * natural.h) / natural.w) };
  const update = (patch: Partial<PictureAttrs>) => {
    const next = cleanPicture(patch, a);
    const tr = editor.state.tr.setNodeMarkup(info.pos, undefined, next);
    editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, info.pos)));
    editor.view.focus();
  };
  const cm = (key: "x" | "y", label: string) => (
    <Field label={label}>
      <input type="number" step={0.1} aria-label={`${label === "X" ? "Position horizontale" : "Position verticale"} (cm)`} value={+pxToCm(a[key]).toFixed(1)} className={num}
        onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) update({ [key]: cmToPx(v) }); }} />
      cm
    </Field>
  );
  const dim = (key: "width" | "height", label: string) => (
    <Field label={label}>
      <input type="number" step={0.1} aria-label={`${label === "L" ? "Largeur" : "Hauteur"} de l'image (cm)`} value={+pxToCm(cur[key === "width" ? "w" : "h"]).toFixed(1)} className={num}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          const px = cmToPx(v);
          if (!Number.isFinite(v) || px < MIN_PICTURE) return;
          // Proportions are kept: the other side follows.
          const ratio = cur.h / cur.w;
          update(key === "width" ? { width: px, height: px * ratio } : { height: px, width: px / ratio });
        }} />
      cm
    </Field>
  );
  const z = (d: 1 | -1) => update({ z: a.z + d });
  return (
    <div className="sticky top-5 z-20 mx-auto -mb-1 mt-2 flex w-fit max-w-[98%] flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border border-line bg-surface px-2 py-1 shadow-pop" role="toolbar" aria-label="Image">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-accent">Image</span>
      <DropdownButton icon={Layers} size="sm" label="Habillage" title="Habillage du texte et position"
        items={PICTURE_WRAPS.map((w) => ({ label: PICTURE_WRAP_LABELS[w], checked: a.wrap === w, onSelect: () => update({ wrap: w, ...(w === "front" || w === "behind" ? { x: a.x, y: a.y } : {}) }) }))} />
      {dim("width", "L")}
      {dim("height", "H")}
      <Field label="Rotation"><input type="number" step={5} aria-label="Rotation de l'image (degrés)" value={Math.round(a.rotation)} className={num} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && update({ rotation: e.target.valueAsNumber })} />°</Field>
      {(isFloating(a) || a.wrap === "square") && <><RibbonSeparator />{cm("x", "X")}{cm("y", "Y")}</>}
      {isFloating(a) && <><RibbonButton icon={BringToFront} title="Avancer" onClick={() => z(1)} /><RibbonButton icon={SendToBack} title="Reculer" onClick={() => z(-1)} /></>}
      <RibbonSeparator />
      <RibbonButton icon={Maximize} title="Taille d'origine" onClick={() => update({ width: Math.min(natural.w, 650), height: (Math.min(natural.w, 650) * natural.h) / natural.w, rotation: 0 })} />
      <RibbonButton icon={Trash2} title="Supprimer l'image" className="text-danger" onClick={() => editor.chain().focus().deleteSelection().run()} />
    </div>
  );
}
