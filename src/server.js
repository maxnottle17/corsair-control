// Ties the devices, settings and the control page together.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const { Keyboard } = require('./keyboard');
const { Headset } = require('./headset');
const { Audio } = require('./audio');
const { Effects, hex } = require('./effects');
const layout = require('./layout');
const input = require('./input');
const store = require('./config');
const { KbFs } = require('./kbfs');
const screen = require('./screen');
const onboard = require('./onboard');
const hotkeys = require('./hotkeys');
const startup = require('./startup');
const eq = require('./eq');

const PORT = Number(process.env.CC_PORT) || 47821;
const UI_DIR = path.join(__dirname, '..', 'ui');
const DIAL_MODES = [
  { id: 'volmedia', name: 'Volume + pause', turn: 'Volume up / down', press: 'Play / pause' },
  { id: 'volume', name: 'Volume + mute', turn: 'Volume up / down', press: 'Mute sound' },
  { id: 'mic', name: 'Mic level', turn: 'Headset mic level', press: 'Mute mic' },
  { id: 'sidetone', name: 'Sidetone', turn: 'How loud you hear yourself', press: 'Sidetone on / off' },
  { id: 'brightness', name: 'Key brightness', turn: 'Keyboard brightness', press: 'Lights on / off' },
  { id: 'media', name: 'Track skip', turn: 'Next / previous track', press: 'Play / pause' },
  { id: 'scroll', name: 'Scroll', turn: 'Scroll up / down', press: 'Nothing' },
  { id: 'hscroll', name: 'Side scroll', turn: 'Scroll left / right', press: 'Nothing' },
  { id: 'zoom', name: 'Zoom', turn: 'Zoom in / out', press: 'Reset zoom' },
];

// Which kind of program an app is, for the sound modes' balance sliders.
const APP_KINDS = [
  ['music', 'Music apps', /spotify|music|itunes|tidal|deezer|vlc|foobar|winamp|aimp|mpc-/i],
  ['chat', 'Voice chat apps', /discord|teams|zoom|slack|skype|telegram|whatsapp|teamspeak|mumble/i],
  ['browser', 'Web browsers', /chrome|msedge|firefox|opera|brave|vivaldi|iexplore/i],
];
const KIND_NAMES = { other: 'Games and other apps', music: 'Music apps', chat: 'Voice chat apps', browser: 'Web browsers', system: 'System sounds' };
function appKind(name) {
  if (name === 'System sounds') return 'system';
  const hit = APP_KINDS.find((k) => k[2].test(name));
  return hit ? hit[0] : 'other';
}

function start() {
  let config = store.load();
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const kb = new Keyboard(), hs = new Headset(), audio = new Audio(), fx = new Effects();
  const clients = new Set();
  let rawEvents = 0, lastEvent = '';
  let lastBrightness =config.keyboard.lighting.brightness || 100;

  // ---- state to the page ----
  const snapshot = () => ({
    app: { startWithWindows: startup.isEnabled(), settingsFrom: store.source() },
    eq: { installed: eq.installed(), bands: eq.BANDS, problem: eqProblem },
    config,
    keyboard: { connected: kb.connected, firmware: kb.firmware, events: rawEvents, lastEvent },
    headset: { receiver: hs.receiver, online: hs.online, firmware: hs.firmware, battery: hs.battery, charging: hs.charging, micMuted: hs.micMuted },
    audio: {
      ready: audio.ready, playback: audio.pick('playback'), recording: audio.pick('recording'),
      apps: audio.apps.map((a) => ({ ...a, kind: appKind(a.name) })).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)),
      kinds: KIND_NAMES,
    },
    stored,
    layout: { keys: layout.keys, assignable: layout.ASSIGNABLE, fnLabels: layout.FN_LABELS },
    fnHeld,
    dialModes: DIAL_MODES,
  });
  const send = (msg) => { const s = JSON.stringify(msg); for (const c of clients) if (c.readyState === 1) c.send(s); };
  let pushTimer = null;
  const push = () => { if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; send({ type: 'state', state: snapshot() }); }, 40); };

  // ---- keyboard lighting ----
  let animTimer = null;
  const t0 = Date.now();
  let fnHeld = false, lastFrameSent = 0, streaming = true, lightTimer = null;
  const lightSig = () => JSON.stringify(onboard.lightingLayers(config.keyboard.lighting, config.keyboard.onboard.leds || []));
  // Store the still picture in the keyboard shortly after the last change (not on every step of a colour drag).
  function scheduleLightSave() {
    if (config.keyboard.control === 'full') return;
    if (config.keyboard.onboard.leds && lightSig() === config.keyboard.onboard.light) return;
    clearTimeout(lightTimer);
    lightTimer = setTimeout(() => { lightTimer = null; onboardOp('light'); }, 700);
  }
  // While Fn is held, only keys that do something with Fn (and buttons with a job) stay lit.
  function fnFrame() {
    const buf = Buffer.alloc(layout.COLOR_BYTES);
    const c = hex(config.keyboard.lighting.fnColor);
    const lit = [...layout.FN_KEYS];
    for (const [id, a] of Object.entries(config.keyboard.buttons)) if (a && a.type !== 'none') lit.push(Number(id));
    for (const id of lit) buf.set(c, id * 3);
    return buf;
  }
  function draw(forceSend) {
    const cfg = config.keyboard.lighting;
    const buf = fnHeld ? fnFrame() : fx.frame(cfg, (Date.now() - t0) / 1000);
    if (kb.connected && streaming) kb.writeColors(buf);
    const now = Date.now();
    if (clients.size && (forceSend || now - lastFrameSent >= 75)) { lastFrameSent = now; send({ type: 'frame', rgb: buf.toString('base64'), fn: fnHeld }); }
  }
  function applyKeyboardLighting() {
    clearInterval(animTimer); animTimer = null;
    const cfg = config.keyboard.lighting;
    if (kb.connected) kb.setBrightness(cfg.brightness);
    // In full control one frame is enough for a still picture. When the keyboard runs itself it
    // repaints its own stored lighting constantly: still pictures are stored in the keyboard
    // (see scheduleLightSave) and only moving effects, or a preview while a colour is being
    // picked, are streamed - very fast, because slower updates lose to the keyboard's repaint.
    const full = config.keyboard.control === 'full';
    const moving = fx.isAnimated(cfg);
    streaming = full || moving || !!lightTimer;
    draw(true);
    if (full) { if (moving) animTimer = setInterval(draw, 40); }
    else if (streaming) animTimer = setInterval(draw, 6);
  }

  // ---- headset ----
  function applyHeadsetLighting() {
    const l = config.headset.lighting;
    const s = l.on ? l.brightness / 100 : 0;
    hs.setColors(hex(l.top).map((v) => Math.round(v * s)), hex(l.bottom).map((v) => Math.round(v * s)));
  }
  const applySidetone = () => hs.setSidetone(config.headset.sidetone.enabled, config.headset.sidetone.level);
  function applyHeadset() { applyHeadsetLighting(); applySidetone(); hs.setSleep(config.headset.sleepMinutes); }

  // ---- side screen ----
  const thumbs = new Map(); // resource id -> base64 pixels, so pictures are only read off the keyboard once
  let screenBusy = false;
  function screenState(kfs) {
    const s = screen.read(kfs);
    return {
      type: 'screen', current: s.current, width: screen.WIDTH, height: screen.HEIGHT,
      slots: s.slots.map((x) => {
        if (x.kind === 'image' && !thumbs.has(x.resourceId)) { const px = screen.readImage(kfs, x.resourceId); thumbs.set(x.resourceId, px ? px.toString('base64') : null); }
        return { index: x.index, kind: x.kind, pixels: x.kind === 'image' ? thumbs.get(x.resourceId) : null };
      }),
    };
  }
  async function screenOp(m) {
    if (!kb.connected) { send({ type: 'screen', error: 'The keyboard is not connected.' }); return; }
    if (screenBusy) return;
    screenBusy = true;
    const wasAnimating = !!animTimer;
    clearInterval(animTimer); animTimer = null;
    try {
      const kfs = new KbFs((bytes) => kb.cmd(bytes));
      kb.beginFiles();
      let changed = true;
      if (m.op === 'select') screen.select(kfs, Number(m.index));
      else if (m.op === 'remove') screen.removeSlot(kfs, Number(m.index));
      else if (m.op === 'add') {
        const px = Buffer.from(String(m.pixels || ''), 'base64');
        if (!screenBackedUp) { screen.backup(kfs, path.dirname(store.file)); screenBackedUp = true; }
        screen.addImage(kfs, px);
      } else changed = false;
      const state = screenState(kfs);
      if (changed || config.keyboard.control !== 'full') await kb.reloadProfile(); else kb.busy = false;
      send(state);
    } catch (e) {
      console.error('screen:', e.message);
      send({ type: 'screen', error: e.message });
    } finally {
      screenBusy = false; kb.busy = false;
      if (kb.connected) applyKeyboardLighting();
    }
  }
  let screenBackedUp = false;

  // ---- dial modes and button jobs saved in the keyboard (used while it runs itself) ----
  let stored = {}, keysBackedUp = false;
  async function onboardOp(what) {
    if (!kb.connected || config.keyboard.control === 'full') return;
    if (screenBusy) { setTimeout(() => onboardOp(what), 400); return; }
    screenBusy = true;
    clearInterval(animTimer); animTimer = null;
    let changed = false;
    try {
      const kfs = new KbFs((bytes) => kb.cmd(bytes));
      kb.beginFiles();
      let files = config.keyboard.onboard.files || [];
      const dialDue = what === 'dial' || config.keyboard.onboard.dial !== config.keyboard.dial.mode;
      if ((dialDue || what === 'buttons' || what === 'light') && !keysBackedUp) { onboard.backup(kfs, path.dirname(store.file)); keysBackedUp = true; }
      if (dialDue) { files = onboard.applyDial(kfs, config.keyboard.dial.mode, files); changed = true; }
      if (what === 'buttons') { files = onboard.applyButtons(kfs, config.keyboard.selfButtons, files); changed = true; }
      if (!config.keyboard.onboard.leds || !config.keyboard.onboard.leds.length) {
        let leds = onboard.readLeds(kfs);
        if (leds.length < 50) leds = layout.keys.map((k) => k.id);
        config.keyboard.onboard.leds = leds;
      }
      let light = config.keyboard.onboard.light;
      console.log(`onboard ${what}: leds ${config.keyboard.onboard.leds.length}, lighting ${lightSig() !== light ? 'needs saving' : 'up to date'}`);
      if (lightSig() !== light) {
        if (!keysBackedUp) { onboard.backup(kfs, path.dirname(store.file)); keysBackedUp = true; }
        files = onboard.applyLighting(kfs, onboard.lightingLayers(config.keyboard.lighting, config.keyboard.onboard.leds), files);
        light = lightSig(); changed = true;
      }
      stored = onboard.describeButtons(kfs);
      if (changed) { config.keyboard.onboard = { files, dial: config.keyboard.dial.mode, leds: config.keyboard.onboard.leds, light }; store.save(config); }
    } catch (e) {
      console.error('onboard:', e.message);
      send({ type: 'notice', text: 'Could not save that to the keyboard: ' + e.message });
    } finally {
      try { await kb.reloadProfile(); } catch (e) { /* handled by reconnect */ }
      screenBusy = false; kb.busy = false;
      if (kb.connected) applyKeyboardLighting();
      push();
    }
  }

  // ---- tone (equaliser) ----
  let eqProblem = '';
  function applyEq() {
    const m = config.sound.mode && config.sound.modes[config.sound.mode];
    const r = eq.apply(m ? m.eq : config.sound.manualEq);
    eqProblem = r === 'not installed' ? '' : r;
  }

  // ---- sound modes ----
  let modeApplied = new Set(); // apps already set to the current mode's level
  function applyAppLevels(onlyNew) {
    const m = config.sound.mode && config.sound.modes[config.sound.mode];
    if (!m) return;
    for (const a of audio.apps) {
      if (onlyNew && modeApplied.has(a.name)) continue;
      modeApplied.add(a.name);
      const level = m.levels[appKind(a.name)];
      if (typeof level === 'number' && a.volume !== level) audio.setAppVolume(a.name, level);
    }
  }
  function applySoundMode(id) {
    const m = config.sound.modes[id];
    config.sound.mode = m ? id : null;
    store.save(config);
    applyEq();
    if (!m) { push(); return; }
    const out = audio.pick('playback'), mic = audio.pick('recording');
    if (out && typeof m.volume === 'number') audio.setVolume(out.id, clamp(m.volume));
    if (mic && typeof m.mic === 'number') audio.setVolume(mic.id, clamp(m.mic));
    if (m.sidetone) update({ headset: { sidetone: { enabled: !!m.sidetone.enabled, level: clamp(m.sidetone.level) } } });
    modeApplied = new Set();
    applyAppLevels(false);
    push();
  }

  // ---- settings changes ----
  let applyingMode = false;
  function update(patch) {
    const before = config;
    config = store.merge(config, patch);
    // per-key colours are replaced as a whole so that keys can be cleared
    if (patch.keyboard && patch.keyboard.lighting && patch.keyboard.lighting.perKey) config.keyboard.lighting.perKey = patch.keyboard.lighting.perKey;
    store.save(config);
    if (patch.keyboard && patch.keyboard.control && before.keyboard.control !== config.keyboard.control) {
      fnHeld = false;
      kb.setControl(config.keyboard.control).then(() => { applyKeyboardLighting(); onboardOp('sync'); });
    }
    if (config.keyboard.control !== 'full' && patch.keyboard) {
      if (patch.keyboard.dial && before.keyboard.dial.mode !== config.keyboard.dial.mode) onboardOp('dial');
      if (patch.keyboard.selfButtons) onboardOp('buttons');
    }
    if (patch.keyboard && patch.keyboard.lighting) {
      if (config.keyboard.lighting.brightness > 0) lastBrightness = config.keyboard.lighting.brightness;
      scheduleLightSave();
      applyKeyboardLighting();
    }
    if (patch.sound && (patch.sound.manualEq || patch.sound.modes)) applyEq();
    // editing the mode that is switched on takes effect straight away
    const activePatch = patch.sound && patch.sound.modes && config.sound.mode && patch.sound.modes[config.sound.mode];
    if (activePatch && Object.keys(activePatch).some((k) => k !== 'eq') && !applyingMode) {
      applyingMode = true;
      try { applySoundMode(config.sound.mode); } finally { applyingMode = false; }
    }
    if (patch.headset) {
      if (patch.headset.lighting) applyHeadsetLighting();
      if (patch.headset.sidetone) applySidetone();
      if (patch.headset.sleepMinutes !== undefined && before.headset.sleepMinutes !== config.headset.sleepMinutes) hs.setSleep(config.headset.sleepMinutes);
    }
    push();
  }

  // ---- dial and buttons ----
  function dialTurn(dir) {
    switch (config.keyboard.dial.mode) {
      case 'volmedia':
      case 'volume': input.media(dir > 0 ? 'volup' : 'voldown'); break;
      case 'mic': audio.nudge('recording', dir * 4); push(); break;
      case 'sidetone': update({ headset: { sidetone: { enabled: true, level: clamp(config.headset.sidetone.level + dir * 5) } } }); break;
      case 'brightness': update({ keyboard: { lighting: { brightness: clamp(config.keyboard.lighting.brightness + dir * 10) } } }); break;
      case 'media': input.media(dir > 0 ? 'next' : 'prev'); break;
      case 'scroll': input.scroll(dir); break;
      case 'hscroll': input.hscroll(dir); break;
      case 'zoom': input.zoom(dir); break;
    }
  }
  function toggleLights() {
    const b = config.keyboard.lighting.brightness;
    update({ keyboard: { lighting: { brightness: b > 0 ? 0 : lastBrightness } } });
  }
  function dialPress() {
    switch (config.keyboard.dial.mode) {
      case 'volmedia': input.media('playpause'); break;
      case 'volume': input.media('mute'); break;
      case 'mic': audio.toggleMute('recording'); push(); break;
      case 'sidetone': update({ headset: { sidetone: { enabled: !config.headset.sidetone.enabled } } }); break;
      case 'brightness': toggleLights(); break;
      case 'media': input.media('playpause'); break;
      case 'zoom': input.shortcut('ctrl+0'); break;
    }
  }
  function runAction(a) {
    if (!a) return;
    switch (a.type) {
      case 'shortcut': input.shortcut(a.value); break;
      case 'media': input.media(a.value); break;
      case 'launch': input.launch(a.value); break;
      case 'text': input.typeText(a.value); break;
      case 'micmute': audio.toggleMute('recording'); push(); break;
      case 'lights': toggleLights(); break;
      case 'dialmode': {
        const i = DIAL_MODES.findIndex((m) => m.id === config.keyboard.dial.mode);
        update({ keyboard: { dial: { mode: DIAL_MODES[(i + 1) % DIAL_MODES.length].id } } });
        break;
      }
    }
  }

  kb.on('raw', (d) => { rawEvents++; lastEvent = Buffer.from(d).subarray(0, 26).toString('hex'); });
  kb.on('connected', () => { applyKeyboardLighting(); push(); onboardOp('sync'); });
  // Dial turns and button presses the keyboard passes to us while it runs itself.
  hotkeys.start((slot) => {
    if (config.keyboard.control === 'full') return;
    if (slot === onboard.SIGNAL.cw) dialTurn(1);
    else if (slot === onboard.SIGNAL.ccw) dialTurn(-1);
    else if (slot === onboard.SIGNAL.press) dialPress();
    else runAction(config.keyboard.selfButtons[130 + slot]);
  });
  kb.on('disconnected', () => { fnHeld = false; push(); });
  kb.on('keydown', (id) => {
    fx.keyDown(id);
    send({ type: 'key', id, down: true });
    try {
      const fn = kb.pressed.has(layout.KEY_FN);
      if (id === layout.KEY_FN) { fnHeld = true; draw(true); }
      else if (id === layout.KEY_DIAL_PRESS) dialPress();
      else if (fn && id === layout.KEY_F3) dialModeBrightness(-20);
      else if (fn && id === layout.KEY_F4) dialModeBrightness(20);
      else if (fn && id === layout.KEY_F12) runAction({ type: 'dialmode' });
      else if (config.keyboard.buttons[id]) runAction(config.keyboard.buttons[id]);
    } catch (e) { console.error('action failed:', e.message); }
  });
  function dialModeBrightness(delta) { update({ keyboard: { lighting: { brightness: clamp(config.keyboard.lighting.brightness + delta) } } }); }
  kb.on('keyup', (id) => { send({ type: 'key', id, down: false }); if (id === layout.KEY_FN) { fnHeld = false; draw(true); } });
  kb.on('dial', (dir) => { send({ type: 'dial', dir }); try { dialTurn(dir); } catch (e) { console.error('dial failed:', e.message); } });

  hs.on('receiver', push);
  hs.on('online', () => { applyHeadset(); push(); });
  hs.on('offline', push);
  hs.on('status', push);
  hs.on('mic', (muted) => {
    if (!config.headset.followMicMute) return;
    const mic = audio.devices.find((d) => d.flow === 'recording' && /corsair void/i.test(d.name));
    if (mic) audio.setMute(mic.id, muted);
  });
  audio.on('change', () => { applyAppLevels(true); push(); });

  // ---- web server (this PC only) ----
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0] === '/' ? 'index.html' : path.basename(req.url.split('?')[0]);
    const file = path.join(UI_DIR, name);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  const allowed = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
  const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024, verifyClient: ({ origin }) => allowed.has(origin) });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'state', state: snapshot() }));
    draw(true);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.type === 'patch' && m.patch && typeof m.patch === 'object') update(m.patch);
      else if (m.type === 'volume' && typeof m.id === 'string') { audio.setVolume(m.id, clamp(Number(m.value) || 0)); push(); }
      else if (m.type === 'mute' && typeof m.id === 'string') { audio.setMute(m.id, !!m.value); push(); }
      else if (m.type === 'polling') kb.setPollingRate(Number(m.code));
      else if (m.type === 'screen') screenOp(m);
      else if (m.type === 'appvolume' && typeof m.name === 'string') { audio.setAppVolume(m.name.slice(0, 100), clamp(Number(m.value) || 0)); push(); }
      else if (m.type === 'appmute' && typeof m.name === 'string') { audio.setAppMute(m.name.slice(0, 100), !!m.value); push(); }
      else if (m.type === 'soundmode') applySoundMode(m.id);
      else if (m.type === 'startup') {
        try { startup.setEnabled(!!m.enabled); } catch (e) { send({ type: 'notice', text: 'Could not change the start-with-Windows setting: ' + e.message }); }
        push();
      }
      else if (m.type === 'quit') { send({ type: 'bye' }); stop(); setTimeout(() => process.exit(0), 200); }
    });
  });
  // If the app is already running, leave the devices to that copy.
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? 'Corsair Control is already running.' : e.message); process.exit(0); });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Corsair Control running at http://127.0.0.1:${PORT}`);
    kb.control = config.keyboard.control === 'full' ? 'full' : 'self';
    kb.start(); hs.start(); audio.start();
    applyEq();
    startup.migrate();
    setInterval(() => { const was = eq.installed(); if (!was) { if (eq.installed()) { applyEq(); push(); } } }, 15000).unref();
    applyKeyboardLighting();
  });

  // Whatever way the app ends, write the latest settings first.
  process.on('exit', () => store.flush(config));
  let stopped = false;
  function stop() {
    if (stopped) return; stopped = true;
    clearInterval(animTimer);
    store.flush(config);
    hotkeys.stop();
    kb.stop(); hs.stop(); audio.stop();
    try { server.close(); } catch (e) { /* ignore */ }
  }
  return { stop, port: PORT, url: `http://127.0.0.1:${PORT}` };
}

if (require.main === module) {
  const app = start();
  const bye = () => { app.stop(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye); process.on('SIGHUP', bye);
}

module.exports = { start };
