// Which way of sending colours makes them stay on the keys while the keyboard runs itself?
// Five phases of 8 seconds each, repeated. The app must not be running.
//   RED    - colour sent 25 times a second, nothing else
//   GREEN  - same, plus re-claiming the lights twice a second
//   BLUE   - re-claiming the lights before every colour update
//   WHITE  - colour sent 200 times a second
//   PURPLE - app in full control (known to hold; for comparison)
const { KbFs } = require('../src/kbfs');

const rounds = Number(process.argv[2]) || 3;
const fs = KbFs.standalone();
const st = (b) => { try { return fs.cmd(b).status; } catch (e) { return 'err'; } };
const frame = (c) => { const p = Buffer.alloc(4 + 2 + 413); p.writeUInt16LE(413, 0); p[4] = 0x12; for (let i = 0; i < 137; i++) p.set(c, 6 + i * 3); return [0x06, 0x01, ...p]; };
const OPEN = [0x0d, 0x01, 0x22];

function phase(name, colour, gapMs, each) {
  return new Promise((resolve) => {
    const end = Date.now() + 8000; let n = 0;
    console.log(new Date().toISOString().slice(11, 19), name);
    const tick = () => { if (each) each(n); st(frame(colour)); n++; if (Date.now() < end) setTimeout(tick, gapMs); else resolve(); };
    tick();
  });
}

(async () => {
  for (let r = 0; r < rounds; r++) {
    st([1, 3, 0, 1]); st(OPEN);
    await phase('RED', [255, 0, 0], 40);
    await phase('GREEN', [0, 255, 0], 40, (n) => { if (n % 12 === 0) st(OPEN); });
    await phase('BLUE', [0, 0, 255], 40, () => st(OPEN));
    await phase('WHITE', [255, 255, 255], 5);
    st([1, 3, 0, 2]); st(OPEN);
    await phase('PURPLE', [160, 0, 255], 40);
  }
  st([0x05, 0x01, 0x01]); st([1, 3, 0, 1]);
  fs.close();
  console.log('done');
})();
