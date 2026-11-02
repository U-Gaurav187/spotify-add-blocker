document.addEventListener('DOMContentLoaded', () => {
  const unlockCheckbox = document.getElementById('unlockControls');
  const queueCheckbox = document.getElementById('customQueueEnabled');
  const muteCheckbox = document.getElementById('muteAds');
  const ffCheckbox = document.getElementById('fastForwardAds');
  const bannersCheckbox = document.getElementById('hideBanners');
  const adsCountEl = document.getElementById('adsCount');
  const resetBtn = document.getElementById('resetBtn');

  const DEFAULTS = {
    unlockControls: true,
    customQueueEnabled: true,
    muteAds: true,
    fastForwardAds: true,
    hideBanners: true,
    adsBlockedCount: 0
  };

  chrome.storage.local.get(DEFAULTS, (data) => {
    unlockCheckbox.checked = !!data.unlockControls;
    queueCheckbox.checked = !!data.customQueueEnabled;
    muteCheckbox.checked = !!data.muteAds;
    ffCheckbox.checked = !!data.fastForwardAds;
    bannersCheckbox.checked = !!data.hideBanners;
    adsCountEl.textContent = data.adsBlockedCount || 0;
  });

  unlockCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ unlockControls: unlockCheckbox.checked });
  });

  queueCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ customQueueEnabled: queueCheckbox.checked });
  });

  muteCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ muteAds: muteCheckbox.checked });
  });

  ffCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ fastForwardAds: ffCheckbox.checked });
  });

  bannersCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideBanners: bannersCheckbox.checked });
  });

  resetBtn.addEventListener('click', () => {
    chrome.storage.local.set({ adsBlockedCount: 0 }, () => {
      adsCountEl.textContent = '0';
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.adsBlockedCount) {
      adsCountEl.textContent = changes.adsBlockedCount.newValue || 0;
    }
  });
});
