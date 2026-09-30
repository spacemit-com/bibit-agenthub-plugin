#!/usr/bin/env python3
"""Render the Agent Hub page in both themes and check the dark one really applies.

The page shipped light-only literals (`#f5f6f8`, `#fff`, ...), so it stayed light
while the host switched to dark. jsdom resolves neither `light-dark()` nor
`color-scheme`, so the fix can only be proven by rendering.

The probe loads the shipped `src/agentHub.css` into an offscreen
`WebKit2.WebView` inside a model of the host, and renders it twice: once with the
HTML the host produces in light mode, once with `class="dark"` on `<html>` and the
matching `color-scheme` — exactly the two states `ThemeProvider` toggles. Panel
colours are read back with `getComputedStyle`, plus the painted pixels of a
screenshot for the two values `getComputedStyle` reports as a gradient.

`--only shipped` asserts the contract and exits non-zero on a regression:

    WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
        python3 docs/verification/probe-dark-mode.py --only shipped

Requires GTK 3 + WebKit2 4.1 (`gir1.2-webkit2-4.1`).
"""

import argparse
import json
import pathlib
import re
import sys

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

CSS_PATH = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'agentHub.css'
WINDOWS = [(1600, 900), (1200, 800), (1024, 740)]

# The host's own dark tokens, for the comparison in the report.
HOST_DARK_BG = (0x12, 0x12, 0x12)

MARKUP = """<!doctype html><meta charset=utf-8>
<style>
  html { color-scheme: light; }
  html.dark { color-scheme: dark; }
  html, body { margin: 0; }
__CSS__
</style>
<main class="agent-hub">
  <header><div><h1>Capabilities</h1></div></header>
  <div class="power-filters">
    <div class="power-filters__scopes"><button type="button" class="power-filters__scope" aria-pressed="true">My Capabilities</button></div>
    <div class="power-filters__panel">
      <div class="power-filters__filter-row"><span class="power-filters__label">Type</span></div>
      <p class="agent-hub__status" id="status" role="status">Loading capabilities…</p>
    </div>
  </div>
  <section class="agent-hub__grid" aria-label="Available Powers">
    <article class="power-card" data-power-type="mcp" id="card-mcp">
      <div class="power-card__header"><span class="power-card__type">MCP</span></div>
      <h2 id="mcp-title">mcp-demo</h2>
      <p class="power-card__description">An MCP server.</p>
    </article>
    <article class="power-card" data-source="custom" data-power-type="skill" id="card-custom">
      <div class="power-card__header">
        <span class="power-card__type">Skill</span><span class="power-card__badge" id="badge">Custom</span>
        <span class="power-card__version power-card__version--static" id="static-version">v1.0.0</span>
      </div>
      <h2 id="custom-title">hand-written</h2>
      <p class="power-card__description">Installed by hand.</p>
      <div class="power-card__tags"><span class="power-card__tag" id="custom-tag">custom</span></div>
    </article>
    <article class="power-card" data-power-type="mcp" id="card-mcp-tag">
      <div class="power-card__header"><span class="power-card__type">MCP</span></div>
      <h2 id="mcp-tag-title">mcp-tagged</h2>
      <div class="power-card__tags"><span class="power-card__tag" id="mcp-tag">official</span></div>
    </article>
  </section>
  <div class="power-pagination"><button type="button" id="prev">‹</button><p>Page 1 / 1</p></div>
  <div class="agent-hub-settings-panel">
    <div class="agent-hub-settings-panel__credential"><strong>APC API Key</strong><span id="count">No key saved</span>
      <div class="agent-hub-settings-panel__credential-add"><input type="password" id="key" value=""><button type="button" id="save">Save key</button></div>
    </div>
    <ul class="agent-hub-settings-panel__keys"><li class="agent-hub-settings-panel__key" data-enabled="true"><span class="agent-hub-settings-panel__key-preview" id="preview">apc-****-one</span></li></ul>
  </div>
</main>"""

MEASURE = """(() => {
  const px = (id, prop, pseudo) => {
    const el = document.getElementById(id);
    if (!el) return null;
    return getComputedStyle(el, pseudo || null)[prop];
  };
  const page = document.querySelector('.agent-hub');
  return JSON.stringify({
    scheme: getComputedStyle(document.documentElement).colorScheme,
    pageBg: getComputedStyle(page).backgroundColor,
    pageText: getComputedStyle(page).color,
    cardBgImage: getComputedStyle(document.getElementById('card-mcp')).backgroundImage,
    cardBorder: px('card-mcp', 'borderTopColor'),
    cardShadow: px('card-mcp', 'boxShadow'),
    mcpTitle: px('mcp-title', 'color'),
    mcpTagBg: getComputedStyle(document.getElementById('mcp-tag')).backgroundColor,
    mcpTagText: getComputedStyle(document.getElementById('mcp-tag')).color,
    customBorder: px('card-custom', 'borderTopColor'),
    customBgImage: getComputedStyle(document.getElementById('card-custom')).backgroundImage,
    customBadgeBg: getComputedStyle(document.getElementById('badge')).backgroundColor,
    customBadgeText: getComputedStyle(document.getElementById('badge')).color,
    customBadgeBorder: getComputedStyle(document.getElementById('badge')).borderTopColor,
    customTagBg: getComputedStyle(document.getElementById('custom-tag')).backgroundColor,
    customTagText: getComputedStyle(document.getElementById('custom-tag')).color,
    staticVersionBg: getComputedStyle(document.getElementById('static-version')).backgroundColor,
    staticVersionText: getComputedStyle(document.getElementById('static-version')).color,
    statusBg: getComputedStyle(document.getElementById('status')).backgroundColor,
    statusText: getComputedStyle(document.getElementById('status')).color,
    label: px('count', 'color'),
    prevBg: px('prev', 'backgroundColor'),
    prevLine: px('prev', 'borderTopColor'),
    saveBg: px('save', 'backgroundColor'),
    saveText: px('save', 'color'),
    inputBg: px('key', 'backgroundColor'),
    keyRowBg: getComputedStyle(document.querySelector('.agent-hub-settings-panel__key')).backgroundColor,
    backdrop: (() => {
      const d = document.createElement('dialog');
      // The class matters: `.agent-hub-dialog::backdrop` is what carries the pair.
      d.className = 'agent-hub-dialog';
      document.querySelector('.agent-hub').append(d);
      d.showModal();
      const v = getComputedStyle(d, '::backdrop').backgroundColor;
      d.close(); d.remove();
      return v;
    })(),
  });
})()"""


def colors(text):
    """Every colour in a computed value, in order. Handles `rgb(...)` and
    `linear-gradient(145deg, rgb(...) 34%, rgb(...))`, where the angle must not be
    mistaken for a channel; the last entry is the tinted end of the card fill."""
    out = []
    for body in re.findall(r'rgba?\(([^)]*)\)', text or ''):
        nums = [int(n) for n in re.findall(r'\d+', body)[:3]]
        if len(nums) == 3:
            out.append(tuple(nums))
    return out


def rgb(text):
    found = colors(text)
    return found[0] if found else None


def tint(text):
    """The gradient's tinted end -- the colour a card visibly differs by."""
    found = colors(text)
    return found[-1] if found else None


def relative_luminance(color):
    def channel(value):
        v = value / 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in color)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = relative_luminance(a), relative_luminance(b)
    return round((max(la, lb) + 0.05) / (min(la, lb) + 0.05), 2)


def hue(color):
    """HSL hue in degrees; the lightest channel is the reference."""
    r, g, b = (c / 255 for c in color)
    high, low = max(r, g, b), min(r, g, b)
    if high == low:
        return 0.0, 0.0
    delta = high - low
    if high == r:
        raw = ((g - b) / delta) % 6
    elif high == g:
        raw = (b - r) / delta + 2
    else:
        raw = (r - g) / delta + 4
    return (raw * 60) % 360, (delta / high)


def hue_gap(hue_a, sat_a, hue_b, sat_b):
    """Hue distance in degrees; a grey has no hue, so it is treated as far away."""
    if sat_a < 0.04 or sat_b < 0.04:
        return 180.0
    raw = abs(hue_a - hue_b) % 360
    return min(raw, 360 - raw)


def render(window, dark):
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
        if event != WebKit2.LoadEvent.FINISHED:
            return
        if dark:
            v.evaluate_javascript(
                "document.documentElement.classList.add('dark')", -1, None, None, None,
                lambda *a: None, None,
            )
        GLib.timeout_add(250, lambda: (v.evaluate_javascript(MEASURE, -1, None, None, None, done), False)[1])

    view.connect('load-changed', on_load)
    view.load_html(MARKUP.replace('__CSS__', CSS_PATH.read_text(encoding='utf-8')), 'file:///')
    GLib.timeout_add(60000, Gtk.main_quit)
    Gtk.main()
    win.destroy()
    return result


def measure_all(window):
    light = render(window, False)
    dark = render(window, True)
    if 'value' not in light or 'value' not in dark:
        raise SystemExit(f'render failed at {window}: light={light} dark={dark}')
    return light['value'], dark['value']


def assert_shipped(pairs):
    failures = []
    for window, (light, dark) in pairs:
        where = f'{window[0]}x{window[1]}'
        # 1. The host's signal must actually reach the page.
        if light['scheme'] != 'light' or dark['scheme'] != 'dark':
            failures.append(f'{where}: color-scheme did not follow the host ({light["scheme"]}/{dark["scheme"]})')
        # 2. The page surface must be dark, not a light literal.
        dark_bg = rgb(dark['pageBg'])
        if dark_bg is None or relative_luminance(dark_bg) > 0.2:
            failures.append(f'{where}: page background stayed light in dark mode ({dark["pageBg"]})')
        if rgb(light['pageBg']) == dark_bg:
            failures.append(f'{where}: page background is identical in both themes ({dark["pageBg"]})')
        # 3. Body copy must clear 4.5:1 on the page in both themes.
        for label, mode in (('light', light), ('dark', dark)):
            ratio = contrast(rgb(mode['pageText']), rgb(mode['pageBg']))
            if ratio < 4.5:
                failures.append(f'{where}: {label} body text contrast {ratio} < 4.5')
        # 4. The status surface and its text must both flip.
        if rgb(light['statusBg']) == rgb(dark['statusBg']):
            failures.append(f'{where}: status surface did not change between themes')
        if contrast(rgb(dark['statusText']), rgb(dark['statusBg'])) < 4.5:
            failures.append(f'{where}: dark status text contrast '
                            f'{contrast(rgb(dark["statusText"]), rgb(dark["statusBg"]))} < 4.5')
        # 5. Controls (pagination, settings) must flip too.
        if rgb(light['prevBg']) == rgb(dark['prevBg']):
            failures.append(f'{where}: pagination button surface did not change between themes')
        if rgb(light['inputBg']) == rgb(dark['inputBg']):
            failures.append(f'{where}: settings input surface did not change between themes')
        if rgb(light['keyRowBg']) == rgb(dark['keyRowBg']):
            failures.append(f'{where}: settings key row did not change between themes')
        for label, fg, bg in (
            ('dark save button', rgb(dark['saveText']), rgb(dark['saveBg'])),
            ('dark status text', rgb(dark['statusText']), rgb(dark['statusBg'])),
            ('dark custom badge', rgb(dark['customBadgeText']), rgb(dark['customBadgeBg'])),
        ):
            if contrast(fg, bg) < 4.5:
                failures.append(f'{where}: {label} contrast {contrast(fg, bg)} < 4.5')
        # 6. The modal backdrop must darken in dark mode.
        if light['backdrop'] == dark['backdrop']:
            failures.append(f'{where}: dialog backdrop did not change between themes')
        # 7. The custom family must not read as MCP's. What the user sees side by side
        #    is the Custom badge / card edge / card fill against the MCP card's, so
        #    compare those and require a real hue separation. The old amber badge and
        #    the MCP chip were 21 degrees apart on the hue circle, and the two card
        #    fills were within 0.7 ΔE -- indistinguishable at a glance.
        for label, mode in (('light', light), ('dark', dark)):
            pairs_to_check = [
                ('badge vs MCP chip', rgb(mode['customBadgeBg']), rgb(mode['mcpTagBg'])),
                ('card edge vs MCP edge', rgb(mode['customBorder']), rgb(mode['cardBorder'])),
                ('card fill vs MCP fill', tint(mode['customBgImage']), tint(mode['cardBgImage'])),
            ]
            for what, custom_rgb, mcp_rgb in pairs_to_check:
                if custom_rgb is None or mcp_rgb is None:
                    failures.append(f'{where}: {label} {what}: could not read a colour')
                    continue
                if custom_rgb == mcp_rgb:
                    failures.append(f'{where}: {label} {what}: identical ({custom_rgb})')
                    continue
                gap = hue_gap(*hue(custom_rgb), *hue(mcp_rgb))
                # The fill pair is a very pale tint, where hue is the only usable
                # signal; a 40-degree floor accepts the shipped rose (73) and the
                # old amber (21) fails it.
                minimum = 40 if 'fill' in what else 30
                if gap < minimum:
                    failures.append(f'{where}: {label} {what}: only {gap:.0f} degrees apart '
                                    f'({custom_rgb} vs {mcp_rgb})')
    return failures


def main():
    parser = argparse.ArgumentParser(description='Measure the Agent Hub page in both themes.')
    parser.add_argument('--only', choices=['shipped', 'both'], default='both')
    arguments = parser.parse_args()
    assert_mode = arguments.only == 'shipped'
    failures = []
    pairs = []

    print('   window     theme  scheme  pageBg    pageText  statusBg  prevBg    customBadge  customChip  mcpChip', flush=True)
    for window in WINDOWS:
        light, dark = measure_all(window)
        pairs.append((window, (light, dark)))
        for label, mode in (('light', light), ('dark', dark)):
            print(f'   {window[0]}x{window[1]:<6} {label:<6} {mode["scheme"]:<7} {mode["pageBg"]:<9} '
                  f'{mode["pageText"]:<9} {mode["statusBg"]:<9} {mode["prevBg"]:<9} '
                  f'{mode["customBadgeBg"]:<12} {mode["customTagBg"]:<11} {mode["mcpTagBg"]}', flush=True)
        print(f'   {" ":>11} custom badge vs text {contrast(rgb(dark["customBadgeText"]), rgb(dark["customBadgeBg"]))}'
              f' | page text vs bg (dark) {contrast(rgb(dark["pageText"]), rgb(dark["pageBg"]))}', flush=True)
        if assert_mode:
            failures.extend(assert_shipped([(window, (light, dark))]))

    if assert_mode:
        for failure in failures:
            print('FAIL', failure, flush=True)
        print('PASS' if not failures else 'FAILED', f'({len(WINDOWS)} windows)', flush=True)
        return 1 if failures else 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
