# Spotify Web Controller & Ad Silencer 🎵📱

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Android App](https://img.shields.io/badge/Android-APK%20Ready-brightgreen?style=flat-square)](#-android-application--ota-sync)
[![OTA Remote Sync](https://img.shields.io/badge/GitHub-OTA%20Sync-blueviolet?style=flat-square)](#-automatic-github-ota-remote-sync-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-brightgreen?style=flat-square)](PRIVACY_POLICY.md)

A production-grade, zero-cost audio enhancement suite for the **Spotify Web Player** (`open.spotify.com`), available both as a **Cross-Browser WebExtension** and as a **Self-Updating Android WebView Application (`/android-app`)** with an automatic **Over-The-Air (OTA) GitHub Sync Engine**.

---

## ✨ Features at a Glance

| Feature | Browser Extension | Android App (`/android-app`) |
| :--- | :---: | :---: |
| 🔀 **60fps Native Queue Drag (`=`)** | ✅ Mouse & Touch | ✅ 60fps Mobile Touch Drag |
| 🔇 **Smart Audio Ad Silencing** | ✅ Instant Auto-Mute | ✅ Instant Auto-Mute |
| ⏩ **Ad Fast-Forwarding** | ✅ Up to 16x Skip | ✅ Up to 16x Skip |
| 🔓 **Unlocked Transport & Seek Bar** | ✅ Unlimited Skips | ✅ Unlimited Skips |
| 🧹 **Banner Ad Removal** | ✅ DeclarativeNetRequest | ✅ Network Interception |
| 🔄 **Automatic GitHub OTA Sync** | ✅ Remote Config | ✅ Full Script Hot-Reloading |
| 🌙 **Screen-Off Background Playback** | — | ✅ Foreground Media Service |
| 🔒 **100% Client-Side Privacy** | ✅ Zero Telemetry | ✅ Zero Telemetry |

---

## 📱 Android Application & OTA Sync

The `/android-app` directory contains a standalone Android project (Kotlin, AndroidX WebKit, Min SDK 26, Target SDK 35) designed to run Spotify Web in Desktop mode with background playback and live GitHub updates.

### 📥 How to Install the APK

1. Go to the [**Releases**](https://github.com/U-Gaurav187/spotify-add-blocker/releases) page (or the [**Actions**](https://github.com/U-Gaurav187/spotify-add-blocker/actions) tab for the latest build artifact).
2. Download `app-debug.apk` directly to your Android device.
3. Tap the file to install (if prompted, allow *"Install unknown apps"* for your browser or file manager).
4. Launch **Spotify Controller** and log in to your Spotify account.

### 🌟 Android Specific Capabilities
- **Screen-Off & Background Playback**: Uses an Android `ForegroundService` with a partial `WakeLock` and an `AudioWebView` that overrides window visibility changes so audio continues playing seamlessly when you switch apps or lock your phone.
- **Widevine DRM Auto-Grant**: WebChromeClient automatically grants `RESOURCE_PROTECTED_MEDIA_ID` so DRM-encrypted audio streams play without silent decoder errors.
- **Floating Controller Menu**: Tap the floating green button at the bottom-right of the screen to toggle features or tap **"Sync Updates from GitHub"**.

---

## ⚡ Automatic GitHub OTA Remote Sync Engine

You never have to rebuild or reinstall the APK when you update your extension scripts!

```
 ┌─────────────────────────────────────────────────────────┐
 │               Your GitHub Repository                   │
 │       (U-Gaurav187/spotify-add-blocker: main)           │
 │                                                         │
 │   • page_hook.js     • styles.css                       │
 │   • rules.json       • remote-config.json               │
 └────────────────────────────┬────────────────────────────┘
                              │ git push
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │        Android App: OtaSyncManager.kt (Background)       │
 │                                                         │
 │   1. Fetches raw files with ?t=${timestamp} (no-cache)  │
 │   2. Fallback check: main branch ➔ master branch        │
 │   3. Integrity Verification (markers & JSON validation) │
 │   4. SHA-256 Hash comparison against local filesDir     │
 └────────────────────────────┬────────────────────────────┘
                              │ If changed
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │        Hot-Swap & WebView Reload (Zero APK Rebuild)      │
 │                                                         │
 │   • Removes old ScriptHandler                           │
 │   • Injects updated page_hook.js at document_start      │
 │   • Reloads WebView with Toast notification             │
 └─────────────────────────────────────────────────────────┘
```

1. **Push your code to GitHub**: Push any changes to `page_hook.js`, `styles.css`, `rules.json`, or `remote-config.json` on `main`.
2. **Automatic Background Sync**: On app launch (or when tapping *"Sync Updates from GitHub"* in the floating menu), `OtaSyncManager` downloads the latest files from GitHub Raw.
3. **Integrity Validation**: Before saving, the app validates file signatures (`__sab_hook_installed`, `sab-hide-banners`, valid JSON). Corrupted or 404 responses are automatically rejected.
4. **Hot Reload**: If a file hash changed, the app saves it to local app storage, replaces the `document_start` injection, and reloads the web player with a Toast notification: *"Updated from GitHub! Reloading..."*.

---

## 💻 Browser Extension Installation (Desktop)

### Chrome, Edge, Brave, Opera & Vivaldi
1. Download or clone this repository:
   ```bash
   git clone https://github.com/U-Gaurav187/spotify-add-blocker.git
   ```
2. Navigate to your browser's extension manager:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Turn **ON** the **Developer mode** toggle in the top-right corner.
4. Click **"Load unpacked"** and select the root folder of this repository.
5. Open [open.spotify.com](https://open.spotify.com).

### Mozilla Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."** and select `manifest.json`.

---

## 🏗️ Building the Android App Locally

If you wish to compile the Android app locally using Gradle:

```bash
cd android-app

# On Windows:
gradlew.bat assembleDebug

# On Linux / macOS:
chmod +x gradlew
./gradlew assembleDebug
```

The compiled APK will be generated at:
`android-app/app/build/outputs/apk/debug/app-debug.apk`

---

## 📁 Repository Structure

```
├── .github/workflows/
│   └── build-android.yml    # Automated GitHub Actions APK builder & release workflow
├── android-app/             # Complete Android Studio / Gradle project
│   ├── app/
│   │   ├── build.gradle.kts # Android module build file with asset copy task
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── assets/      # Pre-bundled offline fallback scripts
│   │       ├── java/com/spotifyadblocker/app/
│   │       │   ├── AudioWebView.kt        # Custom WebView with continuous playback
│   │       │   ├── MainActivity.kt        # Desktop UA, DRM grant, rule interceptor
│   │       │   ├── MediaPlaybackService.kt# Foreground service with WakeLock
│   │       │   └── OtaSyncManager.kt      # GitHub Raw cache-busting sync engine
│   │       └── res/         # Layouts, themes, drawables & dialogs
│   ├── build.gradle.kts     # Root build file
│   └── settings.gradle.kts  # Gradle settings
├── content.js               # Isolated world WebExtension script
├── manifest.json            # Manifest V3 extension configuration
├── page_hook.js             # Main world script (FLIP queue, OTA sync & audio hooks)
├── popup.html / popup.js    # Browser extension popup UI
├── remote-config.json       # Dynamic remote selectors & custom CSS overrides
├── rules.json               # DeclarativeNetRequest ad & telemetry blocking rules
├── styles.css               # 60fps animations, mobile styles & ad element removal
├── PRIVACY_POLICY.md        # 100% local, zero-tracking privacy policy
└── README.md                # Comprehensive documentation
```

---

## 🔒 Privacy & Security

This project contains zero analytics, tracking beacons, or third-party telemetry. All user settings, queue sequences, and cached scripts remain strictly on your local device. Read our [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

---

## ⚖️ Disclaimer

Spotify is a registered trademark of Spotify AB. This project is an independent open-source educational utility and is not affiliated with, sponsored by, or endorsed by Spotify AB.
