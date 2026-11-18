// Corsair Void Wireless v2 through its USB receiver.
// Protocol details follow the open-source OpenLinkHub project (GPL-3.0).
const HID = require('node-hid');
const { EventEmitter } = require('events');

const VID = 0x1b1c, PID = 0x2a08;
const DONGLE = 0x08, HEADSET = 0x09;

const CMD = {
  softwareMode: [0x01, 0x03, 0x00, 0x02],
  hardwareMode: [0x01, 0x03, 0x00, 0x01],
  heartbeat: [0x12],
  firmware: [0x02, 0x13],
  linkStatus: [0x02, 0x36],
  battery: [0x02, 0x0f],
  charge: [0x02, 0x10],
  mic: [0x02, 0xa6],
  openColor: [0x0d, 0x00, 0x22],
  writeColor: [0x06, 0x00],
  sidetoneOff: [0x01, 0x46, 0x00],
  sidetoneLevel: [0x01, 0x47, 0x00],
  noiseCancel: [0x01, 0xd1, 0x00],
  sleepEnable: [0x01, 0x0d, 0x00],
  sleepTime: [0x01, 0x0e, 0x00],
};

class Headset extends EventEmitter {
  constructor() {
    super();
    this.dev = null;
    this.listener = null;
    this.receiver = false; // USB receiver present
    this.online = false; // headset switched on and linked
    this.firmware = null;
    this.battery = null;
    this.charging = null;
    this.micMuted = null;
    this._timer = null;
    this._retry = null;
    this._closing = false;
  }

  start() { this._tryConnect(); }

  _find(usage) {
    return HID.devices().find((d) => d.vendorId === VID && d.productId === PID && d.interface === 4 && d.usagePage === 0xff42 && d.usage === usage);
  }

  _tryConnect() {
    if (this._closing || this.receiver) return;
    clearTimeout(this._retry);
    try {
      const cmdInfo = this._find(1), evInfo = this._find(2);
      if (!cmdInfo) throw new Error('receiver not found');
      this.dev = new HID.HID(cmdInfo.path);
      this._transfer(DONGLE, CMD.softwareMode);
      if (evInfo) {
        this.listener = new HID.HID(evInfo.path);
        this.listener.on('data', (d) => this._onData(d));
        this.listener.on('error', () => this._lost());
      }
      this.receiver = true;
      this.emit('receiver');
      this._poll();
      this._timer = setInterval(() => this._poll(), 10000);
    } catch (e) {
      this._cleanup();
      this._retry = setTimeout(() => this._tryConnect(), 3000);
    }
  }

  // Reply layout: [1, source, command, status, data...]
  _transfer(endpoint, cmd, data) {
    const w = Buffer.alloc(64);
    w[0] = 0x02; w[1] = endpoint;
    Buffer.from(cmd).copy(w, 2);
    if (data) Buffer.from(data).copy(w, 2 + cmd.length);
    this.dev.write(w);
    for (let i = 0; i < 4; i++) {
      const r = this.dev.readTimeout(1000);
      if (!r || !r.length) break;
      if (r[2] === cmd[0]) return r;
    }
    throw new Error('no reply from headset');
  }

  _safe(fn) {
    if (!this.dev) return false;
    try { fn(); return true; } catch (e) {
      console.error('headset:', e.message, new Error().stack.split('\n')[2].trim());
      if (/write|not open|closed/i.test(String(e.message))) this._lost();
      return false;
    }
  }

  _hs(cmd, data) {
    const r = this._transfer(HEADSET, cmd, data);
    if (r[3] !== 0) throw new Error('headset refused command');
    return r;
  }

  _poll() {
    this._safe(() => {
      this._transfer(DONGLE, CMD.heartbeat);
      const st = this._transfer(DONGLE, CMD.linkStatus);
      const online = st[3] === 0 && st[4] === 0x02;
      if (online && !this.online) this._bringOnline();
      else if (!online && this.online) { this.online = false; this.emit('offline'); }
      if (this.online) {
        this._transfer(HEADSET, CMD.heartbeat);
        this._readBattery();
        this.emit('status');
      }
    });
  }

  _bringOnline() {
    try {
      const fw = this._hs(CMD.firmware);
      this.firmware = `${fw[5]}.${fw[6]}.${fw[7]}`;
      this._hs(CMD.softwareMode);
      this._hs(CMD.openColor);
      this._readBattery();
      try { this.micMuted = this._hs(CMD.mic)[4] === 1; } catch (e) { /* not reported */ }
      this.online = true;
      this.emit('online');
    } catch (e) { this.online = false; }
  }

  _readBattery() {
    try {
      const b = this._hs(CMD.battery);
      const pct = Math.round((b[4] | (b[5] << 8)) / 10);
      if (pct > 0 && pct <= 100) this.battery = pct;
      this.charging = this._hs(CMD.charge)[4];
    } catch (e) { /* keep last known */ }
  }

  _onData(d) {
    this.emit('raw', d);
    if (d[0] === 0x03 && d[3] === 0x10) { this.charging = d[5]; this.emit('status'); }
    else if (d[0] === 0x03 && d[1] === 0x01 && d[3] === 0x0f) {
      const pct = Math.round((d[5] | (d[6] << 8)) / 10);
      if (pct > 0 && pct <= 100) { this.battery = pct; this.emit('status'); }
    } else if (d[1] === 0x00 && d[3] === 0x36) {
      setTimeout(() => this._poll(), 500);
    } else if (d[0] === 0x03 && d[2] === 0x01 && d[3] === 0xa6) {
      this.micMuted = d[5] === 1;
      this.emit('mic', this.micMuted);
      this.emit('status');
    }
  }

  _lost() {
    const was = this.receiver;
    this._cleanup();
    if (was) this.emit('offline');
    if (!this._closing) this._retry = setTimeout(() => this._tryConnect(), 3000);
  }

  _cleanup() {
    clearInterval(this._timer);
    this.receiver = false; this.online = false;
    for (const h of [this.listener, this.dev]) { try { h && h.close(); } catch (e) { /* already gone */ } }
    this.listener = null; this.dev = null;
  }

  // top / bottom: [r, g, b]
  setColors(top, bottom) {
    if (!this.online) return false;
    const payload = Buffer.alloc(4 + 2 + 20);
    payload.writeUInt16LE(20, 0);
    payload[4] = 0x12;
    payload.set(top, 6); payload.set(bottom, 9);
    return this._safe(() => this._hs(CMD.writeColor, payload));
  }

  // level 0-100
  setSidetone(enabled, level) {
    if (!this.online) return false;
    return this._safe(() => {
      if (!enabled) { this._hs(CMD.sidetoneOff, [0x01]); return; }
      try { this._transfer(HEADSET, CMD.noiseCancel, [0x00]); } catch (e) { /* not on this model */ }
      this._hs(CMD.sidetoneOff, [0x00]);
      const b = Buffer.alloc(2);
      b.writeUInt16LE(Math.max(0, Math.min(100, Math.round(level))) * 10, 0);
      this._hs(CMD.sidetoneLevel, b);
    });
  }

  // minutes; 0 = never switch off
  setSleep(minutes) {
    if (!this.online) return false;
    return this._safe(() => {
      if (!minutes) { this._hs(CMD.sleepEnable, [0x00]); return; }
      this._hs(CMD.sleepEnable, [0x01]);
      const b = Buffer.alloc(4);
      b.writeUInt32LE(minutes * 60000, 0);
      this._hs(CMD.sleepTime, b);
    });
  }

  stop() {
    this._closing = true;
    clearTimeout(this._retry);
    if (this.dev) {
      try { if (this.online) this._transfer(HEADSET, CMD.hardwareMode); } catch (e) { /* ignore */ }
      try { this._transfer(DONGLE, CMD.hardwareMode); } catch (e) { /* ignore */ }
    }
    this._cleanup();
  }
}

module.exports = { Headset };
