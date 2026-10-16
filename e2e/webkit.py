#!/usr/bin/env python3
"""
Checks in the real engine of the desktop app (WebKitGTK), which Playwright/Chrome cannot stand in for: column layout, audit of every
character, and a real print job to PDF (the page count and the text of every page).

  Requires: `npm run dev` on :1420, python3-gi with WebKit2 4.1, poppler-utils (pdfinfo, pdftotext).
  Run:      python3 e2e/webkit.py
"""
import os, subprocess, sys, tempfile, time
os.environ.setdefault('LC_ALL', 'C')                      # the "Print to File" printer has a translated name otherwise
os.environ.setdefault('GTK_PRINT_BACKENDS', 'file')
os.environ.setdefault('WEBKIT_DISABLE_COMPOSITING_MODE', '1')
os.environ.setdefault('WEBKIT_DISABLE_DMABUF_RENDERER', '1')

import gi
gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'audit.js')) as _f:
    AUDIT = _f.read()
LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '

def rows(n, prefix='a'):
    return ''.join(f'<tr><td><p>{prefix}{r}</p></td><td><p>b{r}</p></td></tr>' for r in range(n))

# name, html, columns, markers that must be in the printed text, minimum number of pages
SCENARIOS = [
    ('one column, 4 pages', f'<p>START {LOREM * 6}</p>' * 14 + f'<p>FINDOC {LOREM}</p>', False, ['START', 'FINDOC'], 3),
    ('two columns: long paragraph, table with header, list', f'<p>Intro {LOREM}</p><p>LONGPARA {LOREM * 40}</p><table><tbody><tr><th><p>ENTETE1</p></th><th><p>ENTETE2</p></th></tr>{rows(40)}</tbody></table><ul><li><p>PUCE {LOREM * 10}</p></li></ul><p>FINDOC {LOREM}</p>', True, ['LONGPARA', 'ENTETE1', 'a39', 'PUCE', 'FINDOC'], 3),
    ('two columns: giant row, nested table in a list item, shaded paragraph', f'<p>Intro {LOREM}</p><table><tbody><tr><td><p>GEANTE {LOREM * 45}</p></td><td><p>court</p></td></tr></tbody></table><ul><li><p>Puce {LOREM}</p><table><tbody>{rows(12)}</tbody></table><p>Apres {LOREM * 25}</p></li></ul><p data-shading="#fecaca">ENCADRE {LOREM * 30}</p><p>FINDOC {LOREM}</p>', True, ['GEANTE', 'court', 'a11', 'ENCADRE', 'FINDOC'], 6),
    ('two columns: a cell spanning three rows at a column change', f'<p>Intro {LOREM}</p><table><tbody>' + rows(24) + '<tr><td rowspan="3"><p>SPAN</p></td><td><p>s1</p></td></tr><tr><td><p>s2</p></td></tr><tr><td><p>s3</p></td></tr>' + rows(30, 'z') + f'</tbody></table><p>FINDOC {LOREM}</p>', True, ['SPAN', 's1', 's2', 's3', 'z29', 'FINDOC'], 2),
    ('two columns: a table of 300 rows (about 18 pages)', f'<table><tbody><tr><th><p>ENTETE1</p></th><th><p>ENTETE2</p></th></tr>{rows(300)}</tbody></table><p>FINDOC {LOREM}</p>', True, ['a0', 'a299', 'FINDOC'], 6),
    ('one column: a table of 1500 rows (about 40 pages: no drift, no slowdown)', f'<table><tbody>{rows(1500)}</tbody></table><p>FINDOC {LOREM}</p>', False, ['a0', 'a1499', 'FINDOC'], 30),
]

TEST = r"""
window.__run = async (html, cols) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (sel, text) => { const el = [...document.querySelectorAll(sel)].find((e) => (e.textContent || '').trim() === text); if (!el) throw new Error('missing ' + text); el.click(); };
  try {
    while (!document.querySelector('.page-sheet')) await sleep(200);
    await sleep(1500);
    window.__lomaEditor.commands.setContent(html);
    await sleep(1200);
    click('[role=tab]', 'Mise en page'); await sleep(300);
    click('button', 'Colonnes'); await sleep(300);
    click('[role=menuitem]', cols ? 'Deux' : 'Une');
    await sleep(2000);
    const a = window.__lomaAudit();
    return JSON.stringify({ sheets: document.querySelectorAll('.page-sheet').length, shifts: document.querySelectorAll('.col-shift').length, heads: document.querySelectorAll('.col-header').length, problems: a.problems.slice(0, 3) });
  } catch (e) { return 'ERR ' + e.message; }
};
window.__ready = 1;
"""

def preflight():
    import shutil, socket
    for tool in ('pdfinfo', 'pdftotext'):
        if not shutil.which(tool): sys.exit(f'{tool} not found (poppler-utils)')
    try: socket.create_connection(('localhost', 1420), timeout=2).close()
    except OSError: sys.exit('nothing listens on :1420 (run `npm run dev`)')
preflight()

win = Gtk.OffscreenWindow(); win.set_default_size(1700, 1000)
wv = WebKit2.WebView.new_with_context(WebKit2.WebContext.new_ephemeral()); win.add(wv); win.show_all()
failed = 0
tmp = os.environ.get('LOMA_WK_KEEP') or tempfile.mkdtemp(prefix='loma-wk-')   # LOMA_WK_KEEP=dir keeps the PDFs
PAPER = os.environ.get('LOMA_WK_PAPER', 'a4')                                  # LOMA_WK_PAPER=letter prints on Letter paper
MARGIN_MM = float(os.environ.get('LOMA_WK_MARGIN', '0'))                        # LOMA_WK_MARGIN=5 prints with 5 mm printer margins
ONLY = os.environ.get('LOMA_WK_ONLY')                                         # LOMA_WK_ONLY=2 runs the third scenario only

def ok(cond, msg):
    global failed
    print(('PASS  ' if cond else 'FAIL  ') + msg)
    if not cond: failed += 1

def js(code, cb=None):
    def done(w, res, _):
        value = None
        try:
            v = w.evaluate_javascript_finish(res)
            value = v.to_string() if v is not None else None
        except Exception as e:
            if 'Unsupported result type' not in str(e): print('JS error:', e)
        if cb: cb(value)
    wv.evaluate_javascript(code, -1, None, None, None, done, None)

def wait_for(expr, then, tries=300):
    def check(left):
        js(f'String({expr})', lambda v: then() if v == 'true' else (GLib.timeout_add(200, lambda: (check(left - 1), False)[1]) if left > 0 else (ok(False, f'timeout waiting for {expr}'), finish())))
    check(tries)

def finish():
    print(f'\n{failed} check(s) FAILED' if failed else '\nAll WebKit checks passed')
    GLib.idle_add(lambda: (Gtk.main_quit(), False)[1])

_started = set()
def run_scenario(i):
    if i in _started: return
    _started.add(i)
    if i >= len(SCENARIOS): return finish()
    if ONLY is not None and str(i) != ONLY: return run_scenario(i + 1)
    name, html, cols, markers, min_pages = SCENARIOS[i]
    print(f'-- {name}')
    js(f'window.__res = null; window.__run({html!r}, {str(cols).lower()}).then((r) => {{ window.__res = r; }}); 0;')
    def poll():
        js('String(window.__res || "")', lambda v: print_it(v) if v else GLib.timeout_add(300, lambda: (poll(), False)[1]))
    def print_it(v):
        import json
        res = json.loads(v) if v.startswith('{') else {'err': v}
        ok('err' not in res, 'scenario ran' + (f' ({res.get("err")})' if 'err' in res else ''))
        if 'err' in res: return run_scenario(i + 1)
        ok(res['problems'] == [], 'every character stays inside its page and its column ' + '; '.join(res['problems']))
        ok(res['sheets'] >= min_pages, f'{res["sheets"]} pages on screen (>= {min_pages})')
        if cols: ok(res['shifts'] > 0, f'text and rows moved to their slots ({res["shifts"]})')
        pdf = os.path.join(tmp, f'{i}.pdf')
        op = WebKit2.PrintOperation.new(wv)
        ps = Gtk.PrintSettings()
        ps.set(Gtk.PRINT_SETTINGS_PRINTER, 'Print to File'); ps.set(Gtk.PRINT_SETTINGS_OUTPUT_FILE_FORMAT, 'pdf'); ps.set(Gtk.PRINT_SETTINGS_OUTPUT_URI, 'file://' + pdf)
        op.set_print_settings(ps)
        pg = Gtk.PageSetup(); pg.set_paper_size(Gtk.PaperSize.new(Gtk.PAPER_NAME_LETTER if PAPER == 'letter' else Gtk.PAPER_NAME_A4))
        for side in ('top', 'bottom', 'left', 'right'): getattr(pg, f'set_{side}_margin')(MARGIN_MM, Gtk.Unit.MM)
        op.set_page_setup(pg)
        def after(_o):
            try:
                pages = int(subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout.split('Pages:')[1].split()[0])
                text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
            except Exception as e:
                ok(False, f'pdf tools: {e}'); return run_scenario(i + 1)
            ok(pages == res['sheets'], f'the print job has one page per sheet ({pages} / {res["sheets"]})')
            page_texts = text.split('\f')[:pages]
            empty = [n + 1 for n, t in enumerate(page_texts) if not t.strip()]
            ok(not empty, f'no printed page is empty {empty}')
            order = [next((n for n, t in enumerate(page_texts) if m in t), -1) for m in markers]
            for m, at in zip(markers, order): ok(at >= 0, f'"{m}" is in the printed text (page {at + 1})')
            ok(order == sorted(order), f'the markers come out in document order (pages {[a + 1 for a in order]})')
            ok(all(sum(m in t for t in page_texts) <= 1 or m in ('court', 'ENTETE1', 'START') for m in markers), 'no marker is printed twice')
            run_scenario(i + 1)
        op.connect('finished', after)
        op.connect('failed', lambda o, e: (ok(False, f'print failed: {e.message}'), run_scenario(i + 1)))
        op.print_()
    poll()

def loaded(w, ev):
    if ev != WebKit2.LoadEvent.FINISHED: return
    js(AUDIT, lambda _: js(TEST, lambda _: js(r"""(async () => { let s = null; while (!s) { s = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Document vierge'); await new Promise((r) => setTimeout(r, 200)); } s.click(); })(); 0;""", lambda _: wait_for('!!window.__lomaEditor', lambda: run_scenario(0)))))

wv.connect('load-changed', loaded)
GLib.timeout_add(560000, lambda: (print('global timeout'), sys.exit(2)))
wv.load_uri('http://localhost:1420')
Gtk.main()
sys.exit(1 if failed else 0)
