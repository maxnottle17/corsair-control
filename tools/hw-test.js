// Test: leave the keyboard running itself (so its screen and Fn shortcuts work) and
// see whether we can still drive the lights and hear the dial / G-keys.
// Slowly cycles all keys red -> green -> blue for the given number of seconds.
const HID = require('node-hid');
const { KbFs } = require('../src/kbfs');

const seconds = Number(process.argv[2]) || 150;
const fs = KbFs.standalone();
const evInfo = HID.devices().find((d) => d.vendorId === 0x1b1c && d.productId === 0x2b0e && d.interface === 3);
const counts = {}; const samples = [];
let listener = null;
if (evInfo) {
  listener = new HID.HID(evInfo.path);
  listener.on('data', (d) => {
    const k = 'type' + d[3]; counts[k] = (counts[k] || 0) + 1;
    if (samples.length < 12) samples.push(Buffer.from(d).subarray(0, 26).toString('hex'));
  });
  listener.on('error', () => {});
}
const st = (b) => fs.cmd(b).status;
const statuses = {};
console.log('mode set to self-operated:', st([1, 3, 0, 1]), ' open lighting:', st([0x0d, 0x01, 0x22]));
const t0 = Date.now();
const timer = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  if (t > seconds) {
    clearInterval(timer);
    try { st([0x05, 0x01, 0x01]); } catch (e) { /* ignore */ }
    console.log('colour write statuses:', JSON.stringify(statuses));
    console.log('events heard:', JSON.stringify(counts));
    console.log('samples:', samples.join('\n         '));
    try { listener && listener.close(); } catch (e) { /* ignore */ }
    fs.close();
    return;
  }
  const phase = Math.floor(t / 3) % 3;
  const c = [[255, 0, 0], [0, 255, 0], [0, 0, 255]][phase];
  const p = Buffer.alloc(4 + 2 + 413); p.writeUInt16LE(413, 0); p[4] = 0x12;
  for (let i = 0; i < 137; i++) p.set(c, 6 + i * 3);
  try { const s = st([0x06, 0x01, ...p]); statuses[s] = (statuses[s] || 0) + 1; } catch (e) { statuses.err = (statuses.err || 0) + 1; }
}, 100);
