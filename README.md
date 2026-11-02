# Ad Silencer & Queue Controller for Spotify™ 🎵

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browser Support](https://img.shields.io/badge/Browsers-Chrome%20|%20Edge%20|%20Brave%20|%20Firefox-blue?style=flat-square)](#-installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-brightgreen?style=flat-square)](PRIVACY_POLICY.md)

A lightweight, high-performance browser extension that upgrades the Spotify Web Player with **smooth 60fps drag-and-drop queue reordering**, **intelligent audio ad silencing/fast-forwarding**, **unlocked seek scrubbing**, and **banner ad removal** — without requiring Spotify Premium.

---

## ✨ Features

- 🔀 **Native Queue Drag-and-Drop (`=`)**:
  - Adds a sleek two-horizontal-line drag handle directly beside each song in Spotify's native **"Next in queue"** panel.
  - **60fps FLIP physics animation**: Sibling cards glide smoothly into place as you drag.
  - **Live cursor tracking & lift**: Lifted cards cast a subtle glowing shadow and follow your cursor in real time.
- 🔇 **Smart Audio Ad Silencing**:
  - Automatically detects audio advertisements and mutes playback volume instantly until regular music resumes.
- ⏩ **Ad Fast-Forwarding**:
  - Automatically speeds up and skips advertisement streams where possible.
- 🔓 **Native Transport Controls**:
  - Unlocks the native seek-bar scrubbing, previous/next track buttons, and shuffle/repeat on the web player.
- 🧹 **Visual Banner Ad Removal**:
  - Hides intrusive leaderboard and sidebar banner containers seamlessly via clean CSS.
- 🔒 **100% Client-Side & Private**:
  - Zero data collection, no telemetry, and no tracking cookies. All settings and stats stay on your device.

---

## 🚀 Free Installation (No Extension Store Needed)

You can install and use this extension in under 60 seconds without paying any store fees:

### Chrome, Edge, Brave, Opera & Vivaldi

1. **Download the Code**:
   - Click the green **Code** button at the top of this repository and select **Download ZIP** (or clone the repo):
     ```bash
     git clone https://github.com/U-Gaurav187/spotify-add-blocker.git
     ```
   - Extract the downloaded `.zip` file into a folder on your computer.

2. **Open Extensions Manager**:
   - In **Google Chrome**: navigate to `chrome://extensions`
   - In **Microsoft Edge**: navigate to `edge://extensions`
   - In **Brave**: navigate to `brave://extensions`

3. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch in the top-right corner of the extensions page.

4. **Load Unpacked**:
   - Click the **"Load unpacked"** button in the top-left corner.
   - Select the folder containing this project (the folder where `manifest.json` is located).

5. **Start Listening**:
   - Open [open.spotify.com](https://open.spotify.com) and pin the extension icon in your browser toolbar!

---

### Mozilla Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select the `manifest.json` file inside the cloned/downloaded folder.
4. Open [open.spotify.com](https://open.spotify.com).

---

## 🛠️ Architecture & Under the Hood

The extension is engineered to run seamlessly alongside Spotify's dynamic React/Redux single-page application:

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Window                         │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │               Spotify Web Player                    │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐   │   │
│   │   │   page_hook.js (MAIN World)                 │   │   │
│   │   │   • FLIP Queue Reordering Engine            │   │   │
│   │   │   • Media Element & Audio Hooks             │   │   │
│   │   │   • Fail-Open Mutation Circuit Breakers     │   │   │
│   │   └──────────────────────▲──────────────────────┘   │   │
│   │                          │ CustomEvents             │   │
│   │                          │ (JSON-serialized)        │   │
│   │   ┌──────────────────────▼──────────────────────┐   │   │
│   │   │   content.js (ISOLATED World)               │   │   │
│   │   │   • Extension Storage Bridge                │   │   │
│   │   │   • Declarative Net Request Sync            │   │   │
│   │   └─────────────────────────────────────────────┘   │   │
│   │   ┌─────────────────────────────────────────────┐   │   │
│   │   │   styles.css                                │   │   │
│   │   │   • Hardware-accelerated transforms         │   │   │
│   │   │   • Drop settle keyframes & ad slot hiding  │   │   │
│   │   └─────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- **Fail-Open Design**: Wrapped native functions (`fetch`, `HTMLMediaElement`) catch errors silently, guaranteeing that Spotify updates will never crash the player.
- **Circuit Breaker**: An internal mutation governor prevents infinite loops during heavy React re-renders.
- **Cross-World Safety**: Configuration and event payloads are JSON-serialized across execution worlds to prevent permission errors in Firefox Xray Vision and Chromium V8 context boundaries.

---

## 📁 Repository Structure

```
├── icons/               # 16x16, 48x48, and 128x128 extension icons
├── content.js           # Isolated world script & storage bridge
├── manifest.json        # Manifest V3 extension configuration
├── page_hook.js         # Main world script (FLIP physics queue & audio hooks)
├── popup.html           # Settings popup user interface
├── popup.css            # Spotify-themed dark mode popup styles
├── popup.js             # User preferences management & counters
├── rules.json           # DeclarativeNetRequest ad and telemetry block rules
├── styles.css           # 60fps animations, drag states & ad cleanup styles
├── PRIVACY_POLICY.md    # Transparent, 100% local privacy disclosure
└── README.md            # Documentation and installation guide
```

---

## 🔒 Privacy

This extension does not collect, log, or transmit any user data. All configuration states and statistics are stored exclusively in your local browser storage via `chrome.storage.local`. For full details, see [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

---

## ⚖️ Disclaimer

Spotify is a registered trademark of Spotify AB. This extension is an independent, open-source educational project and is not affiliated with, sponsored by, or endorsed by Spotify AB.
