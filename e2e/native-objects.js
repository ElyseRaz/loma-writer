// Native self-test of shapes, text boxes, rich headers/footers, native equations and bookmarks.
(async () => {
  const out = (k, v) => fetch("http://127.0.0.1:9911", { method: "POST", body: JSON.stringify({ k, v }) }).catch(() => {});
  const runId = String(Math.random());
  localStorage.setItem("__selftest_run", runId);
  const sleep = (ms) => new Promise((r, j) => setTimeout(() => (localStorage.getItem("__selftest_run") === runId ? r() : j(new Error("superseded"))), ms));
  const check = (name, cond, extra = "") => out(cond ? "PASS" : "FAIL", name + (cond ? "" : "  " + extra));
  const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
  const byLabel = (sel, t, exact) => [...document.querySelectorAll(sel)].find((b) => (exact ? b.textContent.trim() === t : b.textContent.trim().includes(t)) || b.getAttribute("aria-label") === t || b.getAttribute("title") === t);
  const btn = (t, exact) => byLabel("button", t, exact);
  const shapes = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === "shape") o.push({ ...n.attrs, text: n.textContent }); }); return o; };
  try {
    await sleep(3500);
    await import("/e2e/audit.js");
    btn("Document vierge")?.click(); await sleep(600);
    const ed = window.__lomaEditor;
    [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "Insertion").click(); await sleep(250);

    // --- shapes ---
    ed.commands.setContent("<p>Formes</p>"); ed.commands.focus("end"); await sleep(300);
    btn("Formes", true).click(); await sleep(300);
    check("gallery lists many shapes", document.querySelectorAll('[aria-label$="branches"], [aria-label="Ellipse"], [aria-label="Losange"]').length >= 4);
    byLabel("button", "Ellipse", true).click(); await sleep(300);
    document.execCommand("insertText", false, "Texte natif"); await sleep(300);
    let s = shapes(ed);
    check("shape inserted with text", s.length === 1 && s[0].kind === "ellipse" && s[0].text === "Texte natif", JSON.stringify(s));
    check("drawn as SVG (not a picture)", document.querySelectorAll(".shape-box svg path").length === 1 && document.querySelectorAll(".ProseMirror img:not(.ProseMirror-separator)").length === 0);
    const bb = document.querySelector(".shape-box").getBoundingClientRect();
    check(`shape has its size (${Math.round(bb.width)}x${Math.round(bb.height)})`, Math.abs(bb.width - 180) < 3 && Math.abs(bb.height - 110) < 3);
    check("shape toolbar visible", !!document.querySelector('[role=toolbar][aria-label="Forme"]'));
    btn("Remplissage").click(); await sleep(200);
    byLabel("button", "#fef08a").click(); await sleep(300);
    check("fill editable", shapes(ed)[0].fill === "#fef08a" && document.querySelector(".shape-box svg path").getAttribute("fill") === "#fef08a");
    setValue(document.querySelector('input[aria-label="Largeur (cm)"]'), "9"); await sleep(300);
    check("width editable", Math.abs(shapes(ed)[0].width - 340) <= 2, String(shapes(ed)[0].width));
    // mouse resize through the handle (window-level listeners)
    const h = document.querySelector(".shape-handle"); const r = h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left + 3, clientY: r.top + 3 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + 3 + 40, clientY: r.top + 3 + 30 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: r.left + 3 + 40, clientY: r.top + 3 + 30 })); await sleep(300);
    check(`handle resizes (${shapes(ed)[0].width}x${shapes(ed)[0].height})`, shapes(ed)[0].width >= 375 && shapes(ed)[0].height >= 135);
    ed.commands.focus("end"); btn("Formes", true).click(); await sleep(250); byLabel("button", "Flèche droite", true).click(); await sleep(250);
    ed.commands.focus("end"); btn("Formes", true).click(); await sleep(250); byLabel("button", "Étoile à 5 branches", true).click(); await sleep(250);
    check("several shapes", shapes(ed).map((x) => x.kind).join() === "ellipse,rightArrow,star5", shapes(ed).map((x) => x.kind).join());

    // --- text box ---
    ed.commands.setContent("<p>Avant</p>"); ed.commands.focus("end"); await sleep(300);
    btn("Zone de texte").click(); await sleep(300);
    for (const t of ["Une", "Deux", "Trois", "Quatre"]) { document.execCommand("insertText", false, `${t} ligne`); document.execCommand("insertParagraph"); await sleep(30); }
    await sleep(300);
    check("text box is a shape of type textbox that grows", shapes(ed)[0].kind === "textbox" && document.querySelector(".shape-textbox").offsetHeight > 90, String(document.querySelector(".shape-textbox")?.offsetHeight));

    // --- rich header ---
    const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
    ed.commands.setContent(Array.from({ length: 40 }, (_, i) => `<p>Paragraphe ${i}. ${lorem.repeat(2)}</p>`).join("")); await sleep(900);
    btn("En-tête", true).click(); await sleep(250);
    byLabel("[role=menuitem]", "Modifier l'en-tête").click(); await sleep(400);
    const hfe = document.querySelector('[role=dialog] [role=textbox][aria-label="Contenu de l\'en-tête"]');
    hfe.focus();
    document.execCommand("insertText", false, "Première ligne"); document.execCommand("insertParagraph");
    document.execCommand("insertText", false, "Deuxième ligne, page "); await sleep(100);
    byLabel("[role=dialog] button", "Insérer le numéro de page").click(); await sleep(200);
    byLabel("[role=dialog] button", "Enregistrer", true).click(); await sleep(1200);
    const sheet = document.querySelectorAll(".page-sheet");
    const first = sheet[1]?.querySelector(".hf");
    check(`multi-line header with a page field on every sheet (${sheet.length} sheets)`, sheet.length > 2 && first && first.querySelectorAll("p").length >= 2 && /Deuxième ligne, page 2/.test(first.textContent), first && first.textContent);
    const a = window.__lomaAudit();
    check(`pagination valid with a 2-line header (${a.pages} pages)`, a.problems.length === 0, a.problems.slice(0, 2).join("|"));

    // --- bookmarks visible ---
    ed.commands.setContent("<p>Texte</p>"); ed.commands.focus("end"); ed.commands.insertBookmark("Repere"); await sleep(300);
    check("bookmark visible by default", document.querySelector(".ProseMirror .bookmark").getBoundingClientRect().width > 4);

    // --- native round trip: equation (OMML / formula object), shapes, rich header ---
    const docs = await import("/src/services/documents/index.ts");
    ed.commands.setContent("<h1>T</h1><p>x</p>"); ed.commands.focus("end");
    ed.commands.insertEquation("\\frac{a}{b}+\\sqrt{x}"); ed.commands.insertShape("hexagon", { fill: "#fef08a" }); ed.commands.insertShape("textbox");
    const st = window.__lomaState;
    const model = { content: ed.getJSON(), page: st.page, headerFooter: st.headerFooter };
    for (const f of ["docx", "odt"]) {
      const { bytes } = await docs.serializeDocument(f, model);
      const back = await docs.openDocumentBytes(bytes, `x.${f}`);
      const sj = JSON.stringify(back.model.content);
      const eq = /"latex":"\\\\frac\{a\}\{b\}\s?\+\s?\\\\sqrt\{x\}"/.test(sj);
      check(`${f}: native equation, hexagon, text box and rich header survive`, eq && sj.includes('"kind":"hexagon"') && sj.includes('"kind":"textbox"') && JSON.stringify(back.model.headerFooter?.header).includes("Deuxième ligne") && JSON.stringify(back.model.headerFooter?.header).includes("pageField"), sj.slice(0, 200));
    }
  } catch (e) { out("ERROR", String(e && e.stack || e).slice(0, 500)); }
  out("DONE", true);
})();
