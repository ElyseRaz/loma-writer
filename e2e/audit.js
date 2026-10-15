// Runs inside the page (Chrome via Playwright, or the native WebKitGTK webview): measures the real layout.
// Returns violations of the pagination invariants; an empty `problems` list means the layout is correct.
window.__lomaAudit = function () {
  const ed = window.__lomaEditor;
  const root = ed.view.dom;
  const sheets = [...document.querySelectorAll(".page-sheet")];
  const stack = document.querySelector(".page-stack");
  const zoom = new DOMMatrix(getComputedStyle(stack).transform).a || 1; // zoom is a paint-only transform
  const rect0 = sheets[0].getBoundingClientRect();
  const pageH = rect0.height / zoom;
  const pitch = sheets.length > 1 ? (sheets[1].getBoundingClientRect().top - rect0.top) / zoom : pageH + 24;
  const pad = parseFloat(getComputedStyle(document.querySelector(".paper")).paddingTop);
  const padB = parseFloat(getComputedStyle(document.querySelector(".paper")).paddingBottom);
  const H = pageH - pad - padB;
  const originTop = rect0.top; // top of page 1
  const problems = [];
  const eps = 1.5;
  const check = (name, top, bottom) => {
    const y1 = (top - originTop) / zoom;
    const y2 = (bottom - originTop) / zoom;
    const page = Math.floor((y1 - pad + eps) / pitch);
    const lo = page * pitch + pad, hi = page * pitch + pad + H;
    if (y1 < lo - eps || y2 > hi + eps) problems.push(`${name}: ${y1.toFixed(1)}..${y2.toFixed(1)} page ${page + 1} content ${lo.toFixed(1)}..${hi.toFixed(1)}`);
  };
  const range = document.createRange();
  let lines = 0;
  root.querySelectorAll("p, h1, h2, h3, pre").forEach((el, n) => {
    if (el.closest("td, th")) return;
    // every character must be inside a page's content area
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      for (let o = 0; o < node.length; o++) {
        range.setStart(node, o); range.setEnd(node, o + 1);
        const r = range.getClientRects()[0];
        if (r && r.width > 0) { lines++; check(`${el.tagName}#${n} char ${o}`, r.top, r.bottom); }
      }
    }
  });
  root.querySelectorAll("tr").forEach((tr, n) => { if (!tr.classList.contains("pg-spacer")) { const r = tr.getBoundingClientRect(); check(`TR#${n}`, r.top, r.bottom); } });
  root.querySelectorAll("img:not(.ProseMirror-separator)").forEach((im, n) => { const r = im.getBoundingClientRect(); check(`IMG#${n}`, r.top, r.bottom); });
  // headings must not end a page
  root.querySelectorAll("h1, h2, h3").forEach((h, n) => {
    const next = h.nextElementSibling; if (!next || next.classList.contains("pg-spacer") === false && next.tagName === undefined) return;
    const hb = (h.getBoundingClientRect().bottom - originTop) / zoom;
    const nt = next && next.getBoundingClientRect ? (next.getBoundingClientRect().top - originTop) / zoom : hb;
    if (Math.floor((nt - pad + eps) / pitch) !== Math.floor((hb - pad - eps) / pitch) && !next.classList.contains("pg-spacer")) problems.push(`heading#${n} separated from what follows`);
  });
  const spacers = [...root.querySelectorAll(".pg-spacer")].map((s) => +(s.dataset.h || 0));
  const domText = (() => { const c = root.cloneNode(true); c.querySelectorAll(".pg-spacer").forEach((s) => s.remove()); return c.textContent; })();
  return { problems, pages: sheets.length, pitch, H, spacers, chars: lines, text: domText, status: [...document.querySelectorAll("footer span")].map((s) => s.textContent).find((t) => /Page \d+ sur \d+/.test(t)) };
};
