document.addEventListener('DOMContentLoaded', () => {
  const extApi = typeof browser !== 'undefined' ? browser : chrome;

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

  getStorage(DEFAULTS).then((data) => {
    unlockCheckbox.checked = !!data.unlockControls;
    queueCheckbox.checked = !!data.customQueueEnabled;
    muteCheckbox.checked = !!data.muteAds;
    ffCheckbox.checked = !!data.fastForwardAds;
    bannersCheckbox.checked = !!data.hideBanners;
    adsCountEl.textContent = data.adsBlockedCount || 0;
  });

  unlockCheckbox.addEventListener('change', () => {
    setStorage({ unlockControls: unlockCheckbox.checked });
  });

  queueCheckbox.addEventListener('change', () => {
    setStorage({ customQueueEnabled: queueCheckbox.checked });
  });

  muteCheckbox.addEventListener('change', () => {
    setStorage({ muteAds: muteCheckbox.checked });
  });

  ffCheckbox.addEventListener('change', () => {
    setStorage({ fastForwardAds: ffCheckbox.checked });
  });

  bannersCheckbox.addEventListener('change', () => {
    setStorage({ hideBanners: bannersCheckbox.checked });
  });

  resetBtn.addEventListener('click', () => {
    setStorage({ adsBlockedCount: 0 }).then(() => {
      adsCountEl.textContent = '0';
    });
  });

  if (extApi.storage && extApi.storage.onChanged) {
    extApi.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.adsBlockedCount) {
        adsCountEl.textContent = changes.adsBlockedCount.newValue || 0;
      }
    });
  }
});
