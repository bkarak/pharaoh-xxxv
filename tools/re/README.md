Throwaway analysis scripts used while reverse-engineering GAME.EXE. Run them from a directory
containing the original files (see ../../original). Order used:

1. `mzinfo.py game.exe`        header, segments, writes game.bin
2. `disasm.py`                 Capstone disassembly to disasm.txt + string cross-references
3. `rng.py SEG LO HI`          print a disassembly range, e.g. `rng.py 07bb 1858 1b4f`
4. `tbl.py SEG OFF N`          dump N words of a jump table
5. `render_gfx.py`             pictures to PNG
6. `dump_script.py`            decode every object's script (superseded by ../extract.py)

Capstone and Pillow come from a venv: `python3 -m venv venv && venv/bin/pip install capstone pillow`.
