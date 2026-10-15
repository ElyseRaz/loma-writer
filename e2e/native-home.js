// Native self-test of the "Accueil" tools (see e2e/README.md for the temporary injection).
(async () => {
  const out = (k, v) => fetch("http://127.0.0.1:9911", { method: "POST", body: JSON.stringify({ k, v }) }).catch(() => {});
  // Only the most recently started copy of this script keeps running (the dev server may reload the page twice).
  const runId = String(Math.random());
  localStorage.setItem("__selftest_run", runId);
  const sleep = (ms) => new Promise((r, j) => setTimeout(() => (localStorage.getItem("__selftest_run") === runId ? r() : j(new Error("superseded"))), ms));
  const check = (name, cond, extra = "") => out(cond ? "PASS" : "FAIL", name + (cond ? "" : "  " + extra));
  const setValue = (input, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); };
  const btn = (txt) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes(txt) || (b.getAttribute("aria-label") || "").includes(txt));
  const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o }));
  try {
    await sleep(3500);
    btn("Document vierge")?.click(); await sleep(600);
    const ed = window.__lomaEditor;
    ed.commands.setContent("<p>Le chat dort. Un chat noir, deux CHATS, un chaton.</p><p>Encore un chat ici.</p>");
    await sleep(300);
    ed.commands.focus("start");
    key("f", { ctrlKey: true }); await sleep(300);
    const q = document.querySelector('input[aria-label="Rechercher"]');
    check("Ctrl+F opens the find bar", !!q);
    setValue(q, "chat"); await sleep(400);
    check(`matches highlighted (${document.querySelectorAll(".find-match").length}/5)`, document.querySelectorAll(".find-match").length === 5);
    check("current match styled", document.querySelectorAll(".find-current").length === 1);
    btn("Afficher le remplacement")?.click(); await sleep(200);
    setValue(document.querySelector('input[aria-label="Remplacer par"]'), "loup"); await sleep(100);
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remplacer" && b.closest("[role=search]")).click(); await sleep(300);
    check("replace current", ed.getText().includes("Le loup dort"));
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Tout remplacer").click(); await sleep(400);
    check("replace all", !/chat/i.test(ed.getText().replace(/chaton/gi, "")), ed.getText());
    key("Escape"); await sleep(300);
    check("Escape closes the bar and clears highlights", !document.querySelector('[role=search]') && document.querySelectorAll(".find-match").length === 0);

    ed.commands.setContent('<p style="text-align:center"><strong><em>Modèle</em></strong></p><p>Texte à styler</p>');
    await sleep(300);
    ed.commands.setTextSelection(3);
    btn("Reproduire la mise en forme").click(); await sleep(200);
    check("format painter armed", btn("Reproduire la mise en forme").getAttribute("aria-pressed") === "true");
    ed.commands.setTextSelection({ from: 11, to: 16 });
    document.querySelector(".paper").dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); await sleep(400);
    const p2 = ed.getJSON().content[1];
    check("format copied (bold+italic, centered)", p2.content.some((n) => (n.marks || []).some((m) => m.type === "bold")) && p2.content.some((n) => (n.marks || []).some((m) => m.type === "italic")) && p2.attrs.textAlign === "center", JSON.stringify(p2));
    check("painter disarmed", btn("Reproduire la mise en forme").getAttribute("aria-pressed") !== "true");

    ed.commands.setContent("<p>Premier</p><p>Deuxième</p><p>Troisième</p>");
    await sleep(300);
    ed.commands.setTextSelection({ from: 2, to: 14 });
    btn("Trame de fond").click(); await sleep(200);
    [...document.querySelectorAll("button")].find((b) => b.getAttribute("title") === "#fef08a").click(); await sleep(300);
    const bg = getComputedStyle(ed.view.dom.querySelector("p")).backgroundColor;
    check(`shading visible (${bg})`, bg === "rgb(254, 240, 138)");
    check("only selected paragraphs shaded", getComputedStyle(ed.view.dom.querySelectorAll("p")[2]).backgroundColor === "rgba(0, 0, 0, 0)");
    ed.commands.setTextSelection(3);
    btn("Bordures").click(); await sleep(200);
    [...document.querySelectorAll("[role=menuitem]")].find((b) => b.textContent.includes("Bordure du bas")).click(); await sleep(300);
    const bw = getComputedStyle(ed.view.dom.querySelector("p")).borderBottomWidth;
    check(`bottom border drawn (${bw})`, bw === "1px");
    btn("Bordures").click(); await sleep(200);
    [...document.querySelectorAll("[role=menuitem]")].find((b) => b.textContent.includes("Aucune bordure")).click(); await sleep(300);
    check("border removed", getComputedStyle(ed.view.dom.querySelector("p")).borderBottomWidth === "0px");

    // pagination still valid with decorated paragraphs
    await import("/e2e/audit.js");
    const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
    ed.commands.setContent(Array.from({ length: 60 }, (_, i) => `<p>Paragraphe ${i}. ${lorem.repeat(2)}</p>`).join(""));
    ed.commands.selectAll(); ed.commands.setShading("#e5e7eb"); ed.commands.setBorders("all");
    await sleep(1200);
    const a = window.__lomaAudit();
    check(`decorated paragraphs paginate (${a.pages} pages)`, a.pages >= 3 && a.problems.length === 0, a.problems.slice(0, 3).join(" | "));
  } catch (e) { out("ERROR", String(e && e.stack || e).slice(0, 400)); }
  out("DONE", true);
})();
