#!/usr/bin/env python3
"""Reproduce the fixed-card-width measurements for the Agent Hub Power grid.

The Agent Hub page renders inside WebKitGTK on the target board, and jsdom has no
layout engine, so this is the only way to measure the real card boxes. The probe loads
the shipped `src/agentHub.css` itself -- not a copy of it -- into an offscreen
`WebKit2.WebView` together with the card markup `src/components/PowerCard.tsx` produces,
at a range of window sizes. The page sits inside a model of the host's own box: the
window minus the in-flow `15rem` sidebar gap minus the 2px window shell border, so the
column counts are the ones the real host produces.

It reports:

  * the card width, the number of columns and the space left on either side of the
    centred track block,
  * the header's overflow past the card's content box (the `Custom` badge and the
    version slot drifting out of their slot),
  * the `h2` / description top offsets, which must be identical on every card in a row
    (a Hub-managed card renders a native `<select>` at 31px, a hand-installed card a
    static label, and the two must occupy the same header height).

It measures the shipped stylesheet and, unless `--only shipped` is passed, the same
stylesheet with the fixes reversed (a `repeat(5, minmax(0, 1fr))` grid with the old
1240/980/720/480px column breakpoints, and the 26px static version label) as the
comparison baseline. `--only shipped` additionally asserts the contract -- one fixed
card width, three columns at the host's default window, one shared title/description
line, no header overflow and no sideways scroll -- so a regression exits non-zero:

    WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
        python3 docs/verification/probe-fixed-card-grid.py --only shipped

Requires GTK 3 + WebKit2 4.1 (`gir1.2-webkit2-4.1`), i.e. the board or any desktop with
the same stack.
"""

import argparse
import json
import pathlib
import sys

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

CSS_PATH = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'agentHub.css'
# BiBit's window sizes: 1200x800 default, 1024x740 minimum
# (bibit/src-tauri/tauri.linux.conf.json), plus fullscreen-width values above them.
WINDOWS = [(1920, 1080), (1600, 900), (1512, 982), (1440, 900), (1360, 850), (1300, 850),
           (1276, 800), (1200, 800), (1150, 800), (1100, 800), (1024, 740), (640, 700), (400, 700)]
DEFAULT_WINDOW = (1200, 800)
# The host chrome the page does not own: the in-flow sidebar gap (SIDEBAR_WIDTH = 15rem in
# bibit/web-app/src/components/ui/sidebar.tsx) and the window shell's 1px border on each
# side while the window is un-maximized (WindowSurfaceShell), i.e. 2px of width in total.
# `vw` still resolves against the window, so the page keeps clamp(20px, 4vw, 56px) padding
# exactly as in the real host.
HOST_SIDEBAR = 240
HOST_FRAME = 2
EXPECTED_DEFAULT_COLUMNS = 3

# The two card kinds that share a row: a Hub-managed card (native <select> version) and
# a hand-installed card (Custom badge + static version label). Versions are the canonical
# `vMAJOR.MINOR.PATCH` the DTO accepts, and `plugin` carries the widest type label, so
# plugin/custom with the longest version is the widest header the probe can produce.
CARDS = ''.join(
    f"""<article class="power-card" data-power-type="{ptype}"{' data-source="custom"' if custom else ''}>
  <div class="power-card__header">
    <span class="power-card__type">{ptype}</span>{badge}
    {slot}
  </div>
  <h2>foo-before-summary</h2>
  <p class="power-card__description">A description long enough to wrap over a few lines inside its fixed box.</p>
  <div class="power-card__tags"><span class="power-card__tag">benchmark</span></div>
</article>"""
    for ptype, custom, version in [
        ('skill', False, 'v1.0.0'), ('plugin', True, 'v1.2.3'), ('mcp', False, 'v2026.10.29'),
        ('agent', True, 'v1.10.100'), ('plugin', False, 'v2026.10.29'), ('plugin', True, 'No version'),
    ]
    for badge in ['<span class="power-card__badge">Custom</span>' if custom else '']
    for slot in [
        f'<span class="power-card__version power-card__version--static">{version}</span>'
        if custom else
        f'<select class="power-card__version"><option>{version}</option></select>'
    ]
) + ''.join(
    f"""<article class="power-card" data-power-type="skill">
  <div class="power-card__header"><span class="power-card__type">skill</span>
    <select class="power-card__version"><option>v1.2.{i}</option></select></div>
  <h2>markdown-maker</h2>
  <p class="power-card__description">Another description.</p>
  <div class="power-card__tags"><span class="power-card__tag">media</span></div>
</article>""" for i in range(15)
)

# Models the host: a fixed rail (the sidebar's in-flow gap) plus the page contribution box,
# inside a bordered shell whose content box is the window. `__CSS__`/`__CARDS__` are
# substituted with str.replace, because the stylesheet contains '%' (e.g. `78%`).
PAGE = """<!doctype html><meta charset=utf-8>
<style>
 html, body { margin: 0; }
 .hub-shell { display: flex; width: 100%%; height: 100vh; border: __FRAME__px solid #999; box-sizing: border-box; }
 .hub-rail { flex: 0 0 auto; width: __SIDEBAR__px; background: #eee; }
 /* The host's sidebar gap wrapper is `hidden md:block`: below the md breakpoint (768px)
    the sidebar becomes an overlay Sheet, so the page gets the whole window. */
 @media (max-width: 767px) { .hub-rail { display: none; } }
 .hub-page { flex: 1 1 auto; min-width: 0; overflow: hidden; }
__CSS__
</style>
<div class="hub-shell"><div class="hub-rail"></div><div class="hub-page">
<main class="agent-hub">
 <header><div><p>INTERNAL CATALOG</p><h1>Agent Hub</h1></div></header>
 <section class="agent-hub__grid" id="g">__CARDS__</section>
</main>
</div></div>
""".replace('__FRAME__', str(HOST_FRAME)).replace('__SIDEBAR__', str(HOST_SIDEBAR))

SHIPPED_GRID = """  grid-template-columns: repeat(auto-fill, minmax(min(var(--hub-card-width), 100%), var(--hub-card-width)));
  justify-content: center;
  gap: var(--hub-card-gap);"""

# The layout the report is about: five fixed `1fr` tracks plus the per-breakpoint column
# counts, and a static version label that is 5px shorter than the <select>.
LEGACY_GRID = """  grid-template-columns: repeat(5, minmax(0, 1fr));
  justify-content: start;
  gap: 20px;"""

LEGACY_MEDIA_ANCHOR = """@media (max-width: 480px) {
  .agent-hub { padding-inline: 14px; }"""

LEGACY_MEDIA = """@media (max-width: 1240px) { .agent-hub__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 980px)  { .agent-hub__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px)  { .agent-hub__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) {
  .agent-hub__grid { grid-template-columns: minmax(0, 1fr); }
  .agent-hub { padding-inline: 14px; }"""

SHIPPED_STATIC = """  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-height: var(--hub-version-height);
  max-width: 112px;
  overflow: hidden;
  padding: 3px 8px;"""

LEGACY_STATIC = """  display: inline-block;
  padding: 3px 8px;"""

# The card width the stylesheet must derive for BiBit's default window: the page box
# (1200 − 240 sidebar − 2 frame) minus the page padding (clamp(20px, 4vw, 56px) = 48px at
# that window) leaves 862px of content column; three cards plus three gaps fill it exactly.
EXPECTED_DEFAULT_CONTENT = 1200 - HOST_SIDEBAR - HOST_FRAME - 2 * 48
EXPECTED_CARD_WIDTH = (EXPECTED_DEFAULT_CONTENT - EXPECTED_DEFAULT_COLUMNS * 20) / EXPECTED_DEFAULT_COLUMNS

MEASURE = """(() => {
  const g = document.getElementById('g');
  const cards = [];
  for (const c of g.children) {
    const cb = c.getBoundingClientRect();
    const st = getComputedStyle(c);
    const padL = parseFloat(st.paddingLeft), padR = parseFloat(st.paddingRight);
    const contentL = cb.left + padL, contentR = cb.right - padR;
    const hdrEl = c.querySelector('.power-card__header');
    const hb = hdrEl.getBoundingClientRect();
    const kids = [...hdrEl.children];
    let overlap = 0;
    for (let i = 1; i < kids.length; i += 1)
      overlap = Math.max(overlap, kids[i-1].getBoundingClientRect().right - kids[i].getBoundingClientRect().left);
    cards.push({
      w: cb.width, t: Math.round(cb.top), h: Math.round(cb.height),
      custom: c.hasAttribute('data-source'),
      headerOver: Math.round(hb.right - contentR),
      headerLeftOver: Math.round(contentL - hb.left),
      overlap: Math.round(overlap),
      h2Top: Math.round(c.querySelector('h2').getBoundingClientRect().top - cb.top),
      descTop: Math.round(c.querySelector('.power-card__description').getBoundingClientRect().top - cb.top),
      titleClient: Math.round(c.querySelector('h2').clientWidth),
    });
  }
  const rows = {};
  for (const c of cards) (rows[c.t] = rows[c.t] || []).push(c);
  const keys = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const first = rows[keys[0]] || [];
  const gap = parseFloat(getComputedStyle(g).columnGap) || 0;
  const block = first.length ? first.length * cards[0].w + (first.length - 1) * gap : 0;
  const grid = g.getBoundingClientRect();
  const rounded = (n) => Math.round(n * 100) / 100;
  return JSON.stringify({
    winW: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    gridWidth: Math.round(grid.width),
    cols: keys.map(k => rows[k].length),
    cardWidths: [...new Set(cards.map(c => rounded(c.w)))],
    sideGap: Math.round((grid.width - block) / 2),
    firstRowLeft: first.length ? Math.round(grid.left + (grid.width - block) / 2) : null,
    h2Tops: [...new Set(cards.map(c => c.h2Top))],
    descTops: [...new Set(cards.map(c => c.descTop))],
    cardHeights: [...new Set(cards.map(c => Math.round(c.h)))],
    maxHeaderOver: Math.max(...cards.map(c => c.headerOver)),
    maxHeaderLeftOver: Math.max(...cards.map(c => c.headerLeftOver)),
    maxOverlap: Math.max(...cards.map(c => c.overlap)),
    customH2Tops: [...new Set(cards.filter(c => c.custom).map(c => c.h2Top))],
    managedH2Tops: [...new Set(cards.filter(c => !c.custom).map(c => c.h2Top))],
    titleClientWidths: [...new Set(cards.map(c => c.titleClient))],
  });
})()"""


def stylesheets():
    """The shipped stylesheet, and the same text with the two fixes reversed."""
    shipped = CSS_PATH.read_text(encoding='utf-8')
    for needle in (SHIPPED_GRID, SHIPPED_STATIC, LEGACY_MEDIA_ANCHOR):
        if needle not in shipped:
            raise SystemExit(f'FAILED: {CSS_PATH} no longer contains the rule this probe reverses:\n{needle}')
    legacy = shipped.replace(SHIPPED_GRID, LEGACY_GRID)
    legacy = legacy.replace(LEGACY_MEDIA_ANCHOR, LEGACY_MEDIA)
    legacy = legacy.replace(SHIPPED_STATIC, LEGACY_STATIC)
    return {
        f'shipped (fixed {EXPECTED_CARD_WIDTH:.2f}px card, centred, 31px version slot)': shipped,
        'before (5 x 1fr + breakpoints, 26px static version, 276px at fullscreen)': legacy,
    }


def render(css, window):
    view = WebKit2.WebView()
    win = Gtk.OffscreenWindow()
    win.add(view)
    win.show_all()
    view.set_size_request(*window)
    win.resize(*window)
    result = {}

    def done(v, task):
        try:
            result['value'] = json.loads(v.evaluate_javascript_finish(task).to_string())
        except Exception as exc:  # noqa: BLE001
            result['error'] = str(exc)
        Gtk.main_quit()

    def on_load(v, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(250, lambda: (v.evaluate_javascript(MEASURE, -1, None, None, None, done), False)[1])

    view.connect('load-changed', on_load)
    view.load_html(PAGE.replace('__CSS__', css).replace('__CARDS__', CARDS), 'file:///')
    GLib.timeout_add(60000, Gtk.main_quit)
    Gtk.main()
    win.destroy()
    return result


def main():
    parser = argparse.ArgumentParser(description='Measure the Agent Hub Power card grid.')
    parser.add_argument('--only', choices=['shipped', 'both'], default='both',
                        help='shipped also asserts the shipped layout contract')
    arguments = parser.parse_args()
    sheets = stylesheets()
    assert_mode = arguments.only == 'shipped'
    names = list(sheets)[:1] if assert_mode else list(sheets)

    failures = []
    for name in names:
        print(f'== {name}', flush=True)
        print('   window     cols  cardW    hdrOver  overlap  h2Tops  descTops  cardH  '
              'sideGap  docScrollW  rows', flush=True)
        for window in WINDOWS:
            measured = render(sheets[name], window)
            where = f'{window[0]}x{window[1]}'
            if 'value' not in measured:
                failures.append(f'{name} @ {where}: {measured}')
                print(f'   {where}: {measured}', flush=True)
                continue
            d = measured['value']
            widths = d['cardWidths']
            shown = f'{widths[0]:.2f}' if len(widths) == 1 else str(widths)
            print(f'   {where:<9s} {d["cols"][0]:2d}    {shown:>7s}  {d["maxHeaderOver"]:8d}  '
                  f'{d["maxOverlap"]:7d}  {str(d["h2Tops"]):>6s}  {str(d["descTops"]):>8s}  '
                  f'{str(d["cardHeights"]):>5s}  {d["sideGap"]:7d}  {d["docScrollW"]:10d}  '
                  f'{len(d["cols"]):4d}', flush=True)
            if not assert_mode:
                continue
            if window[0] > 400 and any(abs(w - EXPECTED_CARD_WIDTH) > 0.5 for w in widths):
                failures.append(f'{where}: card width {widths} != {EXPECTED_CARD_WIDTH:.2f}')
            if len(d['h2Tops']) != 1:
                failures.append(f'{where}: cards disagree on the title line {d["h2Tops"]} '
                                f'(custom {d["customH2Tops"]} vs managed {d["managedH2Tops"]})')
            if len(d['descTops']) != 1:
                failures.append(f'{where}: cards disagree on the description line {d["descTops"]}')
            if d['maxHeaderOver'] > 0 or d['maxHeaderLeftOver'] > 0:
                failures.append(f'{where}: header overflows its card by '
                                f'{max(d["maxHeaderOver"], d["maxHeaderLeftOver"])}px')
            if d['maxOverlap'] > 0:
                failures.append(f'{where}: header children overlap by {d["maxOverlap"]}px')
            if d['docScrollW'] > window[0]:
                failures.append(f'{where}: page scrolls sideways to {d["docScrollW"]}px')

    # The point of the card width: BiBit's default window must show three per row, not two
    # with the side gaps the user reported. A regression here is a user-visible defect even
    # though every other assertion still passes.
    if assert_mode:
        default_measure = render(sheets[names[0]], DEFAULT_WINDOW)
        d = default_measure.get('value')
        if not d:
            failures.append(f'default window {DEFAULT_WINDOW[0]}x{DEFAULT_WINDOW[1]}: {default_measure}')
        elif d['cols'][0] != EXPECTED_DEFAULT_COLUMNS:
            failures.append(f'default window {DEFAULT_WINDOW[0]}x{DEFAULT_WINDOW[1]}: '
                            f'{d["cols"][0]} columns, expected {EXPECTED_DEFAULT_COLUMNS} '
                            f'(card {d["cardWidths"]}, side gap {d["sideGap"]}px)')

    if assert_mode:
        if failures:
            print('\nFAILED:', flush=True)
            for failure in failures:
                print('  -', failure, flush=True)
            return 1
        print(f'\nOK: card {EXPECTED_CARD_WIDTH:.2f}px at every window, '
              f'{EXPECTED_DEFAULT_COLUMNS} columns at the host default, one shared '
              'title/description line.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
