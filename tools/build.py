#!/usr/bin/env python3
"""Bundle engine + assets into self-contained HTML files.

Two pages come out of one build:

  dist/pharaoh.html        the standalone page: title, key legend, notes.
  dist/pharaoh-embed.html  the bare screen, for an <iframe> on another page
                           (bkarak.wizhut.tech/software/pharaoh embeds it).

`--site DIR` additionally copies the two into DIR as index.html / embed.html.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CANONICAL = "https://bkarak.wizhut.tech/software/pharaoh"

HEAD = """<meta charset="utf-8">
<title>The Anger of Pharaoh XXXV</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
"""

# The boot script is shared: inflate the bundle, arm the screen on the first
# click or key, hand the canvas to the engine.
BOOT = """<script>
window.PHARAOH_DATA = "__DATA__";
</script>
<script>
__ENGINE__
</script>
<script>
(async () => {
  const b64 = window.PHARAOH_DATA;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  const assets = JSON.parse(new TextDecoder().decode(buf));
  const screen = document.getElementById('screen');
  const overlay = document.getElementById('overlay');
  const arm = () => { overlay.hidden = true; screen.classList.add('armed'); window.focus(); };
  overlay.addEventListener('click', arm);
  window.addEventListener('keydown', arm, { once: true });
  await Pharaoh.start(assets, document.getElementById('vga'));
})();
</script>
"""

STANDALONE = HEAD + """<link rel="canonical" href="__CANONICAL__">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=VT323&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --ground: #0a0c11;
    --panel: #13161d;
    --line: #232733;
    --phosphor: #3ee06a;
    --sand: #d9b86a;
    --ink: #d7dae2;
    --muted: #9aa0ad;
    --mono: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
    --display: "VT323", "IBM Plex Mono", ui-monospace, monospace;
  }
  html, body { background: var(--ground); color: var(--ink); margin: 0; }
  body { font-family: var(--mono); font-size: 14px; line-height: 1.5; min-height: 100vh;
         display: flex; flex-direction: column; align-items: center; padding: 28px 16px 40px; box-sizing: border-box; }
  header { width: min(960px, 100%); display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
  h1 { font-family: var(--display); font-weight: 400; font-size: 32px; line-height: 1; letter-spacing: 0.02em; margin: 0; color: var(--phosphor);
       text-shadow: 0 0 12px rgba(62, 224, 106, 0.35); }
  header .meta { color: var(--muted); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
  header .meta a { color: var(--sand); text-decoration: none; }
  header .meta a:hover { text-decoration: underline; }
  .screen { width: min(960px, 100%); aspect-ratio: 8 / 5; background: #000; border: 1px solid var(--line);
            box-shadow: 0 0 0 6px var(--panel), 0 30px 60px rgba(0,0,0,0.6); position: relative; }
  canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
  .screen:focus-within, .screen.armed { outline: 1px solid rgba(62, 224, 106, 0.5); outline-offset: 6px; }
  .overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(10, 12, 17, 0.82);
             color: var(--sand); font-family: var(--display); font-size: 30px; cursor: pointer; text-align: center; padding: 20px; }
  .overlay[hidden] { display: none; }
  .keys { width: min(960px, 100%); margin-top: 22px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 8px 24px; border-top: 1px solid var(--line); padding-top: 14px; }
  .keys div { display: flex; gap: 12px; align-items: baseline; }
  kbd { font-family: var(--mono); font-size: 12px; color: var(--sand); border: 1px solid var(--line); border-radius: 3px;
        padding: 1px 6px; background: var(--panel); white-space: nowrap; }
  .keys span { color: var(--muted); }
  .note { width: min(960px, 100%); color: var(--muted); font-size: 12.5px; margin-top: 18px; max-width: 72ch; }
  .note b { color: var(--ink); font-weight: 500; }
  .note a { color: var(--sand); }
  @media (prefers-reduced-motion: reduce) { h1 { text-shadow: none; } }
</style>
<header>
  <h1>The Anger of Pharaoh XXXV</h1>
  <div class="meta">DOS freeware, 1997 &middot; browser re-creation &middot; <a href="__CANONICAL__">about the game</a></div>
</header>
<div class="screen" id="screen">
  <canvas id="vga" width="320" height="200"></canvas>
  <div class="overlay" id="overlay">Click here, then press any key to play</div>
</div>
<div class="keys">
  <div><kbd>type + Enter</kbd><span>verb object, e.g. LOOK ROOM</span></div>
  <div><kbd>USE x WITH y</kbd><span>two-object commands</span></div>
  <div><kbd>F1</kbd><span>help</span></div>
  <div><kbd>F4</kbd> <kbd>Esc</kbd><span>options</span></div>
  <div><kbd>F5</kbd><span>inventory</span></div>
  <div><kbd>&uarr;</kbd> <kbd>&darr;</kbd><span>command history</span></div>
  <div><kbd>1-9</kbd><span>answer the spirit</span></div>
  <div><kbd>F10</kbd> <kbd>Ctrl+X</kbd><span>quit to title</span></div>
</div>
<p class="note"><b>Verbs the parser knows:</b> LOOK, EXAMINE, TAKE, USE, OPEN, CLOSE, GO, and USE &hellip; WITH / PUT &hellip; IN.
Objects are named as the original data names them (ROOM, FLOOR, NORTH, WOLF PAINTING, and so on). Saving was never implemented in the original, and it still is not.
The walkthrough, the original DOS files and the source of this re-creation are on <a href="__CANONICAL__">the game's page</a>.</p>
""" + BOOT

# The embed fills whatever frame it is given; the host page supplies the legend.
EMBED = HEAD + """<meta name="robots" content="noindex">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  .screen { position: fixed; inset: 0; background: #000; }
  canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
  .overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.72);
             color: #d9b86a; font: 500 clamp(14px, 3.2vw, 24px)/1.3 ui-monospace, Menlo, Consolas, monospace;
             cursor: pointer; text-align: center; padding: 20px; }
  .overlay[hidden] { display: none; }
</style>
<div class="screen" id="screen">
  <canvas id="vga" width="320" height="200"></canvas>
  <div class="overlay" id="overlay">Click here, then press any key to play</div>
</div>
""" + BOOT


def render(template, data, engine):
    return (template.replace("__DATA__", data).replace("__ENGINE__", engine)
            .replace("__CANONICAL__", CANONICAL))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", type=Path, help="also copy the pages into DIR as index.html and embed.html")
    args = ap.parse_args()

    subprocess.check_call([sys.executable, str(ROOT / "tools" / "extract.py")])
    data = (ROOT / "dist" / "assets.deflate.b64").read_text().strip()
    engine = (ROOT / "src" / "engine.js").read_text()

    outputs = {
        ROOT / "dist" / "pharaoh.html": render(STANDALONE, data, engine),
        ROOT / "dist" / "pharaoh-embed.html": render(EMBED, data, engine),
    }
    for out, html in outputs.items():
        out.write_text(html)
        print(f"wrote {out} ({len(html)} bytes)")

    if args.site:
        args.site.mkdir(parents=True, exist_ok=True)
        for src, name in ((ROOT / "dist" / "pharaoh.html", "index.html"),
                          (ROOT / "dist" / "pharaoh-embed.html", "embed.html")):
            shutil.copyfile(src, args.site / name)
            print(f"copied {src.name} -> {args.site / name}")


if __name__ == "__main__":
    main()
