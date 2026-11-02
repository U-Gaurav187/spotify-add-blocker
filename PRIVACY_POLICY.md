# Privacy Policy for Ad Silencer & Queue Controller for Spotify™

**Last Updated:** November 2026

## Overview
**Ad Silencer & Queue Controller for Spotify™** ("the Extension") is committed to protecting your privacy. This Privacy Policy describes how your information is handled when using this browser extension.

## 1. Information We Do NOT Collect
- **No Personal Data:** We do not collect, store, transmit, or sell personal information such as your name, email address, IP address, browsing history, or payment details.
- **No Account Information:** The extension does not intercept, log, or store your Spotify login credentials, passwords, or authentication tokens.
- **No Analytics or Telemetry:** The extension contains no tracking analytics, third-party trackers, beacons, or telemetry scripts.

## 2. Information Handled Locally on Your Device
The Extension operates entirely within your browser client. The following information is stored exclusively on your local machine using the browser's built-in `chrome.storage.local` API:
- **User Preferences:** Your selected toggle settings (such as muting ads, unlocking controls, custom queue behavior, fast-forwarding, and hiding visual banners).
- **Local Ad Counter:** A numerical counter reflecting the number of ad interruptions silenced or skipped during your sessions.
- **Custom Queue Data:** The track sequence for custom queue ordering within your active session.

None of this data ever leaves your device or is communicated to any external server.

## 3. Permissions Used
The extension requests only the minimum necessary permissions to function:
- **`storage`**: Used exclusively to save your user settings and ad counter locally on your browser.
- **`declarativeNetRequest`**: Used to redirect known tracking, telemetry, and banner ad endpoints locally so your music playback is uninterrupted.
- **`host_permissions` (`https://open.spotify.com/*`, etc.)**: Required so the extension can inject controls and manage playback states strictly on the Spotify web player page.

## 4. Third-Party Websites
The Extension modifies the client-side presentation and behavior of the Spotify Web Player (`open.spotify.com`). It is not affiliated with, endorsed by, or sponsored by Spotify AB. Please refer to Spotify's own Privacy Policy regarding how Spotify collects and processes your data on their platform.

## 5. Changes to This Policy
Any updates to this Privacy Policy will be reflected in this document with an updated revision date.

## 6. Contact & Open Source
This extension is an open-source project. If you have questions, concerns, or wish to review the source code, please visit:
[https://github.com/U-Gaurav187/spotify-add-blocker](https://github.com/U-Gaurav187/spotify-add-blocker)
