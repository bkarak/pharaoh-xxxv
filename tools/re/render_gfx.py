#!/usr/bin/env python3
"""Render every picture (the six rooms inside game.dat and the standalone .gfx files) to PNG
using the palette stored in game.dat. Needs Pillow."""
import struct
from PIL import Image

d = open("game.dat", "rb").read()
pal_off = struct.unpack_from("<I", d, 10)[0]
pal = d[pal_off:pal_off + 768]                     # 8-bit values; the engine divides by 4 for the DAC
flat = list(pal)

def render(buf, name):
    h, w, x, y = struct.unpack_from("<HHHH", buf, 0)
    im = Image.frombytes("P", (w, h), bytes(buf[8:8 + w * h]))
    im.putpalette(flat)
    im.convert("RGB").resize((w * 3, h * 3), Image.NEAREST).save(f"{name}.png")
    print(f"{name}: {w}x{h} at ({x},{y})")

for i in range(6):
    off = struct.unpack_from("<I", d, 22 + i * 6 + 2)[0]
    render(d[off:off + 32008], f"screen{i}")
for f in ["begin", "end", "end1", "end2", "end3", "end4", "end5"]:
    render(open(f + ".gfx", "rb").read(), f)
