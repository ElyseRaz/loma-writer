import { useEditorState, type Editor } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, BringToFront, Group, PaintBucket, PenLine, SendToBack, Trash2, Ungroup, Layers, Sparkles } from "lucide-react";
import { SHAPE_CATEGORIES, SHAPES, NONE, isTextBox } from "../../editor/shapes/catalog";
import { findObject, MIN_SIZE, multiSelection, type GroupAttrs, type ShapeAttrs } from "../../editor/shapes/Shape";
import { WRAP_LABELS, type Gradient, type Shadow, type Wrap } from "../../editor/shapes/types";
import { pxToCm } from "../../services/documents/page";
import { cmToPx } from "../../state/types";
import { RibbonButton } from "../ui/RibbonButton";
import { DropdownButton } from "../ui/Dropdown";
import { RibbonSeparator } from "../ribbon/RibbonParts";

const FILLS = ["#bfdbfe", "#bbf7d0", "#fef08a", "#fecaca", "#e9d5ff", "#e5e7eb", "#ffffff", "#2563eb", "#16a34a", "#dc2626", "#242424"];
const STROKES = ["#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed", "#6b7280", "#242424", "#ffffff"];
const DEFAULT_GRADIENT: Gradient = { type: "linear", angle: 90, stops: [{ pos: 0, color: "#bfdbfe" }, { pos: 100, color: "#2563eb" }] };
const DEFAULT_SHADOW: Shadow = { color: "#000000", opacity: 0.35, blur: 8, dx: 4, dy: 4 };

function Swatches({ colors, none, onPick }: { colors: string[]; none: string; onPick: (c: string) => void }) {
  return (
    <div className="w-[176px] p-1.5">
      <div className="grid grid-cols-6 gap-1.5">
        {colors.map((c) => <button key={c} aria-label={c} title={c} onClick={() => onPick(c)} style={{ background: c }} className="h-6 w-6 rounded border border-black/15 hover:scale-105" />)}
      </div>
      <button onClick={() => onPick(NONE)} className="mt-2 h-7 w-full rounded-md text-[12px] hover:bg-hover">{none}</button>
    </div>
  );
}

const num = "h-6 w-14 rounded border border-line bg-surface px-1 text-right text-[12px] text-fg outline-none focus:border-accent";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="flex items-center gap-1 text-[11px] text-muted">{label}{children}</label>;

/** Contextual tools, shown while the caret is in a shape, a text box or a group. */
export function ShapeToolbar({ editor }: { editor: Editor }) {
  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const f = findObject(e.state);
      const picked = multiSelection(e.state).length;
      if (!f && picked < 2) return null;
      const inGroup = !!f && e.state.doc.resolve(f.pos).parent.type.name === "shapeGroup";
      return { type: f?.node.type.name ?? null, attrs: (f?.node.attrs ?? null) as (ShapeAttrs & GroupAttrs) | null, inGroup, picked };
    },
  });
  if (!info) return null;
  const a = info.attrs;
  const isShape = info.type === "shape";
  const box = isShape && !!a && isTextBox(a.kind);
  const update = (attrs: Partial<ShapeAttrs>) => editor.chain().focus().updateShape(attrs).run();
  const cm = (axis: "width" | "height" | "x" | "y", label: string, aria: string) => a && (
    <Field label={label}>
      <input type="number" step={0.1} aria-label={aria} value={+pxToCm(a[axis]).toFixed(1)} className={num}
        onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) { const px = cmToPx(v); if ((axis === "width" || axis === "height") ? px >= MIN_SIZE : true) update({ [axis]: px }); } }} />
      cm
    </Field>
  );
  const floating = !!a && (a.wrap === "front" || a.wrap === "behind" || a.wrap === "square" || a.wrap === "topBottom") && !info.inGroup;
  const gradient = a?.gradient ?? null;
  const setGradient = (g: Gradient | null) => update({ gradient: g });

  return (
    <div className="sticky top-5 z-20 mx-auto -mb-1 mt-2 flex w-fit max-w-[98%] flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border border-line bg-surface px-2 py-1 shadow-pop" role="toolbar" aria-label="Forme">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-accent">{info.type === "shapeGroup" ? "Groupe" : box ? "Zone de texte" : isShape ? "Forme" : "Sélection"}</span>
      {info.picked >= 2 && (
        <RibbonButton icon={Group} size="sm" label={`Grouper (${info.picked})`} title="Grouper les formes sélectionnées (elles doivent se suivre dans le document)" onClick={() => editor.chain().focus().groupShapes().run()} />
      )}
      {a && (
        <>
          {isShape && !box && (
            <select aria-label="Type de forme" value={a.kind} onChange={(e) => update({ kind: e.target.value })} className="h-6 rounded border border-line bg-surface px-1 text-[12px]">
              {SHAPE_CATEGORIES.map((cat) => <optgroup key={cat} label={cat}>{SHAPES.filter((s) => s.category === cat).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>)}
            </select>
          )}
          {isShape && (
            <>
              <RibbonSeparator />
              <DropdownButton icon={PaintBucket} title="Remplissage" panel={(close) => (
                <div className="w-[216px] p-1.5">
                  <Swatches colors={FILLS} none="Sans remplissage" onPick={(c) => { close(); update({ fill: c, gradient: null }); }} />
                  <div className="mt-1 border-t border-line pt-2">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Dégradé</div>
                    <div className="flex items-center gap-1.5">
                      <select aria-label="Type de dégradé" value={gradient?.type ?? "off"} onChange={(e) => setGradient(e.target.value === "off" ? null : { ...(gradient ?? DEFAULT_GRADIENT), type: e.target.value as "linear" | "radial" })} className="h-6 rounded border border-line bg-surface px-1 text-[12px]">
                        <option value="off">Aucun</option><option value="linear">Linéaire</option><option value="radial">Radial</option>
                      </select>
                      <input type="color" aria-label="Couleur de début" value={gradient?.stops[0].color ?? "#bfdbfe"} onChange={(e) => setGradient({ ...(gradient ?? DEFAULT_GRADIENT), stops: [{ pos: 0, color: e.target.value }, ...(gradient ?? DEFAULT_GRADIENT).stops.slice(1)] })} className="h-6 w-7 cursor-pointer rounded border border-line bg-transparent p-0" />
                      <input type="color" aria-label="Couleur de fin" value={gradient?.stops.at(-1)?.color ?? "#2563eb"} onChange={(e) => setGradient({ ...(gradient ?? DEFAULT_GRADIENT), stops: [...(gradient ?? DEFAULT_GRADIENT).stops.slice(0, -1), { pos: 100, color: e.target.value }] })} className="h-6 w-7 cursor-pointer rounded border border-line bg-transparent p-0" />
                    </div>
                    {gradient?.type === "linear" && (
                      <Field label="Angle"><input type="number" min={0} max={359} aria-label="Angle du dégradé" value={Math.round(gradient.angle)} onChange={(e) => setGradient({ ...gradient, angle: e.target.valueAsNumber || 0 })} className={num} />°</Field>
                    )}
                  </div>
                </div>
              )}>
                <span className="absolute bottom-0.5 left-1.5 right-1.5 h-[3px] rounded-full border border-black/10" style={{ background: gradient ? `linear-gradient(90deg, ${gradient.stops[0].color}, ${gradient.stops.at(-1)!.color})` : a.fill === NONE ? "transparent" : a.fill }} />
              </DropdownButton>
              <DropdownButton icon={PenLine} title="Contour" panel={(close) => <Swatches colors={STROKES} none="Sans contour" onPick={(c) => { close(); update({ stroke: c }); }} />}>
                <span className="absolute bottom-0.5 left-1.5 right-1.5 h-[3px] rounded-full border border-black/10" style={{ background: a.stroke === NONE ? "transparent" : a.stroke }} />
              </DropdownButton>
              <select aria-label="Épaisseur du contour" value={a.strokeWidth} onChange={(e) => update({ strokeWidth: +e.target.value })} className="h-6 rounded border border-line bg-surface px-1 text-[12px]">
                {[0.5, 1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} px</option>)}
              </select>
              <DropdownButton icon={Sparkles} title="Ombre" active={!!a.shadow} panel={() => {
                const sh = a.shadow;
                const set = (patch: Partial<Shadow>) => update({ shadow: { ...(sh ?? DEFAULT_SHADOW), ...patch } });
                return (
                  <div className="w-[210px] space-y-1.5 p-2">
                    <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={!!sh} onChange={(e) => update({ shadow: e.target.checked ? DEFAULT_SHADOW : null })} /> Ombre portée</label>
                    {sh && (
                      <>
                        <div className="flex items-center gap-2"><input type="color" aria-label="Couleur de l'ombre" value={sh.color} onChange={(e) => set({ color: e.target.value })} className="h-6 w-7 cursor-pointer rounded border border-line bg-transparent p-0" /><Field label="Opacité"><input type="number" min={0} max={100} aria-label="Opacité de l'ombre" value={Math.round(sh.opacity * 100)} onChange={(e) => set({ opacity: (e.target.valueAsNumber || 0) / 100 })} className={num} />%</Field></div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <Field label="Flou"><input type="number" min={0} aria-label="Flou de l'ombre" value={sh.blur} onChange={(e) => set({ blur: e.target.valueAsNumber || 0 })} className="h-6 w-10 rounded border border-line bg-surface px-1 text-right text-[12px]" /></Field>
                          <Field label="X"><input type="number" aria-label="Décalage horizontal de l'ombre" value={sh.dx} onChange={(e) => set({ dx: e.target.valueAsNumber || 0 })} className="h-6 w-10 rounded border border-line bg-surface px-1 text-right text-[12px]" /></Field>
                          <Field label="Y"><input type="number" aria-label="Décalage vertical de l'ombre" value={sh.dy} onChange={(e) => set({ dy: e.target.valueAsNumber || 0 })} className="h-6 w-10 rounded border border-line bg-surface px-1 text-right text-[12px]" /></Field>
                        </div>
                      </>
                    )}
                  </div>
                );
              }} />
            </>
          )}
          <RibbonSeparator />
          {!info.inGroup && (
            <DropdownButton icon={Layers} size="sm" label="Habillage" title="Habillage du texte et position" items={(Object.keys(WRAP_LABELS) as Array<Exclude<Wrap, "group">>).map((w) => ({ label: WRAP_LABELS[w], checked: a.wrap === w, onSelect: () => update({ wrap: w, ...(w === "front" || w === "behind" ? { x: a.x || 0, y: a.y || 0 } : {}) }) }))} />
          )}
          {cm("width", "L", "Largeur (cm)")}
          {cm("height", box ? "H min." : "H", "Hauteur (cm)")}
          <Field label="Rotation"><input type="number" min={0} max={359} aria-label="Rotation (degrés)" value={Math.round(a.rotation)} onChange={(e) => update({ rotation: e.target.valueAsNumber || 0 })} className="h-6 w-12 rounded border border-line bg-surface px-1 text-right text-[12px] text-fg outline-none focus:border-accent" />°</Field>
          {(floating || info.inGroup) && (
            <>
              {cm("x", "X", "Position horizontale (cm)")}
              {cm("y", "Y", "Position verticale (cm)")}
              {!info.inGroup && (a.wrap === "front" || a.wrap === "behind") && (
                <select aria-label="Position relative à" value={a.anchor} onChange={(e) => update({ anchor: e.target.value as "page" | "paragraph" })} className="h-6 rounded border border-line bg-surface px-1 text-[12px]">
                  <option value="paragraph">/ paragraphe</option><option value="page">/ page</option>
                </select>
              )}
              <RibbonButton icon={BringToFront} title="Avancer" onClick={() => editor.chain().focus().shapeZ(1).run()} />
              <RibbonButton icon={SendToBack} title="Reculer" onClick={() => editor.chain().focus().shapeZ(-1).run()} />
            </>
          )}
          {!floating && !info.inGroup && (
            <>
              <RibbonButton icon={AlignLeft} title="Aligner à gauche" active={a.align === "left"} onClick={() => update({ align: "left" })} />
              <RibbonButton icon={AlignCenter} title="Centrer" active={a.align === "center"} onClick={() => update({ align: "center" })} />
              <RibbonButton icon={AlignRight} title="Aligner à droite" active={a.align === "right"} onClick={() => update({ align: "right" })} />
            </>
          )}
          {(info.type === "shapeGroup" || info.inGroup) && (
            <RibbonButton icon={Ungroup} size="sm" label="Dissocier" title="Dissocier le groupe" onClick={() => editor.chain().focus().ungroupShapes().run()} />
          )}
          <RibbonSeparator />
          <RibbonButton icon={Trash2} title="Supprimer la forme" className="text-danger" onClick={() => editor.chain().focus().deleteShape().run()} />
        </>
      )}
    </div>
  );
}
