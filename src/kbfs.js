// Access to the keyboard's onboard files (used for the side screen).
// Command numbers and file formats come from reading Corsair's Web Hub.
// `cmd(bytes)` sends one command and returns { status, data } with data starting after the status byte.
const HID = require('node-hid');

const BUF = 0; // buffer slot used for file transfers
const CHUNK = 1024;

class KbFs {
  constructor(cmd) { this.cmd = cmd; }

  // Opens the keyboard directly, for the command-line tools (the app must not be running).
  static standalone() {
    const info = HID.devices().find((d) => d.vendorId === 0x1b1c && d.productId === 0x2b0e && d.interface === 2 && d.usagePage === 0xff42);
    if (!info) throw new Error('keyboard not found');
    const dev = new HID.HID(info.path);
    const fs = new KbFs((bytes) => {
      const w = Buffer.alloc(1025);
      w[2] = 0x01;
      Buffer.from(bytes).copy(w, 4);
      dev.write(w);
      const r = Buffer.from(dev.readTimeout(2000));
      if (!r.length) throw new Error('no reply');
      return { status: r[4], data: r.subarray(5) };
    });
    fs.close = () => { try { dev.close(); } catch (e) { /* ignore */ } };
    fs.mode = (software) => fs.ok([0x01, 0x03, 0x00, software ? 0x02 : 0x01], 'set mode');
    return fs;
  }

  ok(bytes, what) { const r = this.cmd(bytes); if (r.status !== 0) throw new Error(`${what} failed (status ${r.status})`); return r; }
  getProp(id) { const r = this.cmd([0x02, id & 255, id >> 8]); return r.status === 0 ? r.data.readUInt32LE(0) : null; }

  unbind() { this.cmd([0x05, 0x01, BUF]); }
  open(id) {
    let r = this.cmd([0x0d, BUF, id & 255, id >> 8]);
    if (r.status !== 0) { this.unbind(); r = this.cmd([0x0d, BUF, id & 255, id >> 8]); }
    return r.status === 0;
  }
  exists(id) { const ok = this.open(id); this.unbind(); return ok; }

  readFile(id) {
    if (!this.open(id)) return null;
    try {
      const size = this.ok([0x09, BUF], 'describe').data.readUInt32LE(2);
      const parts = []; let got = 0;
      while (got < size) {
        const d = this.ok([0x08, BUF], 'read').data;
        const take = Math.min(size - got, d.length);
        parts.push(Buffer.from(d.subarray(0, take))); got += take;
      }
      return Buffer.concat(parts);
    } finally { this.unbind(); }
  }

  writeFile(id, data) {
    data = Buffer.from(data);
    if (!this.open(id)) { this.unbind(); this.ok([0x0b, id & 255, id >> 8], 'create file'); if (!this.open(id)) throw new Error('cannot open new file'); }
    try {
      const len = Buffer.alloc(4); len.writeUInt32LE(data.length, 0);
      const first = CHUNK - 4 - 2 - 4; // packet minus header, command + slot, length
      this.ok([0x06, BUF, ...len, ...data.subarray(0, first)], 'write');
      const step = CHUNK - 4 - 2;
      for (let o = first; o < data.length; o += step) this.ok([0x07, BUF, ...data.subarray(o, o + step)], 'write (continued)');
    } finally { this.unbind(); }
  }
  deleteFile(id) { return this.cmd([0x0c, id & 255, id >> 8]).status === 0; }
}

module.exports = { KbFs };
