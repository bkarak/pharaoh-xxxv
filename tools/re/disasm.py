#!/usr/bin/env python3
"""Linear-sweep 16-bit disassembly of game.bin with Capstone, plus a search for code that
pushes the address of interesting strings in the data segment (DGROUP)."""
from capstone import Cs, CS_ARCH_X86, CS_MODE_16

img = open("game.bin", "rb").read()
DGROUP = 0x0E68                      # from mzinfo.py: the segment every data reference points at
SEGMENTS = [(0x0000, 0x0000, 0x7BB0), (0x07BB, 0x7BB0, 0xDA20)]   # (segment, start, end)

md = Cs(CS_ARCH_X86, CS_MODE_16)
lines = []
for seg, start, end in SEGMENTS:
    for ins in md.disasm(img[start:end], 0):
        lines.append((seg, ins.address, ins.mnemonic, ins.op_str))
open("disasm.txt", "w").write("\n".join(f"{s:04x}:{a:04x}  {m:<8} {o}" for s, a, m, o in lines))
print(len(lines), "instructions written to disasm.txt")

targets = ["GAME.DAT", "CHAR.DAT", "COMM_PTR too long", "You can't do that here", "RETURN TO GAME", "end%d.gfx"]
base = DGROUP * 16
for t in targets:
    i = img.find(t.encode())
    if i < 0:
        continue
    off = i - base
    refs = [f"{s:04x}:{a:04x}" for s, a, m, o in lines if m in ("push", "mov") and o.endswith(hex(off))]
    print(f"{t!r:40} at DS:{off:04x}  referenced from {refs[:6]}")
