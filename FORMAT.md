# The Anger of Pharaoh XXXV — reverse-engineered file formats

Everything below was recovered from `GAME.EXE` (Borland C++ 4, 16-bit real mode, 74 516 bytes,
January 1997) by disassembly, and from the data files that ship next to it. Offsets given as
`07bb:xxxx` are code-segment offsets inside the EXE; they match the comments in `src/engine.js`.

## Files

| File | Purpose |
|---|---|
| `GAME.DAT` | The whole game: palette, verb table, 6 room pictures, 67 object records (names, sprites, script). |
| `CHAR.DAT` | 91 glyphs of an 8×12 font, ASCII 32..122. |
| `BEGIN.GFX` | Title picture, 320×100 drawn at y=20. |
| `END.GFX` | Ending picture, 320×100 drawn at y=90. |
| `END1.GFX` … `END5.GFX` | Five random "you are dead" panels, 164×70 drawn at (78,55). |

All numbers are little-endian. Every picture uses the same layout, which the engine calls with a
single blit routine (`07bb:2d52`, opaque copy):

```
word height, word width, word x, word y, then height*width bytes, one palette index per pixel
```

## Video

Mode 13h (320×200×256). The room picture occupies rows 0..99, the text console rows 109..199
(seven 13-pixel lines; the console scrolls with `07bb:3032`). Text is drawn with the CHAR.DAT
glyphs at colour index `0x1C`; the underline cursor uses index 15. Menu boxes use index 249 (red)
or 252 (blue). Palette values in `GAME.DAT` are 8-bit and are divided by 4 before being
programmed into the DAC (`07bb:0150`). Screen changes fade through black in 64 palette steps,
one per vertical retrace (`07bb:2e17`).

## CHAR.DAT

91 records of 100 bytes: `word 12, word 8`, then 96 pixel bytes (row-major, `0x1C` = ink,
`0` = paper). Record *n* is ASCII 32+*n*.

## GAME.DAT

```
0   "DS"
2   dword verb table size          (203)
6   dword verb table offset
10  dword palette offset           (768 bytes, 8-bit RGB)
14  word  screen count             (6)
16  word  object count             (67)
18  dword runtime object table offset
22  (screens + objects) × { word, dword offset }   -- 73 directory entries
```

The word in each directory entry is a size hint; only the offset matters. Screens come first
(each a 320×100 picture, 32 008 bytes), then the objects.

**Runtime object table** (`object count` × 6 bytes at offset 18's target): `word SCR` (room the
object is in), `word FLG`, `word CDT` (condition/state, starts at 0). This table is copied into
memory at start-up and mutated by the script. FLG bits:

| bit | meaning |
|---|---|
| 0x01 | record loaded in memory (object is in the current room or in the inventory) |
| 0x02 | carried in the inventory |
| 0x04 | any redraw of this object repaints the whole room |
| 0x08 | invisible (sprite not drawn) |
| 0x10 | cannot be referred to by name yet |
| 0x20 | never loaded even if carried (unused by the data) |

**Verb table**: NUL-separated synonyms, groups separated by an empty string, `0xFF` at the end.
Group numbers are 1-based: 1 LOOK, 2 USE, 3 TAKE, 4 EXAMINE, 5 USE…WITH, 6 OPEN, 7 CLOSE, 8 GO.
A `0xFE` inside a synonym (`USE\xFEWITH`, `PUT\xFEIN`) marks a two-part verb whose second half
is matched after the first object.

### Object record

```
0   word  n            number of extra sprite slots
2   dword cmd          offset (from record start) of the script block
6   dword sprite[0]    sprite for condition 0 (0 = none)
10  dword sprite[1..n] sprites for conditions 1..n
    names: NUL-terminated synonyms, terminated by an empty string (first one is the display name)
    sprites and script follow
```

The sprite shown for an object is `sprite[CDT]`. The first name is printed by the inventory box.

### Script block

```
cmd+0   word nblocks
cmd+2   nblocks × word   offsets (from cmd) of each verb block
block:  word verb, dword obj2, then entries { word proc, dword data offset (from record start) }
        terminated by proc = 0
```

A verb block is selected by `(verb, obj2)`; `obj2` is the second object of a two-part command
(0 otherwise). Entries run in order; each internal procedure returns 0 (next entry), 1 (restart
the block), -1 (stop), or 2 (restart the whole game). Procedures are called through a table of
far pointers at `DS:03FE`, indexed by `(proc-1)*4`, so a bad number prints "Reference to non
existing internal function".

### Internal procedures

| # | data | effect |
|---|---|---|
| 3 | obj, cond | Set CDT; erase the old sprite by restoring the room background under it and draw the new one (skipped when hidden, carried, or not loaded). Used for animations with 41. |
| 4 | obj, mask | FLG &= mask, then redraw the sprite if bits 2 or 8 changed. |
| 5 | obj, mask | FLG \|= mask, same redraw rule. |
| 6 | obj, mask | FLG ^= mask, same redraw rule. |
| 7 | screen | Unload everything and enter a room (-1 = reload the current one). Returns -1. |
| 8 | obj, screen | Move an object to another room. |
| 20 | text | Print (`\n` = next line, `\r` = carriage return). |
| 30 | obj, cond, n, n×{proc, off} | If `CDT[obj] == cond` run the nested procedures ("in_p_ifcee"). |
| 31 | same | If `CDT[obj] != cond` run the nested procedures. |
| 39 | – | Lightning: fade the palette to white, wait 2 s, fade back. |
| 40 | dialogue node | Multiple-choice dialogue (see below). |
| 41 | ms | Delay. |
| 42 | – | Random death panel with Retry (returns 1) / Forget it (returns 2). |
| 43 | – | The ending; returns 2. |

Procedures 32–34 exist in the EXE (flag tests) but are never used by the data.

### Dialogue node (procedure 40)

```
text NUL
word nprocs, nprocs × { word proc, 20 bytes data }   (only death nodes use this: proc 42)
byte nanswers
nanswers × answer text NUL
nanswers × word offset of the child node, relative to THIS node
```

Answers are shown as `1)…`, `2)…` and chosen with the digit keys. The whole tree lives inside the
ROCK object (id 54) and is entered by `USE ROCK WITH SOCKET` in the last room.

## Parser (`07bb:14ad`)

The input line is normalised in place (letters upper-cased, runs of spaces collapsed, one space
appended). The verb is the longest synonym that prefixes the line and is followed by a space
(earlier synonyms win ties); the object is the longest name of any *loaded, nameable* object that
follows it. If text remains, the line is parsed again allowing only two-part verbs, whose second
half (`WITH`, `IN`, `ON`) must precede the second object. Error messages are drawn at random from
four tables: empty line, unknown verb, unknown object, malformed sentence. A sentence that parses
but has no matching block gets one of five "You can't do that here" style replies.

## Input loop (`07bb:26c9`)

A 20-line doskey history (60 bytes each, at most 39 characters typed), Home/End/arrows/Ins/Del
editing, F1 help, F2/F3 print SAVE/LOAD and do nothing else, F4/Esc options menu, F5 inventory,
F10/Ctrl-X/Alt-X quit. Invalid keys beep at a random pitch; more than ten in a row print a random
"Stop playing with that…" message.
