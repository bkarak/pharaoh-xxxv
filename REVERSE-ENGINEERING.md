# Reverse-engineering The Anger of Pharaoh XXXV

This is the record of how I took a 74 KB DOS executable from 1997 and turned it into a
working browser game in one afternoon (2026-09-02). The "I" here is Claude Code (Anthropic's
coding agent), which did the reverse-engineering and wrote these notes as it went; Vassilios
Karakoidas, one of the game's two authors, asked the question and directed the work. Every command below was actually run,
and every output excerpt is real. The scripts live in `tools/re/`, the final extractor in
`tools/extract.py`, and the engine in `src/engine.js`.

## What was in the box

The zip held ten files. Sizes alone say a lot when you have written enough file formats:

```
game.exe    74,516   MS-DOS executable
game.dat   463,479   "data"
char.dat     9,100
begin.gfx   32,008
end.gfx     32,008
end1.gfx    11,488   (end2..end5 identical size)
```

32,008 is 320 × 100 + 8. So `begin.gfx` is a 320×100 picture, one byte per pixel, with an
8-byte header. That means VGA mode 13h (256 colours), not the 16-colour EGA I first assumed.
And 11,488 = 164 × 70 + 8, another picture. The first `xxd` confirmed it:

```
$ xxd -l 16 begin.gfx
00000000: 6400 4001 0000 1400 feff feff feff feff   d.@.............
```

Four little-endian words: 100, 320, 0, 20. Height, width, x, y. The pictures carry their
own screen position, which later turned out to be how sprites work too.

`char.dat` was the font: 9,100 = 91 × 100, each record a `(12, 8)` header plus 96 pixel
bytes. 91 glyphs starting at ASCII 32 (space) and ending at 122 (`z`). The glyph pixels are
`0x1C`, which becomes important later (it is the palette index the text is drawn in).

## Tools

I used nothing exotic. The only things that had to be installed were Python packages.

- **`xxd`, `strings`, `file`** for the first look.
- **Python 3.14** for every parser. `struct.unpack_from` does all the heavy lifting.
- **Capstone 5** (`pip install capstone`) as the 16-bit x86 disassembler. I wanted Ghidra
  for its decompiler, but its Homebrew cask no longer exists, and downloading 400 MB for a
  74 KB binary felt wrong. Capstone plus `grep` was enough (barely).
- **Pillow** to render the pictures to PNG so I could see what I was decoding.
- The Claude Code browser pane to play-test the result.

No emulator. I never ran the original. That was a deliberate choice, and it cost me exactly
one wrong guess (see step 5).

## Step 1: strings

`strings -n 4 game.exe` was the single most productive command of the day. Besides
`Borland C++ - Copyright 1994 Borland Intl.` (so, Borland C++ 4, real mode), it gave the
whole personality of the program:

```
Stop playing with that...
This is a game not a piano...stop it!
Sobara, ti mas les? :-))
COMM_PTR too long for object %d
SCR_PTR too long for object %d, Condition %d
Data file error: Reference to non existing internal function %u
 Commands size %ld offset %ld pallete %ld OBJ_NO %d SCR_NO %d OBJ_PTR %ld
OBJ no %d, size %ld,offset in file %ld and SCR:%d FLG:%d CDT:%d
          Command %d
          OBJ2    %d
          Procedure no: %d and data %x,%x,%x,%x
```

Those debug `printf`s are a gift. They name the fields of the file header (commands,
palette, OBJ_NO, SCR_NO, OBJ_PTR), the per-object runtime table (SCR, FLG, CDT), and the
shape of a script entry (command, OBJ2, procedure number, data). Half of the format was
now hypothesis, before I had looked at a single byte of `game.dat`.

`strings game.dat` added the other half: hundreds of object synonyms (`WOLF'S BLUE EYE`,
`THE PAINTED ROCK ON THE FLOOR`) and the room descriptions. A text-parser adventure with
pictures, six rooms, and the jokes of two Greek students (the credits in the death screens
say "Mike & Bill").

## Step 2: the file header

With the `printf` as a map I wrote a ten-line parser:

```python
d = open('game.dat','rb').read()
cmdsize, cmdoff, paloff = struct.unpack_from('<III', d, 2)
n1, n2 = struct.unpack_from('<HH', d, 14)
objptr, = struct.unpack_from('<I', d, 18)
# -> cmdsize 203 cmdoff 193678 paloff 192508 n1 6 n2 67 objptr 193276
```

Then a directory of 73 six-byte entries (word + dword offset) starting at byte 22. The
first six offsets were 32,008 bytes apart, so those were the six room pictures. The other
67 were the objects. The 203 bytes at `cmdoff` were the verb table:

```
LOOK\0LOOK AT\0STARE\0STARE AT\0\0USE\0PUSH\0PRESS\0\0TAKE\0PICK UP\0GET\0HUG\0...
USE\xfeWITH\0USE\xfeIN\0PUT\xfeIN\0PUT\xfeON\0\0OPEN\0\0CLOSE\0\0GO\0GOTO\0...\xff
```

Synonyms separated by NUL, groups by an empty string, `0xFF` at the end, and a `0xFE`
inside the two-part verbs where the second object goes. Eight verb groups. This is the
kind of format a student invents in an evening, and it is pleasant to decode for the same
reason.

The 768 bytes at `paloff` were the palette, with values up to 255. VGA wants 6-bit values,
so either the file was wrong or the engine divided by four. The disassembly later showed
`idiv bx` with `bx = 4` in a loop of 256 (`07bb:0150`). File was right, engine divides.

## Step 3: pictures

Before touching any code I rendered everything with Pillow (`tools/re/render_gfx.py`).
If the palette and pixel layout are right, you see a room; if not, you see noise. I saw
six rooms, a pyramid with a sphinx wearing glasses, a dancing mummy in a doorway, and five
red-on-black death messages ("Save early Save often. If only we had a save capability").
That one screenshot removed all doubt about the picture format and told me what the game
looked like. I recommend doing this early; it also keeps you motivated.

## Step 4: object records

Each object record starts with a word `n`, a dword, another dword, then `n` dwords, then the
NUL-separated names. I guessed the meaning by arithmetic on the first object:

```
0200 | 9003 0000 | 5101 0000 | 5101 0000 | ef02 0000 | "EYE\0THE EYE\0..."
n=2    912         337         337         751
```

The names ended at record offset 337, and at 337 sat `0e00 1d00 9500 4e00` followed by 406
bytes: a 29×14 picture at (149, 78). So 337 and 751 were sprite offsets, and 912 (which is
751 + 8 + 17×9) was where the script began. The record header is therefore: sprite count,
script offset, sprite for state 0, sprites for states 1..n. Note the trap: the "state 0"
sprite sits in the header *before* the array, and the engine indexes `header + 6 + 4*state`,
so state 0 lands on it naturally. I only understood why after reading procedure 3.

## Step 5: the script, and my one wrong guess

The script block is a word count, an array of word offsets, and then blocks that begin
with `word id, dword x` and a list of `(word code, dword offset)` entries terminated by 0.

I dumped all of them with `tools/re/dump_script.py` and looked for patterns. Codes were
almost always 30 or 31, sometimes 20, 7, 3 or 6. Block ids were 1, 2, 3, 4, 5, 8. My first
reading was "the id is the object's state and the code is the verb", which is exactly
backwards. It broke immediately on the torch: block id 1 said "You can see a torch
burning", id 4 said "Nothing special about the torch", id 8 said "you try to pass through
the wall … burns some of your pretty hair". Those are LOOK, EXAMINE and GO. So the block
id is the **verb** (1 LOOK, 2 USE, 3 TAKE, 4 EXAMINE, 5 USE WITH, 6 OPEN, 7 CLOSE, 8 GO)
and the dword after it is the second object for USE…WITH. The eye's block 5 has
`x = 2`, and object 2 is the wolf painting. Everything clicked.

The codes were procedure numbers. 20 pointed straight at a string. 30 and 31 pointed at a
small header `(object, state, count)` followed by `count` pairs of `(procedure, offset)`.
The offsets are relative to that header, and the text of a nested procedure 20 simply
follows. Once that was clear the dump read like source code:

```
=== obj 1 'EYE'
  verb TAKE
     30: {'obj': 1, 'val': 1, 'do': [(20, ' You already have it...|')]}
     30: {'obj': 1, 'val': 2, 'do': [(20, ' You try to move it but it is stuck|in the wall, forget it|')]}
     30: {'obj': 1, 'val': 0, 'do': [(20, ' You scratch floor, and the painted rock|...gets out.|'), (3, (1, 1)), (5, (1, 2))]}
```

"If the eye's state is 0, print, set its state to 1, OR 2 into its flags." I had the
semantics of 3 and 5 as guesses at this point. Guesses are fine for reading; they are not
fine for a clone. That is what the disassembly was for.

## Step 6: disassembly with Capstone

`tools/re/mzinfo.py` parses the MZ header and walks the relocation table. Every far
pointer the loader patches tells you which segment values exist:

```
segment 0000 (linear      0) referenced 422 times
segment 07bb (linear  31664) referenced  18 times
segment 0da2 (linear  55840) referenced  41 times
segment 0e68 (linear  59008) referenced  83 times
```

Segment 0 turned out to be the Borland run-time library (printf, fopen, the startup code),
`07bb` the game's own code, and `0e68` the data segment (DGROUP). Knowing DGROUP means you
can turn a string's file offset into the immediate a `push` would carry, and grep the
disassembly for it. `tools/re/disasm.py` does that:

```
'COMM_PTR too long'    at DS:10c7  referenced from ['07bb:0540']
"You can't do that here" at DS:12bb  referenced from ['07bb:1b13']
'RETURN TO GAME'       at DS:17de  referenced from ['07bb:339c']
```

Three anchors: the loader, the command executor, and the options menu. From each anchor I
read outwards with `tools/re/rng.py 07bb 1858 1b4f` (print a range of the disassembly).
Borland's code generator is verbose but regular. `les bx, [0x5642]; add bx, ax` with
`ax = index*6` is an array of six-byte structs, which matched `SCR:%d FLG:%d CDT:%d`.
`shl ax, 2; les bx, [0x564e]` is an array of far pointers, the loaded object records.

The one thing I could not find by grepping was the procedure dispatcher, because it is not a
`switch`. It is this:

```
07bb:19f2  mov  bx, word ptr [bp - 0xa]      ; procedure number
07bb:19f5  dec  bx
07bb:19f6  shl  bx, 2
07bb:19f9  lcall [bx + 0x3fe]                ; far call through a table at DS:03FE
```

A table of far function pointers, filled by an init routine (`07bb:41a8`) with seventeen
`mov word ptr [0x4xx], 0x7bb / mov word ptr [0x4xx], offset` pairs. Sort by slot and you
have the list: procedures 3, 4, 5, 6, 7, 8, 20, 30, 31, 32, 33, 34, 39, 40, 41, 42, 43, each
with its entry point. The error string "Reference to non existing internal function"
is printed when a slot is empty. I then read all seventeen functions. The return codes of
the executor loop (`07bb:1a00`) were the last piece of the interpreter:

```
07bb:1a03  cmp  word ptr [bp - 0xc], -1   ; -1: stop this verb
07bb:1a0b  cmp  word ptr [bp - 0xc], 1    ;  1: restart the entry list from 0
07bb:1a15  cmp  word ptr [bp - 0xc], 0    ;  0: next entry
                                          ; anything else: return it (2 = restart game)
```

Procedure 42 (the death panel) returns 1 for "Retry" and 2 for "Forget it". That is the
whole save-game story of this program: retry re-runs the verb, forget it reboots the game.

## Step 7: the parser

The parser (`07bb:14ad`, `13c3`, `121d`) is where a clone lives or dies, because players
type arbitrary things. It normalises the line in place (upper-case, collapse spaces, append
one space), then picks the **longest** verb synonym that is a prefix of the line *and is
followed by a space*. Ties go to the earlier synonym. The object is chosen the same way
among the names of objects that are loaded (in the room or carried) and do not have flag
`0x10`. If text remains after "verb object", it starts over allowing only two-part verbs,
and expects the second half (`WITH`, `IN`, `ON`) before the second object.

The trailing-space rule explains a lot of odd behaviour: `LOOK` alone fails with "What
exactly is the second word?", while `LOOK AROUND` works because `AROUND` is a synonym of
the room. I reproduced it exactly rather than improving it, because improving it would
change which sentences the puzzles accept.

## Step 8: the dialogue tree

One procedure (40) is a multiple-choice dialogue with the pharaoh's spirit. Its data is a
node: text, a count of inline procedures (only death nodes have one, procedure 42), a
count of answers, the answer strings, and one word per answer. I first read those words as
offsets from the tree's root and got garbage two nodes deep. They are offsets from the
*current node*, which is obvious once you notice the function passes its own argument
pointer when recursing (`07bb:5a5d`). With that fixed, a tiny walker printed the tree and
the winning path (answers 2, 1, 1, 2) fell out, as did the eight ways to die.

## Step 9: the clone

`tools/extract.py` re-implements the parsing above properly and writes one JSON bundle:
palette, verbs, font, 65 pictures (base64), and 67 objects with their scripts decoded into
plain structures. Deflated, that is 55 KB. `src/engine.js` keeps the original's shape on
purpose: a 64,000-byte framebuffer with a 6-bit palette, the same opaque blit, the same
"restore background under the old sprite, draw the new one" for state changes, the same
13-pixel text lines scrolling inside rows 109..199, the same key codes. Every function has
the original's offset in a comment so a doubt can be settled by reading the disassembly
instead of arguing with the code.

Two things I changed knowingly: quitting returns to the title (there is no DOS to return
to), and the 64-step palette fade is driven by elapsed time instead of vertical retrace.

## What went wrong

**The `þ` marker.** The first build could not parse `USE EYE WITH PAINTING`. The page was
served without a charset, so the U+00FE marker inside the two-part verbs became two
Latin-1 characters and never matched. Fixed with an escape and a `<meta charset>`.

**Testing through automation.** The browser pane's "type" action does not synthesise real
letter keydowns, so I drove the game through an exported key queue instead. Then I spent
twenty minutes chasing a "bug" that was my own helper pushing an Enter with no ASCII code.
The intro menu treated it as an invalid key, beeped, and ate the first command. The lesson
is old: log what the program sees, not what you think you sent.

**Sprite identity.** Procedure 3 compares sprite *pointers* to decide whether to redraw.
Two objects reuse the same sprite offset for two states. My extractor originally created
two images for them, which would have caused a redraw the original skips. Deduplicating by
offset restored the behaviour.

## Conclusions

The whole thing was about 1,350 lines of Python and JavaScript and a few thousand lines of
disassembly read by eye. The order that worked was: sizes and strings first, then data
before code, then render early, then disassemble only the functions the data cannot
explain. Borland's debug strings did more for me than any tool. And I never needed the
original to run, which I am still a little surprised by.

The scripts are in `tools/re/`, in the order they were used. If you try the same on
another DOS game, start with `strings`.
