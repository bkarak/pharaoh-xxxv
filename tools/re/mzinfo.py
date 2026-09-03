#!/usr/bin/env python3
"""Parse the MZ header of a DOS EXE, list the segments referenced by its relocation table,
and write the flat load image (game.bin) for the disassembler."""
import struct
import sys

d = open(sys.argv[1] if len(sys.argv) > 1 else "game.exe", "rb").read()
(magic, cblp, cp, crlc, cparhdr, minalloc, maxalloc, ss, sp, csum, ip, cs, lfarlc, ovno) = struct.unpack_from("<2sHHHHHHHHHHHHH", d, 0)
hdr = cparhdr * 16
img = d[hdr:]
print(f"header {hdr} bytes, image {len(img)} bytes, entry {cs:04x}:{ip:04x}, stack {ss:04x}:{sp:04x}, {crlc} relocations")
segs = {}
for i in range(crlc):
    off, seg = struct.unpack_from("<HH", d, lfarlc + i * 4)
    lin = seg * 16 + off
    val = struct.unpack_from("<H", img, lin)[0]
    segs.setdefault(val, []).append((seg, off))
for v in sorted(segs):
    print(f"segment {v:04x} (linear {v * 16:6d}) referenced {len(segs[v]):3d} times, e.g. from {segs[v][:3]}")
open("game.bin", "wb").write(img)
