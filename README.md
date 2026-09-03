# The Anger of Pharaoh XXXV — browser re-creation

A faithful HTML re-implementation of the 1997 DOS text-parser adventure. The original engine
(`GAME.EXE`, Borland C++) was reverse-engineered from the binary; the game's own data files are
extracted at build time and the JavaScript engine reproduces the interpreter, parser, VGA console,
menus, palette fades and PC-speaker beeps. Nothing about the game was rewritten by hand: rooms,
sprites, texts, puzzles and the spirit's dialogue tree all come from `GAME.DAT`.

The reverse-engineering and the re-implementation were done by Claude Code (Anthropic's coding
agent) on 2026-09-02, from the binary and the data files alone, directed by Vassilios Karakoidas,
one of the game's two authors.

Play it at [bkarak.wizhut.tech/software/pharaoh-web](https://bkarak.wizhut.tech/software/pharaoh-web).
The story of the reverse-engineering is in [REVERSE-ENGINEERING.md](REVERSE-ENGINEERING.md)
and the recovered file formats in [FORMAT.md](FORMAT.md).

## Layout

```
original/   the DOS files (GAME.EXE, GAME.DAT, CHAR.DAT, BEGIN/END/END1-5.GFX) — not in the repo, see below
tools/extract.py   GAME.DAT + friends -> dist/assets.json (+ deflated base64 copy)
tools/build.py     extract, then inline engine + data into dist/pharaoh.html (+ dist/pharaoh-embed.html)
tools/re/          the throwaway analysis scripts, in the order they were used
src/engine.js      the engine (one routine per original function, offsets in comments)
dist/pharaoh.html  the single-file deliverable (build output, not committed)
FORMAT.md          the reverse-engineered file formats and script semantics
```

The original game files are not part of this repository. They are the 1997 freeware release,
[game.zip](https://bkarak.wizhut.tech/programs/game/game.zip) (10 files, 668 KB); unzip it into
`original/` — the names are already lower-case, which is what the extractor expects.

## Build

```bash
python3 tools/build.py
```

Then open `dist/pharaoh.html` (any static server, or `python3 -m http.server --directory dist`).
The page needs `DecompressionStream`, available in every current browser. Python 3 with nothing
installed is enough; only the analysis scripts under `tools/re/` want Capstone and Pillow.

The build also writes `dist/pharaoh-embed.html`, the bare screen with no chrome, meant for an
`<iframe>` on another page. `--site DIR` copies the two into `DIR` as `index.html` and
`embed.html`; that is how the game is published on the site above.

`Pharaoh.debug()` exposes `present`, the framebuffer-to-canvas paint, so a script can capture
the screen from a background tab where `requestAnimationFrame` never fires; `Pharaoh.pushKey`
feeds the key queue for the same purpose.

## Walkthrough (spoilers)

1. Dark room: `TAKE EYE`, `USE EYE WITH PAINTING`, `GO NORTH`.
2. Corridor: `TAKE THING IN THE WATER`, `EXAMINE THING IN THE WATER` (three rocks), `GO AHEAD`.
3. Coffin room: `USE RED ROCK WITH LEFT TRIANGLE`, `USE BLUE ROCK WITH RIGHT TRIANGLE`,
   `USE GREEN ROCK WITH UPPER TRIANGLE`, then `TAKE MUMMY`, `GO DOWN`.
4. Hidden room: `USE BUTTON` (or `GO NORTH`) — you get trapped, but both doors upstairs open.
   `GO SOUTH`, `GO EAST`.
5. Pharaoh room: `TAKE VASE`, `USE SAND WITH VASE`, `USE VASE WITH SAND WITH PILLAR`, `TAKE ROCK`,
   `GO SOUTH`, `GO NORTH`.
6. Last room: `USE ROCK WITH SOCKET`, then answer 2, 1, 1, 2. Every other branch kills you.

## Differences from the DOS version

- Quitting returns to the title screen instead of DOS.
- Palette fades run at a fixed 14 ms per step instead of the monitor's vertical retrace.
- The random number source is `Math.random()` rather than the PIT timer.
