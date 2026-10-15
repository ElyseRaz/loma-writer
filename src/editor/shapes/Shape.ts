import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { isTextBox, NONE, shapeDef } from "./catalog";
import {
  cleanPlacement, cleanShapeAttrs, defaultGroupAttrs, defaultShapeAttrs, MAX_WIDTH, MIN_SIZE,
  type Gradient, type GroupAttrs, type Placement, type Shadow, type ShapeAttrs, type Wrap,
} from "./types";

export type { ShapeAttrs, GroupAttrs } from "./types";
export { MIN_SIZE } from "./types";
export const defaultAttrs = defaultShapeAttrs;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    shape: {
      /** Inserts a shape (or a text box) and puts the caret in it, ready to type. */
      insertShape: (kind: string, attrs?: Partial<ShapeAttrs>) => ReturnType;
      /** Changes the properties of the shape (or group) that holds the selection. */
      updateShape: (attrs: Partial<ShapeAttrs>) => ReturnType;
      deleteShape: () => ReturnType;
      /** Moves the shape one step in front of / behind the others. */
      shapeZ: (delta: 1 | -1) => ReturnType;
      /** Groups the shapes selected with Ctrl+click. */
      groupShapes: () => ReturnType;
      ungroupShapes: () => ReturnType;
    };
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
let uidSeq = 0;
const GAP = 12; // space between a wrapped shape and the text around it

// ----------------------------------------------------------------------------------------------- drawing

interface Drawable {
  kind: string;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  gradient?: Gradient | null;
  shadow?: Shadow | null;
}

/** SVG markup of a shape: geometry, solid or gradient fill, outline and shadow (also used for gallery previews). */
export function shapeSvg(a: Drawable, uid = `ls${++uidSeq}`): string {
  const def = shapeDef(isTextBox(a.kind) ? "rect" : a.kind);
  const sw = a.stroke === NONE ? 0 : a.strokeWidth;
  const w = Math.max(1, a.width - sw);
  const h = Math.max(1, a.height - sw);
  const open = !!def.openPath;
  let fill = open ? "none" : a.fill;
  let defs = "";
  const g = a.gradient;
  if (g && !open) {
    const stops = g.stops.map((s) => `<stop offset="${s.pos}%" stop-color="${s.color}"/>`).join("");
    if (g.type === "radial") defs += `<radialGradient id="${uid}g" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`;
    else {
      const r = (g.angle * Math.PI) / 180;
      const [dx, dy] = [Math.cos(r) / 2, Math.sin(r) / 2];
      defs += `<linearGradient id="${uid}g" x1="${50 - dx * 100}%" y1="${50 - dy * 100}%" x2="${50 + dx * 100}%" y2="${50 + dy * 100}%">${stops}</linearGradient>`;
    }
    fill = `url(#${uid}g)`;
  }
  let filter = "";
  const sh = a.shadow;
  if (sh) {
    defs += `<filter id="${uid}f" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur in="SourceAlpha" stdDeviation="${sh.blur / 2}"/><feOffset dx="${sh.dx}" dy="${sh.dy}" result="o"/><feFlood flood-color="${sh.color}" flood-opacity="${sh.opacity}"/><feComposite in2="o" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    filter = ` filter="url(#${uid}f)"`;
  }
  return `<svg xmlns="${SVG_NS}" width="${a.width}" height="${a.height}" viewBox="0 0 ${a.width} ${a.height}" style="position:absolute;inset:0;overflow:visible" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ""}<g${filter} transform="translate(${sw / 2} ${sw / 2})"><path d="${def.path(w, h)}" fill="${fill}" fill-rule="${def.evenOdd ? "evenodd" : "nonzero"}" stroke="${a.stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/></g></svg>`;
}

// ----------------------------------------------------------------------------------------------- attributes

const json = <T>(raw: string | null): T | null => {
  try { return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
};

function attrSpec(base: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(base)) {
    const data = key === "kind" ? "shape" : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const complex = fallback === null || typeof fallback === "object";
    out[key] = {
      default: fallback,
      parseHTML: (el: HTMLElement) => {
        const raw = el.getAttribute(`data-${data}`);
        if (raw === null) return fallback;
        if (complex) return json(raw);
        return typeof fallback === "number" ? (Number(raw) || fallback) : raw;
      },
      renderHTML: (a: Record<string, unknown>) => (a[key] === null || a[key] === undefined ? {} : { [`data-${data}`]: complex ? JSON.stringify(a[key]) : a[key] }),
    };
  }
  return out;
}

// ----------------------------------------------------------------------------------------------- layout

/** Position and size of the box, according to the wrap mode. Returns what the box needs to draw itself. */
function layoutBox(anchor: HTMLElement, box: HTMLElement, a: Placement & { height: number }, textBox: boolean, inGroup: boolean): void {
  const mode: Wrap = inGroup ? "group" : a.wrap;
  box.style.cssText = "";
  anchor.style.cssText = "";
  anchor.dataset.wrap = mode;
  box.style.width = `${a.width}px`;
  box.style[textBox ? "minHeight" : "height"] = `${a.height}px`;
  if (a.rotation) box.style.transform = `rotate(${a.rotation}deg)`;
  const parentW = anchor.parentElement?.clientWidth || MAX_WIDTH;
  switch (mode) {
    case "inline":
      box.style.marginLeft = a.align === "left" ? "0" : "auto";
      box.style.marginRight = a.align === "right" ? "0" : "auto";
      break;
    case "topBottom":
      box.style.marginLeft = `${Math.max(0, a.x)}px`;
      box.style.marginTop = `${Math.max(0, a.y)}px`;
      box.style.marginBottom = `${GAP}px`;
      break;
    case "square": {
      anchor.style.display = "contents"; // the box takes part in the text flow of the parent
      const left = a.x + a.width / 2 < parentW / 2;
      box.style.float = left ? "left" : "right";
      box.style.marginTop = `${Math.max(0, a.y)}px`;
      if (left) { box.style.marginLeft = `${Math.max(0, a.x)}px`; box.style.marginRight = `${GAP}px`; }
      else { box.style.marginRight = `${Math.max(0, parentW - a.x - a.width)}px`; box.style.marginLeft = `${GAP}px`; }
      box.style.marginBottom = "4px";
      break;
    }
    case "front":
    case "behind":
      anchor.style.cssText = "display:block;height:0;position:relative;";
      box.style.position = "absolute";
      box.style.zIndex = mode === "front" ? String(10 + a.z) : String(-50 + a.z);
      break;
    case "group":
      box.style.position = "absolute";
      box.style.left = `${a.x}px`;
      box.style.top = `${a.y}px`;
      box.style.zIndex = String(a.z + 50);
      break;
  }
  if (a.rotation) box.style.transform = `rotate(${a.rotation}deg)`;
}

/** Free (front/behind) shapes: absolute position from the paragraph or from the page the anchor is on. */
export function placeFloating(anchor: HTMLElement, box: HTMLElement, a: Placement): void {
  if (a.wrap !== "front" && a.wrap !== "behind") return;
  if (a.anchor === "paragraph") { box.style.left = `${a.x}px`; box.style.top = `${a.y}px`; return; }
  const stack = anchor.closest<HTMLElement>(".page-stack");
  const pitch = Number(stack?.dataset.pitch) || 0;
  if (!stack || !pitch) { box.style.left = `${a.x}px`; box.style.top = `${a.y}px`; return; }
  const s = stack.getBoundingClientRect();
  const scale = s.width / stack.offsetWidth || 1;
  const r = anchor.getBoundingClientRect();
  const anchorY = (r.top - s.top) / scale;
  const anchorX = (r.left - s.left) / scale;
  const page = Math.max(0, Math.floor((anchorY + 1) / pitch));
  box.style.left = `${a.x - anchorX}px`;
  box.style.top = `${page * pitch + a.y - anchorY}px`;
}

/**
 * Shared node view of shapes and groups: an anchor (in the text flow, where the object belongs) holding the box
 * that is drawn, moved, resized and rotated. Handles appear when the object is hovered or selected.
 */
function makeView(kind: "shape" | "group") {
  return ({ node: initial, getPos, editor }: { node: PMNode; getPos: () => number | undefined; editor: import("@tiptap/core").Editor }) => {
    let node: PMNode = initial;
    const anchor = document.createElement("div");
    anchor.className = "shape-anchor";
    const box = document.createElement("div");
    box.className = kind === "group" ? "shape-box shape-group" : "shape-box";
    const art = document.createElement("div");
    art.className = "shape-art";
    art.contentEditable = "false";
    const contentDOM = document.createElement("div");
    contentDOM.className = kind === "group" ? "group-children" : "shape-text";
    const mk = (cls: string, title: string) => {
      const h = document.createElement("div");
      h.className = cls;
      h.contentEditable = "false";
      h.title = title;
      return h;
    };
    const resize = mk("shape-handle", "Redimensionner");
    const rotate = mk("shape-rotate", "Faire pivoter (Maj : par pas de 15°)");
    const move = mk("shape-move", "Déplacer");
    box.append(art, contentDOM, resize, rotate, move);
    anchor.append(box);

    const attrs = () => node.attrs as ShapeAttrs;
    const isGroupChild = () => {
      const p = getPos();
      if (p === undefined) return false;
      return editor.state.doc.resolve(p).parent.type.name === "shapeGroup";
    };

    const render = () => {
      const a = attrs();
      const textBox = kind === "shape" && isTextBox(a.kind);
      const inGroup = isGroupChild();
      layoutBox(anchor, box, a, textBox, inGroup);
      box.dataset.shape = kind === "shape" ? a.kind : "group";
      box.classList.toggle("shape-textbox", textBox);
      box.classList.toggle("shape-floating", a.wrap === "front" || a.wrap === "behind" || inGroup);
      if (kind === "shape") {
        contentDOM.style.display = node.childCount || textBox ? "" : "none";
        const h = textBox ? Math.max(a.height, box.offsetHeight || a.height) : a.height;
        art.innerHTML = shapeSvg({ ...a, height: h });
        const inset = shapeDef(textBox ? "rect" : a.kind).textInset ?? 0;
        contentDOM.style.padding = `${6 + inset * a.height}px ${8 + inset * a.width}px`;
      }
      if (a.alt) box.setAttribute("aria-label", a.alt);
      placeFloating(anchor, box, a);
    };
    render();

    // Layout changes (pagination, zoom, text edits) move the anchor: free shapes follow it; text boxes redraw their frame.
    const onLayout = () => { if (anchor.isConnected) { render(); } };
    window.addEventListener("loma:layout", onLayout);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (kind === "shape" && isTextBox(attrs().kind)) render(); }) : null;
    ro?.observe(box);

    // ------------------------------------------------------------------------- mouse interaction
    const scaleOf = () => box.getBoundingClientRect().width / (box.offsetWidth || 1) || 1;
    const commit = (patch: Record<string, unknown>) => {
      const p = getPos();
      if (p === undefined) return;
      const next = kind === "shape" ? cleanShapeAttrs({ ...attrs(), ...patch }, attrs()) : { ...cleanPlacement({ ...attrs(), ...patch }, attrs()), alt: attrs().alt };
      editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, next));
    };
    const drag = (e: MouseEvent, onMove: (dx: number, dy: number, ev: MouseEvent) => Record<string, unknown>) => {
      e.preventDefault();
      e.stopPropagation();
      const scale = scaleOf();
      const start = { x: e.clientX, y: e.clientY };
      let last: Record<string, unknown> | null = null;
      const move_ = (ev: MouseEvent) => {
        last = onMove((ev.clientX - start.x) / scale, (ev.clientY - start.y) / scale, ev);
        // Live preview: draw with the draft values, without touching the document yet.
        const draft = { ...attrs(), ...last } as ShapeAttrs;
        layoutBox(anchor, box, draft, kind === "shape" && isTextBox(draft.kind), isGroupChild());
        if (kind === "shape") art.innerHTML = shapeSvg(draft);
        placeFloating(anchor, box, draft);
      };
      const up = () => {
        window.removeEventListener("mousemove", move_);
        window.removeEventListener("mouseup", up);
        if (last) commit(last);
      };
      window.addEventListener("mousemove", move_);
      window.addEventListener("mouseup", up);
    };
    resize.addEventListener("mousedown", (e) => {
      const a = attrs();
      const h0 = Math.max(a.height, box.offsetHeight);
      drag(e, (dx, dy) => ({ width: Math.max(MIN_SIZE, a.width + dx), height: Math.max(MIN_SIZE, h0 + dy) }));
    });
    // Moving: inside a group the children move within the group's box; anywhere else the shape becomes free
    // (in front of the text, positioned on the page) and follows the pointer over the whole page, margins and other pages included.
    const startMove = (e: MouseEvent, threshold: number) => {
      if (isGroupChild()) { drag(e, (dx, dy) => ({ x: Math.round(attrs().x + dx), y: Math.round(attrs().y + dy) })); return; }
      const stack = anchor.closest<HTMLElement>(".page-stack");
      const pitch = Number(stack?.dataset.pitch) || 0;
      const pos0 = getPos();
      if (!stack || !pitch || pos0 === undefined) { drag(e, (dx, dy) => ({ x: Math.round(attrs().x + dx), y: Math.round(attrs().y + dy) })); return; }
      const a0 = attrs();
      const s = stack.getBoundingClientRect();
      const scale = s.width / stack.offsetWidth || 1;
      const r = box.getBoundingClientRect();
      // Top-left of the unrotated box, in page-stack px (the bounding rect of a rotated box is larger).
      const absX0 = (r.left + r.width / 2 - s.left) / scale - a0.width / 2;
      const absY0 = (r.top + r.height / 2 - s.top) / scale - Math.max(a0.height, box.offsetHeight) / 2;
      const pageW = stack.offsetWidth;
      const anchorRect = anchor.getBoundingClientRect();
      const anchorPage = Math.max(0, Math.floor(((anchorRect.top - s.top) / scale + 1) / pitch));
      const startX = e.clientX, startY = e.clientY;
      let started = false;
      let pos = { x: absX0, y: absY0 };
      const place = () => {
        // Anywhere on the sheet, margins included, never outside the paper.
        const x = Math.round(Math.min(Math.max(pos.x, 0), Math.max(0, pageW - a0.width)));
        const sheet = stack.querySelector<HTMLElement>(".page-sheet");
        const pages = Number(stack.dataset.pages) || 1;
        const maxY = sheet ? (pages - 1) * pitch + sheet.offsetHeight - Math.max(a0.height, box.offsetHeight) : Infinity;
        const y = Math.round(Math.min(Math.max(pos.y, 0), Math.max(0, maxY)));
        return { x, y };
      };
      const draftOf = () => { const p = place(); return { ...a0, wrap: a0.wrap === "behind" ? "behind" : "front", anchor: "page", x: p.x, y: p.y - anchorPage * pitch } as ShapeAttrs; };
      const onMoveEv = (ev: MouseEvent) => {
        if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < threshold) return;
        started = true;
        ev.preventDefault();
        pos = { x: absX0 + (ev.clientX - startX) / scale, y: absY0 + (ev.clientY - startY) / scale };
        const draft = draftOf();
        layoutBox(anchor, box, draft, kind === "shape" && isTextBox(draft.kind), false);
        if (kind === "shape") art.innerHTML = shapeSvg(draft);
        placeFloating(anchor, box, draft);
        box.classList.add("shape-floating", "shape-dragging");
      };
      const up = () => {
        window.removeEventListener("mousemove", onMoveEv);
        window.removeEventListener("mouseup", up);
        box.classList.remove("shape-dragging");
        if (!started) { // a plain click on the handle selects the shape
          const at = getPos();
          if (at !== undefined) { editor.commands.setNodeSelection(at); editor.view.focus(); } // focus: Ctrl+C / Suppr work right away
          return;
        }
        const p = place();
        const targetPage = Math.max(0, Math.floor((p.y + 1) / pitch));
        const attrsNext = (kind === "shape" ? cleanShapeAttrs : (x: Partial<ShapeAttrs>, b: ShapeAttrs) => ({ ...cleanPlacement(x, b), alt: b.alt }))({ ...a0, wrap: draftOf().wrap, anchor: "page", x: p.x, y: p.y - targetPage * pitch }, a0);
        const cur = getPos();
        if (cur === undefined) return;
        const tr = editor.state.tr;
        // Dropped on another page: the shape is re-anchored to a paragraph of that page, so it stays there when the text reflows.
        if (targetPage !== anchorPage) {
          let at = editor.state.doc.content.size;
          let found = false;
          editor.state.doc.forEach((n, off) => {
            if (found || off === cur) return;
            const dom = editor.view.nodeDOM(off);
            if (!(dom instanceof HTMLElement) || n.type.name === "shape" || n.type.name === "shapeGroup") return;
            const top = (dom.getBoundingClientRect().top - s.top) / scale;
            if (top >= targetPage * pitch - 2) { at = off; found = true; }
          });
          const node = editor.state.doc.nodeAt(cur)!.type.create(attrsNext, editor.state.doc.nodeAt(cur)!.content);
          const size = editor.state.doc.nodeAt(cur)!.nodeSize;
          tr.delete(cur, cur + size);
          tr.insert(at > cur ? at - size : at, node);
        } else tr.setNodeMarkup(cur, undefined, attrsNext);
        editor.view.dispatch(tr);
      };
      window.addEventListener("mousemove", onMoveEv);
      window.addEventListener("mouseup", up);
    };
    move.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); startMove(e, 0); });
    // Dragging the shape itself (not its text, not the handles) moves it too; a small threshold keeps plain clicks as clicks.
    box.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || [resize, rotate, move].some((h) => h.contains(e.target as globalThis.Node))) return;
      const r = box.getBoundingClientRect();
      const edge = Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY) < 7;
      const inText = contentDOM.contains(e.target as globalThis.Node) && (contentDOM.textContent ?? "").length > 0 && !edge; // an empty shape is dragged from anywhere, one with text from its border
      if (inText && kind === "shape") return; // the text of the shape is being edited
      if (kind === "group" && e.target !== box && !(e.target as HTMLElement).closest?.(".shape-art")) return;
      startMove(e, 4);
    });
    rotate.addEventListener("mousedown", (e) => {
      const r = box.getBoundingClientRect();
      const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
      drag(e, (_dx, _dy, ev) => {
        let deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        return { rotation: ((Math.round(deg) % 360) + 360) % 360 };
      });
    });

    return {
      dom: anchor,
      contentDOM,
      update: (updated: PMNode) => {
        if (updated.type !== node.type) return false;
        node = updated;
        render();
        return true;
      },
      // Only the text inside the box is edited by the user; everything else is drawn by the view.
      ignoreMutation: (m: MutationRecord | { type: "selection"; target: globalThis.Node }) => m.type === "selection" ? false : !contentDOM.contains(m.target) && m.target !== contentDOM,
      stopEvent: (e: Event) => [resize, rotate, move].some((h) => h.contains(e.target as globalThis.Node)),
      destroy: () => { ro?.disconnect(); window.removeEventListener("loma:layout", onLayout); },
    };
  };
}

// ----------------------------------------------------------------------------------------------- nodes

const shapeAttrDefaults = (): Record<string, unknown> => ({ ...defaultShapeAttrs("rect") });
const groupAttrDefaults = (): Record<string, unknown> => ({ ...defaultGroupAttrs() });

/**
 * A drawing shape: one of the preset geometries, or a text box. It holds text, and its fill (solid or gradient),
 * outline, shadow, rotation, size and position (in the line, wrapped, or free in front of / behind the text) stay editable.
 */
export const Shape = Node.create({
  name: "shape",
  group: "block",
  content: "paragraph*",
  isolating: true,
  selectable: true,
  draggable: false,
  addAttributes: () => attrSpec(shapeAttrDefaults()),
  parseHTML: () => [{ tag: "div[data-shape]" }],
  renderHTML: ({ node, HTMLAttributes }) => {
    const spec = ["div", mergeAttributes(HTMLAttributes, { class: "shape-box" })] as unknown[];
    if (node.childCount) spec.push(0);
    return spec as never;
  },
  addNodeView: () => makeView("shape") as never,

  addCommands() {
    return {
      insertShape:
        (kind, attrs = {}) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.shape;
          const a = cleanShapeAttrs({ ...attrs, kind }, defaultShapeAttrs(kind));
          const def = kind === "line" ? null : state.schema.nodes.paragraph.create();
          const node = type.create(a, def ? [def] : []);
          // An empty paragraph is replaced by the shape; otherwise the shape goes right after the current block
          // (never inside another shape or group).
          const $from = state.selection.$from;
          const inside = findObject(state);
          const emptyPara = !inside && state.selection.empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
          const pos = inside ? inside.pos + inside.node.nodeSize : emptyPara ? $from.before() : $from.parent.isTextblock ? $from.after() : $from.pos;
          if (emptyPara) tr.replaceWith(pos, $from.after(), node);
          else tr.insert(pos, node);
          // Something to type in after a shape that ends the document.
          if (pos + node.nodeSize >= tr.doc.content.size) tr.insert(pos + node.nodeSize, state.schema.nodes.paragraph.create());
          // Caret inside the shape so the user can type right away; lines have no text, so they are selected.
          if (def) tr.setSelection(TextSelection.create(tr.doc, pos + 2));
          else tr.setSelection(NodeSelection.create(tr.doc, pos));
          dispatch?.(tr.scrollIntoView());
          return true;
        },

      updateShape:
        (attrs) =>
        ({ state, tr, dispatch }) => {
          const found = findObject(state);
          if (!found) return false;
          const next = found.node.type.name === "shape"
            ? cleanShapeAttrs({ ...found.node.attrs, ...attrs }, found.node.attrs as ShapeAttrs)
            : { ...cleanPlacement({ ...found.node.attrs, ...attrs }, found.node.attrs as Placement), alt: String((attrs as GroupAttrs).alt ?? found.node.attrs.alt ?? "") };
          tr.setNodeMarkup(found.pos, undefined, next);
          // Switching to a floating mode keeps what the user sees: position starts at the current place.
          dispatch?.(tr);
          return true;
        },

      deleteShape:
        () =>
        ({ state, tr, dispatch }) => {
          const found = findObject(state);
          if (!found) return false;
          tr.delete(found.pos, found.pos + found.node.nodeSize);
          dispatch?.(tr);
          return true;
        },

      shapeZ:
        (delta) =>
        ({ state, tr, dispatch }) => {
          const found = findObject(state);
          if (!found) return false;
          tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, z: Math.max(-49, Math.min(49, Number(found.node.attrs.z ?? 0) + delta)) });
          dispatch?.(tr);
          return true;
        },

      groupShapes:
        () =>
        ({ state, tr, dispatch }) => {
          const picked = multiSelection(state);
          if (picked.length < 2) return false;
          const nodes = picked.map((p) => ({ pos: p, node: state.doc.nodeAt(p)! }));
          // Group members must follow each other in the document so the group takes their place.
          const adjacent = nodes.every((n, i) => i === 0 || nodes[i - 1].pos + nodes[i - 1].node.nodeSize === n.pos);
          if (!adjacent || nodes.some((n) => n.node.type.name !== "shape")) return false;
          const boxes = nodes.map(({ node }) => {
            const a = node.attrs as ShapeAttrs;
            const floating = a.wrap === "front" || a.wrap === "behind";
            return { node, x: floating ? a.x : 0, y: floating ? a.y : 0, w: a.width, h: a.height };
          });
          const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
          const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
          const first = nodes[0].node.attrs as ShapeAttrs;
          const children = boxes.map((b) => state.schema.nodes.shape.create({ ...b.node.attrs, wrap: "group", anchor: "paragraph", x: b.x - x0, y: b.y - y0, align: "left" }, b.node.content));
          const group = state.schema.nodes.shapeGroup.create(
            { ...defaultGroupAttrs(), width: x1 - x0, height: y1 - y0, wrap: first.wrap === "behind" ? "behind" : "front", anchor: first.anchor, x: x0, y: y0 },
            children,
          );
          const from = nodes[0].pos;
          const to = nodes[nodes.length - 1].pos + nodes[nodes.length - 1].node.nodeSize;
          tr.replaceWith(from, to, group);
          tr.setSelection(NodeSelection.create(tr.doc, from));
          tr.setMeta(multiKey, { clear: true });
          dispatch?.(tr);
          return true;
        },

      ungroupShapes:
        () =>
        ({ state, tr, dispatch }) => {
          const found = findGroup(state);
          if (!found) return false;
          const g = found.node.attrs as GroupAttrs;
          const children: PMNode[] = [];
          found.node.forEach((c) => children.push(state.schema.nodes.shape.create({ ...c.attrs, wrap: g.wrap, anchor: g.anchor, x: g.x + Number(c.attrs.x), y: g.y + Number(c.attrs.y) }, c.content)));
          tr.replaceWith(found.pos, found.pos + found.node.nodeSize, children);
          dispatch?.(tr);
          return true;
        },
    };
  },
});

/** Several shapes held together: moved, resized and rotated as one, like a Word group. */
export const ShapeGroup = Node.create({
  name: "shapeGroup",
  group: "block",
  content: "shape+",
  isolating: true,
  selectable: true,
  draggable: false,
  addAttributes: () => attrSpec({ ...groupAttrDefaults() }),
  parseHTML: () => [{ tag: "div[data-group]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "shape-box shape-group", "data-group": "" }), 0],
  addNodeView: () => makeView("group") as never,
  addProseMirrorPlugins() {
    return [multiSelectPlugin()];
  },
});

// ----------------------------------------------------------------------------------------------- selection helpers

/** The shape or group holding the selection (a shape inside a group counts as the shape itself). */
export function findObject(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && (sel.node.type.name === "shape" || sel.node.type.name === "shapeGroup")) return { node: sel.node, pos: sel.from };
  const $from = sel.$from;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "shape" || n.type.name === "shapeGroup") return { node: n, pos: $from.before(d) };
  }
  return null;
}

/** Kept under its former name: the shape (not the group) holding the selection. */
export function findShape(state: EditorState): { node: PMNode; pos: number } | null {
  const f = findObject(state);
  return f && f.node.type.name === "shape" ? f : null;
}

export function findGroup(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "shapeGroup") return { node: sel.node, pos: sel.from };
  const $from = sel.$from;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "shapeGroup") return { node: $from.node(d), pos: $from.before(d) };
  return null;
}

// Ctrl+click adds shapes to a multi-selection, so they can be grouped.
const multiKey = new PluginKey<number[]>("loma-shape-multi");
export const multiSelection = (state: EditorState): number[] => multiKey.getState(state) ?? [];

function multiSelectPlugin(): Plugin<number[]> {
  return new Plugin<number[]>({
    key: multiKey,
    state: {
      init: () => [],
      apply(tr, value) {
        const meta = tr.getMeta(multiKey) as { toggle?: number; clear?: boolean } | undefined;
        let next = tr.docChanged ? value.map((p) => tr.mapping.map(p)).filter((p) => tr.doc.nodeAt(p)?.type.name === "shape") : value;
        if (meta?.clear) next = [];
        if (meta?.toggle !== undefined) next = next.includes(meta.toggle) ? next.filter((p) => p !== meta.toggle) : [...next, meta.toggle].sort((a, b) => a - b);
        return next;
      },
    },
    props: {
      decorations: (state) => {
        const picked = multiKey.getState(state) ?? [];
        return picked.length ? DecorationSet.create(state.doc, picked.flatMap((p) => { const n = state.doc.nodeAt(p); return n ? [Decoration.node(p, p + n.nodeSize, { class: "shape-multi" })] : []; })) : DecorationSet.empty;
      },
      handleClickOn(view: EditorView, _pos, node, nodePos, event) {
        if (!(event.ctrlKey || event.metaKey) || node.type.name !== "shape") return false;
        const current = multiKey.getState(view.state) ?? [];
        // The shape that already holds the selection joins the multi-selection with the first Ctrl+click.
        const holder = findObject(view.state);
        const tr = view.state.tr;
        if (!current.length && holder && holder.node.type.name === "shape" && holder.pos !== nodePos) tr.setMeta(multiKey, { toggle: holder.pos });
        view.dispatch(tr);
        view.dispatch(view.state.tr.setMeta(multiKey, { toggle: nodePos }));
        return true;
      },
    },
  });
}
