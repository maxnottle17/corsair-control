// Corsair Vanguard Pro 96 over USB HID.
// Protocol details follow the open-source OpenLinkHub project (GPL-3.0).
const HID = require('node-hid');
const { EventEmitter } = require('events');
const { COLOR_BYTES } = require('./layout');

const VID = 0x1b1c, PID = 0x2b0e;
const PACKET = 1025; // report id + 1024

const CMD = {
  softwareMode: [0x01, 0x03, 0x00, 0x02],
  hardwareMode: [0x01, 0x03, 0x00, 0x01],
  activateLed: [0x0d, 0x01, 0x22],
  firmware: [0x02, 0x13],
  writeColor: [0x06, 0x01],
  brightness: [0x01, 0x02, 0x00],
  keepAlive: [0x12],
  pollingRate: [0x01, 0x01, 0x00],
  gameModeLocks: [0x01, 0x4a, 0x00],
  gameMode: [0x01, 0xe1, 0x00],
  gameModeKey: [0x01],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Keyboard extends EventEmitter {
  constructor() {
    super();
    this.dev = null;
    this.listener = null;
    this.connected = false;
    this.firmware = null;
    this.pressed = new Set();
    this._keepAlive = null;
    this._gmGuard = null;
    this.control = 'self';
    this.busy = false;
    this._retry = null;
    this._closing = false;
  }

  start() { this._tryConnect(); }

  _find(iface) {
    return HID.devices().find((d) => d.vendorId === VID && d.productId === PID && d.interface === iface && d.usagePage === 0xff42);
  }

  async _tryConnect() {
    if (this._closing || this.connected) return;
    clearTimeout(this._retry);
    try {
      const cmdInfo = this._find(2), evInfo = this._find(3);
      if (!cmdInfo || !evInfo) throw new Error('keyboard not found');
      this.dev = new HID.HID(cmdInfo.path);
      const fw = this._transfer(CMD.firmware);
      this.firmware = `${fw[5]}.${fw[6]}.${fw[7] | (fw[8] << 8)}`;
      await this._enter();

      this.listener = new HID.HID(evInfo.path);
      this.listener.on('data', (d) => this._onData(d));
      this.listener.on('error', () => this._lost());

      this._keepAlive = setInterval(() => this._safe(() => this._transfer(CMD.keepAlive)), 20000);
      this.connected = true;
      this.pressed.clear();
      this.emit('connected');
    } catch (e) {
      this._cleanup();
      this._retry = setTimeout(() => this._tryConnect(), 3000);
    }
  }

  // Two ways of working with the keyboard:
  //  'self' - the keyboard keeps running itself (its screen, Fn shortcuts and dial all
  //           work as built in); we only paint the lights and keep game mode off.
  //  'full' - we take over completely: the keyboard reports every key and dial turn to
  //           us, but stops running its own screen and Fn shortcuts.
  async _enter() {
    clearInterval(this._gmGuard); this._gmGuard = null;
    if (this.control === 'full') {
      this._transfer(CMD.softwareMode);
      this._transfer(CMD.activateLed);
      await sleep(400);
      this.setGameMode(false);
    } else {
      this._transfer(CMD.hardwareMode);
      this._transfer(CMD.activateLed);
      this._gmGuard = setInterval(() => this._guardGameMode(), 1500);
    }
  }

  // In 'self' mode the Game Mode button still works inside the keyboard, so undo it whenever it switches on.
  _guardGameMode() {
    if (!this.dev || this.busy) return;
    try {
      const r = this._transfer([0x02, 0xe1, 0x00]);
      if (r[4] === 0 && r[5] === 1) { this._transfer([0x01, 0xe1, 0x00], [0]); this._transfer([0x01, 0xef, 0x00], [0]); }
    } catch (e) { /* try again next time */ }
  }

  async setControl(mode) {
    mode = mode === 'full' ? 'full' : 'self';
    if (mode === this.control) return;
    this.control = mode;
    this.pressed.clear();
    if (this.dev) { try { await this._enter(); } catch (e) { this._lost(); } }
  }

  _transfer(cmd, data, timeout = 500) {
    const w = Buffer.alloc(PACKET);
    w[2] = 0x01;
    Buffer.from(cmd).copy(w, 4);
    if (data) Buffer.from(data).copy(w, 4 + cmd.length);
    this.dev.write(w);
    // Replies echo the command number; skip any late reply left over from an earlier command.
    for (let i = 0; i < 4; i++) {
      const r = this.dev.readTimeout(timeout);
      if (!r || !r.length) break;
      if (r[3] === cmd[0]) return r;
    }
    throw new Error('no reply from keyboard');
  }

  _safe(fn) {
    if (!this.dev) return false;
    try { fn(); return true; } catch (e) { console.error('keyboard:', e.message); this._lost(); return false; }
  }

  _lost() {
    if (!this.connected && !this.dev) return;
    this._cleanup();
    this.emit('disconnected');
    if (!this._closing) this._retry = setTimeout(() => this._tryConnect(), 3000);
  }

  _cleanup() {
    clearInterval(this._keepAlive);
    clearInterval(this._gmGuard); this._gmGuard = null; this.busy = false;
    this.connected = false;
    for (const h of [this.listener, this.dev]) { try { h && h.close(); } catch (e) { /* already gone */ } }
    this.listener = null; this.dev = null;
  }

  _onData(d) {
    this.emit('raw', d);
    if (d[3] === 0x02) {
      // 20-byte bitmap, one bit per key index
      const now = new Set();
      for (let i = 0; i < 160; i++) if (d[4 + (i >> 3)] & (1 << (i & 7))) now.add(i);
      for (const k of now) if (!this.pressed.has(k)) this.emit('keydown', k);
      for (const k of this.pressed) if (!now.has(k)) this.emit('keyup', k);
      this.pressed = now;
    } else if (d[3] === 0x05) {
      const v = d[6];
      if (v === 1) this.emit('dial', 1);
      else if (v === 255) this.emit('dial', -1);
    }
  }

  // One raw command for the onboard file system: returns { status, data }.
  cmd(bytes) {
    const r = Buffer.from(this._transfer(bytes, null, 5000)); // saving to the keyboard's memory can be slow
    return { status: r[4], data: r.subarray(5) };
  }

  // The keyboard re-reads its stored profile (screen pictures included) when it is
  // handed back control, so do that briefly and then take over again.
  async reloadProfile() {
    if (!this.dev) return;
    try {
      this._transfer(CMD.hardwareMode);
      await sleep(600);
      await this._enter();
    } catch (e) { this._lost(); } finally { this.busy = false; }
  }

  // Files are written with the keyboard under our control, as Corsair's own tool does.
  beginFiles() { this.busy = true; this._transfer(CMD.softwareMode); }

  // rgb: Buffer of LED colours, 3 bytes per LED index
  writeColors(rgb) {
    const payload = Buffer.alloc(4 + 2 + COLOR_BYTES);
    payload.writeUInt16LE(COLOR_BYTES, 0);
    payload[4] = 0x12; payload[5] = 0x00;
    Buffer.from(rgb).copy(payload, 6, 0, Math.min(rgb.length, COLOR_BYTES));
    return this._safe(() => this._transfer(CMD.writeColor, payload));
  }

  // percent 0-100
  setBrightness(percent) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(Math.max(0, Math.min(1000, Math.round(percent * 10))), 0);
    return this._safe(() => this._transfer(CMD.brightness, b));
  }

  // Game mode is something the PC software switches on when the GM button is
  // pressed. We never switch it on, and make sure it is off when we connect.
  setGameMode(on) {
    return this._safe(() => {
      this._transfer(CMD.gameModeLocks, [0x00]);
      this._transfer(CMD.gameMode, [on ? 1 : 0]);
      this._transfer(CMD.gameModeKey, [0x45, 0x00, on ? 1 : 0]);
    });
  }

  // 4 = 1000 Hz, 5 = 2000, 6 = 4000, 7 = 8000. The keyboard re-attaches after this.
  setPollingRate(code) {
    if (![1, 2, 3, 4, 5, 6, 7].includes(code)) return false;
    const ok = this._safe(() => { try { this._transfer(CMD.pollingRate, [code]); } catch (e) { /* drops off the bus */ } });
    setTimeout(() => this._lost(), 300);
    return ok;
  }

  stop() {
    this._closing = true;
    clearTimeout(this._retry);
    if (this.dev) {
      // close our hold on the lights so the keyboard's own lighting comes back
      try { this._transfer([0x05, 0x01, 0x01]); } catch (e) { /* ignore */ }
      try { this._transfer(CMD.hardwareMode); } catch (e) { /* ignore */ }
    }
    this._cleanup();
  }
}

module.exports = { Keyboard };
