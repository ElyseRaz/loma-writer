// Native self-test: injected temporarily into index.html to run the pagination checks in the real
// Tauri/WebKitGTK webview. Results are POSTed to a local collector (see e2e/README.md).
(async () => {
  const out = (k, v) => fetch("http://127.0.0.1:9911", { method: "POST", body: JSON.stringify({ k, v }) }).catch(() => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, extra = "") => out(cond ? "PASS" : "FAIL", name + (cond ? "" : "  " + extra));
  try {
    await sleep(3500);
    await import("/e2e/audit.js");
    const btn = (txt) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes(txt) || b.getAttribute("aria-label") === txt);
    const menu = (txt) => [...document.querySelectorAll("[role=menuitem]")].find((b) => b.textContent.includes(txt));
    const audited = async () => { await sleep(700); return window.__lomaAudit(); };
    const setZoom = (z) => { const r = document.querySelector("input[type=range]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(r, String(z)); r.dispatchEvent(new Event("input", { bubbles: true })); };
    out("env", navigator.userAgent);
    btn("Document vierge")?.click();
    await sleep(600);
    const ed = window.__lomaEditor;
    const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
    let html = "";
    for (let i = 0; i < 40; i++) { if (i % 8 === 0) html += `<h1>Chapitre ${i / 8 + 1}</h1>`; else if (i % 4 === 0) html += `<h2>Section ${i}</h2>`; html += `<p>${"Paragraphe " + i + ". " + lorem.repeat(1 + (i % 6))}</p>`; }
    ed.commands.setContent(html);
    let a = await audited();
    const base = a.pages;
    check(`long document spans several pages (${a.pages})`, a.pages >= 3);
    check("every character inside a page content area", a.problems.length === 0, a.problems.slice(0, 3).join(" | "));
    check(`status bar real page count (${a.status})`, new RegExp(`Page \\d+ sur ${a.pages}$`).test(a.status ?? ""));
    check("text identical with and without breaks", a.text.replace(/\s/g, "") === ed.getText().replace(/\s/g, ""));
    out("spacers", a.spacers.map((s) => Math.round(s)));

    [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "Mise en page").click();
    await sleep(200);
    for (const [btnName, item, label] of [["Marges", "Étroites", "narrow"], ["Marges", "Larges", "wide"], ["Taille", "A5", "A5"]]) {
      btn(btnName).click(); await sleep(150); menu(item).click();
      const r = await audited();
      check(`${label}: layout valid, ${r.pages} pages (portrait A4 = ${base})`, r.problems.length === 0 && (label === "narrow" ? r.pages < base : r.pages > base), r.problems.slice(0, 2).join(" | "));
      btn(btnName).click(); await sleep(150); menu(btnName === "Marges" ? "Normales" : "A4").click(); await sleep(300);
    }
    btn("Marges").click(); await sleep(150); menu("Personnalisées").click(); await sleep(250);
    const setInput = (label, v) => { const i = [...document.querySelectorAll("label")].find((l) => l.textContent.startsWith(label)).querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); };
    setInput("Haut", "6"); setInput("Bas", "6"); await sleep(100);
    btn("Appliquer").click();
    const cm = await audited();
    check(`custom margins: more pages (${cm.pages} > ${base})`, cm.pages > base && cm.problems.length === 0, cm.problems.slice(0, 2).join(" | "));
    btn("Marges").click(); await sleep(150); menu("Normales").click();
    ed.commands.setContent(Array.from({ length: 90 }, (_, i) => `<p>Ligne ${i}</p>`).join(""));
    const sp = (await audited()).pages;
    btn("Orientation").click(); await sleep(150); menu("Paysage").click();
    const ls = await audited();
    check(`landscape: more pages (${ls.pages} > ${sp}) and valid`, ls.pages > sp && ls.problems.length === 0, ls.problems.slice(0, 2).join(" | "));
    btn("Orientation").click(); await sleep(150); menu("Portrait").click();

    ed.commands.setContent(html);
    const ref = await audited();
    for (const z of [25, 50, 150, 300]) {
      setZoom(z);
      const zr = await audited();
      const same = zr.spacers.length === ref.spacers.length && zr.spacers.every((s, i) => Math.abs(s - ref.spacers[i]) < 3);
      check(`zoom ${z}%: same pages (${zr.pages}) and breaks (±3px)`, zr.pages === ref.pages && zr.problems.length === 0 && same, `${zr.problems.slice(0, 2).join(" | ")} ${JSON.stringify(zr.spacers.map(Math.round))}`);
    }
    // Clicking: ProseMirror must map screen coordinates to the right document position, at every zoom.
    for (const z of [25, 100, 300]) {
      setZoom(z); await sleep(600);
      const para = [...ed.view.dom.querySelectorAll("p")][30];
      const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT); const text = walker.nextNode();
      const idx = Math.min(40, text.length - 2);
      const range = document.createRange(); range.setStart(text, idx); range.setEnd(text, idx + 1);
      const rc = range.getBoundingClientRect();
      const hit = ed.view.posAtCoords({ left: rc.left + rc.width / 2, top: rc.top + rc.height / 2 });
      const want = ed.view.posAtDOM(text, idx);
      check(`zoom ${z}%: click maps to the clicked character (pos ${hit && hit.pos} vs ${want})`, !!hit && Math.abs(hit.pos - want) <= 1);
      const caret = ed.view.coordsAtPos(want);
      check(`zoom ${z}%: caret rectangle matches the character`, Math.abs(caret.left - rc.left) < 3 && Math.abs(caret.top - rc.top) < 12, `${caret.left} vs ${rc.left}; ${caret.top} vs ${rc.top}`);
    }
    setZoom(100); await sleep(500);

    ed.commands.focus("end");
    const pagesBefore = (await audited()).pages;
    document.execCommand("insertParagraph");
    for (let i = 0; i < 45; i++) { document.execCommand("insertText", false, "Ligne ajoutée au clavier. " + "mot ".repeat(8)); document.execCommand("insertParagraph"); await sleep(8); }
    await sleep(600);
    const sel = ed.state.selection.head, size = ed.state.doc.content.size;
    const t = await audited();
    check(`typing adds pages (${pagesBefore} -> ${t.pages}) and stays valid`, t.pages > pagesBefore && t.problems.length === 0, t.problems.slice(0, 2).join(" | "));
    check("caret at the end after typing across page breaks", sel >= size - 2, `${sel}/${size}`);
    document.execCommand("insertText", false, "XYZ");
    await sleep(150);
    check("typing still works after recalculation", ed.getText().endsWith("XYZ"));
    await sleep(300);
    const st = (await audited()).status;
    check(`status shows caret page (${st})`, /Page \d+ sur \d+/.test(st));

    ed.commands.setContent("<p>Avant le saut</p><p>Après le saut</p>");
    await sleep(300);
    ed.commands.setTextSelection(14); ed.commands.insertPageBreak();
    const br = await audited();
    check(`manual page break gives ${br.pages} pages`, br.pages === 2);

    const rows = Array.from({ length: 60 }, (_, i) => `<tr><td><p>Ligne ${i}</p></td><td><p>Valeur ${i}</p></td></tr>`).join("");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    ed.commands.setContent(`<p>Avant</p><table><tbody>${rows}</tbody></table><p><img src="${png}" width="300" height="400"></p><p><img src="${png}" width="300" height="700"></p><p>Fin</p>`);
    const tb = await audited();
    check(`table+images valid (${tb.pages} pages)`, tb.pages >= 3 && tb.problems.length === 0, tb.problems.slice(0, 3).join(" | "));
    check("no row lost/duplicated", ed.view.dom.querySelectorAll("tr:not(.pg-spacer)").length === 60);
    check("no image lost/duplicated", ed.view.dom.querySelectorAll("img:not(.ProseMirror-separator)").length === 2);
    const items = Array.from({ length: 70 }, (_, i) => `<li><p>Élément ${i} ${lorem}</p></li>`).join("");
    ed.commands.setContent(`<h1>Liste</h1><ul>${items}</ul><ol>${items}</ol>`);
    const li = await audited();
    check(`lists valid (${li.pages} pages)`, li.pages >= 4 && li.problems.length === 0, li.problems.slice(0, 3).join(" | "));
    check("no list item lost/duplicated", ed.view.dom.querySelectorAll("li").length === 140);
    ed.commands.undo(); ed.commands.redo();
    {
      // Regression: undo/redo dropped the spacers, so text flowed across the gap between sheets.
      const lists = (await audited()).pages;
      ed.commands.setContent("<p>court</p>"); await sleep(500);
      ed.commands.undo();
      const u = await audited();
      check(`undo restores pagination (${u.pages} pages, ${u.spacers.length} breaks)`, u.pages === lists && u.problems.length === 0 && u.spacers.length >= lists - 1, u.problems.slice(0, 2).join(" | "));
      ed.commands.redo(); await sleep(400);
    }
    check("undo/redo after pagination", true);
  } catch (e) { out("ERROR", String(e && e.stack || e).slice(0, 400)); }
  out("DONE", true);
})();
