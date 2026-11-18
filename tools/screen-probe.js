// Command-line check of the side screen. The app must not be running.
//   node tools/screen-probe.js            read-only: list what is stored
//   node tools/screen-probe.js test       back up, then add a test pattern and show it
//   node tools/screen-probe.js select N   show slot N
//   node tools/screen-probe.js remove N   remove picture slot N
const path = require('path');
const { KbFs } = require('../src/kbfs');
const screen = require('../src/screen');

const [action, arg] = process.argv.slice(2);
const backupDir = path.join(process.env.APPDATA || '.', 'CorsairControl');

function testPattern() {
  const b = Buffer.alloc(screen.WIDTH * screen.HEIGHT * 2);
  for (let y = 0; y < screen.HEIGHT; y++) for (let x = 0; x < screen.WIDTH; x++) {
    const t = x / (screen.WIDTH - 1), edge = x < 4 || y < 4 || x >= screen.WIDTH - 4 || y >= screen.HEIGHT - 4;
    let r = Math.round(255 * t), g = Math.round(200 * (1 - t)), bl = 255;
    if (edge) { r = 255; g = 214; bl = 10; }
    if (Math.abs(x - y * (screen.WIDTH / screen.HEIGHT)) < 2) { r = g = bl = 255; }
    b.writeUInt16LE(((r >> 3) << 11) | ((g >> 2) << 5) | (bl >> 3), (y * screen.WIDTH + x) * 2);
  }
  return b;
}

const fs = KbFs.standalone();
try {
  fs.mode(true);
  if (action === 'test') { console.log('backup saved to', screen.backup(fs, backupDir)); console.log('added as slot', screen.addImage(fs, testPattern())); }
  else if (action === 'select') console.log('now showing slot', screen.select(fs, Number(arg)));
  else if (action === 'remove') console.log('removed; now showing slot', screen.removeSlot(fs, Number(arg)));
  const s = screen.read(fs);
  console.log('free memory:', fs.getProp(62), 'bytes   showing slot:', s.current);
  for (const x of s.slots) console.log(`  slot ${x.index}: ${x.kind}  (config ${x.configId}, resource ${x.resourceId})`);
} catch (e) { console.error('error:', e.message); process.exitCode = 1; }
finally { try { fs.mode(false); } catch (e) { /* ignore */ } fs.close(); }
