// Talks to audio.ps1 (Windows volume / mute for playback and recording devices).
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

class Audio extends EventEmitter {
  constructor() {
    super();
    this.devices = [];
    this.apps = []; // programs that currently have sound: { name, volume, muted, active }
    this.ready = false;
    this.proc = null;
    this._buf = '';
    this._timer = null;
  }

  start() {
    this.proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'audio.ps1')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.stdout.on('data', (chunk) => {
      this._buf += chunk.toString();
      let i;
      while ((i = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, i).trim();
        this._buf = this._buf.slice(i + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready) { this.ready = true; this._send('list'); }
          if (msg.devices) { this.devices = msg.devices; this.apps = msg.apps || []; this.emit('change'); }
        } catch (e) { /* ignore partial output */ }
      }
    });
    this.proc.on('exit', () => { this.ready = false; this.proc = null; });
    this._timer = setInterval(() => this._send('list'), 4000);
  }

  _send(line) { if (this.ready && this.proc) { try { this.proc.stdin.write(line + '\n'); } catch (e) { /* helper gone */ } } }

  // The headset's own playback / recording devices, falling back to the Windows defaults.
  pick(flow) {
    const list = this.devices.filter((d) => d.flow === flow);
    return list.find((d) => /corsair void/i.test(d.name)) || list.find((d) => d.isDefault) || null;
  }

  setVolume(id, percent) {
    const d = this.devices.find((x) => x.id === id);
    if (d) d.volume = percent;
    this._send(`vol ${id} ${Math.round(percent)}`);
  }
  setMute(id, muted) {
    const d = this.devices.find((x) => x.id === id);
    if (d) d.muted = muted;
    this._send(`mute ${id} ${muted ? 1 : 0}`);
  }
  setAppVolume(name, percent) {
    const a = this.apps.find((x) => x.name === name);
    if (a) a.volume = percent;
    this._send(`appvol ${Math.round(percent)} ${name}`);
  }
  setAppMute(name, muted) {
    const a = this.apps.find((x) => x.name === name);
    if (a) a.muted = muted;
    this._send(`appmute ${muted ? 1 : 0} ${name}`);
  }
  nudge(flow, delta) {
    const d = this.pick(flow);
    if (d) this.setVolume(d.id, Math.max(0, Math.min(100, d.volume + delta)));
  }
  toggleMute(flow) {
    const d = this.pick(flow);
    if (d) this.setMute(d.id, !d.muted);
  }

  stop() { clearInterval(this._timer); try { this.proc && this.proc.kill(); } catch (e) { /* ignore */ } }
}

module.exports = { Audio };
