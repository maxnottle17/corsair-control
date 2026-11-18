// Dial modes and button jobs saved in the keyboard's own memory, so they work while
// the keyboard runs itself. File formats follow Corsair's Web Hub.
//
// Jobs the keyboard can do alone (media keys, shortcuts) are stored directly. Jobs that
// need the PC (open an app, mute the mic, sidetone...) are stored as an unusual key
// combination (Ctrl+Alt+Shift+F1..F9) which the app listens for - see hotkeys.js.
const fsNode = require('fs');
const path = require('path');

const PROP_DIAL_INDEX = 108;
const DIAL_CUSTOM = 0;
const TRIGGER = { cw: 0, ccw: 1, press: 2 };
const CONSUMER = { playpause: 0xcd, next: 0xb5, prev: 0xb6, stop: 0xb7, mute: 0xe2, volup: 0xe9, voldown: 0xea };
// key numbers as the keyboard counts them
const K = { ctrl: 105, shift: 106, alt: 107, win: 108, f1: 58 };
const KEYCODES = {
  ctrl: 105, control: 105, shift: 106, alt: 107, win: 108, enter: 40, return: 40, esc: 41, escape: 41, backspace: 42, tab: 43, space: 44,
  '-': 45, minus: 45, '=': 46, plus: 46, '[': 47, ']': 48, '\\': 49, ';': 51, "'": 52, '`': 53, ',': 54, '.': 55, '/': 56,
  printscreen: 70, prtsc: 70, insert: 73, home: 74, pageup: 75, delete: 76, del: 76, end: 77, pagedown: 78, right: 79, left: 80, down: 81, up: 82,
};
for (let i = 0; i < 26; i++) KEYCODES[String.fromCharCode(97 + i)] = 4 + i;
for (let i = 1; i <= 9; i++) KEYCODES[String(i)] = 29 + i;
KEYCODES['0'] = 39;
for (let i = 1; i <= 12; i++) KEYCODES['f' + i] = 57 + i;

// Slots of the "ask the app" key combination: Ctrl+Alt+Shift+F<n>
const SIGNAL = { 131: 1, 132: 2, 133: 3, 134: 4, 135: 5, 136: 6, cw: 7, ccw: 8, press: 9 };
const BUTTON_IDS = [131, 132, 133, 134, 135, 136];

const consumer = (name) => ({ type: 3, code: CONSUMER[name] });
const signal = (slot) => ({ type: 1, keys: [K.ctrl, K.alt, K.shift, K.f1 + SIGNAL[slot] - 1] });

function remapBytes(a) {
  const head = [0x6e, 0x07, a.type, 0, 0, 0, 0, 0];
  if (a.type === 1) return Buffer.from([...head, a.keys.length, ...a.keys]);
  return Buffer.from([...head, a.code & 255, a.code >> 8]);
}

function shortcutKeys(text) {
  const parts = String(text || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  const keys = parts.map((p) => KEYCODES[p]);
  return parts.length && keys.every((k) => k !== undefined) ? keys : null;
}

// What to store for a button job. null = nothing stored (button does nothing).
function buttonAction(id, job) {
  if (!job || job.type === 'none') return null;
  if (job.type === 'media' && CONSUMER[job.value]) return consumer(job.value);
  if (job.type === 'shortcut') { const keys = shortcutKeys(job.value); return keys ? { type: 1, keys } : null; }
  return signal(id); // needs the PC: the app does it when it sees the combination
}

// What to store for a dial mode: a built-in keyboard mode, or three actions.
function dialSpec(mode) {
  switch (mode) {
    case 'volume': return { builtin: 13 };
    case 'brightness': return { builtin: 1 };
    case 'scroll': return { builtin: 4 };
    case 'hscroll': return { builtin: 5 };
    case 'zoom': return { builtin: 7 };
    case 'media': return { color: [0xff, 0x2b, 0xd6], cw: consumer('next'), ccw: consumer('prev'), press: consumer('playpause') };
    case 'mic': case 'sidetone': return { color: [0x00, 0xc8, 0xff], cw: signal('cw'), ccw: signal('ccw'), press: signal('press') };
    default: return { color: [0xff, 0xd6, 0x0a], cw: consumer('volup'), ccw: consumer('voldown'), press: consumer('playpause') }; // volmedia
  }
}

function profile(fs) {
  const list = fs.readFile(15);
  for (let i = 4; list && i + 1 < list.length; i += 2) {
    const id = list.readUInt16LE(i), p = id && fs.readFile(id);
    if (!p || p.length < 40 || p[0] !== 0x1e || p[1] !== 0xf1) continue;
    return { id, assignId: p.readUInt16LE(6), propsId: p.readUInt16LE(8), lightId: p.readUInt16LE(12), keymapId: p.readUInt16LE(14), dialId: p.readUInt16LE(18) };
  }
  throw new Error('keyboard profile not found');
}

function parseDial(buf) {
  const modes = []; let e = 4;
  const n = buf.readUInt16LE(2);
  for (let i = 0; i < n && e + 6 <= buf.length; i++) {
    const m = { type: buf[e], color: Buffer.from(buf.subarray(e + 1, e + 5)), actions: [] }; const c = buf[e + 5]; e += 6;
    for (let j = 0; j < c; j++) { m.actions.push({ trigger: buf[e], options: buf.readUInt16LE(e + 2), fileId: buf.readUInt16LE(e + 4) }); e += 6; }
    modes.push(m);
  }
  return modes;
}
function buildDial(modes) {
  const out = [0x16, 0x00, modes.length & 255, modes.length >> 8];
  for (const m of modes) {
    out.push(m.type, ...m.color, m.actions.length);
    for (const a of m.actions) out.push(a.trigger, 0, a.options & 255, a.options >> 8, a.fileId & 255, a.fileId >> 8);
  }
  return Buffer.from(out);
}
function parseAssign(buf) {
  const keys = new Map(); let e = 4;
  while (e + 2 <= buf.length) {
    const key = buf[e], n = buf[e + 1], len = 2 + n * 10;
    const files = []; for (let j = 0; j < n; j++) files.push(buf.readUInt16LE(e + 2 + j * 10 + 2));
    keys.set(key, { raw: Buffer.from(buf.subarray(e, e + len)), files });
    e += len;
  }
  return keys;
}
function setProp(fs, propsId, id, value) {
  const buf = fs.readFile(propsId), n = buf.readUInt16LE(2), pairs = [];
  for (let i = 0; i < n; i++) pairs.push([buf.readUInt16LE(4 + i * 6), buf.readUInt32LE(6 + i * 6)]);
  const hit = pairs.find((p) => p[0] === id);
  if (hit) hit[1] = value; else pairs.push([id, value]);
  const out = Buffer.alloc(4 + pairs.length * 6);
  buf.copy(out, 0, 0, 2); out.writeUInt16LE(pairs.length, 2);
  pairs.forEach(([pid, v], i) => { out.writeUInt16LE(pid, 4 + i * 6); out.writeUInt32LE(v >>> 0, 6 + i * 6); });
  fs.writeFile(propsId, out);
}

// Hands out file numbers nothing else on the keyboard uses.
function allocator(fs, taken) {
  let next = 28300;
  return () => {
    for (; next <= 32767; next++) if (!taken.has(next) && !fs.exists(next)) { taken.add(next); return next++; }
    throw new Error('no free file slots on the keyboard');
  };
}

// Saves the files we change, once per run of the app.
function backup(fs, dir) {
  const p = profile(fs);
  const out = path.join(dir, 'keys-backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fsNode.mkdirSync(out, { recursive: true });
  const ids = [p.id, p.assignId, p.propsId, p.keymapId, p.dialId, p.lightId, ...lightList(fs, p)];
  for (const id of ids) { const d = id && fs.readFile(id); if (d) fsNode.writeFileSync(path.join(out, id + '.bin'), d); }
  return out;
}

// Makes `mode` the keyboard's dial mode (it becomes the first and active mode; the
// keyboard's other built-in modes stay available through Fn + F12).
// `owned` lists files this app created earlier; returns the new list.
function applyDial(fs, mode, owned) {
  const p = profile(fs);
  const old = parseDial(fs.readFile(p.dialId));
  const spec = dialSpec(mode);
  const ownedSet = new Set(owned);
  const stale = old.flatMap((m) => m.actions.map((a) => a.fileId)).filter((id) => ownedSet.has(id));
  const alloc = allocator(fs, new Set());
  const created = [];
  let first;
  if (spec.builtin !== undefined) {
    const existing = old.find((m) => m.type === spec.builtin);
    first = { type: spec.builtin, color: existing ? existing.color : Buffer.from([0xff, 0xff, 0xff, 0xff]), actions: [] };
  } else {
    first = { type: DIAL_CUSTOM, color: Buffer.from([0xff, ...spec.color]), actions: [] };
    for (const t of ['cw', 'ccw', 'press']) {
      const id = alloc(); fs.writeFile(id, remapBytes(spec[t])); created.push(id);
      first.actions.push({ trigger: TRIGGER[t], options: 1, fileId: id });
    }
  }
  // keep the keyboard's other modes, minus the one we just put first and minus our own old custom mode
  const rest = old.filter((m) => m.type !== first.type && !(m.type === DIAL_CUSTOM && m.actions.some((a) => ownedSet.has(a.fileId))));
  fs.writeFile(p.dialId, buildDial([first, ...rest]));
  setProp(fs, p.propsId, PROP_DIAL_INDEX, 0);
  for (const id of stale) fs.deleteFile(id);
  return [...owned.filter((id) => !stale.includes(id)), ...created];
}

// Stores the jobs for G1-G5 and the Stream Deck key. A job of type 'keep' leaves
// whatever the keyboard already has for that button untouched.
function applyButtons(fs, jobs, owned) {
  const p = profile(fs);
  const keys = parseAssign(fs.readFile(p.assignId));
  const keymap = fs.readFile(p.keymapId);
  const ownedSet = new Set(owned);
  const alloc = allocator(fs, new Set());
  const created = [], stale = [];
  for (const id of BUTTON_IDS) {
    const job = jobs[id];
    if (!job || job.type === 'keep') continue;
    const had = keys.get(id);
    if (had) stale.push(...had.files.filter((f) => ownedSet.has(f)));
    const action = buttonAction(id, job);
    if (!action) { keys.delete(id); keymap[2 + id] |= 1; continue; }
    const fileId = alloc(); fs.writeFile(fileId, remapBytes(action)); created.push(fileId);
    const raw = Buffer.alloc(12); raw[0] = id; raw[1] = 1; raw.writeUInt16LE(fileId, 4); raw.writeUInt32LE(0x61, 6);
    keys.set(id, { raw, files: [fileId] });
    keymap[2 + id] &= ~1; // the stored action replaces the key's own function
  }
  fs.writeFile(p.keymapId, keymap);
  fs.writeFile(p.assignId, Buffer.concat([Buffer.from([0x75, 0, 0, 0]), ...[...keys.values()].map((k) => k.raw)]));
  for (const id of stale) fs.deleteFile(id);
  return [...owned.filter((id) => !stale.includes(id)), ...created];
}

// A short description of what the keyboard currently has stored for each button.
function describeButtons(fs) {
  const p = profile(fs);
  const keys = parseAssign(fs.readFile(p.assignId));
  const out = {};
  for (const id of BUTTON_IDS) {
    const k = keys.get(id);
    if (!k || !k.files.length) { out[id] = 'nothing'; continue; }
    const f = fs.readFile(k.files[0]);
    if (!f) { out[id] = 'a saved action'; continue; }
    if (f[0] === 0x6e && f[2] === 3) { const name = Object.keys(CONSUMER).find((n) => CONSUMER[n] === f.readUInt16LE(8)); out[id] = name ? 'media: ' + name : 'a media key'; }
    else if (f[0] === 0x6e && f[2] === 1 && f[8] === 4 && f[9] === K.ctrl && f[10] === K.alt && f[11] === K.shift) out[id] = 'a job that this app carries out';
    else if (f[0] === 0x6e && f[2] === 1) out[id] = 'a key press';
    else if (f[0] === 0xac) out[id] = 'a macro' + (f.length > 16 ? ' "' + f.subarray(16).toString('latin1').replace(/\0/g, '') + '"' : '');
    else out[id] = 'a saved action';
  }
  return out;
}

// ---- lighting stored in the keyboard ----
// The keyboard paints its own lighting many times a second, so a still colour has to be
// stored in it rather than streamed. Each layer is one colour on a set of keys.
function lightList(fs, p) {
  const buf = p.lightId && fs.readFile(p.lightId);
  const ids = [];
  if (buf && buf.length >= 4) for (let i = 0; i < buf.readUInt16LE(2) && 8 + i * 4 <= buf.length; i++) ids.push(buf.readUInt16LE(6 + i * 4));
  return ids;
}

// Every light the keyboard's current lighting covers (keys plus any extra lights).
function readLeds(fs) {
  const p = profile(fs); const leds = new Set();
  for (const id of lightList(fs, p)) {
    const f = fs.readFile(id);
    if (!f || f.length < 8) continue;
    const at = 7 + f[6] * 4; // header(2) flags speed direction pad colourCount, then colours
    for (let i = 0; i < f[at] && at + 1 + i < f.length; i++) leds.add(f[at + 1 + i]);
  }
  return [...leds].sort((a, b) => a - b);
}

const rgb = (hex) => { const n = parseInt(String(hex || '').replace('#', ''), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// The still picture to store for the current lighting settings: [{ color, keys }].
// Moving effects are streamed by the app on top of a plain base.
function lightingLayers(cfg, leds) {
  const dark = ['off', 'rainbow', 'cycle'].includes(cfg.effect);
  const base = dark ? [0, 0, 0] : rgb(cfg.color);
  if (cfg.effect !== 'perkey') return [{ color: base, keys: leds }];
  const groups = new Map();
  for (const id of leds) {
    const c = (cfg.perKey && cfg.perKey[id]) || cfg.color;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(id);
  }
  // the keyboard holds a limited number of layers: keep the biggest colour groups, fold the rest into the base colour
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const kept = sorted.slice(0, 19), rest = sorted.slice(19).flatMap((g) => g[1]);
  const layers = kept.map(([c, keys]) => ({ color: rgb(c), keys }));
  if (rest.length) layers.push({ color: base, keys: rest });
  return layers;
}

function applyLighting(fs, layers, owned) {
  const p = profile(fs);
  if (!p.lightId) throw new Error('this profile has no lighting file');
  const ownedSet = new Set(owned);
  const stale = lightList(fs, p).filter((id) => ownedSet.has(id));
  const alloc = allocator(fs, new Set());
  const created = [];
  for (const l of layers) {
    const id = alloc();
    // static effect: type, start-with-profile, speed, direction, pad, 1 colour (stored A B G R), keys
    fs.writeFile(id, Buffer.from([126, 32, 1, 0, 0, 0, 1, 255, l.color[2], l.color[1], l.color[0], l.keys.length, ...l.keys]));
    created.push(id);
  }
  const list = [0x69, 0x6c, created.length & 255, created.length >> 8];
  for (const id of created) list.push(8, 0, id & 255, id >> 8);
  fs.writeFile(p.lightId, Buffer.from(list));
  for (const id of stale) fs.deleteFile(id);
  return [...owned.filter((id) => !stale.includes(id)), ...created];
}

module.exports = { applyDial, applyButtons, describeButtons, backup, readLeds, lightingLayers, applyLighting, SIGNAL, BUTTON_IDS };
