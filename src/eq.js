// Tone control through Equalizer APO (a free equaliser that runs inside Windows).
// We only write a small settings file that Equalizer APO reads; if it is not installed,
// nothing happens and the app says so.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]; // Hz
const OURS = 'corsair-control.txt';
const INCLUDE = 'Include: ' + OURS;

let dir = null, lastCheck = 0, lastText = null;

function findDir() {
  const guesses = [];
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\EqualizerAPO', '/v', 'ConfigPath'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /ConfigPath\s+REG_SZ\s+(.+)/.exec(out);
    if (m) guesses.push(m[1].trim());
  } catch (e) { /* not installed, or no such key */ }
  guesses.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'EqualizerAPO', 'config'));
  return guesses.find((g) => { try { return fs.statSync(path.join(g, 'config.txt')).isFile(); } catch (e) { return false; } }) || null;
}

function installed() {
  if (!dir && Date.now() - lastCheck > 10000) { lastCheck = Date.now(); dir = findDir(); }
  return !!dir;
}

// gains: one number per band, in dB. Returns '' when it worked, otherwise a short reason.
function apply(gains) {
  if (!installed()) return 'not installed';
  const g = BANDS.map((_, i) => Math.max(-12, Math.min(12, Number(gains && gains[i]) || 0)));
  const flat = g.every((v) => v === 0);
  const boost = Math.max(0, ...g);
  const lines = ['# Written by Corsair Control. Change the tone in the app, not here.'];
  if (!flat) {
    lines.push(`Preamp: ${(-boost).toFixed(1)} dB`); // lower everything by the biggest boost so loud sounds do not distort
    BANDS.forEach((hz, i) => { if (g[i] !== 0) lines.push(`Filter: ON PK Fc ${hz} Hz Gain ${g[i].toFixed(1)} dB Q 1.41`); });
  }
  const text = lines.join('\r\n') + '\r\n';
  if (text === lastText) return '';
  try {
    fs.writeFileSync(path.join(dir, OURS), text);
    const main = path.join(dir, 'config.txt');
    let cur = fs.readFileSync(main, 'utf8');
    // A fresh install ships with sample settings that already change the sound. Switch those
    // off (they are kept, just commented out) so only the tone chosen in the app applies.
    if (/^\s*Include:\s*example\.txt/im.test(cur) && !cur.toLowerCase().includes(INCLUDE.toLowerCase())) {
      cur = cur.split(/\r?\n/).map((l) => (l.trim() && !l.trim().startsWith('#') ? '# ' + l : l)).join('\r\n');
      fs.writeFileSync(main, cur);
    }
    if (!cur.split(/\r?\n/).some((l) => l.trim().toLowerCase() === INCLUDE.toLowerCase())) fs.writeFileSync(main, cur.replace(/\s*$/, '') + '\r\n' + INCLUDE + '\r\n');
    lastText = text;
    return '';
  } catch (e) {
    return /EPERM|EACCES/.test(e.code || '') ? 'Windows would not let the app write to the equaliser folder' : e.message;
  }
}

module.exports = { BANDS, installed, apply };
