#!/usr/bin/env python3
"""Measure the Agent Hub page-header action row (manual refresh + create resource).

The header lives inside WebKitGTK, where jsdom has no layout engine, so the icon
button's sizing and the row it shares with the create entry can only be checked by
rendering. The probe loads the shipped `src/agentHub.css` itself -- not a copy of
it -- into an offscreen `WebKit2.WebView` together with the header markup
`src/AgentHubPage.tsx` produces (title block, `.agent-hub__create` column with the
`.agent-hub__actions` row and the unavailable note), inside a model of the host's
own box: the window minus the in-flow `15rem` sidebar gap minus the 2px shell
border.

It reports, at every host window size:

  * the refresh and create button boxes (width, height, top) and whether they share
    one row at the same height with the refresh icon to the left,
  * the create button's box next to the same header rendered without the refresh
    entry, which is what "does not crowd out the existing element" means here,
  * the header's overflow past the page's content box and whether the page scrolls
    sideways,
  * the `↻` glyph's advance width at the rendered font size, so a font that has no
    arrow glyph (which would render as a tofu box) is visible in the report.

`--only shipped` asserts the contract -- two same-height buttons on one row, the
refresh icon square and on the left, the create entry unmoved, nothing overflowing,
no sideways scroll -- so a regression exits non-zero:

    WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
        python3 docs/verification/probe-refresh-button.py --only shipped

Requires GTK 3 + WebKit2 4.1 (`gir1.2-webkit2-4.1`), i.e. the board or any desktop
with the same stack.
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
# (bibit/src-tauri/tauri.linux.conf.json), plus wider and much narrower ones.
WINDOWS = [(1920, 1080), (1600, 900), (1440, 900), (1300, 850), (1200, 800), (1150, 800),
           (1024, 740), (900, 700), (640, 700), (400, 700)]
DEFAULT_WINDOW = (1200, 800)
# The host chrome the page does not own, as in the card-grid probe.
HOST_SIDEBAR = 240
HOST_FRAME = 2
# The two header buttons must end up the same height, whatever that height is: the
# create entry is a native button sized by WebKit's control font, the refresh entry
# follows it. Only their equality and the icon's squareness are contractual.

# The header AgentHubPage renders. `__REFRESH__` is the new entry, `__NOTE__` the
# unavailable description; both are substituted so the same markup can be measured
# with and without the refresh button.
REFRESH_BUTTON = (
    '<button type="button" class="agent-hub__refresh" aria-label="Refresh" title="Refresh">'
    '<span aria-hidden="true">\u21bb</span></button>'
)
CREATE_BUTTON = '<button type="button">Create a resource</button>'
NOTE = (
    '<p id="agent-hub-create-unavailable" class="agent-hub__create-note">'
    'Opening a new conversation is unavailable because this host does not provide it.</p>'
)

PAGE = """<!doctype html><meta charset=utf-8>
<style>
 html, body { margin: 0; }
 .hub-shell { display: flex; width: 100%%; height: 100vh; border: __FRAME__px solid #999; box-sizing: border-box; }
 .hub-rail { flex: 0 0 auto; width: __SIDEBAR__px; background: #eee; }
 @media (max-width: 767px) { .hub-rail { display: none; } }
 .hub-page { flex: 1 1 auto; min-width: 0; overflow: hidden; }
__CSS__
</style>
<div class="hub-shell"><div class="hub-rail"></div><div class="hub-page">
<main class="agent-hub">
 <header id="h">
  <div><p>INTERNAL CATALOG</p><h1>Agent Hub</h1></div>
  <div class="agent-hub__create" id="col">
   <div class="agent-hub__actions" id="row">__REFRESH____CREATE__</div>
   __NOTE__
  </div>
 </header>
</main>
</div></div>
""".replace('__FRAME__', str(HOST_FRAME)).replace('__SIDEBAR__', str(HOST_SIDEBAR))

WITH_REFRESH = PAGE.replace('__REFRESH__', REFRESH_BUTTON).replace('__CREATE__', CREATE_BUTTON).replace('__NOTE__', NOTE)
WITHOUT_REFRESH = PAGE.replace('__REFRESH__', '').replace('__CREATE__', CREATE_BUTTON).replace('__NOTE__', NOTE)

MEASURE = """(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 100) / 100, y: Math.round(r.top * 100) / 100,
             w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
             right: Math.round(r.right * 100) / 100, bottom: Math.round(r.bottom * 100) / 100 };
  };
  const page = document.querySelector('.agent-hub');
  const st = getComputedStyle(page);
  const padL = parseFloat(st.paddingLeft), padR = parseFloat(st.paddingRight);
  const pb = page.getBoundingClientRect();
  const contentL = pb.left + padL, contentR = pb.right - padR;
  const refresh = document.querySelector('.agent-hub__refresh');
  const buttons = [...document.querySelectorAll('#row button')];
  const create = buttons[buttons.length - 1];
  const header = document.getElementById('h');
  const title = header.firstElementChild;
  // Advance width of the arrow glyph at the rendered font size, via a canvas so
  // no layout box can influence it.
  const context = document.createElement('canvas').getContext('2d');
  const refreshStyle = refresh ? getComputedStyle(refresh) : null;
  context.font = refreshStyle
    ? `${refreshStyle.fontStyle} ${refreshStyle.fontWeight} ${refreshStyle.fontSize} ${refreshStyle.fontFamily}`
    : '20px sans-serif';
  return JSON.stringify({
    winW: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    contentL: Math.round(contentL), contentR: Math.round(contentR),
    refresh: box(refresh),
    create: box(create),
    createText: create ? create.textContent : null,
    row: box(document.getElementById('row')),
    col: box(document.getElementById('col')),
    header: box(header),
    title: box(title),
    note: box(document.querySelector('.agent-hub__create-note')),
    noteAlign: getComputedStyle(document.querySelector('.agent-hub__create-note')).textAlign,
    buttonCount: buttons.length,
    headerOverRight: Math.round(header.getBoundingClientRect().right - contentR),
    headerOverLeft: Math.round(contentL - header.getBoundingClientRect().left),
    glyphWidth: Math.round(context.measureText('\\u21bb').width * 100) / 100,
    fontSize: refreshStyle ? refreshStyle.fontSize : null,
  });
})()"""


def render(markup, window):
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
    view.load_html(markup.replace('__CSS__', CSS_PATH.read_text(encoding='utf-8')), 'file:///')
    GLib.timeout_add(60000, Gtk.main_quit)
    Gtk.main()
    win.destroy()
    return result


def fmt(box):
    if box is None:
        return 'n/a'
    return f'{box["x"]:g},{box["y"]:g} {box["w"]:g}x{box["h"]:g}'


def main():
    parser = argparse.ArgumentParser(description='Measure the Agent Hub header action row.')
    parser.add_argument('--only', choices=['shipped', 'both'], default='both',
                        help='shipped also asserts the shipped header contract')
    arguments = parser.parse_args()
    assert_mode = arguments.only == 'shipped'
    failures = []

    print('== with the refresh entry', flush=True)
    print('   window     refresh            create             sameRow  glyph  hdrOver  docScrollW', flush=True)
    for window in WINDOWS:
        measured = render(WITH_REFRESH, window)
        where = f'{window[0]}x{window[1]}'
        if 'value' not in measured:
            failures.append(f'{where}: {measured}')
            print(f'   {where}: {measured}', flush=True)
            continue
        d = measured['value']
        refresh, create = d['refresh'], d['create']
        same_row = (
            refresh is not None
            and abs((refresh['y'] + refresh['h'] / 2) - (create['y'] + create['h'] / 2)) <= 1
            and refresh['right'] <= create['x'] + 0.5
        )
        print(f'   {where:<9s} {fmt(refresh):<18s} {fmt(create):<18s} {str(same_row):<7s}  '
              f'{d["glyphWidth"]:5.1f}  {d["headerOverRight"]:7d}  {d["docScrollW"]:10d}', flush=True)
        if not assert_mode:
            continue
        if d['buttonCount'] != 2:
            failures.append(f'{where}: {d["buttonCount"]} buttons in the action row, expected 2')
        if not same_row:
            failures.append(f'{where}: refresh {refresh} and create {create} are not one left-to-right row')
        if abs(refresh['h'] - create['h']) > 0.5:
            failures.append(f'{where}: refresh is {refresh["h"]}px high but the create entry is '
                            f'{create["h"]}px, so the row has two heights')
        if abs(refresh['w'] - refresh['h']) > 0.5:
            failures.append(f'{where}: refresh button is not square ({refresh["w"]}x{refresh["h"]})')
        if d['headerOverRight'] > 0 or d['headerOverLeft'] > 0:
            failures.append(f'{where}: header overflows its content box by '
                            f'{max(d["headerOverRight"], d["headerOverLeft"])}px')
        if d['docScrollW'] > window[0]:
            failures.append(f'{where}: page scrolls sideways to {d["docScrollW"]}px')
        if d['note'] is None or d['note']['y'] < refresh['bottom'] - 0.5:
            failures.append(f'{where}: the unavailable note is not below the action row ({d["note"]})')
        if d['noteAlign'] != 'right':
            failures.append(f'{where}: the note is not right-aligned ({d["noteAlign"]})')
        if d['glyphWidth'] <= 0:
            failures.append(f'{where}: the refresh glyph has no advance width')

    print('\n== without the refresh entry (baseline for "does not crowd out")', flush=True)
    print('   window     create             baseline create    moved?', flush=True)
    for window in WINDOWS:
        measured = render(WITHOUT_REFRESH, window)
        where = f'{window[0]}x{window[1]}'
        if 'value' not in measured:
            failures.append(f'{where}: baseline render {measured}')
            print(f'   {where}: {measured}', flush=True)
            continue
        d = measured['value']
        with_entry = render(WITH_REFRESH, window).get('value')
        create, before = d['create'], with_entry['create'] if with_entry else None
        moved = before is not None and (
            abs(before['w'] - create['w']) > 0.5 or abs(before['h'] - create['h']) > 0.5
            or abs(before['y'] - create['y']) > 1
        )
        print(f'   {where:<9s} {fmt(create):<18s} {fmt(before):<18s} {str(moved):<6s}', flush=True)
        if not assert_mode:
            continue
        if before is None:
            failures.append(f'{where}: could not measure the create entry with the refresh button')
        elif moved:
            # The refresh entry may only extend the row leftwards; the create entry's
            # own box (width and height) must not shrink or move to another line.
            failures.append(f'{where}: the create entry changed with the refresh button '
                            f'({create} -> {before})')

    if assert_mode:
        if failures:
            print('\nFAILED:', flush=True)
            for failure in failures:
                print('  -', failure, flush=True)
            return 1
        print('\nOK: one same-height action row at every window, refresh icon square and on the left, '
              'the create entry unmoved, no header overflow and no sideways scroll.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
