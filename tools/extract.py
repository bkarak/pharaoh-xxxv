#!/usr/bin/env python3
"""Extract every asset of "The Anger of Pharaoh XXXV" (DOS, 1997) into one JSON bundle.

Reads the original data files (GAME.DAT, CHAR.DAT, *.GFX) and writes assets.json,
which the HTML engine consumes. See ../FORMAT.md for the reverse-engineered layout.
"""
import base64
import json
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIG = ROOT / "original"

VERB_NAMES = {1: "LOOK", 2: "USE", 3: "TAKE", 4: "EXAMINE", 5: "USEWITH", 6: "OPEN", 7: "CLOSE", 8: "GO"}


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def cstr(b, o):
    end = b.index(b"\0", o)
    return b[o:end].decode("latin1"), end + 1


class Bundle:
    def __init__(self):
        self.images = []

    def add_image(self, blob, off=0):
        """Image blob: header (h, w, x, y) as 4 words, then h*w bytes, 1 byte per pixel."""
        h, w, x, y = struct.unpack_from("<HHHH", blob, off)
        px = blob[off + 8 : off + 8 + w * h]
        if len(px) != w * h:
            raise ValueError("truncated image")
        self.images.append({"w": w, "h": h, "x": x, "y": y, "data": base64.b64encode(px).decode("ascii")})
        return len(self.images) - 1


def decode_proc(rec, pn, a, bundle, warnings, obj_gfx_count):
    """Decode the data of internal procedure `pn` located at record offset `a`."""
    if pn == 20:
        return cstr(rec, a)[0]
    if pn in (30, 31):
        obj, val, n = struct.unpack_from("<HHH", rec, a)
        subs = []
        for k in range(n):
            spn, spd = struct.unpack_from("<HH", rec, a + 6 + k * 4)
            subs.append([spn, decode_proc(rec, spn, a + spd, bundle, warnings, obj_gfx_count)])
        return {"obj": obj, "val": val, "procs": subs}
    if pn == 3:
        obj, val = struct.unpack_from("<HH", rec, a)
        if obj in obj_gfx_count and val > obj_gfx_count[obj]:
            warnings.append(f"proc 3 sets obj {obj} cond {val} beyond its {obj_gfx_count[obj]} sprites")
        return [obj, val]
    if pn in (4, 5, 6, 8):
        return list(struct.unpack_from("<HH", rec, a))
    if pn == 7:
        v = u16(rec, a)
        return [v - 65536 if v > 32767 else v]
    if pn == 41:
        return [u16(rec, a)]
    if pn in (39, 42, 43):
        return None
    if pn == 40:
        return decode_dialogue(rec, a, bundle, warnings)
    raise ValueError(f"unknown procedure {pn}")


def decode_dialogue(rec, base, bundle, warnings, seen=None):
    """Proc 40: a dialogue node. Layout (offsets relative to the node itself):
    text\\0, word nprocs, nprocs x (word proc, 20 bytes data), byte nanswers,
    nanswers x text\\0, nanswers x word child_offset (relative to this node)."""
    if seen is None:
        seen = {}
    if base in seen:
        return {"ref": seen[base]}
    node_id = len(seen)
    seen[base] = node_id
    text, p = cstr(rec, base)
    procs = []
    di = 0
    while u16(rec, p) > di:
        p += 2
        pn = u16(rec, p)
        procs.append([pn, decode_proc(rec, pn, p + 2, bundle, warnings, {})])
        di += 1
        p += 20
    p += 2
    node = {"id": node_id, "text": text, "procs": procs, "answers": []}
    if procs:
        return node
    na = rec[p]
    p += 1
    answers = []
    for _ in range(na):
        s, p = cstr(rec, p)
        answers.append(s)
    offs = [u16(rec, p + i * 2) for i in range(na)]
    for i in range(na):
        node["answers"].append({"text": answers[i], "node": decode_dialogue(rec, base + offs[i], bundle, warnings, seen)})
    return node


def main():
    d = (ORIG / "game.dat").read_bytes()
    assert d[:2] == b"DS", "not a game.dat"
    cmd_size, cmd_off, pal_off = struct.unpack_from("<III", d, 2)
    scr_no, obj_no = struct.unpack_from("<HH", d, 14)
    obj_ptr = u32(d, 18)
    entries = [struct.unpack_from("<HI", d, 22 + i * 6) for i in range(scr_no + obj_no)]
    bundle = Bundle()
    warnings = []

    # palette: 256 x RGB, 8-bit values; the engine divides by 4 before programming the DAC
    pal = [v // 4 for v in d[pal_off : pal_off + 768]]

    # verb table: synonyms separated by \0, groups by an empty string, 0xFF terminates
    verbs = []
    group = []
    p = cmd_off
    while d[p] != 0xFF:
        s, p = cstr(d, p)
        if s == "":
            verbs.append(group)
            group = []
        else:
            group.append(s)  # keeps \xfe (U+00FE) as the two-part marker
    if group:
        verbs.append(group)

    screens = [bundle.add_image(d, off) for _, off in entries[:scr_no]]

    # runtime object table (SCR, FLG, CDT) stored in the file at obj_ptr
    table = [struct.unpack_from("<HHH", d, obj_ptr + i * 6) for i in range(obj_no)]

    objects = []
    obj_entries = entries[scr_no:]
    gfx_counts = {}
    recs = []
    for i, (_, off) in enumerate(obj_entries):
        end = obj_entries[i + 1][1] if i + 1 < len(obj_entries) else len(d)
        rec = d[off:end]
        ng = u16(rec, 0)
        gfx_counts[i + 1] = ng
        recs.append(rec)

    for i, rec in enumerate(recs):
        ng = u16(rec, 0)
        cmd = u32(rec, 2)
        slots = [u32(rec, 6)] + [u32(rec, 10 + k * 4) for k in range(ng)]
        gfx = []
        seen_off = {}  # the engine compares sprite pointers, so equal offsets must share one image
        for s in slots:
            if not s:
                gfx.append(None)
                continue
            if s not in seen_off:
                seen_off[s] = bundle.add_image(rec, s)
            gfx.append(seen_off[s])
        p = 10 + ng * 4
        names = []
        while True:
            s, p = cstr(rec, p)
            if s == "":
                break
            names.append(s)
        ncond = u16(rec, cmd)
        blocks = []
        for k in range(ncond):
            bo = cmd + u16(rec, cmd + 2 + k * 2)
            verb = u16(rec, bo)
            obj2 = u16(rec, bo + 2)
            q = bo + 6
            ents = []
            while True:
                pn = u16(rec, q)
                if pn == 0:
                    break
                doff = u32(rec, q + 2)
                ents.append([pn, decode_proc(rec, pn, doff, bundle, warnings, gfx_counts)])
                q += 6
            blocks.append({"verb": verb, "obj2": obj2, "entries": ents})
        scr, flg, cdt = table[i]
        objects.append({"id": i + 1, "names": names, "scr": scr, "flg": flg, "cdt": cdt, "gfx": gfx, "blocks": blocks})

    # standalone graphics
    begin = bundle.add_image((ORIG / "begin.gfx").read_bytes())
    end = bundle.add_image((ORIG / "end.gfx").read_bytes())
    deaths = [bundle.add_image((ORIG / f"end{n}.gfx").read_bytes()) for n in range(1, 6)]

    # font: 91 glyphs (ASCII 32..122), each (h=12, w=8) header + 96 pixel bytes (0 or 0x1c)
    font_raw = (ORIG / "char.dat").read_bytes()
    glyphs = []
    for g in range(len(font_raw) // 100):
        h, w = struct.unpack_from("<HH", font_raw, g * 100)
        assert (h, w) == (12, 8)
        px = font_raw[g * 100 + 4 : g * 100 + 100]
        rows = []
        for r in range(12):
            bits = 0
            for c in range(8):
                if px[r * 8 + c]:
                    bits |= 1 << (7 - c)
            rows.append(bits)
        glyphs.append(rows)

    assets = {
        "title": "THE ANGER OF PHARAOH XXXV",
        "palette": pal,
        "textColor": 0x1C,
        "verbs": verbs,
        "verbNames": VERB_NAMES,
        "screens": screens,
        "begin": begin,
        "end": end,
        "deaths": deaths,
        "font": glyphs,
        "objects": objects,
        "images": bundle.images,
    }
    out = ROOT / "dist" / "assets.json"
    out.write_text(json.dumps(assets, separators=(",", ":")))
    raw = out.read_bytes()
    packed = zlib.compress(raw, 9)
    (ROOT / "dist" / "assets.deflate.b64").write_text(base64.b64encode(packed).decode("ascii"))
    print(f"objects {len(objects)}, images {len(bundle.images)}, verbs {len(verbs)} groups")
    print(f"assets.json {len(raw)} bytes, deflated {len(packed)} bytes, base64 {len(packed) * 4 // 3} bytes")
    for w in warnings:
        print("WARNING:", w)


if __name__ == "__main__":
    sys.exit(main())
