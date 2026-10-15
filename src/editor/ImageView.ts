import { placeInSheets, sheetIndexAt, stackSheets } from "../pagination/pageLayout";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { placeFloating } from "./shapes/Shape";

/** Wrap modes of a picture (a subset of the shapes' ones). */
export type PictureWrap = "inline" | "square" | "front" | "behind";
export const PICTURE_WRAPS: PictureWrap[] = ["inline", "square", "front", "behind"];
export const PICTURE_WRAP_LABELS: Record<PictureWrap, string> = { inline: "En ligne avec le texte", square: "Carré", front: "Devant le texte", behind: "Derrière le texte" };
export const MIN_PICTURE = 16;
export const MAX_PICTURE = 3000;

export interface PictureAttrs {
  src: string;
  alt?: string | null;
  width: number | null;
  height: number | null;
  rotation: number;
  wrap: PictureWrap;
  anchor: "page" | "paragraph";
  x: number;
  y: number;
  z: number;
}

const finite = (v: unknown, d: number) => { const n = typeof v === "string" ? parseFloat(v) : (v as number); return typeof n === "number" && Number.isFinite(n) ? n : d; };
const size = (v: unknown, d: number | null) => { const n = finite(v, NaN); return Number.isNaN(n) ? d : Math.min(MAX_PICTURE, Math.max(MIN_PICTURE, Math.round(n))); };

/** Valid picture attributes from anything (a file, the toolbar, a drag). */
export function cleanPicture(a: Partial<PictureAttrs>, base: PictureAttrs): PictureAttrs {
  return {
    ...base,
    ...a,
    width: size(a.width ?? base.width, null),
    height: size(a.height ?? base.height, null),
    rotation: ((Math.round(finite(a.rotation, base.rotation) * 10) / 10) % 360 + 360) % 360,
    wrap: PICTURE_WRAPS.includes(a.wrap as PictureWrap) ? (a.wrap as PictureWrap) : base.wrap,
    anchor: a.anchor === "paragraph" ? "paragraph" : "page",
    x: Math.round(finite(a.x, base.x)),
    y: Math.round(finite(a.y, base.y)),
    z: Math.min(49, Math.max(-49, Math.round(finite(a.z, base.z)))),
  };
}

export const isFloating = (a: { wrap: PictureWrap }) => a.wrap === "front" || a.wrap === "behind";

/** Attributes stored on the image node, beside src/alt/title/width/height. */
export const pictureAttributes = () => {
  const num = (name: string, def: number) => ({
    default: def,
    parseHTML: (el: HTMLElement) => finite(el.getAttribute(`data-${name}`), def),
    renderHTML: (a: Record<string, unknown>) => (a[name] ? { [`data-${name}`]: String(a[name]) } : {}),
  });
  return {
    rotation: num("rotation", 0),
    x: num("x", 0),
    y: num("y", 0),
    z: num("z", 0),
    wrap: {
      default: "inline",
      parseHTML: (el: HTMLElement) => (PICTURE_WRAPS.includes(el.getAttribute("data-wrap") as PictureWrap) ? el.getAttribute("data-wrap") : "inline"),
      renderHTML: (a: Record<string, unknown>) => (a.wrap && a.wrap !== "inline" ? { "data-wrap": String(a.wrap) } : {}),
    },
    anchor: {
      default: "page",
      parseHTML: (el: HTMLElement) => (el.getAttribute("data-anchor") === "paragraph" ? "paragraph" : "page"),
      renderHTML: (a: Record<string, unknown>) => (a.anchor === "paragraph" ? { "data-anchor": "paragraph" } : {}),
    },
  };
};

const GAP = 12;

/**
 * Node view of pictures: like a shape, a picture can stay in the text, wrap the text, or float in front of / behind it; it is moved,
 * resized and rotated with handles, and the shape toolbar-like "Image" toolbar edits the same settings.
 */
export function pictureView({ node: initial, getPos, editor }: { node: PMNode; getPos: () => number | undefined; editor: Editor }) {
  let node = initial;
  const anchor = document.createElement("span");
  anchor.className = "img-anchor";
  const box = document.createElement("span");
  box.className = "img-box";
  const img = document.createElement("img");
  img.draggable = false;
  const mk = (cls: string, title: string) => {
    const h = document.createElement("span");
    h.className = cls;
    h.contentEditable = "false";
    h.title = title;
    return h;
  };
  // Eight handles, like Word: the four corners (proportions kept, Maj frees them) and the four sides (one dimension each).
  const DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
  const handles = DIRS.map((d) => { const h = mk(`img-handle img-h-${d}`, d.length === 2 ? "Redimensionner (Maj : sans garder les proportions)" : "Redimensionner ce côté"); h.dataset.dir = d; return h; });
  const rotate = mk("img-rotate", "Faire pivoter (Maj : par pas de 15°)");
  const move = mk("img-move", "Sélectionner (clic) ou déplacer (glisser)");
  box.append(img, ...handles, rotate, move);
  anchor.append(box);

  const attrs = () => node.attrs as PictureAttrs;
  const natural = () => ({ w: img.naturalWidth || 200, h: img.naturalHeight || 150 });
  const dims = (a: PictureAttrs) => {
    const n = natural();
    // Attributes read from HTML or older documents may be strings.
    const aw = size(a.width, null), ah = size(a.height, null);
    const w = aw ?? (ah ? (ah * n.w) / n.h : Math.min(n.w, 650));
    return { w, h: ah ?? (aw ? (aw * n.h) / n.w : (w * n.h) / n.w) };
  };

  const layout = (a: PictureAttrs) => {
    const { w, h } = dims(a);
    anchor.dataset.wrap = a.wrap;
    anchor.style.cssText = "";
    box.style.cssText = `width:${w}px;height:${h}px;`;
    switch (a.wrap) {
      case "inline":
        anchor.style.cssText = "display:inline-block;position:relative;vertical-align:bottom;max-width:100%;";
        box.style.position = "relative";
        box.style.display = "inline-block";
        break;
      case "square": {
        const parentW = anchor.closest<HTMLElement>("p, li, td, th")?.clientWidth || 650;
        const left = a.x + w / 2 < parentW / 2;
        anchor.style.display = "contents";
        box.style.cssText += `display:block;position:relative;float:${left ? "left" : "right"};margin:${Math.max(0, a.y)}px ${left ? GAP : Math.max(0, parentW - a.x - w)}px 4px ${left ? Math.max(0, a.x) : GAP}px;`;
        break;
      }
      default:
        anchor.style.cssText = "display:inline-block;width:0;height:0;position:relative;";
        box.style.position = "absolute";
        box.style.zIndex = a.wrap === "front" ? String(10 + a.z) : String(-50 + a.z);
        break;
    }
    if (a.rotation) box.style.transform = `rotate(${a.rotation}deg)`;
    img.style.cssText = "width:100%;height:100%;display:block;pointer-events:none;";
    if (isFloating(a)) placeFloating(anchor, box, { ...a, width: w, height: h } as never);
  };

  const render = () => {
    const a = attrs();
    if (img.getAttribute("src") !== a.src) img.src = a.src;
    img.alt = a.alt ?? "";
    layout(a);
    box.classList.toggle("img-floating", isFloating(a));
  };
  img.addEventListener("load", render);
  const onLayout = () => { if (isFloating(attrs())) layout(attrs()); };
  window.addEventListener("loma:layout", onLayout);
  render();

  // ------------------------------------------------------------------------------------------- interaction
  const scaleOf = () => box.getBoundingClientRect().width / (box.offsetWidth || 1) || 1;
  const commit = (patch: Partial<PictureAttrs>) => {
    const p = getPos();
    if (p === undefined) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, cleanPicture(patch, attrs())));
  };
  const drag = (e: MouseEvent, onMove: (dx: number, dy: number, ev: MouseEvent) => Partial<PictureAttrs>) => {
    e.preventDefault();
    e.stopPropagation();
    const scale = scaleOf();
    const start = { x: e.clientX, y: e.clientY };
    let last: Partial<PictureAttrs> | null = null;
    const move_ = (ev: MouseEvent) => {
      last = onMove((ev.clientX - start.x) / scale, (ev.clientY - start.y) / scale, ev);
      layout(cleanPicture(last, attrs()));
    };
    const up = () => {
      window.removeEventListener("mousemove", move_);
      window.removeEventListener("mouseup", up);
      if (last) commit(last);
    };
    window.addEventListener("mousemove", move_);
    window.addEventListener("mouseup", up);
  };

  for (const handle of handles) {
    handle.addEventListener("mousedown", (e) => {
      const dir = handle.dataset.dir!;
      const a0 = attrs();
      const { w, h } = dims(a0);
      const rad = (a0.rotation * Math.PI) / 180;
      const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
      drag(e, (dx, dy, ev) => {
        // The pointer moves in the page's axes, the picture's sides in its own (rotated) ones.
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const west = dir.includes("w"), east = dir.includes("e"), north = dir.includes("n"), south = dir.includes("s");
        let nw = w + (east ? lx : west ? -lx : 0);
        let nh = h + (south ? ly : north ? -ly : 0);
        if (dir.length === 2 && !ev.shiftKey) { // a corner keeps the proportions
          const k = Math.max(MIN_PICTURE / Math.min(w, h), (nw / w + nh / h) / 2);
          nw = w * k;
          nh = h * k;
        }
        nw = Math.max(MIN_PICTURE, nw);
        nh = Math.max(MIN_PICTURE, nh);
        // Free pictures keep the opposite side in place when a left or top side moves.
        const patch: Partial<PictureAttrs> = { width: nw, height: nh };
        if (a0.wrap !== "inline") {
          if (west) patch.x = a0.x + (w - nw) * cos + 0;
          if (north) patch.y = a0.y + (h - nh) * cos + 0;
        }
        return patch;
      });
    });
  }
  rotate.addEventListener("mousedown", (e) => {
    const r = box.getBoundingClientRect();
    const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
    drag(e, (_dx, _dy, ev) => {
      let deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      return { rotation: deg };
    });
  });

  /** Moving makes the picture free (in front of the text, positioned on the page) and lets it follow the pointer over the whole page. */
  const startMove = (e: MouseEvent, threshold: number) => {
    const stack = anchor.closest<HTMLElement>(".page-stack");
    const pos0 = getPos();
    if (!stack || !(Number(stack.dataset.pitch) > 0) || pos0 === undefined) return;
    const a0 = attrs();
    const { w, h } = dims(a0);
    const s = stack.getBoundingClientRect();
    const scale = s.width / stack.offsetWidth || 1;
    const r = box.getBoundingClientRect();
    const absX0 = (r.left + r.width / 2 - s.left) / scale - w / 2;
    const absY0 = (r.top + r.height / 2 - s.top) / scale - h / 2;
    const sheets = stackSheets(stack);
    const anchorPage = sheetIndexAt(sheets, (anchor.getBoundingClientRect().top - s.top) / scale);
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    let pos = { x: absX0, y: absY0 };
    const place = () => placeInSheets(sheets, pos.x, pos.y, w, h);
    const wrapNow = a0.wrap === "behind" ? "behind" : "front";
    const onMoveEv = (ev: MouseEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < threshold) return;
      started = true;
      ev.preventDefault();
      pos = { x: absX0 + (ev.clientX - startX) / scale, y: absY0 + (ev.clientY - startY) / scale };
      const p = place();
      layout({ ...a0, wrap: wrapNow, anchor: "page", x: p.ax - sheets[anchorPage].left, y: p.ay - sheets[anchorPage].top });
      box.classList.add("img-dragging");
    };
    const up = () => {
      window.removeEventListener("mousemove", onMoveEv);
      window.removeEventListener("mouseup", up);
      box.classList.remove("img-dragging");
      const cur = getPos();
      if (cur === undefined) return;
      if (!started) { editor.commands.setNodeSelection(cur); editor.view.focus(); return; } // a plain click selects the picture
      const p = place();
      const targetPage = p.page;
      const next = cleanPicture({ wrap: wrapNow, anchor: "page", x: p.x, y: p.y }, a0);
      const tr = editor.state.tr;
      if (targetPage !== anchorPage) {
        // Dropped on another page: the picture moves into a paragraph of that page so it stays there when the text reflows.
        let at = -1;
        editor.state.doc.forEach((n, off) => {
          if (at >= 0 || !n.isTextblock) return;
          const dom = editor.view.nodeDOM(off);
          if (dom instanceof HTMLElement && (dom.getBoundingClientRect().top - s.top) / scale >= sheets[targetPage].top - 2) at = off + 1;
        });
        const size = node.nodeSize;
        if (at >= 0 && !(at > cur && at <= cur + size)) {
          tr.delete(cur, cur + size);
          const target = at > cur ? at - size : at;
          tr.insert(target, node.type.create(next));
          tr.setSelection(NodeSelection.create(tr.doc, target));
          editor.view.dispatch(tr);
          return;
        }
      }
      tr.setNodeMarkup(cur, undefined, next);
      tr.setSelection(NodeSelection.create(tr.doc, cur));
      editor.view.dispatch(tr);
    };
    window.addEventListener("mousemove", onMoveEv);
    window.addEventListener("mouseup", up);
  };
  move.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); startMove(e, 0); });
  // preventDefault: no native drag-and-drop of the node (the image extension is draggable) and no text selection while moving.
  img.addEventListener("mousedown", (e) => { if (e.button === 0) { e.preventDefault(); startMove(e, 4); } });
  box.addEventListener("mousedown", (e) => { if (e.button === 0 && e.target === box) { e.preventDefault(); startMove(e, 4); } });

  return {
    dom: anchor,
    update: (updated: PMNode) => {
      if (updated.type !== node.type) return false;
      node = updated;
      render();
      return true;
    },
    ignoreMutation: () => true,
    stopEvent: (e: Event) => [...handles, rotate, move].some((h) => h.contains(e.target as globalThis.Node)),
    destroy: () => window.removeEventListener("loma:layout", onLayout),
  };
}
