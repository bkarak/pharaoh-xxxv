#!/usr/bin/env python3
"""Render REVERSE-ENGINEERING.md (plus the code it refers to) as a single HTML page."""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
md = (ROOT / "REVERSE-ENGINEERING.md").read_text()

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)
    return s

out, para, in_code, code, in_list = [], [], False, [], False
def flush_para():
    global para
    if para:
        out.append("<p>" + inline(" ".join(para)) + "</p>")
        para = []
def close_list():
    global in_list
    if in_list:
        out.append("</ul>"); in_list = False

for line in md.split("\n"):
    if line.startswith("```"):
        if in_code:
            out.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>"); code = []; in_code = False
        else:
            flush_para(); close_list(); in_code = True
        continue
    if in_code:
        code.append(line); continue
    if line.startswith("# "):
        flush_para(); close_list(); out.append(f"<h1>{inline(line[2:])}</h1>"); continue
    if line.startswith("## "):
        flush_para(); close_list(); out.append(f"<h2>{inline(line[3:])}</h2>"); continue
    if line.startswith("- "):
        flush_para()
        if not in_list:
            out.append("<ul>"); in_list = True
        out.append(f"<li>{inline(line[2:])}</li>"); continue
    if line.strip() == "":
        flush_para(); close_list(); continue
    if in_list and line.startswith("  "):
        out[-1] = out[-1][:-5] + " " + inline(line.strip()) + "</li>"; continue
    para.append(line.strip())
flush_para(); close_list()

# appendix: every script, verbatim
files = [
    ("tools/re/mzinfo.py", "MZ header and segment map"),
    ("tools/re/disasm.py", "Capstone disassembly and string cross-references"),
    ("tools/re/rng.py", "Print a disassembly range"),
    ("tools/re/tbl.py", "Dump a jump table"),
    ("tools/re/render_gfx.py", "Render the pictures"),
    ("tools/re/dump_script.py", "First script dumper (exploration)"),
    ("tools/extract.py", "Final extractor"),
    ("tools/build.py", "Page template and bundler"),
    ("src/engine.js", "The engine"),
]
out.append("<h1 id=\"appendix\">Appendix: the code</h1>")
out.append("<p>Every file, verbatim, in the order it was written.</p>")
out.append("<ul>" + "".join(f'<li><a href="#{p.replace("/", "-").replace(".", "-")}"><code>{p}</code></a> {d}</li>' for p, d in files) + "</ul>")
for p, d in files:
    anchor = p.replace("/", "-").replace(".", "-")
    src = (ROOT / p).read_text()
    out.append(f'<h2 id="{anchor}"><code>{p}</code> <span class="dim">{html.escape(d)}</span></h2>')
    out.append("<pre><code>" + html.escape(src) + "</code></pre>")

body = "\n".join(out)
page = """<meta charset="utf-8">
<title>Reverse-engineering Pharaoh XXXV</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=VT323&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:ital,wght@0,400;0,500;1,400&display=swap">
<style>
  :root { --ground:#0a0c11; --panel:#13161d; --line:#232733; --phosphor:#3ee06a; --sand:#d9b86a; --ink:#d7dae2; --muted:#9aa0ad;
          --mono:"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; --serif:"IBM Plex Serif", Georgia, serif; --display:"VT323", var(--mono); }
  html, body { background: var(--ground); color: var(--ink); margin: 0; }
  body { font-family: var(--serif); font-size: 16px; line-height: 1.6; padding: 36px 20px 80px; }
  main { max-width: 74ch; margin: 0 auto; }
  h1 { font-family: var(--display); font-weight: 400; font-size: 44px; line-height: 1; color: var(--phosphor); margin: 0 0 8px; text-wrap: balance; }
  h1 + p { color: var(--muted); }
  h2 { font-family: var(--mono); font-weight: 500; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sand);
       margin: 44px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); }
  h2 code { text-transform: none; letter-spacing: 0; font-size: 13px; }
  h2 .dim { color: var(--muted); font-weight: 400; margin-left: 10px; }
  p { margin: 0 0 14px; }
  ul { padding-left: 22px; margin: 0 0 14px; }
  li { margin-bottom: 6px; }
  code { font-family: var(--mono); font-size: 0.86em; background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 0 5px; }
  pre { background: #05070a; border: 1px solid var(--line); border-left: 3px solid var(--phosphor); padding: 12px 14px; overflow-x: auto;
        margin: 6px 0 18px; font-size: 12.5px; line-height: 1.5; }
  pre code { background: none; border: 0; padding: 0; font-size: inherit; color: #cfe8d6; }
  strong { color: var(--ink); font-weight: 500; }
  a { color: var(--sand); }
  a:focus-visible { outline: 2px solid var(--phosphor); outline-offset: 2px; }
</style>
<main>
""" + body + "\n</main>\n"
(ROOT / "dist" / "reverse-engineering.html").write_text(page)
print("wrote dist/reverse-engineering.html", len(page), "bytes")
