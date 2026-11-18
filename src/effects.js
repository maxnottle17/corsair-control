// Turns the lighting settings into a colour for every LED on the keyboard.
const { keys, LED_COUNT, COLOR_BYTES } = require('./layout');

const minX = Math.min(...keys.map((k) => k.x));
const maxX = Math.max(...keys.map((k) => k.x + k.w));
const pos = new Map(keys.map((k) => [k.id, (k.x + k.w / 2 - minX) / (maxX - minX)]));

function hex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hsv(h, s, v) {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const scale = (c, s) => c.map((v) => Math.round(v * s));

const ANIMATED = new Set(['rainbow', 'breathing', 'cycle', 'wave', 'reactive']);

class Effects {
  constructor() { this.hits = new Map(); }
  isAnimated(cfg) { return ANIMATED.has(cfg.effect); }
  keyDown(id) { this.hits.set(id, Date.now()); }

  // cfg: keyboard.lighting; t: seconds
  frame(cfg, t) {
    const buf = Buffer.alloc(COLOR_BYTES);
    const c1 = hex(cfg.color), c2 = hex(cfg.color2);
    const speed = 0.15 + (cfg.speed / 100) * 1.6;
    const now = Date.now();
    for (let id = 0; id < LED_COUNT; id++) {
      const p = pos.has(id) ? pos.get(id) : 0.5;
      let c;
      switch (cfg.effect) {
        case 'off': c = [0, 0, 0]; break;
        case 'perkey': c = hex((cfg.perKey && cfg.perKey[id]) || cfg.color); break;
        case 'rainbow': c = hsv((((p - t * speed * 0.4) % 1) + 1) % 1, 1, 1); break;
        case 'cycle': c = hsv((t * speed * 0.15) % 1, 1, 1); break;
        case 'breathing': c = scale(c1, 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(t * speed * 2.2))); break;
        case 'wave': c = mix(c1, c2, 0.5 + 0.5 * Math.sin((p * 2 - t * speed) * Math.PI * 2)); break;
        case 'reactive': {
          const hit = this.hits.get(id);
          const age = hit ? (now - hit) / (1400 - cfg.speed * 10) : 1;
          c = age < 1 ? mix(c2, c1, age) : c1;
          break;
        }
        default: c = c1; // static
      }
      buf[id * 3] = c[0]; buf[id * 3 + 1] = c[1]; buf[id * 3 + 2] = c[2];
    }
    return buf;
  }
}

module.exports = { Effects, hex };
