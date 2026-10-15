// Native self-test of the "Insertion" tab (see e2e/README.md for the temporary injection).
(async () => {
  const out = (k, v) => fetch("http://127.0.0.1:9911", { method: "POST", body: JSON.stringify({ k, v }) }).catch(() => {});
  const runId = String(Math.random());
  localStorage.setItem("__selftest_run", runId);
  const sleep = (ms) => new Promise((r, j) => setTimeout(() => (localStorage.getItem("__selftest_run") === runId ? r() : j(new Error("superseded"))), ms));
  const check = (name, cond, extra = "") => out(cond ? "PASS" : "FAIL", name + (cond ? "" : "  " + extra));
  const setValue = (el, v) => { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); };
  const byText = (sel, txt, exact = false) => [...document.querySelectorAll(sel)].find((b) => (exact ? b.textContent.trim() === txt : b.textContent.trim().includes(txt)) || b.getAttribute("aria-label") === txt || b.getAttribute("title") === txt);
  const btn = (t, exact) => byText("button", t, exact);
  const dlg = (t) => [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent.trim() === t);
  const images = (ed) => { const o = []; ed.state.doc.descendants((x) => { if (x.type.name === "image") o.push(x.attrs); }); return o; };
  try {
    await sleep(3500);
    await import("/e2e/audit.js");
    btn("Document vierge")?.click(); await sleep(600);
    const ed = window.__lomaEditor;
    [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "Insertion").click(); await sleep(250);
    check("no disabled button left in the Insertion tab", document.querySelectorAll("[role=tabpanel] button[aria-disabled=true]").length === 0);

    ed.commands.setContent("<p>Avant</p><p>Après</p>"); await sleep(300);
    ed.commands.setTextSelection(7); btn("Page vierge").click(); await sleep(700);
    const bl = window.__lomaAudit();
    check(`blank page: ${bl.pages} pages`, bl.pages === 3 && bl.problems.length === 0, bl.problems.join("|"));

    ed.commands.setContent("<h1>Intro</h1><p>Corps</p>"); await sleep(300);
    btn("Page de garde").click(); await sleep(300);
    setValue(document.querySelector('[role=dialog] input'), "Rapport natif"); await sleep(100);
    dlg("Insérer au début").click(); await sleep(700);
    check("cover page inserted + own page", JSON.stringify(ed.getJSON()).includes("Rapport natif") && window.__lomaAudit().pages === 2);

    // Canvas drawing in WebKit: shapes, icons, chart
    ed.commands.setContent("<p>x</p>"); ed.commands.focus("end"); await sleep(300);
    btn("Formes").click(); await sleep(250);
    byText("button", "Étoile", true).click(); await sleep(400);
    const shape = images(ed)[0];
    check("shape rendered to PNG in WebKit", shape && shape.src.startsWith("data:image/png;base64,") && shape.src.length > 400, String(shape && shape.src.length));
    btn("Icônes").click(); await sleep(300);
    setValue(document.querySelector('[role=dialog] input[aria-label="Rechercher une icône"]'), "cœur"); await sleep(200);
    byText("[role=dialog] button", "Cœur", true).click(); await sleep(900);
    const icon = images(ed).find((i) => (i.alt || "").startsWith("Icône"));
    check("icon (SVG -> PNG) rendered in WebKit", icon && icon.src.length > 500, String(icon && icon.src.length));
    btn("Graphique").click(); await sleep(500);
    const prev = document.querySelector('img[alt="Aperçu du graphique"]');
    check("chart preview drawn", !!prev && prev.src.length > 1000);
    dlg("Insérer").click(); await sleep(400);
    const chart = images(ed).find((i) => (i.alt || "").startsWith("Histogramme"));
    check("chart inserted with data in the alt text", chart && /T1 : 2025 12/.test(chart.alt), JSON.stringify(chart && chart.alt));

    // Equation with KaTeX
    ed.commands.setContent("<p>F : </p>"); ed.commands.focus("end"); await sleep(300);
    btn("Équation").click(); await sleep(300);
    setValue(document.querySelector("[role=dialog] textarea"), "\\frac{a}{b}+\\sqrt{x}"); await sleep(300);
    check("KaTeX preview renders", document.querySelectorAll("[role=dialog] .katex").length > 0);
    dlg("Insérer").click(); await sleep(400);
    check("equation in the document", document.querySelectorAll(".ProseMirror .equation .katex").length === 1);
    // KaTeX fonts must actually load offline
    await document.fonts.ready;
    const faces = [...document.fonts].filter((f) => f.family.startsWith("KaTeX") && f.status === "loaded").length;
    check(`KaTeX fonts loaded locally (${faces})`, faces > 0);

    // Text box + bookmark + cross-reference
    ed.commands.setContent("<h1>Titre A</h1><p>Texte</p>"); ed.commands.focus("end"); await sleep(300);
    btn("Zone de texte").click(); await sleep(300);
    document.execCommand("insertText", false, "Dans la boîte"); await sleep(300);
    check("text box inserted and editable", /Dans la boîte/.test(document.querySelector(".text-box")?.textContent || ""));
    btn("Signet", true) ? btn("Signet", true).click() : [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Signet").click();
    await sleep(300);
    setValue(document.querySelector('[role=dialog] input'), "Conclusion"); await sleep(100);
    dlg("Ajouter").click(); await sleep(300);
    check("bookmark added", JSON.stringify(ed.getJSON()).includes('"name":"Conclusion"'));
    btn("Renvoi").click(); await sleep(300);
    [...document.querySelectorAll("[role=option]")].find((o) => o.textContent.includes("Titre A")).click(); await sleep(100);
    dlg("Insérer").click(); await sleep(300);
    check("cross-reference inserted", JSON.stringify(ed.getJSON()).includes('"href":"#Titre_Titre_A"'));

    // Header, footer, page numbers: printed text on each sheet, pagination valid
    const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
    ed.commands.setContent(Array.from({ length: 50 }, (_, i) => `<p>Paragraphe ${i}. ${lorem.repeat(2)}</p>`).join("")); await sleep(900);
    [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "En-tête").click(); await sleep(250);
    byText("[role=menuitem]", "Modifier l'en-tête").click(); await sleep(300);
    setValue(document.querySelector('[role=dialog] input[aria-label="Contenu de l\'en-tête"]'), "Rapport confidentiel"); await sleep(100);
    dlg("Enregistrer").click(); await sleep(300);
    [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Numéro").click(); await sleep(250);
    byText("[role=menuitem]", "Bas de page, centré").click(); await sleep(1000);
    const hf = [...document.querySelectorAll(".page-sheet")].map((s) => [...s.querySelectorAll(".hf")].map((h) => h.textContent));
    check(`header + page numbers on every sheet (${hf.length} sheets, e.g. ${JSON.stringify(hf[1])})`, hf.length > 2 && hf.every((p, i) => p[0] === "Rapport confidentiel" && p[1] === `Page ${i + 1} sur ${hf.length}`));
    const a = window.__lomaAudit();
    check(`pagination valid with header/footer (${a.pages} pages)`, a.problems.length === 0, a.problems.slice(0, 2).join("|"));

    // Round trip through DOCX and ODT, natively
    const docs = await import("/src/services/documents/index.ts");
    ed.commands.setContent("<h1>T</h1><p>x</p>"); ed.commands.focus("end");
    ed.commands.insertBookmark("Ancre"); ed.commands.insertEquation("x^2");
    ed.commands.insertContent({ type: "text", text: "lien", marks: [{ type: "link", attrs: { href: "#Ancre" } }] });
    const model = { content: ed.getJSON(), page: { size: "A4", orientation: "portrait", margins: "normal" }, headerFooter: { header: { default: { text: "H", align: "right" } }, footer: { default: { text: "Page {PAGE} sur {PAGES}", align: "center" } }, titlePage: false, evenOdd: false } };
    for (const f of ["docx", "odt"]) {
      const { bytes } = await docs.serializeDocument(f, model);
      const back = await docs.openDocumentBytes(bytes, `x.${f}`);
      const s = JSON.stringify(back.model.content);
      check(`${f}: bookmark, equation, link, header, footer survive`, s.includes('"name":"Ancre"') && s.includes('"latex":"x^2"') && s.includes('"href":"#Ancre"') && back.model.headerFooter?.footer.default?.text === "Page {PAGE} sur {PAGES}" && back.model.headerFooter?.header.default?.text === "H");
    }
  } catch (e) { out("ERROR", String(e && e.stack || e).slice(0, 400)); }
  out("DONE", true);
})();
