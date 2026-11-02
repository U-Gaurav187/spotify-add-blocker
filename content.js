(() => {
  'use strict';

  const DEFAULT_SETTINGS = {
    muteAds: true,
    fastForwardAds: true,
    hideBanners: true,
    unlockControls: true,
    customQueueEnabled: true,
    adsBlockedCount: 0
  };

  function pushConfigToPage(settings) {
    window.dispatchEvent(
      new CustomEvent('SpotifyAdBlocker:Config', {
        detail: {
          muteAds: settings.muteAds,
          fastForwardAds: settings.fastForwardAds,
          hideBanners: settings.hideBanners,
          unlockControls: settings.unlockControls,
          customQueueEnabled: settings.customQueueEnabled
        }
      })
    );
    document.documentElement.classList.toggle('sab-hide-banners', !!settings.hideBanners);
    document.documentElement.classList.toggle('sab-unlock-controls', !!settings.unlockControls);
  }

  chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
    pushConfigToPage(settings);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
        pushConfigToPage(settings);
      });
    }
  });

  window.addEventListener('SpotifyAdBlocker:AdHandled', () => {
    chrome.storage.local.get({ adsBlockedCount: 0 }, (data) => {
      chrome.storage.local.set({
        adsBlockedCount: (data.adsBlockedCount || 0) + 1
      });
    });
  });
})();
