(() => {
  'use strict';

  if (window.__sab_hook_installed) return;
  window.__sab_hook_installed = true;

  const SELECTORS = {
    trackRow: '[data-testid="tracklist-row"]',
    trackLink: 'a[data-testid="internal-track-link"], a[href*="/track/"]',
    trackTitleInRow: '[data-testid="tracklist-row"] div[dir="auto"], [data-testid="internal-track-link"]',
    artistLink: 'a[href*="/artist/"]',

    queueButton: '[data-testid="control-button-queue"], button[aria-label*="Queue" i]',
    skipForward: '[data-testid="control-button-skip-forward"], button[aria-label*="Next" i]',
    skipBack: '[data-testid="control-button-skip-back"], button[aria-label*="Previous" i]',
    shuffleButton: '[data-testid="control-button-shuffle"], button[aria-label*="Shuffle" i]',
    repeatButton: '[data-testid="control-button-repeat"], button[aria-label*="Repeat" i]',
    playPauseButton: '[data-testid="control-button-playpause"], button[aria-label*="Play" i], button[aria-label*="Pause" i]',
    progressBar: '[data-testid="playback-progressbar"], [data-testid="progress-bar"], [role="slider"][aria-label*="progress" i]',

    playButton: '[data-testid="play-button"], button[aria-label*="Play" i]',
    mainPlayButton: '[data-testid="action-bar-row"] [data-testid="play-button"], main [data-testid="play-button"], [data-testid="play-button"]',

    moreButton: '[data-testid="more-button"], button[aria-haspopup="menu"]',
    menuItem: '[role="menuitem"], button[role="menuitem"]',

    nowPlayingWidget: '[data-testid="now-playing-widget"]',
    nowPlayingTitle: '[data-testid="context-item-info-title"], [data-testid="now-playing-widget"] a[href*="/track/"]',
    nowPlayingArtist: '[data-testid="context-item-info-subtitles"], [data-testid="context-item-info-artists"]',

    adSlotContainer: '[data-testid="ad-slot-container"]',
    leaderboardAd: '[data-testid="leaderboard-ad"]',
    billboardAd: '[data-testid="billboard-ad"]',
    displayAd: '[data-testid="DisplayAd"]',
    adLink: 'a[href*="/ad/"], a[data-testid="context-item-info-ad-title"]',
    adTitle: '[data-testid="context-item-info-ad-title"], [data-testid="ad-info-title"]'
  };

  // ============================================================================
  // OVER-THE-AIR (OTA) REMOTE CONFIGURATION SYNC
  // ============================================================================
  function applyRemoteConfig(remote) {
    if (!remote || typeof remote !== 'object') return;
    if (remote.selectors && typeof remote.selectors === 'object') {
      Object.assign(SELECTORS, remote.selectors);
    }
    if (Array.isArray(remote.restrictionKeys) && remote.restrictionKeys.length > 0) {
      RESTRICTION_KEYS = remote.restrictionKeys;
    }
    if (typeof remote.extraCss === 'string' && remote.extraCss.trim()) {
      let styleEl = document.getElementById('sab-remote-css');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'sab-remote-css';
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = remote.extraCss;
    }
  }

  try {
    const rawCached = localStorage.getItem('sab_remote_config_v1');
    if (rawCached) {
      applyRemoteConfig(JSON.parse(rawCached));
    }
  } catch (err) {
    console.debug('[SpotifyAdBlocker] Synchronous local remote config read bypassed:', err);
  }

  async function syncRemoteConfig() {
    const primaryUrl = 'https://raw.githubusercontent.com/U-Gaurav187/spotify-add-blocker/main/remote-config.json';
    const fallbackUrl = 'https://raw.githubusercontent.com/U-Gaurav187/spotify-add-blocker/master/remote-config.json';

    async function fetchConfig(url) {
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }

    try {
      let data = null;
      try {
        data = await fetchConfig(primaryUrl);
      } catch (ePrimary) {
        data = await fetchConfig(fallbackUrl);
      }

      if (data && typeof data === 'object' && data.selectors) {
        applyRemoteConfig(data);
        localStorage.setItem('sab_remote_config_v1', JSON.stringify(data));
      }
    } catch (err) {
      console.debug('[SpotifyAdBlocker] Asynchronous remote config sync bypassed:', err);
    }
  }

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => syncRemoteConfig());
  } else {
    setTimeout(syncRemoteConfig, 1000);
  }

  const trackedMedia = new Set();
  let isAdCurrentlyPlaying = false;
  let userVolumeBeforeAd = 1;
  let userMutedBeforeAd = false;
  let lastLoggedAdId = null;

  let customQueue = [];
  let playHistory = [];
  let isTransitioningQueueTrack = false;
  let lastcapturedTrackInfo = null;
  let pendingContextTrack = null;

  let isInternalMutation = false;
  let observerDebounceTimer = null;
  let controlListenersAttached = false;

  const DRAG_HANDLE_SVG = `
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M2 5h12v1.6H2V5zm0 4.4h12V11H2V9.4z"></path>
    </svg>
  `;

  function safeMutate(fn) {
    isInternalMutation = true;
    try {
      fn();
    } catch (err) {
      console.debug('[SpotifyAdBlocker] Safe mutation caught error:', err);
    } finally {
      Promise.resolve().then(() => {
        isInternalMutation = false;
      });
    }
  }

  let observerExecutionCount = 0;
  let observerLastReset = Date.now();
  let observerInstance = null;
  let circuitBreakerCooldownTimer = null;
  const CIRCUIT_BREAKER_THRESHOLD = 80;

  function handleMutationCircuitBreaker() {
    const now = Date.now();
    if (now - observerLastReset > 1000) {
      observerExecutionCount = 0;
      observerLastReset = now;
    }

    observerExecutionCount++;
    if (observerExecutionCount > CIRCUIT_BREAKER_THRESHOLD) {
      if (observerInstance) observerInstance.disconnect();
      if (observerDebounceTimer) {
        clearTimeout(observerDebounceTimer);
        observerDebounceTimer = null;
      }

      clearTimeout(circuitBreakerCooldownTimer);
      circuitBreakerCooldownTimer = setTimeout(() => {
        observerExecutionCount = 0;
        observerLastReset = Date.now();
        startObserver();
        evaluateAdState(true);
      }, 3000);

      return false;
    }

    return true;
  }

  let config = {
    muteAds: true,
    fastForwardAds: true,
    hideBanners: true,
    unlockControls: true,
    customQueueEnabled: true
  };

  try {
    const savedQueue = localStorage.getItem('sab_custom_queue_v3');
    if (savedQueue) {
      customQueue = JSON.parse(savedQueue) || [];
    }
  } catch (_) {}

  function saveCustomQueue() {
    try {
      localStorage.setItem('sab_custom_queue_v3', JSON.stringify(customQueue));
    } catch (_) {}
  }

  window.addEventListener('SpotifyAdBlocker:Config', (e) => {
    if (!e.detail) return;
    try {
      const incoming = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      if (incoming && typeof incoming === 'object') {
        config = { ...config, ...incoming };
        if (document.documentElement) {
          document.documentElement.classList.toggle('sab-hide-banners', !!config.hideBanners);
          document.documentElement.classList.toggle('sab-unlock-controls', !!config.unlockControls);
        }
        if (config.unlockControls) {
          safeMutate(() => {
            unlockNativeButtons();
          });
        }
      }
    } catch (_) {}
  });

  window.dispatchEvent(new CustomEvent('SpotifyAdBlocker:Ready'));
  window.dispatchEvent(new CustomEvent('SpotifyAdBlocker:RequestConfig'));

  // ============================================================================
  // 1. STRIP PLAYBACK & QUEUE RESTRICTIONS FROM SPOTIFY STATE PAYLOADS
  // ============================================================================
  let RESTRICTION_KEYS = [
    'disallow_seeking_reasons',
    'disallow_skipping_next_reasons',
    'disallow_skipping_prev_reasons',
    'disallow_peeking_next_reasons',
    'disallow_peeking_prev_reasons',
    'disallow_resuming_reasons',
    'disallow_pausing_reasons',
    'disallow_toggling_repeat_context_reasons',
    'disallow_toggling_repeat_track_reasons',
    'disallow_toggling_shuffle_reasons',
    'disallow_transferring_playback_reasons',
    'disallow_updating_context_reasons',
    'disallow_inserting_into_next_tracks_reasons',
    'disallow_inserting_into_context_tracks_reasons',
    'disallow_reordering_in_next_tracks_reasons',
    'disallow_reordering_in_context_tracks_reasons',
    'disallow_removing_from_next_tracks_reasons',
    'disallow_removing_from_context_tracks_reasons'
  ];

  function stripRestrictionsFromObject(obj, depth = 0, seen = new WeakSet()) {
    if (!config.unlockControls || !obj || typeof obj !== 'object' || depth > 6) {
      return obj;
    }

    if (seen.has(obj)) return obj;
    seen.add(obj);

    if (obj.restrictions && typeof obj.restrictions === 'object') {
      for (const key of RESTRICTION_KEYS) {
        if (key in obj.restrictions) {
          delete obj.restrictions[key];
        }
      }
    }

    if (obj.disallows && typeof obj.disallows === 'object') {
      for (const k of Object.keys(obj.disallows)) {
        obj.disallows[k] = false;
      }
    }

    for (const k of Object.keys(obj)) {
      const val = obj[k];
      if (val && typeof val === 'object') {
        stripRestrictionsFromObject(val, depth + 1, seen);
      }
    }
    return obj;
  }

  const origJSONParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const parsed = origJSONParse.call(this, text, reviver);
    try {
      if (
        config.unlockControls &&
        typeof text === 'string' &&
        (text.includes('restrictions') || text.includes('disallow'))
      ) {
        stripRestrictionsFromObject(parsed);
      }
    } catch (_) {}
    return parsed;
  };

  const origResponseJson = Response.prototype.json;
  Response.prototype.json = async function (...args) {
    const data = await origResponseJson.apply(this, args);
    try {
      if (config.unlockControls && data && typeof data === 'object') {
        stripRestrictionsFromObject(data);
      }
    } catch (_) {}
    return data;
  };

  // ============================================================================
  // 2. CAPTURE IN-MEMORY HTMLMediaElements & AUTO-ADVANCE CUSTOM QUEUE
  // ============================================================================
  function registerMediaElement(el) {
    if (el instanceof HTMLMediaElement && !trackedMedia.has(el)) {
      trackedMedia.add(el);

      el.addEventListener('play', () => {
        setTimeout(() => evaluateAdState(true), 0);
      });
      el.addEventListener('loadedmetadata', () => {
        setTimeout(() => {
          evaluateAdState(true);
          recordCurrentTrackToHistory();
        }, 0);
      });
      el.addEventListener('timeupdate', () => {
        if (isAdCurrentlyPlaying) {
          applyAdMitigation(el);
          return;
        }
        if (
          config.unlockControls &&
          config.customQueueEnabled &&
          customQueue.length > 0 &&
          !isTransitioningQueueTrack &&
          Number.isFinite(el.duration) &&
          el.duration > 5 &&
          el.currentTime >= el.duration - 0.45
        ) {
          playNextFromCustomQueue();
        }
      });
    }
  }

  const origCreateElement = document.createElement;
  document.createElement = function (tagName, options) {
    const el = origCreateElement.call(this, tagName, options);
    try {
      const tag = String(tagName).toLowerCase();
      if (tag === 'audio' || tag === 'video') {
        registerMediaElement(el);
      }
    } catch (_) {}
    return el;
  };

  if (window.Audio) {
    const OrigAudio = window.Audio;
    window.Audio = function (...args) {
      const audio = new OrigAudio(...args);
      try {
        registerMediaElement(audio);
      } catch (_) {}
      return audio;
    };
    window.Audio.prototype = OrigAudio.prototype;
  }

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    try {
      registerMediaElement(this);
    } catch (_) {}
    const playPromise = origPlay.apply(this, args);
    setTimeout(() => {
      try {
        evaluateAdState(true);
      } catch (_) {}
    }, 0);
    return playPromise;
  };

  function getAllMediaElements() {
    document.querySelectorAll('audio, video').forEach(registerMediaElement);
    if (trackedMedia.size > 10) {
      for (const el of trackedMedia) {
        if (el.paused && !el.currentSrc && !document.contains(el)) {
          trackedMedia.delete(el);
        }
      }
    }
    return Array.from(trackedMedia);
  }

  function getActiveMediaElement() {
    const list = getAllMediaElements();
    return (
      list.find((m) => !m.paused && Number.isFinite(m.duration) && m.duration > 0) ||
      list.find((m) => Number.isFinite(m.duration) && m.duration > 0) ||
      list[0] ||
      null
    );
  }

  // ============================================================================
  // 3. CUSTOM QUEUE & NATIVE "NEXT IN QUEUE" ANIMATED DRAG-AND-DROP (=) ENGINE
  // ============================================================================
  function extractTrackFromRow(rowEl) {
    if (!rowEl) return null;

    const trackLink =
      rowEl.querySelector(SELECTORS.trackLink) ||
      rowEl.querySelector('a[href*="/track/"]');

    let href = trackLink ? trackLink.getAttribute('href') : null;
    let trackId = null;
    if (href && href.includes('/track/')) {
      trackId = href.split('/track/')[1].split('?')[0];
    }

    let title = trackLink ? (trackLink.textContent || '').trim() : '';
    let artists = '';

    const artistEls = rowEl.querySelectorAll(SELECTORS.artistLink);
    if (artistEls.length > 0) {
      artists = Array.from(artistEls)
        .map((a) => (a.textContent || '').trim())
        .filter(Boolean)
        .join(', ');
    }

    if (!title) {
      const textLeafs = Array.from(rowEl.querySelectorAll('p, span, div, a'))
        .filter((el) => el.childElementCount === 0 && !el.closest('.sab-drag-handle'))
        .map((el) => (el.textContent || '').trim())
        .filter((t) => t.length > 0 && !/^\d+:\d+$/.test(t));

      if (textLeafs.length > 0) title = textLeafs[0];
      if (!artists && textLeafs.length > 1) artists = textLeafs[1];
    }

    if (!title && !href) return null;

    return {
      id: trackId || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || 'Unknown Song',
      artist: artists || '',
      href: href || null
    };
  }

  function recordCurrentTrackToHistory() {
    if (isAdCurrentlyPlaying) return;
    const nowPlayingLink = document.querySelector(SELECTORS.nowPlayingTitle);
    const titleEl = document.querySelector(SELECTORS.nowPlayingTitle);
    const artistEl = document.querySelector(SELECTORS.nowPlayingArtist);

    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    const artist = artistEl ? (artistEl.textContent || '').trim() : '';
    const href = nowPlayingLink ? nowPlayingLink.getAttribute('href') : null;

    if (!title || title.toLowerCase() === 'advertisement') return;

    const currentInfo = {
      id: href || title,
      title,
      artist,
      href
    };

    if (!lastcapturedTrackInfo || lastcapturedTrackInfo.title !== currentInfo.title) {
      if (lastcapturedTrackInfo) {
        playHistory.push(lastcapturedTrackInfo);
        if (playHistory.length > 30) playHistory.shift();
      }
      lastcapturedTrackInfo = currentInfo;
    }
  }

  function getNativeQueueRowsInfo() {
    const candidates = document.querySelectorAll('h1, h2, h3, h4, span, div, p');
    let nextHeading = null;

    for (const el of candidates) {
      if (el.childElementCount === 0) {
        const txt = (el.textContent || '').trim().toLowerCase();
        if (txt === 'next in queue') {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            nextHeading = el;
            break;
          }
        }
      }
    }

    if (!nextHeading) return null;

    const headingRect = nextHeading.getBoundingClientRect();
    let queuePanel =
      nextHeading.closest('aside') ||
      nextHeading.closest('[id*="Panel" i]') ||
      nextHeading.closest('[data-testid*="panel" i]');

    if (!queuePanel) {
      let anc = nextHeading.parentElement;
      while (anc && anc !== document.body) {
        const r = anc.getBoundingClientRect();
        if (r.height > 220 && anc.querySelectorAll('img').length >= 1) {
          queuePanel = anc;
          break;
        }
        anc = anc.parentElement;
      }
    }

    if (!queuePanel) return null;

    const imgs = Array.from(queuePanel.querySelectorAll('img')).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.top > headingRect.bottom - 4 && r.width >= 24 && r.width <= 80;
    });

    const rowEntries = [];
    const seenInnerRows = new Set();

    for (const img of imgs) {
      let cur = img.parentElement;
      let innerRow = null;

      while (cur && cur !== queuePanel && cur !== document.body) {
        const r = cur.getBoundingClientRect();
        const imgCount = cur.querySelectorAll('img').length;
        if (imgCount === 1 && r.width >= 140 && r.height >= 36 && r.height <= 96) {
          innerRow = cur;
          break;
        }
        cur = cur.parentElement;
      }

      if (!innerRow || seenInnerRows.has(innerRow)) continue;
      seenInnerRows.add(innerRow);

      let movableRow = innerRow;
      while (
        movableRow.parentElement &&
        movableRow.parentElement !== queuePanel &&
        movableRow.parentElement.querySelectorAll('img').length === 1 &&
        movableRow.parentElement.getBoundingClientRect().height <= 105
      ) {
        movableRow = movableRow.parentElement;
      }

      rowEntries.push({ innerRow, movableRow });
    }

    return { nextHeading, headingRect, queuePanel, rowEntries };
  }

  // Smooth FLIP + Live Cursor Tracking Drag-and-Drop in Spotify's "Next in queue"
  function enhanceNativeQueuePanel() {
    if (!config.customQueueEnabled) return;
    const info = getNativeQueueRowsInfo();
    if (!info || info.rowEntries.length === 0) return;

    const { headingRect, rowEntries } = info;

    rowEntries.forEach(({ innerRow, movableRow }) => {
      if (innerRow.querySelector('.sab-native-queue-drag')) return;

      const computedPos = window.getComputedStyle(innerRow).position;
      if (computedPos === 'static') {
        innerRow.style.position = 'relative';
      }
      innerRow.style.paddingLeft = '28px';
      movableRow.classList.add('sab-queue-row-animated');

      const handle = document.createElement('span');
      handle.className = 'sab-drag-handle sab-native-queue-drag';
      handle.title = 'Click and drag (=) to reorder queue';
      handle.innerHTML = DRAG_HANDLE_SVG;

      innerRow.appendChild(handle);

      function startDragSession(clientY, isTouchEvent) {
        const container = movableRow.parentElement;
        if (!container) return;

        const initialRect = movableRow.getBoundingClientRect();
        const grabOffsetWithinRow = clientY - initialRect.top;
        let currentTranslateY = 0;

        innerRow.classList.remove('sab-drop-settled');
        innerRow.classList.add('sab-dragging');
        movableRow.style.transition = 'none';
        movableRow.style.zIndex = '999';
        movableRow.style.transform = 'translate3d(0, 0px, 0) scale(1.02)';

        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';

        const processMove = (currentClientY) => {
          const currentInfo = getNativeQueueRowsInfo();
          if (!currentInfo) return;

          const siblings = currentInfo.rowEntries
            .map((entry) => entry.movableRow)
            .filter((el) => el.parentElement === container);

          // 1. Check if cursor / touch crossed over a non-animating sibling row
          const targetSibling = siblings.find((sib) => {
            if (sib === movableRow || sib.dataset.sabFlipping === 'true') return false;
            const r = sib.getBoundingClientRect();
            return currentClientY >= r.top && currentClientY <= r.bottom;
          });

          if (targetSibling) {
            const targetRect = targetSibling.getBoundingClientRect();
            const midY = targetRect.top + targetRect.height / 2;
            const shouldInsertBefore = currentClientY < midY;

            const alreadyInPosition = shouldInsertBefore
              ? movableRow.nextElementSibling === targetSibling
              : targetSibling.nextElementSibling === movableRow;

            if (!alreadyInPosition) {
              // FLIP Step 1 (FIRST): Record current top positions of all other rows
              const firstPositions = new Map();
              siblings.forEach((sib) => {
                if (sib !== movableRow) {
                  firstPositions.set(sib, sib.getBoundingClientRect().top);
                }
              });

              // FLIP Step 2 (LAST): Swap DOM nodes
              safeMutate(() => {
                if (shouldInsertBefore) {
                  container.insertBefore(movableRow, targetSibling);
                } else {
                  container.insertBefore(movableRow, targetSibling.nextSibling);
                }
              });

              // FLIP Step 3 & 4 (INVERT & PLAY): Smoothly glide displaced sibling rows
              siblings.forEach((sib) => {
                if (sib === movableRow) return;
                const firstTop = firstPositions.get(sib);
                if (firstTop === undefined) return;
                const lastTop = sib.getBoundingClientRect().top;
                const deltaY = firstTop - lastTop;

                if (Math.abs(deltaY) > 1) {
                  sib.dataset.sabFlipping = 'true';
                  sib.style.transition = 'none';
                  sib.style.transform = `translate3d(0, ${deltaY}px, 0)`;

                  // Force reflow so browser registers inverted start state
                  void sib.offsetHeight;

                  sib.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
                  sib.style.transform = 'translate3d(0, 0, 0)';

                  clearTimeout(sib._sabFlipTimer);
                  sib._sabFlipTimer = setTimeout(() => {
                    sib.style.transition = '';
                    sib.style.transform = '';
                    delete sib.dataset.sabFlipping;
                  }, 225);
                }
              });
            }
          }

          // 2. Keep the dragged card smoothly locked under the cursor / finger
          const layoutTop = movableRow.getBoundingClientRect().top - currentTranslateY;
          const desiredVisualTop = currentClientY - grabOffsetWithinRow;
          currentTranslateY = desiredVisualTop - layoutTop;

          movableRow.style.transition = 'none';
          movableRow.style.transform = `translate3d(0, ${currentTranslateY}px, 0) scale(1.02)`;
        };

        const endDragSession = () => {
          if (!isTouchEvent) {
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
          } else {
            document.removeEventListener('touchmove', onTouchMove, { capture: true, passive: false });
            document.removeEventListener('touchend', onTouchEnd, true);
            document.removeEventListener('touchcancel', onTouchEnd, true);
          }

          document.body.style.userSelect = '';
          document.body.style.cursor = '';

          // Smoothly animate the dragged card settling into its final slot
          movableRow.style.transition = 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1)';
          movableRow.style.transform = 'translate3d(0, 0, 0) scale(1)';

          setTimeout(() => {
            innerRow.classList.remove('sab-dragging');
            innerRow.classList.add('sab-drop-settled');
            movableRow.style.transition = '';
            movableRow.style.transform = '';
            movableRow.style.zIndex = '';
            setTimeout(() => innerRow.classList.remove('sab-drop-settled'), 480);
          }, 190);

          // Sync the new visual order of "Next in queue" into customQueue
          const updatedInfo = getNativeQueueRowsInfo();
          if (updatedInfo && updatedInfo.rowEntries.length > 0) {
            const syncedTracks = updatedInfo.rowEntries
              .filter(({ innerRow: r }) => r.getBoundingClientRect().top > headingRect.bottom - 4)
              .map(({ innerRow: r }) => extractTrackFromRow(r))
              .filter(Boolean);

            if (syncedTracks.length > 0) {
              customQueue = syncedTracks;
              saveCustomQueue();
              showStatusToast('Queue order updated');
            }
          }
        };

        const onMouseMove = (moveEvent) => {
          processMove(moveEvent.clientY);
        };

        const onMouseUp = () => {
          endDragSession();
        };

        const onTouchMove = (moveEvent) => {
          if (moveEvent.cancelable) moveEvent.preventDefault();
          if (moveEvent.touches && moveEvent.touches.length > 0) {
            processMove(moveEvent.touches[0].clientY);
          }
        };

        const onTouchEnd = () => {
          endDragSession();
        };

        if (!isTouchEvent) {
          document.addEventListener('mousemove', onMouseMove, true);
          document.addEventListener('mouseup', onMouseUp, true);
        } else {
          document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
          document.addEventListener('touchend', onTouchEnd, true);
          document.addEventListener('touchcancel', onTouchEnd, true);
        }
      }

      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        startDragSession(e.clientY, false);
      });

      handle.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        startDragSession(e.touches[0].clientY, true);
      }, { passive: false });
    });
  }

  function playTrackOnDemand(trackObj) {
    if (!trackObj) return;
    isTransitioningQueueTrack = true;

    const finishTransition = () => {
      setTimeout(() => {
        isTransitioningQueueTrack = false;
      }, 1000);
    };

    // Case 0: Check if the track is sitting right inside Spotify's "Next in queue" sidebar
    const queueInfo = getNativeQueueRowsInfo();
    if (queueInfo && queueInfo.rowEntries.length > 0) {
      for (const { innerRow, movableRow } of queueInfo.rowEntries) {
        const info = extractTrackFromRow(innerRow);
        if (info && info.title.toLowerCase() === trackObj.title.toLowerCase()) {
          const playBtn = innerRow.querySelector('button[aria-label*="Play" i], [data-testid="play-button"], button');
          if (playBtn) {
            playBtn.click();
            safeMutate(() => movableRow.remove());
            finishTransition();
            return;
          }
          innerRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          safeMutate(() => movableRow.remove());
          finishTransition();
          return;
        }
      }
    }

    // Case 1: The track row is currently visible on the main page
    if (trackObj.href) {
      const visibleLink = document.querySelector(`a[href="${CSS.escape(trackObj.href)}"]`);
      if (visibleLink) {
        const row = visibleLink.closest(SELECTORS.trackRow);
        if (row) {
          const playBtn = row.querySelector(SELECTORS.playButton);
          if (playBtn) {
            playBtn.click();
            finishTransition();
            return;
          }
        }
      }
    }

    // Case 2: Match by title in currently visible tracklist rows
    const allRows = document.querySelectorAll(SELECTORS.trackRow);
    for (const row of allRows) {
      const info = extractTrackFromRow(row);
      if (info && info.title.toLowerCase() === trackObj.title.toLowerCase()) {
        const playBtn = row.querySelector(SELECTORS.playButton);
        if (playBtn) {
          playBtn.click();
          finishTransition();
          return;
        }
      }
    }

    // Case 3: Navigate via Spotify's SPA router to the track page and click its Play button
    if (trackObj.href) {
      window.history.pushState({}, '', trackObj.href);
      window.dispatchEvent(new PopStateEvent('popstate'));

      let attempts = 0;
      const pollForActionPlay = setInterval(() => {
        attempts++;
        const mainPlayBtn = document.querySelector(SELECTORS.mainPlayButton);
        if (mainPlayBtn) {
          clearInterval(pollForActionPlay);
          mainPlayBtn.click();
          finishTransition();
        } else if (attempts >= 15) {
          clearInterval(pollForActionPlay);
          finishTransition();
        }
      }, 150);
      return;
    }

    finishTransition();
  }

  function playNextFromCustomQueue() {
    if (customQueue.length === 0) return false;
    const nextTrack = customQueue.shift();
    saveCustomQueue();
    showStatusToast(`Playing from Queue: ${nextTrack.title}`);
    playTrackOnDemand(nextTrack);
    return true;
  }

  function addTrackToCustomQueue(trackObj, playNext = false) {
    if (!trackObj) return;
    if (playNext) {
      customQueue.unshift(trackObj);
    } else {
      customQueue.push(trackObj);
    }
    saveCustomQueue();
    setTimeout(() => {
      safeMutate(() => enhanceNativeQueuePanel());
    }, 250);
  }

  function enhanceTracklistRows() {
    if (!config.unlockControls) return;

    document.querySelectorAll('[data-testid="tracklist-row"]').forEach((row) => {
      if (row.dataset.sabQueueEnhanced !== 'true') {
        row.dataset.sabQueueEnhanced = 'true';
        row.querySelectorAll('button[disabled], [aria-disabled="true"]').forEach((btn) => {
          btn.removeAttribute('disabled');
          btn.setAttribute('aria-disabled', 'false');
        });
      }
    });

    if (config.customQueueEnabled) {
      enhanceNativeQueuePanel();
    }
  }

  // ============================================================================
  // 4. NATIVE SPOTIFY UI BUTTONS
  // ============================================================================
  const NATIVE_CONTROL_SELECTORS = [
    SELECTORS.skipForward,
    SELECTORS.skipBack,
    SELECTORS.shuffleButton,
    SELECTORS.repeatButton,
    SELECTORS.playPauseButton,
    SELECTORS.queueButton,
    SELECTORS.progressBar
  ];

  function unlockNativeButtons() {
    if (!config.unlockControls) return;

    for (const selector of NATIVE_CONTROL_SELECTORS) {
      document.querySelectorAll(selector).forEach((el) => {
        if (el.hasAttribute('disabled')) el.removeAttribute('disabled');
        if (el.getAttribute('aria-disabled') === 'true') el.setAttribute('aria-disabled', 'false');
        el.style.pointerEvents = 'auto';
        el.style.opacity = '1';
      });
    }
    enhanceTracklistRows();
  }

  function showStatusToast(message) {
    if (!document.body) return;
    let toast = document.getElementById('sab-status-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sab-status-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2200);
  }

  function forceSkipForward() {
    const media = getActiveMediaElement();
    if (!media) return;
    try {
      if (Number.isFinite(media.duration) && media.duration > 0.5) {
        media.currentTime = Math.max(0, media.duration - 0.15);
        if (media.paused) {
          media.play().catch(() => {});
        }
      }
    } catch (_) {}
  }

  function forceSkipBack() {
    const media = getActiveMediaElement();
    if (!media) return;
    try {
      if (media.currentTime > 3) {
        media.currentTime = 0;
      } else if (playHistory.length > 0) {
        const prevTrack = playHistory.pop();
        playTrackOnDemand(prevTrack);
      } else {
        media.currentTime = 0;
      }
    } catch (_) {}
  }

  function forceSeekToPercentage(pct) {
    const media = getActiveMediaElement();
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    const clamped = Math.max(0, Math.min(1, pct));
    try {
      media.currentTime = clamped * media.duration;
    } catch (_) {}
  }

  function attachNativeControlListeners() {
    if (controlListenersAttached) return;
    controlListenersAttached = true;

    document.addEventListener(
      'contextmenu',
      (e) => {
        const row = e.target instanceof Element ? e.target.closest(SELECTORS.trackRow) : null;
        if (row) {
          pendingContextTrack = extractTrackFromRow(row);
        }
      },
      true
    );

    document.addEventListener(
      'click',
      (e) => {
        if (!config.unlockControls) return;
        const target = e.target;
        if (!(target instanceof Element)) return;

        const rowForMore = target.closest(SELECTORS.trackRow);
        if (rowForMore && target.closest(SELECTORS.moreButton)) {
          pendingContextTrack = extractTrackFromRow(rowForMore);
        }

        const menuItem = target.closest(SELECTORS.menuItem);
        if (menuItem && config.customQueueEnabled) {
          const text = (menuItem.textContent || '').trim().toLowerCase();
          if (text.includes('add to queue') && pendingContextTrack) {
            addTrackToCustomQueue(pendingContextTrack, false);
            pendingContextTrack = null;
          }
        }

        const clickedText = (target.textContent || '').trim().toLowerCase();
        if (clickedText === 'clear queue') {
          customQueue = [];
          saveCustomQueue();
        }

        const queueBtn = target.closest(SELECTORS.queueButton);
        if (queueBtn && config.customQueueEnabled) {
          setTimeout(() => safeMutate(() => enhanceNativeQueuePanel()), 200);
          setTimeout(() => safeMutate(() => enhanceNativeQueuePanel()), 500);
        }

        const nextBtn = target.closest(SELECTORS.skipForward);
        if (nextBtn) {
          if (isAdCurrentlyPlaying) {
            forceSkipForward();
            return;
          }

          if (config.customQueueEnabled && customQueue.length > 0) {
            e.stopPropagation();
            e.preventDefault();
            playNextFromCustomQueue();
            return;
          }

          const mediaBefore = getActiveMediaElement();
          const srcBefore = mediaBefore ? mediaBefore.currentSrc : null;
          const timeBefore = mediaBefore ? mediaBefore.currentTime : 0;

          setTimeout(() => {
            const mediaAfter = getActiveMediaElement();
            if (
              mediaAfter &&
              mediaAfter.currentSrc === srcBefore &&
              Math.abs(mediaAfter.currentTime - timeBefore) < 0.6 &&
              timeBefore > 1.0
            ) {
              forceSkipForward();
            }
          }, 160);
          return;
        }

        const prevBtn = target.closest(SELECTORS.skipBack);
        if (prevBtn) {
          const mediaBefore = getActiveMediaElement();
          const timeBefore = mediaBefore ? mediaBefore.currentTime : 0;

          setTimeout(() => {
            const mediaAfter = getActiveMediaElement();
            if (mediaAfter && Math.abs(mediaAfter.currentTime - timeBefore) < 0.6) {
              forceSkipBack();
            }
          }, 160);
          return;
        }
      },
      true
    );

    const handleProgressBarSeek = (e) => {
      if (!config.unlockControls) return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      const progressBar = target.closest(SELECTORS.progressBar);
      if (!progressBar) return;

      const rect = progressBar.getBoundingClientRect();
      if (rect.width <= 0) return;

      const pct = (e.clientX - rect.left) / rect.width;
      const mediaBefore = getActiveMediaElement();
      if (!mediaBefore || !Number.isFinite(mediaBefore.duration)) return;

      const expectedTime = Math.max(0, Math.min(1, pct)) * mediaBefore.duration;

      setTimeout(() => {
        const mediaAfter = getActiveMediaElement();
        if (mediaAfter && Math.abs(mediaAfter.currentTime - expectedTime) > 2.0) {
          forceSeekToPercentage(pct);
        }
      }, 70);
    };

    document.addEventListener('mousedown', handleProgressBarSeek, true);
    document.addEventListener('click', handleProgressBarSeek, true);
  }

  // ============================================================================
  // 5. AD DETECTION & MITIGATION
  // ============================================================================
  function detectAd() {
    if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
      const meta = navigator.mediaSession.metadata;
      const title = (meta.title || '').trim().toLowerCase();
      const artist = (meta.artist || '').trim().toLowerCase();
      if (title === 'advertisement' || title === 'spotify' || artist === 'advertisement') {
        return { isAd: true, label: meta.title || 'Advertisement' };
      }
    }

    const docTitle = (document.title || '').toLowerCase();
    if (docTitle.startsWith('advertisement')) {
      return { isAd: true, label: 'Advertisement' };
    }

    const nowPlayingWidget = document.querySelector(SELECTORS.nowPlayingWidget);
    if (nowPlayingWidget) {
      const ariaLabel = (nowPlayingWidget.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('advertisement')) {
        return { isAd: true, label: 'Advertisement' };
      }
      const adLink = nowPlayingWidget.querySelector(SELECTORS.adLink);
      if (adLink) {
        return { isAd: true, label: adLink.textContent || 'Advertisement' };
      }
    }

    const trackTitleEl = document.querySelector(SELECTORS.nowPlayingTitle);
    if (trackTitleEl) {
      const text = (trackTitleEl.textContent || '').trim().toLowerCase();
      if (text === 'advertisement' || text === 'sponsored') {
        return { isAd: true, label: trackTitleEl.textContent.trim() };
      }
    }

    const adTitleEl = document.querySelector(SELECTORS.adTitle);
    if (adTitleEl) {
      return { isAd: true, label: adTitleEl.textContent.trim() || 'Advertisement' };
    }

    return { isAd: false, label: null };
  }

  function applyAdMitigation(mediaEl) {
    if (!mediaEl) return;

    if (config.muteAds) {
      mediaEl.muted = true;
    }

    if (config.fastForwardAds) {
      try {
        if (mediaEl.playbackRate < 8) {
          mediaEl.playbackRate = 8.0;
        }
        if (
          Number.isFinite(mediaEl.duration) &&
          mediaEl.duration > 1 &&
          mediaEl.duration <= 120 &&
          mediaEl.currentTime < mediaEl.duration - 0.35
        ) {
          mediaEl.currentTime = Math.max(0, mediaEl.duration - 0.25);
        }
      } catch (_) {}
    }
  }

  function restoreNormalPlayback(mediaEl) {
    if (!mediaEl) return;
    if (config.muteAds) {
      mediaEl.muted = userMutedBeforeAd;
      mediaEl.volume = userVolumeBeforeAd;
    }
    if (mediaEl.playbackRate > 2) {
      mediaEl.playbackRate = 1.0;
    }
  }

  function evaluateAdState(shouldScanDom = true) {
    if (shouldScanDom) {
      safeMutate(() => {
        unlockNativeButtons();
      });
    }

    const { isAd, label } = detectAd();
    const mediaList = getAllMediaElements();

    if (isAd) {
      if (!isAdCurrentlyPlaying) {
        isAdCurrentlyPlaying = true;
        const activeMedia = mediaList.find((m) => !m.paused) || mediaList[0];
        if (activeMedia) {
          userMutedBeforeAd = activeMedia.muted;
          userVolumeBeforeAd = activeMedia.volume;
        }

        const adSignature = `${label}-${Math.floor(Date.now() / 5000)}`;
        if (adSignature !== lastLoggedAdId) {
          lastLoggedAdId = adSignature;
          window.dispatchEvent(
            new CustomEvent('SpotifyAdBlocker:AdHandled', {
              detail: JSON.stringify({ label: label || 'Advertisement', timestamp: Date.now() })
            })
          );
        }
      }

      mediaList.forEach(applyAdMitigation);
    } else if (isAdCurrentlyPlaying) {
      isAdCurrentlyPlaying = false;
      mediaList.forEach(restoreNormalPlayback);
    }
  }

  // ============================================================================
  // 6. SAFE OBSERVER & DOM LIFECYCLE MANAGEMENT
  // ============================================================================
  function startObserver() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
      } else {
        requestAnimationFrame(startObserver);
      }
      return;
    }

    attachNativeControlListeners();

    const observer = new MutationObserver((mutations) => {
      if (isInternalMutation) return;
      if (!handleMutationCircuitBreaker()) return;

      let hasRelevantChanges = false;
      for (const m of mutations) {
        const target = m.target;
        if (target instanceof Element) {
          if (
            target.id === 'sab-status-toast' ||
            target.classList.contains('sab-drag-handle') ||
            target.closest('#sab-status-toast') ||
            target.closest('.sab-drag-handle')
          ) {
            continue;
          }
        }
        hasRelevantChanges = true;
        break;
      }

      if (!hasRelevantChanges) return;

      if (observerDebounceTimer) {
        clearTimeout(observerDebounceTimer);
      }
      observerDebounceTimer = setTimeout(() => {
        observerDebounceTimer = null;
        evaluateAdState(true);
      }, 250);
    });

    observerInstance = observer;

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'href', 'disabled', 'aria-disabled']
    });
  }

  startObserver();

  setInterval(() => {
    if (config.customQueueEnabled) {
      safeMutate(() => enhanceNativeQueuePanel());
    }
    if (isAdCurrentlyPlaying || (trackedMedia.size > 0 && Array.from(trackedMedia).some((m) => !m.paused))) {
      evaluateAdState(false);
    }
  }, 1000);
})();
