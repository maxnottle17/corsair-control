// The Vanguard Pro 96 side screen. Pictures are stored as files in the keyboard's
// own memory; the active profile lists them and remembers which one is showing.
// File formats follow Corsair's Web Hub.
const fsNode = require('fs');
const path = require('path');

const WIDTH = 248, HEIGHT = 170; // picture area of the screen
const FILE_PROFILE_LIST = 15, FILE_RESOURCE_MAP = 61;
const PROP_SCREEN_INDEX = 263;
const CFG_IMAGE = 0x38, CFG_GIF = 0x66, RES_BMP = 0x48;
const ID_MIN = 28000, ID_MAX = 32767;

function parseProfile(fs) {
  const list = fs.readFile(FILE_PROFILE_LIST);
  if (!list || list.length < 6) throw new Error('profile list not readable');
  for (let i = 4; i + 1 < list.length; i += 2) {
    const id = list.readUInt16LE(i);
    const p = id && fs.readFile(id);
    if (!p || p.length < 40 || p[0] !== 0x1e || p[1] !== 0xf1) continue;
    const end = 33 + p.readUInt16LE(30);
    if (p.length < end + 8) continue;
    return { id, propsId: p.readUInt16LE(8), layoutId: p.readUInt16LE(end + 6) };
  }
  throw new Error('no profile with a screen layout found');
}

function parseLayout(buf) {
  let e = 3; const rows = [];
  for (let r = 0; r < buf[2]; r++) { const n = buf[e++]; const ids = []; for (let i = 0; i < n; i++) { ids.push(buf.readUInt16LE(e)); e += 2; } rows.push(ids); }
  return { header: buf.subarray(0, 2), rows };
}
function buildLayout(l) {
  const out = [...l.header, l.rows.length];
  for (const ids of l.rows) { out.push(ids.length); for (const id of ids) out.push(id & 255, id >> 8); }
  return Buffer.from(out);
}
function parseProps(buf) {
  const n = buf.readUInt16LE(2), pairs = [];
  for (let i = 0; i < n; i++) pairs.push([buf.readUInt16LE(4 + i * 6), buf.readUInt32LE(6 + i * 6)]);
  return { header: buf.subarray(0, 2), pairs };
}
function buildProps(p) {
  const out = Buffer.alloc(4 + p.pairs.length * 6);
  p.header.copy(out, 0); out.writeUInt16LE(p.pairs.length, 2);
  p.pairs.forEach(([id, v], i) => { out.writeUInt16LE(id, 4 + i * 6); out.writeUInt32LE(v >>> 0, 6 + i * 6); });
  return out;
}
function parseMap(buf) {
  const n = buf.readUInt16LE(2), items = [];
  for (let i = 0; i < n; i++) items.push(Buffer.from(buf.subarray(4 + i * 8, 12 + i * 8)));
  return { header: buf.subarray(0, 2), items };
}
function buildMap(m) {
  const out = Buffer.alloc(4 + m.items.length * 8);
  m.header.copy(out, 0); out.writeUInt16LE(m.items.length, 2);
  m.items.forEach((it, i) => it.copy(out, 4 + i * 8));
  return out;
}

// rgb565: Buffer of WIDTH*HEIGHT little-endian 16-bit pixels, top row first
function packImage(rgb565) {
  const pixels = WIDTH * HEIGHT * 2;
  if (rgb565.length !== pixels) throw new Error('picture must be 248 x 170');
  const total = 54 + pixels + 6, b = Buffer.alloc(total);
  b[0] = RES_BMP; b.write('BM', 2, 'latin1');
  b.writeUInt32LE(total, 4); b.writeUInt32LE(54, 12); b.writeUInt32LE(40, 16);
  b.writeInt32LE(WIDTH, 20); b.writeInt32LE(HEIGHT, 24); b.writeUInt16LE(1, 28); b.writeUInt16LE(16, 30);
  b.writeUInt32LE(3, 32); b.writeUInt32LE(pixels, 36); b.writeUInt32LE(2835, 40); b.writeUInt32LE(2835, 44);
  rgb565.copy(b, 54);
  b.writeUInt32LE(Math.floor(Date.now() / 1000), total - 4);
  return b;
}

// What is on the screen now: the list of slots and which one is showing.
function read(fs) {
  const prof = parseProfile(fs);
  const layout = parseLayout(fs.readFile(prof.layoutId));
  const props = parseProps(fs.readFile(prof.propsId));
  const cur = props.pairs.find(([id]) => id === PROP_SCREEN_INDEX);
  const slots = layout.rows[0].map((configId, index) => {
    const c = fs.readFile(configId) || Buffer.alloc(0);
    const resourceId = c.length >= 4 ? c.readUInt16LE(2) : 0;
    const kind = c[0] === CFG_IMAGE ? (resourceId ? 'image' : 'builtin') : c[0] === CFG_GIF ? 'animation' : 'other';
    return { index, configId, resourceId, kind };
  });
  return { prof, layout, props, slots, current: cur ? cur[1] : 0 };
}

// Pixels of a stored picture (for previews). Returns null if it is not a plain picture.
function readImage(fs, resourceId) {
  const d = fs.readFile(resourceId);
  if (!d || d[0] !== RES_BMP || d.readUInt16LE(30) !== 16 || d.readInt32LE(20) !== WIDTH || d.readInt32LE(24) !== HEIGHT) return null;
  return d.subarray(54, 54 + WIDTH * HEIGHT * 2);
}

function select(fs, index) {
  const s = read(fs);
  if (index < 0 || index >= s.slots.length) throw new Error('no such screen slot');
  const pair = s.props.pairs.find(([id]) => id === PROP_SCREEN_INDEX);
  if (pair) pair[1] = index; else s.props.pairs.push([PROP_SCREEN_INDEX, index]);
  fs.writeFile(s.prof.propsId, buildProps(s.props));
  return index;
}

function freeIds(fs, state, count) {
  const map = parseMap(fs.readFile(FILE_RESOURCE_MAP));
  const used = new Set([state.prof.id, state.prof.propsId, state.prof.layoutId, ...state.slots.flatMap((x) => [x.configId, x.resourceId]), ...map.items.map((it) => it.readUInt16LE(0))]);
  const out = [];
  for (let id = ID_MIN + 100; id <= ID_MAX && out.length < count; id++) if (!used.has(id) && !fs.exists(id)) out.push(id);
  if (out.length < count) throw new Error('no free file slots on the keyboard');
  return { ids: out, map };
}

// Stores a picture, adds it as a new slot and shows it. Returns the new slot index.
function addImage(fs, rgb565) {
  const data = packImage(rgb565);
  const state = read(fs);
  const free = fs.getProp(62);
  if (free !== null && free < data.length + 4096) throw new Error('the keyboard\'s memory is full');
  const { ids: [resourceId, configId], map } = freeIds(fs, state, 2);

  const originalMap = buildMap(map);
  let listed = false;
  try {
    fs.writeFile(resourceId, data);
    const item = Buffer.alloc(8); item.writeUInt16LE(resourceId, 0); item.writeUInt16LE(resourceId, 2);
    map.items.push(item);
    fs.writeFile(FILE_RESOURCE_MAP, buildMap(map));
    const cfg = Buffer.alloc(16); cfg[0] = CFG_IMAGE; cfg.writeUInt16LE(resourceId, 2);
    fs.writeFile(configId, cfg);
    state.layout.rows[0].push(configId);
    fs.writeFile(state.prof.layoutId, buildLayout(state.layout));
    listed = true;
    return select(fs, state.layout.rows[0].length - 1);
  } catch (e) {
    // Leave nothing half-saved behind: the picture only counts once the profile lists it.
    if (!listed) {
      try { fs.unbind(); fs.writeFile(FILE_RESOURCE_MAP, originalMap); } catch (e2) { /* best effort */ }
      try { fs.deleteFile(configId); fs.deleteFile(resourceId); } catch (e2) { /* best effort */ }
    }
    throw e;
  }
}

// Removes a picture slot (built-in slots cannot be removed).
function removeSlot(fs, index) {
  const state = read(fs);
  const slot = state.slots[index];
  if (!slot || slot.kind !== 'image') throw new Error('that slot cannot be removed');
  state.layout.rows[0].splice(index, 1);
  fs.writeFile(state.prof.layoutId, buildLayout(state.layout));
  const next = state.current === index ? Math.max(0, index - 1) : state.current > index ? state.current - 1 : state.current;
  select(fs, next);
  const map = parseMap(fs.readFile(FILE_RESOURCE_MAP));
  map.items = map.items.filter((it) => it.readUInt16LE(0) !== slot.resourceId);
  fs.writeFile(FILE_RESOURCE_MAP, buildMap(map));
  fs.deleteFile(slot.configId); fs.deleteFile(slot.resourceId);
  return next;
}

// Saves the small index files we modify, so they can be put back if anything goes wrong.
function backup(fs, dir) {
  const prof = parseProfile(fs);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(dir, 'screen-backup-' + stamp);
  fsNode.mkdirSync(out, { recursive: true });
  for (const id of [FILE_PROFILE_LIST, FILE_RESOURCE_MAP, prof.id, prof.propsId, prof.layoutId]) {
    const d = fs.readFile(id);
    if (d) fsNode.writeFileSync(path.join(out, id + '.bin'), d);
  }
  return out;
}

module.exports = { WIDTH, HEIGHT, read, readImage, select, addImage, removeSlot, backup };
