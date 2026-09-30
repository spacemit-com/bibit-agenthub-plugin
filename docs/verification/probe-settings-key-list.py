#!/usr/bin/env python3
"""Measure the Settings tab's saved-key rows in an offscreen WebKitGTK view.

The Settings tab lists the saved APC keys as `head****tail` rows, each with its
own Enable / Delete actions. jsdom has no layout engine, so the two properties
that can only be checked by rendering are:

  * a long preview must not widen the panel nor give the page a horizontal
    scrollbar -- the page must never scroll sideways, and
  * the two row actions must stay on one line and inside the panel.

The probe loads the shipped `src/agentHub.css` itself -- not a copy -- into an
offscreen `WebKit2.WebView` together with the markup
`AgentHubSettingsPanel.tsx` produces, inside a model of the host's own box: the
window minus the in-flow 15rem sidebar minus the 2px shell border.

`--only shipped` asserts the contract and exits non-zero on a regression:

    WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
        python3 docs/verification/probe-settings-key-list.py --only shipped

Requires GTK 3 + WebKit2 4.1 (`gir1.2-webkit2-4.1`).
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
# BiBit's window sizes: 1200x800 default, 1024x740 minimum, plus wider and much
# narrower ones.
WINDOWS = [(1920, 1080), (1600, 900), (1440, 900), (1300, 850), (1200, 800), (1150, 800),
           (1024, 740), (900, 700), (640, 700), (400, 700)]
# The host chrome the page does not own, as in the other probes.
HOST_SIDEBAR = 240
HOST_FRAME = 2
# A preview far longer than any real key, so the row has to give way.
LONG_PREVIEW = 'apc-' + 'x' * 120 + '-tail'

PAGE = """<!doctype html><meta charset=utf-8>
<style>
 html, body { margin: 0; }
 .hub-shell { display: flex; width: 100%%; height: 100vh; border: __FRAME__px solid #999; box-sizing: border-box; }
 .hub-rail { flex: 0 0 auto; width: __SIDEBAR__px; background: #eee; }
 @media (max-width: 767px) { .hub-rail { display: none; } }
 .hub-page { flex: 1 1 auto; min-width: 0; overflow: hidden; }
__CSS__
 .agent-hub { height: 100vh; }
</style>
<div class="hub-shell"><div class="hub-rail"></div><div class="hub-page">
<main class="agent-hub">
<section class="agent-hub-settings-panel" id="panel">
  <div class="agent-hub-settings-panel__credential">
    <div class="agent-hub-settings-panel__credential-head">
      <strong>APC API Key</strong><span id="count">2 saved</span>
    </div>
    <small>Required to upload custom resources to APC.</small>
    <div class="agent-hub-settings-panel__credential-add">
      <input type="password" aria-label="APC API Key" value="">
      <button type="button">Save key</button>
    </div>
    <small>The saved key is only shown masked.</small>
  </div>
  <ul class="agent-hub-settings-panel__keys" aria-label="Saved API Keys">
    <li class="agent-hub-settings-panel__key" data-enabled="true" id="row-enabled">
      <span class="agent-hub-settings-panel__key-preview">apc-****-one</span>
      <span class="agent-hub-settings-panel__key-state">Enabled</span>
      <span class="agent-hub-settings-panel__key-actions">
        <button type="button" disabled>Enable</button><button type="button">Delete</button>
      </span>
    </li>
    <li class="agent-hub-settings-panel__key" data-enabled="false" id="row-long">
      <span class="agent-hub-settings-panel__key-preview">__LONG__</span>
      <span class="agent-hub-settings-panel__key-state">Not enabled</span>
      <span class="agent-hub-settings-panel__key-actions">
        <button type="button">Enable</button><button type="button">Delete</button>
      </span>
    </li>
  </ul>
  <footer><span role="status">Settings synchronized.</span></footer>
</section>
</main>
</div></div>
""".replace('__FRAME__', str(HOST_FRAME)).replace('__SIDEBAR__', str(HOST_SIDEBAR))

MARKUP = PAGE.replace('__LONG__', LONG_PREVIEW)

MEASURE = """(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left * 100) / 100, y: Math.round(r.top * 100) / 100,
             w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
             right: Math.round(r.right * 100) / 100, bottom: Math.round(r.bottom * 100) / 100 };
  };
  const panel = document.getElementById('panel');
  const rows = [...document.querySelectorAll('.agent-hub-settings-panel__key')];
  return JSON.stringify({
    winW: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    page: box(document.querySelector('.agent-hub')),
    panel: box(panel),
    rows: rows.map(box),
    rowActionTops: rows.map((row) =>
      [...row.querySelectorAll('.agent-hub-settings-panel__key-actions button')]
        .map((button) => Math.round(button.getBoundingClientRect().top))),
    rowActions: rows.map((row) => box(row.querySelector('.agent-hub-settings-panel__key-actions'))),
    rowPreviews: rows.map((row) => box(row.querySelector('.agent-hub-settings-panel__key-preview'))),
    addRow: box(document.querySelector('.agent-hub-settings-panel__credential-add')),
    addButton: box(document.querySelector('.agent-hub-settings-panel__credential-add button')),
    input: box(document.querySelector('.agent-hub-settings-panel__credential-add input')),
  });
})()"""


def render(window):
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
    view.load_html(MARKUP.replace('__CSS__', CSS_PATH.read_text(encoding='utf-8')), 'file:///')
    GLib.timeout_add(60000, Gtk.main_quit)
    Gtk.main()
    win.destroy()
    return result


def fmt(box):
    if box is None:
        return 'n/a'
    return f'{box["x"]:g},{box["y"]:g} {box["w"]:g}x{box["h"]:g}'


def main():
    parser = argparse.ArgumentParser(description='Measure the Settings tab saved-key rows.')
    parser.add_argument('--only', choices=['shipped', 'both'], default='both')
    arguments = parser.parse_args()
    assert_mode = arguments.only == 'shipped'
    failures = []

    print('   window     panel                  row[long]              rowActions   addRow', flush=True)
    for window in WINDOWS:
        measured = render(window)
        where = f'{window[0]}x{window[1]}'
        if 'value' not in measured:
            failures.append(f'{where}: {measured}')
            print(f'   {where}: {measured}', flush=True)
            continue
        d = measured['value']
        panel = d['panel']
        long_row = d['rows'][1] if len(d['rows']) > 1 else None
        long_actions = d['rowActions'][1] if len(d['rowActions']) > 1 else None
        print(f'   {where:<9s} {fmt(panel):<22s} {fmt(long_row):<22s} {fmt(long_actions):<12s} '
              f'{fmt(d["addRow"])}', flush=True)
        if not assert_mode:
            continue
        if panel is None or len(d['rows']) != 2:
            failures.append(f'{where}: the two key rows did not render')
            continue
        if d['docScrollW'] > d['winW'] + 1 or d['bodyScrollW'] > d['winW'] + 1:
            failures.append(f'{where}: the page scrolls sideways ({d["docScrollW"]}/{d["bodyScrollW"]} > {d["winW"]})')
        if panel['right'] > d['page']['right'] + 1:
            failures.append(f'{where}: the panel overflows the page column ({panel["right"]} > {d["page"]["right"]})')
        for index, row in enumerate(d['rows']):
            if row['right'] > panel['right'] + 1:
                failures.append(f'{where}: key row {index} overflows the panel ({row["right"]} > {panel["right"]})')
        for index, tops in enumerate(d['rowActionTops']):
            if len(set(tops)) != 1:
                failures.append(f'{where}: key row {index} actions are not on one line: {tops}')
        for index, actions in enumerate(d['rowActions']):
            if actions['right'] > panel['right'] - 6:
                failures.append(f'{where}: key row {index} actions reach past the panel padding '
                                f'({actions["right"]} vs {panel["right"]})')
        for index, preview in enumerate(d['rowPreviews']):
            if preview['right'] > panel['right'] + 1:
                failures.append(f'{where}: key row {index} preview overflows the panel ({preview["right"]})')
        # The add row must also stay inside: the field shrinks, the action does not.
        if d['addRow'] and d['addRow']['right'] > panel['right'] + 1:
            failures.append(f'{where}: the add row overflows the panel ({d["addRow"]["right"]})')
        if d['addButton'] and d['input'] and d['addButton']['x'] < d['input']['x']:
            failures.append(f'{where}: the Save key button moved left of the field')

    if assert_mode:
        for failure in failures:
            print('FAIL', failure, flush=True)
        print('PASS' if not failures else 'FAILED', f'({len(WINDOWS)} windows)', flush=True)
        return 1 if failures else 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
