// Schematic layout of the Vanguard Pro 96. `id` is the keyboard's own key index,
// which is also its LED index (colour bytes live at id*3 in the lighting buffer).
// Positions are in key units; they are approximate and only used for the on-screen
// map and for sweeping effects across the board.

const keys = [];
function row(y, startX, items) {
  let x = startX;
  for (const it of items) {
    if (typeof it === 'number') { x += it; continue; } // gap
    const [id, label, w = 1, h = 1] = it;
    keys.push({ id, label, x, y, w, h });
    x += w;
  }
}

const G = -1.6; // macro column sits left of the main block
const NP = 16.5; // numpad start

keys.push({ id: 130, label: 'GM', x: G, y: 0, w: 1, h: 1 });
[131, 132, 133, 134, 135].forEach((id, i) => keys.push({ id, label: 'G' + (i + 1), x: G, y: i + 1.25, w: 1, h: 1 }));

row(0, 0, [[41, 'Esc'], 0.5, [58, 'F1'], [59, 'F2'], [60, 'F3'], [61, 'F4'], 0.5, [62, 'F5'], [63, 'F6'], [64, 'F7'], [65, 'F8'], 0.5,
  [66, 'F9'], [67, 'F10'], [68, 'F11'], [69, 'F12'], 2, [70, 'PrtSc'], [76, 'Del']]);
row(1.25, 0, [[53, '`'], [30, '1'], [31, '2'], [32, '3'], [33, '4'], [34, '5'], [35, '6'], [36, '7'], [37, '8'], [38, '9'], [39, '0'],
  [45, '-'], [46, '='], [42, 'Bksp', 2], 1.5, [83, 'Num'], [84, '/'], [85, '*'], [86, '-']]);
row(2.25, 0, [[43, 'Tab', 1.5], [20, 'Q'], [26, 'W'], [8, 'E'], [21, 'R'], [23, 'T'], [28, 'Y'], [24, 'U'], [12, 'I'], [18, 'O'], [19, 'P'],
  [47, '['], [48, ']'], [49, '\\', 1.5], 1.5, [95, '7'], [96, '8'], [97, '9'], [87, '+', 1, 2]]);
row(3.25, 0, [[57, 'Caps', 1.75], [4, 'A'], [22, 'S'], [7, 'D'], [9, 'F'], [10, 'G'], [11, 'H'], [13, 'J'], [14, 'K'], [15, 'L'],
  [51, ';'], [52, "'"], [40, 'Enter', 2.25], 1.5, [92, '4'], [93, '5'], [94, '6']]);
row(4.25, 0, [[106, 'Shift', 2.25], [29, 'Z'], [27, 'X'], [6, 'C'], [25, 'V'], [5, 'B'], [17, 'N'], [16, 'M'], [54, ','], [55, '.'], [56, '/'],
  [110, 'Shift', 1.75], 0.25, [82, '↑'], 1.25, [89, '1'], [90, '2'], [91, '3'], [88, 'Ent', 1, 2]]);
row(5.25, 0, [[105, 'Ctrl', 1.25], [108, 'Win', 1.25], [107, 'Alt', 1.25], [44, '', 5.5], [111, 'Alt', 1.25], [122, 'Fn', 1.25], 0.25,
  [136, 'SD'], 0.25, [80, '←'], [81, '↓'], [79, '→'], 0.25, [98, '0', 2], [99, '.']]);

const LED_COUNT = 137;
const COLOR_BYTES = 413;

// Buttons that have no function of their own and can be given an action in the app.
const ASSIGNABLE = [
  { id: 130, name: 'Game Mode button' },
  { id: 131, name: 'G1' }, { id: 132, name: 'G2' }, { id: 133, name: 'G3' },
  { id: 134, name: 'G4' }, { id: 135, name: 'G5' },
  { id: 136, name: 'Stream Deck key' },
];

const KEY_FN = 122, KEY_DIAL_PRESS = 129, KEY_F3 = 60, KEY_F4 = 61, KEY_F12 = 69, KEY_GM = 130;

// Keys that do something when held with Fn (from Corsair's manual): F1-F12, P, M,
// Enter, right Shift, Win, left / right arrows, numpad 7 1 9 3 0, and Fn itself.
const FN_KEYS = [58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 19, 16, 40, 110, 108, 80, 79, 95, 89, 97, 91, 98, 122];
const FN_LABELS = {
  58: 'ScrLk', 59: 'Profile', 60: 'Dim', 61: 'Bright', 62: 'Stop', 63: 'Prev', 64: 'Play', 65: 'Next', 66: 'Mute', 67: 'Vol-', 68: 'Vol+',
  69: 'Dial', 19: 'Pause', 16: 'Macro', 40: 'Screen', 110: 'FlashTap', 108: 'WinLk', 80: 'Scr◀', 79: 'Scr▶', 95: 'Home', 89: 'End', 97: 'PgUp', 91: 'PgDn', 98: 'Ins',
};

module.exports = { keys, LED_COUNT, COLOR_BYTES, ASSIGNABLE, FN_KEYS, FN_LABELS, KEY_FN, KEY_DIAL_PRESS, KEY_F3, KEY_F4, KEY_F12, KEY_GM };
