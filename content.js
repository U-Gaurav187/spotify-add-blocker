(() => {
  'use strict';

  // ============================================================================
  // Practice 1: Centralized Selectors with Resilient Fallbacks
  // ============================================================================
  const SELECTORS = {
    trackRow: '[data-testid="tracklist-row"], [role="row"]',
    queueButton: '[data-testid="control-button-queue"], button[aria-label*="Queue" i]',
    skipForward: '[data-testid="control-button-skip-forward"], button[aria-label*="Next" i]',
    skipBack: '[data-testid="control-button-skip-back"], button[aria-label*="Previous" i]',
    trackLink: 'a[data-testid="internal-track-link"], a[href*="/track/"]',
    nowPlayingWidget: '[data-testid="now-playing-widget"]',
    progressBar: '[data-testid="playback-progressbar"], [data-testid="progress-bar"]'
  };

  const extApi = typeof browser !== 'undefined' ? browser : chrome;

  // 1. Inject page_hook.js into the MAIN execution world dynamically.
  // This works reliably across Chrome, Edge, Firefox, Brave, Opera, and Safari.
  function injectPageHook() {
    try {
      const script = document.createElement('script');
      script.src = extApi.runtime.getURL('page_hook.js');
      script.async = false;
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      console.error('[SpotifyAdBlocker] Failed to inject page hook:', err);
    }
  }

  injectPageHook();

  const DEFAULT_SETTINGS = {
    muteAds: true,
    fastForwardAds: true,
    hideBanners: true,
    unlockControls: true,
    customQueueEnabled: true,
    adsBlockedCount: 0
  };

  let cachedSettings = { ...DEFAULT_SETTINGS };

  function getStorage(keys) {
    return new Promise((resolve) => {
      try {
        const p = extApi.storage.local.get(keys, (res) => {
          resolve(res || keys);
        });
        if (p && typeof p.then === 'function') {
          p.then(resolve).catch(() => resolve(keys));
        }
      } catch (_) {
        resolve(keys);
      }
    });
  }

  function setStorage(data) {
    return new Promise((resolve) => {
      try {
        const p = extApi.storage.local.set(data, () => {
          resolve();
        });
        if (p && typeof p.then === 'function') {
          p.then(resolve).catch(() => resolve());
        }
      } catch (_) {
        resolve();
      }
    });
  }

  function applyStyles(settings) {
    const root = document.documentElement;
    if (root) {
      root.classList.toggle('sab-hide-banners', !!settings.hideBanners);
      root.classList.toggle('sab-unlock-controls', !!settings.unlockControls);
    }
  }

  function pushConfigToPage(settings) {
    cachedSettings = { ...cachedSettings, ...settings };
    applyStyles(cachedSettings);
    window.dispatchEvent(
      new CustomEvent('SpotifyAdBlocker:Config', {
        detail: {
          muteAds: cachedSettings.muteAds,
          fastForwardAds: cachedSettings.fastForwardAds,
          hideBanners: cachedSettings.hideBanners,
          unlockControls: cachedSettings.unlockControls,
          customQueueEnabled: cachedSettings.customQueueEnabled
        }
      })
    );
  }

  // Initial config load
  getStorage(DEFAULT_SETTINGS).then((settings) => {
    pushConfigToPage(settings);
  });

  // Handshake listeners to prevent any MAIN / ISOLATED world race condition
  window.addEventListener('SpotifyAdBlocker:Ready', () => {
    pushConfigToPage(cachedSettings);
  });

  window.addEventListener('SpotifyAdBlocker:RequestConfig', () => {
    pushConfigToPage(cachedSettings);
  });

  // Listen for storage changes from popup
  if (extApi.storage && extApi.storage.onChanged) {
    extApi.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        getStorage(DEFAULT_SETTINGS).then((settings) => {
          pushConfigToPage(settings);
        });
      }
    });
  }

  // Increment blocked count when an ad is handled
  window.addEventListener('SpotifyAdBlocker:AdHandled', () => {
    getStorage({ adsBlockedCount: 0 }).then((data) => {
      const newCount = (data.adsBlockedCount || 0) + 1;
      setStorage({ adsBlockedCount: newCount });
    });
  });
})();
