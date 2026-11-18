// Diagnostic: how the keyboard answers lighting commands while it runs itself.
// The app must not be running. Leaves the keys on the last test colour briefly, then releases them.
const { KbFs } = require('../src/kbfs');

const fs = KbFs.standalone();
const st = (b) => fs.cmd(b).status;
const frame = (r, g, b) => { const p = Buffer.alloc(4 + 2 + 413); p.writeUInt16LE(413, 0); p[4] = 0x12; for (let i = 0; i < 137; i++) p.set([r, g, b], 6 + i * 3); return [0x06, 0x01, ...p]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function burst(label, n, gapMs, colour, extra) {
  return new Promise((resolve) => {
    const times = [], statuses = {}; let i = 0; const t0 = Date.now();
    const tick = () => {
      const a = process.hrtime.bigint();
      let s; try { s = st(frame(...colour)); } catch (e) { s = 'err'; }
      times.push(Number(process.hrtime.bigint() - a) / 1e6);
      statuses[s] = (statuses[s] || 0) + 1;
      if (extra && i % 10 === 5) extra();
      if (++i >= n) {
        times.sort((x, y) => x - y);
        console.log(`${label}: ${n} writes in ${Date.now() - t0} ms; per write median ${times[n >> 1].toFixed(1)} ms, max ${times[n - 1].toFixed(1)} ms; statuses ${JSON.stringify(statuses)}`);
        resolve();
      } else setTimeout(tick, gapMs);
    };
    tick();
  });
}

(async () => {
  try {
    console.log('mode -> self:', st([1, 3, 0, 1]));
    console.log('open lights:', st([0x0d, 0x01, 0x22]), ' open again:', st([0x0d, 0x01, 0x22]));
    await burst('A plain, 40 ms apart   (red)', 75, 40, [255, 0, 0]);
    await burst('B with game-mode check (green)', 75, 40, [0, 255, 0], () => st([0x02, 0xe1, 0x00]));
    await burst('C with brightness set  (blue)', 75, 40, [0, 0, 255], () => st([0x01, 0x02, 0x00, 0xe8, 0x03]));
    console.log('take control and hand back (as the app does after saving to the keyboard):', st([1, 3, 0, 2]), st([1, 3, 0, 1]));
    await sleep(600);
    console.log('  first write without re-opening lights:', st(frame(255, 255, 0)), ' re-open:', st([0x0d, 0x01, 0x22]));
    await burst('D after hand-back      (yellow)', 75, 40, [255, 255, 0]);
    console.log('release lights:', st([0x05, 0x01, 0x01]));
  } catch (e) { console.error('error:', e.message); }
  fs.close();
})();
