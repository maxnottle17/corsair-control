// Sends keyboard / mouse-wheel input to Windows (used by the dial and macro buttons).
const koffi = require('koffi');
const { spawn } = require('child_process');

const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)');
const mouse_event = user32.func('void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, int32 dwData, uintptr_t dwExtraInfo)');
const INPUT = koffi.struct('INPUT', {
  type: 'uint32', _pad0: 'uint32',
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', _pad1: 'uint32',
  dwExtraInfo: 'uintptr_t', _pad2: 'uint64',
});
const SendInput = user32.func('uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');

const KEYUP = 0x0002, UNICODE = 0x0004, WHEEL = 0x0800, HWHEEL = 0x1000;

const VK = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, meta: 0x5b,
  enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08,
  delete: 0x2e, del: 0x2e, insert: 0x2d, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27, printscreen: 0x2c, prtsc: 0x2c,
  plus: 0xbb, '=': 0xbb, minus: 0xbd, '-': 0xbd, ',': 0xbc, '.': 0xbe, '/': 0xbf, ';': 0xba, "'": 0xde,
  '[': 0xdb, ']': 0xdd, '\\': 0xdc, '`': 0xc0,
  volup: 0xaf, voldown: 0xae, mute: 0xad, next: 0xb0, prev: 0xb1, stop: 0xb2, playpause: 0xb3,
};
for (let i = 1; i <= 24; i++) VK['f' + i] = 0x6f + i;
for (let i = 0; i <= 9; i++) VK[String(i)] = 0x30 + i;
for (let c = 65; c <= 90; c++) VK[String.fromCharCode(c).toLowerCase()] = c;

function tap(vk) { keybd_event(vk, 0, 0, 0); keybd_event(vk, 0, KEYUP, 0); }

// "ctrl+shift+s" -> presses the keys in order, releases in reverse. Returns false if a key name is unknown.
function shortcut(text) {
  const parts = String(text || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  const codes = parts.map((p) => VK[p]);
  if (!codes.length || codes.some((c) => c === undefined)) return false;
  for (const c of codes) keybd_event(c, 0, 0, 0);
  for (const c of codes.reverse()) keybd_event(c, 0, KEYUP, 0);
  return true;
}

function media(name) { if (VK[name] !== undefined) tap(VK[name]); }
function scroll(steps) { mouse_event(WHEEL, 0, 0, steps * 120, 0); }
function hscroll(steps) { mouse_event(HWHEEL, 0, 0, steps * 120, 0); }
function zoom(steps) { keybd_event(VK.ctrl, 0, 0, 0); scroll(steps); keybd_event(VK.ctrl, 0, KEYUP, 0); }

function typeText(text) {
  const inputs = [];
  for (const ch of String(text || '')) {
    for (let i = 0; i < ch.length; i++) {
      const code = ch.charCodeAt(i);
      inputs.push({ type: 1, wVk: 0, wScan: code, dwFlags: UNICODE, time: 0, dwExtraInfo: 0 });
      inputs.push({ type: 1, wVk: 0, wScan: code, dwFlags: UNICODE | KEYUP, time: 0, dwExtraInfo: 0 });
    }
  }
  if (inputs.length) SendInput(inputs.length, inputs, koffi.sizeof(INPUT));
}

// Opens a program, file, folder or web address the same way the Run box would.
function launch(target) {
  const t = String(target || '').trim();
  if (!t) return;
  spawn('cmd.exe', ['/c', 'start', '""', t], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = { shortcut, media, scroll, hscroll, zoom, typeText, launch, tap, VK };
