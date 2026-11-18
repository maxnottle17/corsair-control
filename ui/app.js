/* Control page. All settings live in the background app; this page shows them and sends changes. */
const $ = (id) => document.getElementById(id);
let state = null, ws = null, built = false, quitting = false;
const U = 46; // pixels per key unit on the map

const EFFECTS = [
  ['static', 'One colour'], ['perkey', 'Per key'], ['rainbow', 'Rainbow'], ['wave', 'Two-colour wave'],
  ['breathing', 'Breathing'], ['cycle', 'Colour cycle'], ['reactive', 'Light up on press'], ['off', 'Off'],
];
const ACTIONS = [
  ['keep', "Keep the keyboard's saved action"], ['none', 'Do nothing'], ['media', 'Media control'], ['shortcut', 'Keyboard shortcut'], ['launch', 'Open app, file or website'],
  ['text', 'Type text'], ['micmute', 'Mute / unmute mic'], ['dialmode', 'Switch dial mode'], ['lights', 'Keyboard lights on / off'],
];
const MEDIA = [['playpause', 'Play / pause'], ['next', 'Next track'], ['prev', 'Previous track'], ['stop', 'Stop'], ['mute', 'Mute sound'], ['volup', 'Volume up'], ['voldown', 'Volume down']];
const PLACEHOLDER = { shortcut: 'e.g. ctrl+shift+s', launch: 'e.g. spotify:  or  C:\\Games\\game.exe  or  https://…', text: 'Text to type' };
const SWATCHES = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c8ff', '#0a64ff', '#af52de', '#ff2bd6', '#ffffff'];

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
const patch = (p) => send({ type: 'patch', patch: p });
const kbLight = (p) => patch({ keyboard: { lighting: p } });

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => { $('link').textContent = ''; $('link').classList.remove('bad'); };
  ws.onclose = () => {
    if (quitting) { document.querySelector('main').innerHTML = '<div class="card"><h2>App stopped</h2><p class="hint">Both devices are back on their built-in settings. Closing a window does not stop the app; use the Corsair Control shortcut to start it again.</p></div>'; $('link').textContent = ''; return; }
    $('link').textContent = 'Lost contact with the app. Retrying…'; $('link').classList.add('bad'); setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'bye') quitting = true;
    else if (m.type === 'state') { state = m.state; if (!built) build(); sync(); }
    else if (m.type === 'frame') paintFrame(m);
    else if (m.type === 'screen') showScreen(m);
    else if (m.type === 'notice') { $('link').textContent = m.text; $('link').classList.add('bad'); setTimeout(() => { $('link').textContent = ''; $('link').classList.remove('bad'); }, 8000); }
    else if (m.type === 'key') { const el = document.querySelector(`.key[data-id="${m.id}"]`); if (el) el.classList.toggle('down', m.down); }
  };
}

// Set a control's value unless the user is in the middle of changing it.
function setVal(el, v) { if (document.activeElement !== el && String(el.value) !== String(v)) el.value = v; }

function build() {
  built = true;
  $('startup').addEventListener('change', (e) => send({ type: 'startup', enabled: e.target.checked }));
  $('quit').addEventListener('click', () => { quitting = true; send({ type: 'quit' }); });
  // tabs
  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + b.dataset.tab; });
  }));

  // keyboard map
  const keys = state.layout.keys, board = $('board');
  const minX = Math.min(...keys.map((k) => k.x)), maxX = Math.max(...keys.map((k) => k.x + k.w)), maxY = Math.max(...keys.map((k) => k.y + k.h));
  board.style.width = (maxX - minX) * U + 'px'; board.style.height = maxY * U + 'px';
  const special = new Set(state.layout.assignable.map((a) => a.id));
  let painting = false;
  const paintKey = (id) => {
    if (state.config.keyboard.lighting.effect !== 'perkey') return;
    const perKey = { ...state.config.keyboard.lighting.perKey, [id]: $('paint').value };
    state.config.keyboard.lighting.perKey = perKey;
    kbLight({ perKey }); sync();
  };
  for (const k of keys) {
    const el = document.createElement('div');
    el.className = 'key' + (special.has(k.id) ? ' special' : '');
    el.dataset.id = k.id; el.textContent = k.label;
    Object.assign(el.style, { left: (k.x - minX) * U + 'px', top: k.y * U + 'px', width: k.w * U - 4 + 'px', height: k.h * U - 4 + 'px' });
    el.addEventListener('mousedown', (e) => { e.preventDefault(); painting = true; paintKey(k.id); });
    el.addEventListener('mouseenter', () => { if (painting) paintKey(k.id); });
    board.appendChild(el);
  }
  window.addEventListener('mouseup', () => { painting = false; });

  // lighting
  for (const [id, name] of EFFECTS) {
    const b = document.createElement('button'); b.textContent = name; b.dataset.effect = id;
    b.addEventListener('click', () => kbLight({ effect: id }));
    $('effects').appendChild(b);
  }
  $('color').addEventListener('input', (e) => kbLight({ color: e.target.value }));
  $('color2').addEventListener('input', (e) => kbLight({ color2: e.target.value }));
  $('fnColor').addEventListener('input', (e) => kbLight({ fnColor: e.target.value }));
  $('speed').addEventListener('input', (e) => kbLight({ speed: +e.target.value }));
  $('brightness').addEventListener('input', (e) => kbLight({ brightness: +e.target.value }));
  $('fillAll').addEventListener('click', () => { const perKey = {}; for (const k of keys) perKey[k.id] = $('paint').value; kbLight({ perKey }); });
  $('clearKeys').addEventListener('click', () => kbLight({ perKey: {} }));
  document.querySelectorAll('.swatches').forEach((box) => {
    for (const c of SWATCHES) {
      const b = document.createElement('button'); b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Use colour ' + c);
      b.addEventListener('click', () => { const t = $(box.dataset.for); t.value = c; t.dispatchEvent(new Event('input')); });
      box.appendChild(b);
    }
  });

  document.querySelectorAll('#controlModes button').forEach((b) => b.addEventListener('click', () => patch({ keyboard: { control: b.dataset.control } })));
  // dial
  for (const m of state.dialModes) {
    const b = document.createElement('button'); b.dataset.mode = m.id;
    b.innerHTML = `${m.name}<small>Turn: ${m.turn}</small><small>Press: ${m.press}</small>`;
    b.addEventListener('click', () => patch({ keyboard: { dial: { mode: m.id } } }));
    $('dialModes').appendChild(b);
  }

  // buttons
  for (const a of state.layout.assignable) {
    const row = document.createElement('div'); row.className = 'btnrow'; row.dataset.id = a.id;
    const name = document.createElement('div'); name.className = 'name'; name.textContent = a.name;
    const type = document.createElement('select'); type.setAttribute('aria-label', a.name + ' action');
    for (const [v, t] of ACTIONS) type.add(new Option(t, v));
    const slot = document.createElement('div'); slot.className = 'slot';
    const setBtn = (v) => patch({ keyboard: { [state.config.keyboard.control === 'full' ? 'buttons' : 'selfButtons']: { [a.id]: v } } });
    type.addEventListener('change', () => setBtn({ type: type.value, value: type.value === 'media' ? 'playpause' : '' }));
    row.append(name, type, slot); row._type = type; row._slot = slot; row._set = setBtn;
    $('buttons').appendChild(row);
  }
  $('addPic').addEventListener('click', () => $('picFile').click());
  $('picFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addPicture(f); });
  $('applyPolling').addEventListener('click', () => { const v = $('polling').value; if (v) send({ type: 'polling', code: +v }); });

  // sound modes and mixer
  const modes = state.config.sound.modes;
  const off = document.createElement('button'); off.textContent = 'Manual'; off.dataset.mode = '';
  off.addEventListener('click', () => send({ type: 'soundmode', id: null }));
  $('soundModes').appendChild(off);
  for (const [id, m] of Object.entries(modes)) {
    const b = document.createElement('button'); b.textContent = m.name; b.dataset.mode = id;
    b.addEventListener('click', () => send({ type: 'soundmode', id }));
    $('soundModes').appendChild(b);
  }
  const editMode = (p) => { const id = state.config.sound.mode; if (id) patch({ sound: { modes: { [id]: p } } }); };
  $('mVolume').addEventListener('input', (e) => { $('mVolumeOut').textContent = e.target.value + '%'; editMode({ volume: +e.target.value }); });
  $('mMic').addEventListener('input', (e) => { $('mMicOut').textContent = e.target.value + '%'; editMode({ mic: +e.target.value }); });
  $('mSide').addEventListener('change', (e) => editMode({ sidetone: { enabled: e.target.checked } }));
  $('mSideLevel').addEventListener('input', (e) => { $('mSideOut').textContent = e.target.value + '%'; editMode({ sidetone: { level: +e.target.value } }); });
  for (const [kind, label] of Object.entries(state.audio.kinds)) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label for="lv-${kind}">${label}</label><input type="range" id="lv-${kind}" min="0" max="100" step="5"><output id="lvo-${kind}"></output>`;
    $('modeLevels').appendChild(row);
    row.querySelector('input').addEventListener('input', (e) => { $('lvo-' + kind).textContent = e.target.value + '%'; editMode({ levels: { [kind]: +e.target.value } }); });
  }
  const setEq = (gains) => { const id = state.config.sound.mode; patch({ sound: id ? { modes: { [id]: { eq: gains } } } : { manualEq: gains } }); };
  const curEq = () => { const s = state.config.sound; return [...((s.mode && s.modes[s.mode] && s.modes[s.mode].eq) || s.manualEq)]; };
  state.eq.bands.forEach((hz, i) => {
    const col = document.createElement('div'); col.className = 'band';
    const out = document.createElement('output'); const sl = document.createElement('input');
    sl.type = 'range'; sl.min = -12; sl.max = 12; sl.step = 1; sl.id = 'eq-' + i; sl.setAttribute('aria-label', (hz >= 1000 ? hz / 1000 + ' kilohertz' : hz + ' hertz') + ' gain in decibels');
    const lab = document.createElement('span'); lab.textContent = hz >= 1000 ? hz / 1000 + 'k' : hz;
    sl.addEventListener('input', () => { out.textContent = (sl.value > 0 ? '+' : '') + sl.value; const g = curEq(); g[i] = +sl.value; setEq(g); });
    col.append(out, sl, lab); col._out = out; col._sl = sl; $('eq').appendChild(col);
  });
  $('eqFlat').addEventListener('click', () => setEq(state.eq.bands.map(() => 0)));
  $('mixVol').addEventListener('input', (e) => { const d = state.audio.playback; if (d) send({ type: 'volume', id: d.id, value: +e.target.value }); $('mixVolOut').textContent = e.target.value + '%'; });
  $('mixMic').addEventListener('input', (e) => { const d = state.audio.recording; if (d) send({ type: 'volume', id: d.id, value: +e.target.value }); $('mixMicOut').textContent = e.target.value + '%'; });
  $('mixVolMute').addEventListener('click', () => { const d = state.audio.playback; if (d) send({ type: 'mute', id: d.id, value: !d.muted }); });
  $('mixMicMute').addEventListener('click', () => { const d = state.audio.recording; if (d) send({ type: 'mute', id: d.id, value: !d.muted }); });

  // headset
  const hs = (p) => patch({ headset: p });
  $('vol').addEventListener('input', (e) => { const d = state.audio.playback; if (d) send({ type: 'volume', id: d.id, value: +e.target.value }); $('volOut').textContent = e.target.value + '%'; });
  $('mic').addEventListener('input', (e) => { const d = state.audio.recording; if (d) send({ type: 'volume', id: d.id, value: +e.target.value }); $('micOut').textContent = e.target.value + '%'; });
  $('volMute').addEventListener('click', () => { const d = state.audio.playback; if (d) send({ type: 'mute', id: d.id, value: !d.muted }); });
  $('micMute').addEventListener('click', () => { const d = state.audio.recording; if (d) send({ type: 'mute', id: d.id, value: !d.muted }); });
  $('follow').addEventListener('change', (e) => hs({ followMicMute: e.target.checked }));
  $('stOn').addEventListener('change', (e) => hs({ sidetone: { enabled: e.target.checked } }));
  $('stLevel').addEventListener('input', (e) => hs({ sidetone: { level: +e.target.value } }));
  $('hsOn').addEventListener('change', (e) => hs({ lighting: { on: e.target.checked } }));
  $('hsTop').addEventListener('input', (e) => hs({ lighting: { top: e.target.value } }));
  $('hsBottom').addEventListener('input', (e) => hs({ lighting: { bottom: e.target.value } }));
  $('hsBright').addEventListener('input', (e) => hs({ lighting: { brightness: +e.target.value } }));
  $('matchKb').addEventListener('click', () => { const c = state.config.keyboard.lighting.color; hs({ lighting: { top: c, bottom: c, on: true } }); });
  $('sleep').addEventListener('change', (e) => hs({ sleepMinutes: +e.target.value }));
}

// ---- side screen ----
let screenAsked = false;
function showScreen(m) {
  const msg = $('screenMsg');
  $('addPic').disabled = false;
  if (m.error) { msg.textContent = 'Could not do that: ' + m.error; return; }
  msg.textContent = '';
  const box = $('slots'); box.textContent = '';
  for (const s of m.slots) {
    const b = document.createElement('div'); b.className = 'pic' + (s.index === m.current ? ' on' : ''); b.tabIndex = 0; b.setAttribute('role', 'button');
    b.setAttribute('aria-label', (s.kind === 'image' ? 'Picture ' + s.index : 'Built-in display') + (s.index === m.current ? ', showing now' : ''));
    if (s.pixels) {
      const cv = document.createElement('canvas'); cv.width = m.width; cv.height = m.height;
      const bin = atob(s.pixels), img = new ImageData(m.width, m.height);
      for (let i = 0, p = 0; i < bin.length; i += 2, p += 4) {
        const v = bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8);
        img.data[p] = ((v >> 11) & 31) * 255 / 31; img.data[p + 1] = ((v >> 5) & 63) * 255 / 63; img.data[p + 2] = (v & 31) * 255 / 31; img.data[p + 3] = 255;
      }
      cv.getContext('2d').putImageData(img, 0, 0); b.appendChild(cv);
    } else { b.style.display = 'grid'; b.style.placeItems = 'center'; b.textContent = s.kind === 'builtin' ? 'Built-in' : s.kind === 'animation' ? 'Animation' : 'Other'; }
    const pick = () => { if (s.index !== m.current) { msg.textContent = 'Switching…'; send({ type: 'screen', op: 'select', index: s.index }); } };
    b.addEventListener('click', pick);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    if (s.kind === 'image') {
      const d = document.createElement('button'); d.className = 'del'; d.textContent = '×'; d.title = 'Remove this picture from the keyboard'; d.setAttribute('aria-label', 'Remove picture ' + s.index);
      d.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('Remove this picture from the keyboard? This cannot be undone.')) { msg.textContent = 'Removing…'; send({ type: 'screen', op: 'remove', index: s.index }); } });
      b.appendChild(d);
    }
    box.appendChild(b);
  }
}
async function addPicture(file) {
  const msg = $('screenMsg');
  try {
    const bmp = await createImageBitmap(file);
    const W = 248, H = 170, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const k = Math.max(W / bmp.width, H / bmp.height), w = bmp.width * k, h = bmp.height * k;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
    const d = ctx.getImageData(0, 0, W, H).data; let s = '';
    for (let p = 0; p < d.length; p += 4) { const v = ((d[p] >> 3) << 11) | ((d[p + 1] >> 2) << 5) | (d[p + 2] >> 3); s += String.fromCharCode(v & 255, v >> 8); }
    msg.textContent = 'Saving to the keyboard… the lights pause for a moment.'; $('addPic').disabled = true;
    send({ type: 'screen', op: 'add', pixels: btoa(s) });
  } catch (e) { msg.textContent = 'That file could not be read as a picture.'; }
}

// The app sends the exact colours it is putting on the keyboard; mirror them on the map.
let keyEls = null, fnShown = false;
function paintFrame(m) {
  if (!built) return;
  if (!keyEls) keyEls = [...document.querySelectorAll('.key')].map((el) => ({ el, id: +el.dataset.id, label: el.textContent }));
  const bin = atob(m.rgb);
  const dim = Math.max(0.12, (state.config.keyboard.lighting.brightness || 0) / 100);
  for (const k of keyEls) {
    const r = bin.charCodeAt(k.id * 3), g = bin.charCodeAt(k.id * 3 + 1), b = bin.charCodeAt(k.id * 3 + 2);
    const lit = r + g + b > 0;
    // unlit keys show as dark keycaps; lit keys glow in their colour, scaled by brightness
    k.el.style.background = lit ? `rgb(${Math.round(r * dim)},${Math.round(g * dim)},${Math.round(b * dim)})` : '#1b1e26';
    k.el.style.color = lit ? (r * 0.3 + g * 0.6 + b * 0.1) * dim > 150 ? '#111' : '#fff' : '#596072';
    k.el.style.textShadow = lit && (r * 0.3 + g * 0.6 + b * 0.1) * dim > 150 ? 'none' : '';
  }
  if (m.fn !== fnShown) {
    fnShown = m.fn;
    const labels = state.layout.fnLabels;
    for (const k of keyEls) k.el.textContent = m.fn && labels[k.id] ? labels[k.id] : k.label;
    $('boardHint').dataset.fn = m.fn ? '1' : '';
    hint();
  }
}
function hint() {
  const L = state.config.keyboard.lighting;
  $('boardHint').textContent = fnShown ? 'Fn is held: only the keys with an Fn shortcut are lit, labelled with what they do.'
    : L.effect === 'perkey' ? 'This map mirrors the real lights. Click or drag across keys to paint them with the paint colour.'
      : state.config.keyboard.control === 'full' ? 'This map mirrors the real lights, live. Hold Fn on the keyboard to see its shortcuts. Dashed keys can be given a job below.'
        : 'This map mirrors the lights the app is sending, live.';
}

function sync() {
  const c = state.config, L = c.keyboard.lighting, kb = state.keyboard, h = state.headset;
  $('startup').checked = !!(state.app && state.app.startWithWindows);

  $('kbDot').className = 'dot' + (kb.connected ? ' on' : '');
  $('hsDot').className = 'dot' + (h.online ? ' on' : h.receiver ? ' warn' : '');
  $('kbStatus').innerHTML = kb.connected ? `<span><b>Vanguard Pro 96</b> connected</span><span>Firmware ${kb.firmware}</span><span>Game mode: <b>off</b></span>`
    : '<span>Keyboard not found. Plug it in and it will connect by itself.</span>';

  // map
  $('board').classList.toggle('paint', L.effect === 'perkey');
  hint();
  const full = c.keyboard.control === 'full';
  document.querySelectorAll('#controlModes button').forEach((b) => b.classList.toggle('on', (b.dataset.control === 'full') === full));
  document.body.classList.toggle('self', !full);
  setVal($('fnColor'), L.fnColor);
  if (kb.connected && !screenAsked) { screenAsked = true; $('screenMsg').textContent = 'Reading pictures from the keyboard…'; send({ type: 'screen', op: 'list' }); }
  if (!kb.connected) screenAsked = false;

  // lighting controls
  document.querySelectorAll('#effects button').forEach((b) => b.classList.toggle('on', b.dataset.effect === L.effect));
  const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
  show('rowColor', ['static', 'perkey', 'breathing', 'wave', 'reactive'].includes(L.effect));
  show('rowColor2', ['wave', 'reactive'].includes(L.effect));
  show('rowPaint', L.effect === 'perkey');
  show('rowSpeed', ['rainbow', 'wave', 'breathing', 'cycle', 'reactive'].includes(L.effect));
  $('colorLabel').textContent = L.effect === 'perkey' ? 'Base colour' : 'Colour';
  $('color2Label').textContent = L.effect === 'reactive' ? 'Pressed colour' : 'Second colour';
  setVal($('color'), L.color); setVal($('color2'), L.color2);
  setVal($('speed'), L.speed); $('speedOut').textContent = L.speed;
  setVal($('brightness'), L.brightness); $('brightnessOut').textContent = L.brightness + '%';

  document.querySelectorAll('#dialModes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === c.keyboard.dial.mode));

  // buttons
  document.querySelectorAll('.btnrow').forEach((row) => {
    const id = row.dataset.id, gm = id === '130';
    const a = (full ? c.keyboard.buttons[id] : gm ? { type: 'none', value: '' } : c.keyboard.selfButtons[id]) || { type: 'none', value: '' };
    row._type.querySelector('option[value=keep]').hidden = full;
    row._type.disabled = !full && gm;
    setVal(row._type, a.type);
    const has = (state.stored || {})[id];
    const sig = [a.type, full, has].join('|');
    if (row._slot.dataset.type !== sig) {
      row._slot.dataset.type = sig; row._slot.textContent = '';
      if (!full && gm) row._slot.innerHTML = '<span class="none">The keyboard handles this button itself. If it switches game mode on, the app switches it back off within a couple of seconds.</span>';
      else if (a.type === 'keep') { const sp = document.createElement('span'); sp.className = 'none'; sp.textContent = has ? 'The keyboard has ' + has + ' saved for this button.' : 'Reading what the keyboard has saved…'; row._slot.appendChild(sp); }
      else
      if (a.type === 'media') {
        const s = document.createElement('select'); s.setAttribute('aria-label', 'Media action');
        for (const [v, t] of MEDIA) s.add(new Option(t, v));
        s.addEventListener('change', () => row._set({ type: 'media', value: s.value }));
        row._slot.appendChild(s);
      } else if (PLACEHOLDER[a.type]) {
        const i = document.createElement('input'); i.type = 'text'; i.placeholder = PLACEHOLDER[a.type]; i.style.width = '100%';
        i.setAttribute('aria-label', PLACEHOLDER[a.type]);
        i.addEventListener('change', () => row._set({ type: a.type, value: i.value }));
        row._slot.appendChild(i);
      } else if (a.type === 'none') {
        row._slot.innerHTML = '<span class="none">This button is switched off.</span>';
      }
    }
    const field = row._slot.querySelector('select, input');
    if (field) setVal(field, a.value);
  });

  // headset
  const charge = { 1: 'charging', 3: 'fully charged' }[h.charging] || '';
  $('hsStatus').innerHTML = h.online
    ? `<span><b>Void Wireless v2</b> connected</span><span>Battery <b>${h.battery == null ? '–' : h.battery + '%'}</b>${charge ? ' (' + charge + ')' : ''}</span><span>Firmware ${h.firmware}</span>${h.micMuted ? '<span><b>Mic flipped up (muted)</b></span>' : ''}`
    : h.receiver ? '<span>Receiver found, but the headset is switched off or out of range.</span>'
      : '<span>Headset receiver not found. Plug it in and it will connect by itself.</span>';
  const p = state.audio.playback, r = state.audio.recording;
  for (const [dev, slider, out, btn, label] of [[p, 'vol', 'volOut', 'volMute', 'Mute'], [r, 'mic', 'micOut', 'micMute', 'Mute mic']]) {
    $(slider).disabled = !dev; $(btn).disabled = !dev;
    if (dev) { setVal($(slider), dev.volume); if (document.activeElement !== $(slider)) $(out).textContent = dev.volume + '%'; }
    $(btn).textContent = dev && dev.muted ? 'Muted' : label; $(btn).classList.toggle('on', !!(dev && dev.muted));
  }
  $('audioHint').textContent = p ? 'Controls: ' + p.name : 'Looking for sound devices…';
  syncSound(p, r);
  $('follow').checked = c.headset.followMicMute;
  $('stOn').checked = c.headset.sidetone.enabled;
  setVal($('stLevel'), c.headset.sidetone.level); $('stOut').textContent = c.headset.sidetone.level + '%';
  $('stLevel').disabled = !c.headset.sidetone.enabled;
  const hl = c.headset.lighting;
  $('hsOn').checked = hl.on; setVal($('hsTop'), hl.top); setVal($('hsBottom'), hl.bottom);
  setVal($('hsBright'), hl.brightness); $('hsBrightOut').textContent = hl.brightness + '%';
  setVal($('sleep'), c.headset.sleepMinutes);
}

// ---- Sound tab ----
function syncSound(p, r) {
  const snd = state.config.sound, active = snd.mode && snd.modes[snd.mode] ? snd.mode : '';
  document.querySelectorAll('#soundModes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === active));
  $('modeEditor').hidden = !active;
  if (active) {
    const m = snd.modes[active];
    $('modeTitle').textContent = m.name + ' settings';
    setVal($('mVolume'), m.volume); if (document.activeElement !== $('mVolume')) $('mVolumeOut').textContent = m.volume + '%';
    setVal($('mMic'), m.mic); if (document.activeElement !== $('mMic')) $('mMicOut').textContent = m.mic + '%';
    $('mSide').checked = m.sidetone.enabled; $('mSideLevel').disabled = !m.sidetone.enabled;
    setVal($('mSideLevel'), m.sidetone.level); if (document.activeElement !== $('mSideLevel')) $('mSideOut').textContent = m.sidetone.level + '%';
    for (const kind of Object.keys(state.audio.kinds)) { const el = $('lv-' + kind); setVal(el, m.levels[kind]); if (document.activeElement !== el) $('lvo-' + kind).textContent = m.levels[kind] + '%'; }
  }
  const gains = (active && snd.modes[active].eq) || snd.manualEq;
  $('eqTitle').textContent = 'Tone' + (active ? ' for ' + snd.modes[active].name : ' (Manual)');
  $('eqStatus').innerHTML = state.eq.problem ? 'The equaliser is installed but could not be updated: ' + state.eq.problem + '.'
    : state.eq.installed ? 'Bass on the left, treble on the right. Each slider goes from −12 to +12 dB and applies straight away.'
      : 'These sliders need <b>Equalizer APO</b>, a free equaliser for Windows, which is not installed yet. Your settings here are kept and switch on by themselves once it is.';
  [...$('eq').children].forEach((col, i) => { setVal(col._sl, gains[i] || 0); if (document.activeElement !== col._sl) col._out.textContent = (gains[i] > 0 ? '+' : '') + (gains[i] || 0); });
  $('eq').classList.toggle('idle', !state.eq.installed);
  for (const [dev, slider, out, btn, label] of [[p, 'mixVol', 'mixVolOut', 'mixVolMute', 'Mute'], [r, 'mixMic', 'mixMicOut', 'mixMicMute', 'Mute']]) {
    $(slider).disabled = !dev; $(btn).disabled = !dev;
    if (dev) { setVal($(slider), dev.volume); if (document.activeElement !== $(slider)) $(out).textContent = dev.volume + '%'; }
    $(btn).textContent = dev && dev.muted ? 'Muted' : label; $(btn).classList.toggle('on', !!(dev && dev.muted));
  }
  $('mixHint').textContent = p ? 'Headset: ' + p.name : 'Looking for sound devices…';

  // one row per app; rows are reused so a slider being dragged is not replaced
  const box = $('apps'), apps = state.audio.apps || [], seen = new Set();
  for (const a of apps) {
    seen.add(a.name);
    let row = [...box.children].find((x) => x.dataset.app === a.name);
    if (!row) {
      row = document.createElement('div'); row.className = 'row app'; row.dataset.app = a.name;
      const label = document.createElement('label'); const name = document.createElement('b'); name.textContent = a.name; const kind = document.createElement('small');
      label.append(name, kind);
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = 100; slider.setAttribute('aria-label', a.name + ' volume');
      const out = document.createElement('output');
      const mute = document.createElement('button'); mute.className = 'small toggle';
      slider.addEventListener('input', () => { out.textContent = slider.value + '%'; send({ type: 'appvolume', name: a.name, value: +slider.value }); });
      mute.addEventListener('click', () => send({ type: 'appmute', name: a.name, value: !row._muted }));
      row.append(label, slider, out, mute); row._kind = kind; row._slider = slider; row._out = out; row._mute = mute;
      box.appendChild(row);
    }
    row._kind.textContent = state.audio.kinds[a.kind] + (a.active ? ' · playing' : '');
    setVal(row._slider, a.volume); if (document.activeElement !== row._slider) row._out.textContent = a.volume + '%';
    row._muted = a.muted; row._mute.textContent = a.muted ? 'Muted' : 'Mute'; row._mute.classList.toggle('on', a.muted);
  }
  for (const row of [...box.children]) if (!seen.has(row.dataset.app)) row.remove();
  if (!apps.length && !box.children.length) box.innerHTML = '';
}

connect();
