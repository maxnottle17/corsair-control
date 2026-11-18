const fs = require('fs');
const path = require('path');

const dir = path.join(process.env.APPDATA || process.cwd(), 'CorsairControl');
const file = path.join(dir, 'config.json');
const backupFile = path.join(dir, 'config.backup.json');

const defaults = {
  keyboard: {
    control: 'self', // 'self' = keyboard runs itself (screen + Fn shortcuts work); 'full' = app handles dial and buttons
    lighting: { effect: 'static', color: '#00c8ff', color2: '#ff2bd6', speed: 50, brightness: 100, perKey: {}, fnColor: '#ffffff' },
    dial: { mode: 'volmedia' },
    // Button jobs used while the keyboard runs itself. 'keep' leaves the keyboard's own saved action alone.
    selfButtons: { 131: { type: 'keep', value: '' }, 132: { type: 'keep', value: '' }, 133: { type: 'keep', value: '' }, 134: { type: 'keep', value: '' }, 135: { type: 'keep', value: '' }, 136: { type: 'keep', value: '' } },
    onboard: { files: [], dial: null, leds: null, light: null }, // what this app has saved into the keyboard
    // Game Mode button does nothing unless you give it a job here.
    buttons: {
      130: { type: 'none', value: '' },
      131: { type: 'media', value: 'playpause' },
      132: { type: 'media', value: 'prev' },
      133: { type: 'media', value: 'next' },
      134: { type: 'micmute', value: '' },
      135: { type: 'dialmode', value: '' },
      136: { type: 'none', value: '' },
    },
  },
  // Sound modes: one click sets the headset volume, mic level, sidetone and how loud each kind of app is.
  sound: {
    mode: null, // the mode that is switched on, or null for manual
    manualEq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // tone used in Manual; needs Equalizer APO, as do the modes' "eq" values
    modes: {
      gaming: { eq: [0, 1, 0, -1, -1, 0, 2, 4, 3, 1], name: 'Gaming', volume: 70, mic: 80, sidetone: { enabled: true, level: 35 }, levels: { other: 100, music: 35, chat: 100, browser: 60, system: 40 } },
      music: { eq: [4, 3, 1, 0, -1, 0, 1, 2, 3, 3], name: 'Music', volume: 60, mic: 70, sidetone: { enabled: false, level: 35 }, levels: { other: 50, music: 100, chat: 70, browser: 100, system: 25 } },
      movies: { eq: [5, 4, 2, 0, 0, 1, 2, 2, 1, 1], name: 'Movies', volume: 80, mic: 70, sidetone: { enabled: false, level: 35 }, levels: { other: 100, music: 20, chat: 40, browser: 100, system: 15 } },
      chat: { eq: [-4, -3, -1, 0, 1, 2, 3, 3, 1, 0], name: 'Voice chat', volume: 65, mic: 90, sidetone: { enabled: true, level: 50 }, levels: { other: 55, music: 25, chat: 100, browser: 55, system: 40 } },
      focus: { eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], name: 'Focus', volume: 50, mic: 70, sidetone: { enabled: false, level: 35 }, levels: { other: 60, music: 100, chat: 30, browser: 60, system: 0 } },
      night: { eq: [-4, -3, -1, 0, 0, 1, 1, 0, -2, -3], name: 'Late night', volume: 30, mic: 70, sidetone: { enabled: false, level: 35 }, levels: { other: 80, music: 80, chat: 100, browser: 80, system: 20 } },
    },
  },
  headset: {
    lighting: { top: '#00c8ff', bottom: '#00c8ff', brightness: 100, on: true },
    sidetone: { enabled: false, level: 50 },
    sleepMinutes: 15,
    followMicMute: true,
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

function readJson(f) {
  const v = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!isObj(v)) throw new Error('not a settings file');
  return v;
}

// Loads the saved settings. If the main file is missing or damaged (for example the PC
// lost power mid-save), the previous good copy is used instead of starting from scratch.
let loadedFrom = 'defaults';
function load() {
  for (const [f, label] of [[file, 'saved'], [backupFile, 'backup']]) {
    try { const v = merge(defaults, readJson(f)); loadedFrom = label; return v; } catch (e) { /* try the next one */ }
  }
  loadedFrom = 'defaults';
  return merge(defaults, {});
}

// Writes to a temporary file and swaps it in, so a crash can never leave a half-written
// settings file. The file being replaced is kept as the backup when it is readable.
let lastWritten = null;
function writeNow(cfg) {
  const text = JSON.stringify(cfg, null, 2);
  if (text === lastWritten) return true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    try { readJson(file); fs.copyFileSync(file, backupFile); } catch (e) { /* nothing good to back up */ }
    fs.renameSync(tmp, file);
    lastWritten = text;
    return true;
  } catch (e) { console.error('could not save settings:', e.message); return false; }
}

// A change is written to disk the moment it happens. While a slider is being dragged the
// steps in between are skipped, and the final value is written 150 ms after it stops.
let pending = null, lastAt = 0;
function save(cfg) {
  const now = Date.now();
  if (!pending && now - lastAt > 200) { lastAt = now; writeNow(cfg); return; }
  clearTimeout(pending);
  pending = setTimeout(() => { pending = null; lastAt = Date.now(); writeNow(cfg); }, 150);
}
function flush(cfg) {
  clearTimeout(pending); pending = null;
  return writeNow(cfg);
}

module.exports = { load, save, flush, merge, file, dir, source: () => loadedFrom };
