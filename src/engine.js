/* The Anger of Pharaoh XXXV — browser re-implementation of the 1997 DOS engine.
 *
 * Everything here mirrors a routine of the original GAME.EXE (Borland C++ 4, real mode):
 * a 320x200x256 framebuffer, the 8x12 CHAR.DAT font, the doskey-style input line,
 * the verb/object parser, and the GAME.DAT script interpreter with its 17 internal
 * procedures. Offsets in comments (07bb:xxxx) refer to the original code segment.
 */
'use strict';

const Pharaoh = (() => {
  // ------------------------------------------------------------------ helpers
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (n) => Math.floor(Math.random() * n);

  class Restart extends Error {}   // main loop restarts the program (return code 2 / quit)

  // ------------------------------------------------------------------ VGA
  const W = 320, H = 200;
  const fb = new Uint8Array(W * H);
  const pal = new Uint8Array(768);          // 6-bit DAC values, like the real card
  let canvas, ctx, imageData, dirty = true;

  function present() {
    if (!dirty) return;
    dirty = false;
    const d = imageData.data;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const p = fb[i] * 3;
      d[j] = (pal[p] * 255 / 63) | 0;
      d[j + 1] = (pal[p + 1] * 255 / 63) | 0;
      d[j + 2] = (pal[p + 2] * 255 / 63) | 0;
      d[j + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function clearScreen() { fb.fill(0); dirty = true; }

  // 07bb:2d52 — copy an image (header h,w,x,y) to video memory, opaque
  function blit(img) {
    const { w, h, x, y, data } = img;
    for (let r = 0; r < h; r++) {
      const yy = y + r;
      if (yy < 0 || yy >= H) continue;
      fb.set(data.subarray(r * w, r * w + w), yy * W + x);
    }
    dirty = true;
  }

  // 07bb:2ead — restore a rectangle of the room background under a sprite
  function restoreBg(bg, x, y, h, w) {
    for (let r = 0; r < h; r++) {
      const src = (y - bg.y + r) * bg.w + (x - bg.x);
      fb.set(bg.data.subarray(src, src + w), (y + r) * W + x);
    }
    dirty = true;
  }

  // 07bb:2f03 / 2f2a — horizontal / vertical lines (inclusive end points)
  function hline(x1, y, x2, c) { fb.fill(c & 255, y * W + x1, y * W + x2 + 1); dirty = true; }
  function vline(x, y1, y2, c) { for (let y = y1; y <= y2; y++) fb[y * W + x] = c & 255; dirty = true; }

  // 07bb:2f55 — save a rectangle (and blank it), 07bb:2ff3 — put it back
  function saveRect(x, y, w, h) {
    const data = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      const o = (y + r) * W + x;
      data.set(fb.subarray(o, o + w), r * w);
      fb.fill(0, o, o + w);
    }
    dirty = true;
    return { x, y, w, h, data };
  }
  function restoreRect(s) {
    for (let r = 0; r < s.h; r++) fb.set(s.data.subarray(r * s.w, r * s.w + s.w), (s.y + r) * W + s.x);
    dirty = true;
  }

  // 07bb:3032 — scroll a band up by n lines and blank the bottom
  function scrollUp(x, y, w, h, n) {
    for (let r = 0; r < h - n; r++) {
      const src = (y + n + r) * W + x;
      fb.copyWithin((y + r) * W + x, src, src + w);
    }
    for (let r = h - n; r < h; r++) fb.fill(0, (y + r) * W + x, (y + r) * W + x + w);
    dirty = true;
  }

  // 07bb:2e17 — fade the DAC towards a target palette, one step per vertical retrace
  // Every step moves each component one unit closer; steps are derived from elapsed time so a
  // throttled timer (background tab) cannot stretch a fade from 0.9 s into a minute.
  async function fadeTo(target, stepDelay) {
    const start = new Uint8Array(pal);
    const period = 14 + stepDelay;
    const t0 = performance.now();
    for (;;) {
      const k = Math.min(64, Math.floor((performance.now() - t0) / period) + 1);
      for (let i = 0; i < 768; i++) {
        const d = target[i] - start[i];
        pal[i] = start[i] + Math.max(-k, Math.min(k, d));
      }
      dirty = true;
      if (k >= 64) break;
      await sleep(period);
    }
  }
  const savedPal = new Uint8Array(768);            // DS:2c94
  async function fadeOut() { savedPal.set(pal); await fadeTo(new Uint8Array(768), 0); }   // 07bb:3169
  async function fadeIn() { await fadeTo(savedPal, 0); }                                     // 07bb:319a

  // ------------------------------------------------------------------ keyboard
  const keyQueue = [];
  let keyWaiter = null;
  function pushKey(k) {
    if (keyWaiter) { const w = keyWaiter; keyWaiter = null; w(k); } else keyQueue.push(k);
  }
  function getch() {                                // bioskey(0): {a: ascii, s: scan code}
    if (keyQueue.length) return Promise.resolve(keyQueue.shift());
    return new Promise((r) => { keyWaiter = r; });
  }
  function translateKey(e) {
    if (e.metaKey) return null;
    const special = {
      Escape: [0x1b, 1], F1: [0, 0x3b], F2: [0, 0x3c], F3: [0, 0x3d], F4: [0, 0x3e], F5: [0, 0x3f],
      F10: [0, 0x44], Enter: [0x0d, 0x1c], Backspace: [8, 0x0e], Delete: [0, 0x53], Insert: [0, 0x52],
      Home: [0, 0x47], End: [0, 0x4f], ArrowLeft: [0, 0x4b], ArrowRight: [0, 0x4d],
      ArrowUp: [0, 0x48], ArrowDown: [0, 0x50], Tab: [9, 0x0f],
    };
    if (special[e.key]) return { a: special[e.key][0], s: special[e.key][1] };
    if (e.key.length === 1) {
      const code = e.key.charCodeAt(0);
      if (e.ctrlKey) return code >= 64 ? { a: (code & 31), s: 0x2d } : null;   // Ctrl-X -> 0x18
      if (e.altKey) return { a: 0, s: 0x2d };                                    // Alt-X
      if (code < 128) return { a: code, s: 2 };
    }
    return null;
  }

  // ------------------------------------------------------------------ sound (PC speaker)
  let audio = null, osc = null;
  function sound(freq) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      nosound();
      osc = audio.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = audio.createGain();
      g.gain.value = 0.08;
      osc.connect(g).connect(audio.destination);
      osc.start();
    } catch (e) { /* no audio */ }
  }
  function nosound() { if (osc) { try { osc.stop(); } catch (e) {} osc = null; } }

  // ------------------------------------------------------------------ text console
  let A;                                   // assets
  let tx = 0, ty = 0;                       // DS:3294 / DS:3296
  let curOn = 0, curX = 0, curY = 0;        // DS:3f8 / DS:3298
  const TEXT_TOP = 109, TEXT_BOTTOM = 187;  // seven 13-pixel lines

  function drawGlyph(idx, x, y) {           // 07bb:2d8b with a CHAR.DAT glyph
    const rows = A.font[idx];
    for (let r = 0; r < 12; r++) {
      const bits = rows[r], o = (y + r) * W + x;
      for (let c = 0; c < 8; c++) fb[o + c] = (bits >> (7 - c)) & 1 ? A.textColor : 0;
    }
    dirty = true;
  }
  function textScroll() { scrollUp(0, TEXT_TOP, W, 91, 13); }

  function drawCursor() {                   // 07bb:30e1 — underline cursor
    if (curOn) hline(curOn - 1, curY + 11, curOn + 7, 0);
    hline(tx, ty + 12, tx + 8, 15);
    curOn = tx + 1; curY = ty + 1;
  }
  function eraseCursor() {                  // 07bb:3138
    if (curOn) hline(curOn - 1, curY + 11, curOn + 7, 0);
    curOn = 0;
  }

  const printLog = [];
  function print(s) {                       // 07bb:402b — returns strlen + 1
    if (printLog.length < 400) printLog.push(s);
    eraseCursor();
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 10) {
        ty += 13;
        if (ty > TEXT_BOTTOM) { textScroll(); ty -= 13; }
      } else if (c === 13) {
        tx = 0;
      } else {
        if (tx > 312) { tx = 0; ty += 13; }
        if (ty > TEXT_BOTTOM) { textScroll(); ty -= 13; }
        const idx = c - 32;
        if (idx >= 0 && idx <= 90) drawGlyph(idx, tx, ty);
        tx += 8;
      }
    }
    return s.length + 1;
  }
  function putc(c) {                        // 07bb:4117
    eraseCursor();
    if (c === 10) ty = 13;
    if (c === 13) tx = 0;
    if (tx > 312) { tx = 0; ty += 13; }
    if (ty > TEXT_BOTTOM) { textScroll(); ty -= 13; }
    if (c >= 32) {
      const idx = c - 32;
      if (idx <= 90) drawGlyph(idx, tx, ty);
      tx += 8;
    }
  }
  function printN(s, n) {                   // 07bb:32e6 — at most n chars, returns count + 1
    let i = 0;
    for (; i < n && i < s.length; i++) putc(s.charCodeAt(i));
    return i + 1;
  }

  // ------------------------------------------------------------------ beeps and nagging
  const beep = { state: 0, count: 0 };      // DS:3f4 / DS:3f6
  const NAG = ['Stop playing with that...\n\r', 'This is a game not a piano...stop it!\n\r', 'Shut up!!!\n\r',
    'Cut it off\n\r', "Don't waste my time...PLEASE\n\r"];
  async function beepAt(base) {             // 07bb:3a15 (base 300) and 07bb:3a6f (base 800)
    drawCursor();
    if (beep.state === 1) beep.count++; else beep.count = 0;
    beep.state = 2;
    if (beep.count > 10) { print(NAG[rnd(5)]); beep.count = 0; }
    sound(rnd(1000) + base);
    await sleep(50);
    nosound();
    eraseCursor();
  }
  const beepBad = () => beepAt(300);
  const beepEdit = () => beepAt(800);

  // ------------------------------------------------------------------ game state
  let objs;               // runtime table: {scr, flg, cdt} per object (DS:5642)
  let cur = 0;            // current screen (DS:3fc)
  let fadePending = 0;    // DS:3fa
  let bg = null;          // decoded background image of the current screen
  const IMG = [];         // decoded images

  const gfxOf = (o) => {  // sprite for the object's current condition (slot 0 = "x" field)
    const slots = A.objects[o - 1].gfx;
    const s = slots[objs[o - 1].cdt];
    return s === undefined || s === null ? null : IMG[s];
  };

  function unloadAll() { for (const o of objs) o.flg &= ~1; }   // 07bb:11ae

  // 07bb:107f — redraw background and every visible sprite
  function redrawAll() {
    blit(bg);
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if ((o.flg & 3) !== 1 || (o.flg & 8)) continue;
      const g = gfxOf(i + 1);
      if (g) blit(g);
    }
  }

  // 07bb:0e4b — enter a screen: load its objects, draw it, fade in when needed
  async function loadScreen(scr) {
    if (!fadePending && scr !== cur) { await fadeOut(); fadePending = 1; }
    cur = scr;
    for (const o of objs) {                                   // 07bb:038b
      if (o.scr === scr || ((o.flg & 2) && !(o.flg & 0x20))) o.flg |= 1;
    }
    bg = IMG[A.screens[scr]];
    blit(bg);
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o.scr !== scr || (o.flg & 3) !== 1 || (o.flg & 8)) continue;
      const g = gfxOf(i + 1);
      if (g) blit(g);
    }
    if (fadePending) await fadeIn();
    fadePending = 0;
  }

  // ------------------------------------------------------------------ internal procedures
  // Each returns 0 (next entry), 1 (restart the verb's entries), -1 (stop) or throws Restart.

  function flagRedraw(o, old) {             // shared tail of procs 4/5/6
    const st = objs[o - 1];
    if (!((old ^ st.flg) & 0xa) || !(st.flg & 1)) return;
    if (st.flg & 4) { redrawAll(); return; }
    const g = gfxOf(o);
    if (!g) return;
    if (st.flg & 0xa) restoreBg(bg, g.x, g.y, g.h, g.w); else blit(g);
  }

  function procSetCond(o, val) {            // 07bb:4279 — proc 3
    const st = objs[o - 1];
    const oldCdt = st.cdt, oldG = gfxOf(o);
    st.cdt = val;
    const newG = gfxOf(o);
    if (newG === oldG) return;
    if (st.flg & 8 || st.flg & 2 || !(st.flg & 1)) return;
    if (st.flg & 4) { redrawAll(); return; }
    st.cdt = oldCdt;
    if (oldG) restoreBg(bg, oldG.x, oldG.y, oldG.h, oldG.w);
    st.cdt = val;
    if (newG) blit(newG);
  }

  async function runProc(pn, data, input) {
    const st = (o) => objs[o - 1];
    switch (pn) {
      case 3: procSetCond(data[0], data[1]); return 0;
      case 4: { const old = st(data[0]).flg; st(data[0]).flg &= data[1]; flagRedraw(data[0], old); return 0; }
      case 5: { const old = st(data[0]).flg; st(data[0]).flg |= data[1]; flagRedraw(data[0], old); return 0; }
      case 6: { const old = st(data[0]).flg; st(data[0]).flg ^= data[1]; flagRedraw(data[0], old); return 0; }
      case 7: {                              // 07bb:52f4 — change screen
        unloadAll();
        await loadScreen(data[0] === -1 ? cur : data[0]);
        return -1;
      }
      case 8: st(data[0]).scr = data[1]; return 0;
      case 20: print(data); return 0;
      case 30: case 31: {                    // in_p_ifcee — condition equal / not equal
        const hit = st(data.obj).cdt === data.val;
        if (hit !== (pn === 30)) return 0;
        for (const [spn, sd] of data.procs) {
          const r = await runProc(spn, sd, input);
          if (r !== 0) return r;
        }
        return 0;
      }
      case 39: {                             // 07bb:5cf9 — lightning flash
        const keep = new Uint8Array(pal);
        await fadeTo(new Uint8Array(768).fill(63), 0);
        await sleep(2000);
        await fadeTo(keep, 7);
        return 0;
      }
      case 40: return dialogue(data, input);
      case 41: await sleep(data[0]); return 0;
      case 42: return deathScreen();
      case 43: return ending();
      default: print(`Data file error: Reference to non existing internal function ${pn}\n\r`); return 0;
    }
  }

  // 07bb:58c9 — proc 40: a node of the spirit's dialogue tree
  async function dialogue(node, input) {
    if (node.ref !== undefined) node = dialogueNodes[node.ref];
    print(node.text);
    for (const [pn, d] of node.procs) {
      const r = await runProc(pn, d, input);
      if (r !== 0) return r;
    }
    const n = node.answers.length;
    if (n === 0) return 0;
    for (let i = 0; i < n; i++) {
      putc(0x31 + i); putc(0x29);
      print(node.answers[i].text);
    }
    for (;;) {
      const k = await getch();
      if (k.a >= 0x31 && k.a <= 0x39 && n >= k.a - 0x30) {
        return dialogue(node.answers[k.a - 0x31].node, input);
      }
      if (k.a === 0x1b || k.s === 0x3e) await optionsMenu();
      else if (isExitKey(k)) await exitConfirm();
      else if (k.s === 0x3b) await helpBox(30, 61, 271, 105, 300, 165, 32, 68,
        ['1 - 9              :Select Answer\n', 'F1                 :Help\n', 'F2                 :Save (N/A)\n',
          'F3                 :Load (N/A)\n', 'F4, ESC            :Options\n', 'F5                 :Inventory\n',
          'F10,Ctrl-X,Alt-X...:Exit\n']);
      else if (k.s === 0x3f) await inventory();
      else await beepBad();
    }
  }
  let dialogueNodes = [];

  // 07bb:5aa8 — proc 42: random death picture, Retry / Forget it
  async function deathScreen() {
    const sx = tx, sy = ty;
    const saved = saveRect(77, 54, 165, 110);
    blit(IMG[A.deaths[rnd(5)]]);
    tx = 81; ty = 128; print('   Retry\n'); tx = 81; print('   Forget it\n');
    hline(77, 54, 241, -4); hline(77, 124, 241, -4); hline(77, 125, 241, -4); hline(77, 159, 241, -4);
    vline(77, 54, 159, -4); vline(241, 54, 159, -4);
    tx = 81; ty = 128; putc(0x2a); tx = 81;
    for (;;) {
      const k = await getch();
      if (k.s === 0x50 || k.s === 0x48) {
        putc(0x20);
        ty = ((ty - 115) % 26) + 128;      // toggles between 128 and 141
        tx = 81; putc(0x2a); tx = 81;
      } else if (k.a === 0x0d) {
        restoreRect(saved);
        tx = sx; const row = ty; ty = sy;
        const choice = ((row - 128) / 13 | 0) + 1;   // 1 = Retry, 2 = Forget it
        if (choice === 2) throw new Restart();
        return choice;
      } else await beepBad();
    }
  }

  // 07bb:5d62 — proc 43: the happy end
  async function ending() {
    await fadeOut();
    clearScreen();
    tx = 0; ty = 0;
    print("*GREAT*, you finally persuaded the\n\r'SPIRIT' to show you the way out\n\r\n\r YOU ARE FREE AT LAST\n\r");
    await fadeIn();
    await sleep(1000);
    blit(IMG[A.end]);
    await sleep(2000);
    await getch();
    clearScreen();
    throw new Restart();
  }

  // ------------------------------------------------------------------ parser (07bb:13c3 / 121d / 14ad)
  const FE = '\u00fe';
  function prefixLen(input, pat) {          // 07bb:31ac
    if (pat.length && input.startsWith(pat)) return pat.length;
    return 0;
  }

  // 07bb:13c3 — longest verb synonym that prefixes the input and is followed by a space.
  // mode&4: any synonym; else only those whose two-part-ness equals mode&2.
  // mode&1: match the second half (after þ) and only inside verb group `prev`.
  function matchVerb(input, mode, prev) {
    let best = 0, bestVerb = 0, bestFe = 0;
    A.verbs.forEach((group, gi) => {
      const di = gi + 1;
      for (const syn of group) {
        const fe = syn.indexOf(FE);
        const hasFe = fe >= 0 ? 1 : 0;
        if (!(mode & 4) && ((mode & 2) ? 1 : 0) !== hasFe) continue;
        if ((mode & 1) && !hasFe) continue;
        if ((mode & 1) && di !== prev) continue;
        const part = hasFe ? ((mode & 1) ? syn.slice(fe + 1) : syn.slice(0, fe)) : syn;
        const m = prefixLen(input, part);
        if (m && m > best && input[m] === ' ') { best = m; bestVerb = di; if (!(mode & 1)) bestFe = hasFe; }
      }
    });
    return { verb: bestVerb, len: best + 1, hasFe: bestFe };
  }

  // 07bb:121d — longest object name (of loaded, nameable objects) prefixing the input
  function matchObj(input) {
    let mode = 0, p = 0;
    if (input[0] === '#') { mode = 1; p = 1; } else if (input[0] === '@') { mode = 2; p = 1; }
    const s = input.slice(p);
    let best = 0, bestObj = 0;
    for (let i = 0; i < objs.length; i++) {
      const f = objs[i].flg;
      const ok = ((f & 0x13) === 1 && mode === 2) || ((f & 0x13) === 3 && mode === 1) || ((f & 0x11) === 1 && mode === 0);
      if (!ok) continue;
      for (const name of A.objects[i].names) {
        const m = prefixLen(s, name);
        if (m && m > best && s[m] === ' ') { best = m; bestObj = i + 1; }
      }
    }
    return { obj: bestObj, len: best + (best ? 1 : 0) + (mode ? 1 : 0) };
  }

  // 07bb:14ad — normalise the line in place, then find verb, object, (second verb part, object 2)
  function parse(line) {
    let out = '', lastSpace = 1;
    for (const ch of line) {
      if (ch === ' ') { if (lastSpace) continue; lastSpace = 1; out += ch; }
      else { lastSpace = 0; out += (ch >= 'a' && ch <= 'z') ? ch.toUpperCase() : ch; }
    }
    if (!lastSpace) out += ' ';
    const res = { text: out, verb: 0, obj: 0, obj2: 0, code: 0 };
    let si = 4;
    for (;;) {
      let p = out;
      const v = matchVerb(p, si, 0);
      res.verb = v.verb;
      if (!v.verb) { res.code = 7; return res; }
      p = p.slice(v.len);
      const o = matchObj(p);
      res.obj = o.obj;
      if (!o.obj) { res.code = 5; return res; }
      p = p.slice(o.len);
      if (!v.hasFe) {
        if (p.length === 0) { res.obj2 = 0; res.code = 0; return res; }
        if (si === 4) { si = 2; continue; }
        res.code = 6; return res;
      }
      if (p.length === 0) { if (si === 4) { si = 0; continue; } res.code = 6; return res; }
      const v2 = matchVerb(p, si | 1, v.verb);
      if (!v2.verb) { if (si === 4) { si = 0; continue; } res.code = 6; return res; }
      p = p.slice(v2.len);
      const o2 = matchObj(p);
      res.obj2 = o2.obj;
      if (o2.obj) { res.code = 0; return res; }
      if (si === 4) { si = 0; continue; }
      res.code = 6; return res;
    }
  }

  const MSG_EMPTY = ['Well, write something!\n\r', 'Hey dont just press enter!\n\r', 'Seriously??? :-)) \n\r',
    'No kiding...\n\r', "Don't write so much, please...\n\r"];
  const MSG_NOVERB = ['Sorry these verbs not allowed here!\n\r', 'What are you talking about\n\r',
    "Hey it's just a game not a dictionary!\n\r", 'Whaaaaat????\n\r', 'Do you understand this?\n\r',
    'Sobara, ti mas les? :-))\n\r', "Sorry i can't understand\n\r"];
  const MSG_NOOBJ = ['What exactly is the second word?\n\r', 'What is this man?\n\r', 'You are refering to what?\n\r',
    'Save the verb and rewrite...\n\r', 'This object is is...what is it?\n\r'];
  const MSG_BAD = ['What command was that?\n\r', 'Only the object seems familiar\n\r', 'Well, rewrite it...\n\r'];

  // 07bb:164c / 1858 — parse a line and execute the matching verb block
  async function execute(line) {
    const r = parse(line);
    if (r.code !== 0) {
      if (r.text.length === 0) print(MSG_EMPTY[rnd(5)]);
      else if (r.code === 5) print(MSG_NOOBJ[rnd(5)]);
      else if (r.code === 6) print(MSG_BAD[rnd(3)]);
      else if (r.code === 7) print(MSG_NOVERB[rnd(7)]);
      return r.text;
    }
    const blocks = A.objects[r.obj - 1].blocks;
    for (const b of blocks) {
      if (b.verb !== r.verb || b.obj2 !== r.obj2) continue;
      let di = 0;
      while (di < b.entries.length) {
        const [pn, data] = b.entries[di];
        const rc = await runProc(pn, data, r.text);
        if (rc === -1) break;
        if (rc === 1) { di = 0; continue; }
        if (rc === 0) { di++; continue; }
        if (rc === 2) throw new Restart();
        break;
      }
      return r.text;
    }
    switch (rnd(5)) {                        // 07bb:1aed — nothing matched
      case 0: print("'"); print(r.text); print("' not available\n\r"); break;
      case 1: print("You can't do that here\n\r"); break;
      case 2: print('No way man...no way!\n\r'); break;
      case 3: print("Don't even try it\n\r"); break;
      default: print('You cant '); print(r.text); print('\n\r');
    }
    return r.text;
  }

  // ------------------------------------------------------------------ menus and boxes
  const isExitKey = (k) => k.s === 0x44 || k.a === 0x18 || k.s === 1 || (k.a === 0 && k.s === 0x2d) || k.s === 0;

  async function helpBox(x, y, w, h, x2, y2, textX, textY, lines) {   // 07bb:3699 / 3d1d / 3e0d / 3f0a
    const sx = tx, sy = ty;
    const saved = saveRect(x, y, w, h);
    hline(x, y, x2, -7); hline(x, y2, x2, -7); vline(x, y, y2, -7); vline(x2, y, y2, -7);
    tx = textX; ty = textY;
    for (const l of lines) { print(l); tx = textX; }
    await getch();
    restoreRect(saved);
    tx = sx; ty = sy;
  }
  const mainHelp = () => helpBox(30, 35, 261, 131, 290, 165, 32, 42,
    ['F1                 :Help\n', 'F2                 :Save (N/A)\n', 'F3                 :Load (N/A)\n',
      'F4, ESC            :Options\n', 'F5                 :Inventory\n', 'F10,Ctrl-X,Alt-X...:Exit\n',
      'Cursors Up/Down    :Doskey\n', 'Home,End,Cursor L/R:Cursor mov\n', 'Ins, Del           :Editing\n']);

  async function exitConfirm() {            // 07bb:3557
    const sx = tx, sy = ty;
    tx = 90; ty = 55;
    const saved = saveRect(88, 50, 145, 55);
    hline(88, 50, 232, -4); hline(88, 104, 232, -4); vline(88, 50, 104, -4); vline(232, 50, 104, -4);
    print(' Are you sure you'); tx = 90; ty += 13;
    print('   wanna exit?'); tx = 90; ty += 13;
    print('      Y/N');
    let k;
    do { k = await getch(); } while (!'YyNn\x1b'.includes(String.fromCharCode(k.a)) || k.a === 0);
    tx = sx; ty = sy;
    restoreRect(saved);
    if (k.a === 0x59 || k.a === 0x79) throw new Restart('quit');
  }

  async function optionsMenu() {            // 07bb:3318 — F4 / ESC
    const sx = tx, sy = ty;
    const saved = saveRect(70, 61, 181, 79);
    hline(70, 61, 250, -7); hline(70, 139, 250, -7); vline(70, 61, 139, -7); vline(250, 61, 139, -7);
    tx = 115; ty = 69;
    for (const l of ['RETURN TO GAME\n', 'LOAD GAME (N/A)\n', 'SAVE GAME (N/A)\n', 'CREDITS\n', 'EXIT GAME\n']) { print(l); tx = 115; }
    ty = 69; tx = 100; putc(0x2a); tx = 100;
    for (;;) {
      const k = await getch();
      if (isExitKey(k)) break;
      if (k.s === 0x3b) {
        await helpBox(60, 78, 201, 68, 260, 145, 68, 80,
          ['Cursor Up    :Move Up\n', 'Cursor Down  :Move Down\n', 'Enter        :Select\n', 'F1           :Help\n', 'ESC,Ctrl-X...:Return\n']);
      } else if (k.s === 0x50) {
        putc(0x20); tx = 100; ty = ((ty - 56) % 65) + 69; putc(0x2a); tx = 100;
      } else if (k.s === 0x48) {
        putc(0x20); tx = 100; ty -= 13; if (ty < 69) ty = 121; putc(0x2a); tx = 100;
      } else if (k.a === 0x0d) {
        const row = (ty - 69) / 13 | 0;
        if (row === 0) break;
        if (row === 4) await exitConfirm();
      } else await beepBad();
    }
    restoreRect(saved);
    tx = sx; ty = sy;
  }

  async function inventory() {              // 07bb:3845 — F5
    const sx = tx, sy = ty;
    ty = 5; tx = 115;
    const saved = saveRect(4, 4, 313, 102);
    hline(4, 4, 316, -4); hline(4, 105, 316, -4); vline(4, 4, 105, -4); vline(316, 4, 105, -4);
    print('*INVENTORY*');
    hline(4, 14, 316, -4); hline(4, 15, 316, -4);
    ty += 15;
    let di = 5, maxw = 0;
    for (let i = 0; i < objs.length; i++) {
      if ((objs[i].flg & 0x13) !== 3) continue;
      tx = di;
      const n = printN(A.objects[i].names[0], (315 - tx) / 8 | 0) - 1;
      if (n > maxw) maxw = n;
      ty += 14;
      if (ty >= 90) { di += maxw * 8 + 5; ty = 20; if (di > 302) break; }
    }
    await getch();
    restoreRect(saved);
    tx = sx; ty = sy;
  }

  function stamp(word) {                    // 07bb:37df / 3812 — F2 and F3 just print SAVE / LOAD
    const sx = tx, sy = ty;
    tx = 1; ty = 1; print(word);
    tx = sx; ty = sy;
  }

  // ------------------------------------------------------------------ intro (07bb:3ac9)
  async function intro() {
    tx = 0; ty = 0;
    print('       THE ANGER OF PHARAOH XXXV\n\r');
    blit(IMG[A.begin]);
    tx = 0; ty = 135;
    print('    START GAME\n\r    LOAD GAME\n\r    CREDITS\n\r    QUIT\n\r');
    ty = 135; putc(0x2a); tx = 0;
    for (;;) {
      const k = await getch();
      if (isExitKey(k)) await exitConfirm();
      else if (k.s === 0x3b) {
        await helpBox(60, 78, 201, 68, 260, 132, 68, 80,
          ['Cursor Up:    Move Up\n', 'Cursor Down:  Move Down\n', 'Enter:        Select\n', 'F1:           Help\n']);
      } else if (k.s === 0x50) {
        putc(0x20); tx = 0; ty = ((ty - 122) % 52) + 135; putc(0x2a); tx = 0;
      } else if (k.s === 0x48) {
        putc(0x20); tx = 0; ty -= 13; if (ty < 135) ty = 174; putc(0x2a); tx = 0;
      } else if (k.a === 0x0d) {
        const row = (ty - 135) / 13 | 0;
        if (row === 0) { await fadeOut(); fadePending = 1; clearScreen(); return; }
        if (row === 3) await exitConfirm();
      } else await beepBad();
    }
  }

  // ------------------------------------------------------------------ main input loop (07bb:26c9)
  const hist = { lines: Array.from({ length: 20 }, () => []), L: 0, wrapped: 0 };

  function redrawLine(line, pad) {          // 07bb:1b5a
    putc(0x0d);
    print(line.join(''));
    for (let i = 0; i < pad; i++) putc(0x20);
  }

  async function play() {
    let pos = 0, len = 0, maxlen = 0, h = -1, insert = 0;
    let line = hist.lines[hist.L];
    line.length = 0;
    tx = 0; ty = TEXT_TOP;
    for (;;) {
      tx = pos * 8;
      drawCursor();
      if (beep.state) beep.state--;
      const k = await getch();
      eraseCursor();
      if (k.a === 0x1b || k.s === 0x3e) await optionsMenu();
      else if (isExitKey(k)) await exitConfirm();
      else if (k.s === 0x3b) await mainHelp();
      else if (k.s === 0x3c) stamp('SAVE');
      else if (k.s === 0x3d) stamp('LOAD');
      else if (k.s === 0x3f) await inventory();
      else if (k.a >= 0x20 && k.a <= 0x7a) {
        h = -1;
        const ch = String.fromCharCode(k.a);
        if (pos > 38) await beepEdit();
        else if (insert) {
          if (len >= 38) await beepEdit();
          else { line.splice(pos, 0, ch); pos++; len++; line.length = len; if (len > maxlen) maxlen = len; }
        } else {
          if (pos >= len) len++;
          line.length = len; line[pos] = ch; pos++;
          if (len > maxlen) maxlen = len;
        }
      } else if (k.s === 0x0e) {              // backspace
        h = -1;
        if (pos !== 0) { pos--; line.splice(pos, 1); len--; line.length = len; } else await beepEdit();
      } else if (k.s === 0x53) {              // del
        h = -1;
        if (pos !== len) { line.splice(pos, 1); len--; line.length = len; } else await beepEdit();
      } else if (k.s === 0x52) insert ^= 1;
      else if (k.s === 0x47) pos = 0;
      else if (k.s === 0x4f) pos = len;
      else if (k.a === 0x0d) {                // enter
        h = -1;
        print('\n\r');
        const text = await execute(line.join(''));
        line.length = 0; for (const c of text) line.push(c);   // the parser rewrites the buffer in place
        maxlen = 0; len = 0; pos = 0;
        const old = hist.L; hist.L++;
        if (old === 19) { hist.L = 0; hist.wrapped = 1; }
        line = hist.lines[hist.L]; line.length = 0;
      } else if (k.s === 0x4b) { if (pos !== 0) pos--; else await beepEdit(); }
      else if (k.s === 0x4d) { if (pos < len) pos++; else await beepEdit(); }
      else if (k.s === 0x50) {                // down: newer history entry
        if (h === -1 || h === hist.L) await beepEdit();
        else {
          h++;
          if (h === hist.L) { pos = 0; line.length = 0; len = 0; }
          else {
            if (h === 20) h = 0;
            line.length = 0; for (const c of hist.lines[h]) line.push(c);
            pos = 0; len = line.length; if (len > maxlen) maxlen = len;
          }
        }
      } else if (k.s === 0x48) {              // up: older history entry
        const cur1 = h === -1 ? hist.L : h;
        if ((cur1 === 0 && !hist.wrapped) || cur1 === (hist.L + 1) % 20) await beepEdit();
        else {
          if (h === -1) h = hist.L;
          h--; if (h === -1) h = 19;
          line.length = 0; for (const c of hist.lines[h]) line.push(c);
          pos = 0; len = Math.max(line.length - 1, 0); line.length = len; if (len > maxlen) maxlen = len;
        }
      } else await beepBad();
      redrawLine(line, maxlen - len);
    }
  }

  // ------------------------------------------------------------------ program
  async function program() {
    for (;;) {
      // 07bb:0007 — (re)load GAME.DAT: fresh object table, palette, mode 13h
      objs = A.objects.map((o) => ({ scr: o.scr, flg: o.flg, cdt: o.cdt }));
      pal.set(A.palette);
      clearScreen();
      curOn = 0; fadePending = 0; cur = 0; beep.state = 0; beep.count = 0;
      try {
        await intro();
        await loadScreen(0);
        await play();
      } catch (e) {
        if (!(e instanceof Restart)) throw e;
        nosound();
        clearScreen();
        unloadAll();
      }
    }
  }

  function decodeImages() {
    for (const im of A.images) {
      const bin = atob(im.data);
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      IMG.push({ w: im.w, h: im.h, x: im.x, y: im.y, data });
    }
    dialogueNodes = [];
    const collect = (node) => {
      if (!node || node.ref !== undefined) return;
      dialogueNodes[node.id] = node;
      for (const a of node.answers) collect(a.node);
    };
    const walk = (pn, d) => {
      if (pn === 40) collect(d);
      else if (pn === 30 || pn === 31) for (const [spn, sd] of d.procs) walk(spn, sd);
    };
    for (const o of A.objects) for (const b of o.blocks) for (const [pn, d] of b.entries) walk(pn, d);
  }

  async function start(assets, canvasEl) {
    A = assets;
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    imageData = ctx.createImageData(W, H);
    decodeImages();
    window.addEventListener('keydown', (e) => {
      const k = translateKey(e);
      if (!k) return;
      e.preventDefault();
      if (audio && audio.state === 'suspended') audio.resume();
      pushKey(k);
    });
    const frame = () => { present(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    await program();
  }

  // present is exposed so a screenshot can be taken from a background tab, where requestAnimationFrame is paused.
  return { start, pushKey, debug: () => ({ objs, cur, tx, ty, fadePending, queue: keyQueue.length, printLog, present }) };
})();
