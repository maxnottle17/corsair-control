// Listens for Ctrl+Alt+Shift+F1..F9. The keyboard is set up to send these for dial turns
// and button presses that need the PC to do something (see onboard.js).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const RegisterHotKey = user32.func('bool RegisterHotKey(void *hWnd, int id, uint32 fsModifiers, uint32 vk)');
const UnregisterHotKey = user32.func('bool UnregisterHotKey(void *hWnd, int id)');
const MSG = koffi.struct('MSG', { hwnd: 'void *', message: 'uint32', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32', x: 'int32', y: 'int32', priv: 'uint32' });
const PeekMessageW = user32.func('bool PeekMessageW(_Out_ MSG *lpMsg, void *hWnd, uint32 min, uint32 max, uint32 remove)');

const MOD = 0x0001 | 0x0002 | 0x0004; // Alt + Ctrl + Shift
const WM_HOTKEY = 0x0312, VK_F1 = 0x70, BASE = 0x4c00;

let timer = null; const registered = [];

// onSlot(n) is called with 1..9 when Ctrl+Alt+Shift+F<n> arrives
function start(onSlot) {
  stop();
  for (let n = 1; n <= 9; n++) if (RegisterHotKey(null, BASE + n, MOD, VK_F1 + n - 1)) registered.push(BASE + n);
  timer = setInterval(() => {
    const msg = {};
    for (let i = 0; i < 20 && PeekMessageW(msg, null, WM_HOTKEY, WM_HOTKEY, 1); i++) {
      const n = Number(msg.wParam) - BASE;
      if (n >= 1 && n <= 9) { try { onSlot(n); } catch (e) { console.error('hotkey action failed:', e.message); } }
    }
  }, 25);
  return registered.length;
}

function stop() {
  clearInterval(timer); timer = null;
  while (registered.length) UnregisterHotKey(null, registered.pop());
}

module.exports = { start, stop };
