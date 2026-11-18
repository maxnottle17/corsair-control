# Corsair Control

A small Windows app that replaces iCUE for two devices:

- **Corsair Vanguard Pro 96** keyboard
- **Corsair Void Wireless v2** headset

It runs in the background and opens as a window on `http://127.0.0.1:47821` (only reachable from this PC).

## What it does

**Keyboard**
- Lighting: one colour, per-key painting, rainbow, two-colour wave, breathing, colour cycle, light-up-on-press, off. Still colours are saved into the keyboard itself, so they stay even when the app is closed.
- Live keyboard map that mirrors the real lights.
- Dial modes (volume + play/pause, volume + mute, mic level, sidetone, brightness, track skip, scroll, side scroll, zoom), saved into the keyboard.
- Jobs for G1–G5 and the Stream Deck key: media controls, keyboard shortcuts, open an app/file/website, type text, mute the mic, and more.
- Side screen: add, show and remove pictures stored in the keyboard (Fn + left/right still switches between them).
- Game mode is kept switched off.
- Two ways of working: *Keyboard runs itself* (screen and all Fn shortcuts work as built in) or *App takes full control*.

**Headset**
- Battery level, sidetone, idle switch-off timer, lighting, and flip-up mic mute following through to Windows.

**Sound**
- Mixer with headset, microphone and per-app volume and mute.
- Sound modes: Gaming, Music, Movies, Voice chat, Focus, Late night (each sets volumes, mic level, sidetone and app balance).
- 10-band tone control per mode, through the free [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) (install it separately; without it the tone sliders do nothing).

**App**
- Start with Windows (a Task Scheduler sign-in task; no admin rights needed).
- Settings are written the moment they change, with a backup copy, so they survive a crash or power cut. They are stored in `%APPDATA%\CorsairControl\config.json`.

## Running it

Needs [Node.js](https://nodejs.org/) on Windows. Close iCUE first: only one program can control the devices at a time.

```
npm install
```

Then double-click `Corsair Control.vbs` (it starts the app if needed and opens the window), or run `npm start`.

## Notes

- The device protocols are based on the open-source [OpenLinkHub](https://github.com/jurkovic-nikola/OpenLinkHub) project (GPL-3.0), so this project is GPL-3.0 as well. Formats for the keyboard's onboard screen, dial, key and lighting files were worked out from how Corsair's Web Hub talks to the keyboard.
- Before changing files stored on the keyboard, the app saves a backup of them to `%APPDATA%\CorsairControl\`. Holding Esc for two seconds while the keyboard is plugged in resets it to factory settings.
- `tools/` holds small diagnostic scripts used while building this; run them only with the app closed.
- This is an unofficial project and is not affiliated with Corsair.
