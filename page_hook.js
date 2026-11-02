(() => {
  'use strict';

  // Prevent multiple injections if injected dynamically and via manifest
  if (window.__sab_hook_installed) return;
  window.__sab_hook_installed = true;

  // ============================================================================
  // PRACTICE 1: Centralized Selectors with Resilient Fallbacks
  // ============================================================================
  const SELECTORS = {
    // Track row and links inside playlists/albums
    trackRow: '[data-testid="tracklist-row"]',
    trackLink: 'a[data-testid="internal-track-link"], a[href*="/track/"]',
    trackTitleInRow: '[data-testid="tracklist-row"] div[dir="auto"], [data-testid="internal-track-link"]',
    artistLink: 'a[href*="/artist/"]',

    // Bottom playback bar controls
    queueButton: '[data-testid="control-button-queue"], button[aria-label*="Queue" i]',
    skipForward: '[data-testid="control-button-skip-forward"], button[aria-label*="Next" i]',
    skipBack: '[data-testid="control-button-skip-back"], button[aria-label*="Previous" i]',
    shuffleButton: '[data-testid="control-button-shuffle"], button[aria-label*="Shuffle" i]',
    repeatButton: '[data-testid="control-button-repeat"], button[aria-label*="Repeat" i]',
    playPauseButton: '[data-testid="control-button-playpause"], button[aria-label*="Play" i], button[aria-label*="Pause" i]',
    progressBar: '[data-testid="playback-progressbar"], [data-testid="progress-bar"], [role="slider"][aria-label*="progress" i]',

    // Play action buttons
    playButton: '[data-testid="play-button"], button[aria-label*="Play" i]',
    mainPlayButton: '[data-testid="action-bar-row"] [data-testid="play-button"], main [data-testid="play-button"], [data-testid="play-button"]',

    // Context & Menus
    moreButton: '[data-testid="more-button"], button[aria-haspopup="menu"]',
    menuItem: '[role="menuitem"], button[role="menuitem"]',

    // Now Playing Widget
    nowPlayingWidget: '[data-testid="now-playing-widget"]',
    nowPlayingTitle: '[data-testid="context-item-info-title"], [data-testid="now-playing-widget"] a[href*="/track/"]',
    nowPlayingArtist: '[data-testid="context-item-info-subtitles"], [data-testid="context-item-info-artists"]',

    // Ad banners & containers
    adSlotContainer: '[data-testid="ad-slot-container"]',
    leaderboardAd: '[data-testid="leaderboard-ad"]',
    billboardAd: '[data-testid="billboard-ad"]',
    displayAd: '[data-testid="DisplayAd"]',
    adLink: 'a[href*="/ad/"], a[data-testid="context-item-info-ad-title"]',
    adTitle: '[data-testid="context-item-info-ad-title"], [data-testid="ad-info-title"]'
  };

  const trackedMedia = new Set();
  let isAdCurrentlyPlaying = false;
  let userVolumeBeforeAd = 1;
  let userMutedBeforeAd = false;
  let lastLoggedAdId = null;

  // Custom Queue & Track History state
  let customQueue = [];
  let playHistory = [];
  let isTransitioningQueueTrack = false;
  let lastcapturedTrackInfo = null;
  let pendingContextTrack = null;

  // Internal mutation & debounce guards to prevent observer feedback loops
  let isInternalMutation = false;
  let observerDebounceTimer = null;
  let controlListenersAttached = false;

  // Safe HTML string escape helper
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================================
  // PRACTICE 2: Fail-Open Wrapper Pattern
  // Never let an extension hook block or crash the native browser/page function.
  // ============================================================================
  function safeWrap(originalFn, customLogic) {
    return function (...args) {
      try {
        customLogic.apply(this, args);
      } catch (err) {
        console.debug('[SpotifyAdBlocker] Hook bypassed due to host update:', err);
      }
      return originalFn.apply(this, args);
    };
  }

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

  // ============================================================================
  // PRACTICE 3: Circuit Breaker for Infinite Loops & High-Frequency DOM Changes
  // ============================================================================
  let observerExecutionCount = 0;
  let observerLastReset = Date.now();
  let observerInstance = null;
  let circuitBreakerCooldownTimer = null;
  const CIRCUIT_BREAKER_THRESHOLD = 40; // Max fires per second before tripping

  function handleMutationCircuitBreaker() {
    const now = Date.now();
    if (now - observerLastReset > 1000) {
      observerExecutionCount = 0;
      observerLastReset = now;
    }

    observerExecutionCount++;
    if (observerExecutionCount > CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(
        '[SpotifyAdBlocker] High-frequency DOM changes detected (>40/sec). Pausing observer to prevent browser freeze.'
      );
      if (observerInstance) {
        observerInstance.disconnect();
      }
      if (observerDebounceTimer) {
        clearTimeout(observerDebounceTimer);
        observerDebounceTimer = null;
      }

      // Cool down for 5 seconds, then safely re-arm the observer
      clearTimeout(circuitBreakerCooldownTimer);
      circuitBreakerCooldownTimer = setTimeout(() => {
        observerExecutionCount = 0;
        observerLastReset = Date.now();
        console.info('[SpotifyAdBlocker] Cooldown complete. Re-arming MutationObserver.');
        startObserver();
      }, 5000);

      return false; // Tripped circuit breaker
    }

    return true; // Healthy
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
    safeMutate(() => {
      renderCustomQueueDrawer();
      updateNativeQueueBadge();
    });
  }

  // Cross-world handshake: listen for configuration updates safely handling stringified JSON
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
        renderCustomQueueDrawer();
      }
    } catch (_) {}
  });

  // Signal readiness to content script and request active config
  window.dispatchEvent(new CustomEvent('SpotifyAdBlocker:Ready'));
  window.dispatchEvent(new CustomEvent('SpotifyAdBlocker:RequestConfig'));

  // ============================================================================
  // 1. STRIP PLAYBACK & QUEUE RESTRICTIONS FROM SPOTIFY STATE PAYLOADS
  // ============================================================================
  const RESTRICTION_KEYS = [
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

  // Hook JSON.parse with Fail-Open design
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
    } catch (err) {
      console.debug('[SpotifyAdBlocker] JSON.parse hook bypassed:', err);
    }
    return parsed;
  };

  // Hook Response.prototype.json with Fail-Open design
  const origResponseJson = Response.prototype.json;
  Response.prototype.json = async function (...args) {
    const data = await origResponseJson.apply(this, args);
    try {
      if (config.unlockControls && data && typeof data === 'object') {
        stripRestrictionsFromObject(data);
      }
    } catch (err) {
      console.debug('[SpotifyAdBlocker] Response.json hook bypassed:', err);
    }
    return data;
  };

  // ============================================================================
  // 2. CAPTURE IN-MEMORY HTMLMediaElements & AUTO-ADVANCE CUSTOM QUEUE
  // ============================================================================
  function registerMediaElement(el) {
    if (el instanceof HTMLMediaElement && !trackedMedia.has(el)) {
      trackedMedia.add(el);

      // Async evaluation prevents interfering with browser DRM / MediaKey negotiations
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
        // Check if current track is about to finish (within 0.45s of end) and custom queue has items
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

  // Hook document.createElement with Fail-Open design
  const origCreateElement = document.createElement;
  document.createElement = function (tagName, options) {
    const el = origCreateElement.call(this, tagName, options);
    try {
      const tag = String(tagName).toLowerCase();
      if (tag === 'audio' || tag === 'video') {
        registerMediaElement(el);
      }
    } catch (err) {
      console.debug('[SpotifyAdBlocker] createElement hook bypassed:', err);
    }
    return el;
  };

  // Hook window.Audio with Fail-Open design
  if (window.Audio) {
    const OrigAudio = window.Audio;
    window.Audio = function (...args) {
      const audio = new OrigAudio(...args);
      try {
        registerMediaElement(audio);
      } catch (err) {
        console.debug('[SpotifyAdBlocker] Audio hook bypassed:', err);
      }
      return audio;
    };
    window.Audio.prototype = OrigAudio.prototype;
  }

  // Hook HTMLMediaElement.prototype.play with Fail-Open design
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    try {
      registerMediaElement(this);
    } catch (err) {
      console.debug('[SpotifyAdBlocker] Media registration bypassed:', err);
    }
    const playPromise = origPlay.apply(this, args);
    setTimeout(() => {
      try {
        evaluateAdState(true);
      } catch (err) {
        console.debug('[SpotifyAdBlocker] Ad evaluation bypassed:', err);
      }
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
  // 3. CUSTOM QUEUE & ON-DEMAND SONG PLAYBACK ENGINE
  // ============================================================================
  function extractTrackFromRow(rowEl) {
    if (!rowEl) return null;

    // Look for track anchor link inside the row using centralized selectors
    const trackLink =
      rowEl.querySelector(SELECTORS.trackLink) ||
      rowEl.querySelector('a[href*="/track/"]');

    const titleEl =
      trackLink ||
      rowEl.querySelector(SELECTORS.trackTitleInRow);

    const artistEls = rowEl.querySelectorAll(SELECTORS.artistLink);
    const artists = Array.from(artistEls)
      .map((a) => (a.textContent || '').trim())
      .filter(Boolean)
      .join(', ');

    let href = trackLink ? trackLink.getAttribute('href') : null;
    let trackId = null;
    if (href && href.includes('/track/')) {
      trackId = href.split('/track/')[1].split('?')[0];
    }

    const title = titleEl ? (titleEl.textContent || '').trim() : 'Selected Track';
    if (!title && !href) return null;

    return {
      id: trackId || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || 'Unknown Song',
      artist: artists || 'Spotify Artist',
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

    if (
      !lastcapturedTrackInfo ||
      lastcapturedTrackInfo.title !== currentInfo.title
    ) {
      if (lastcapturedTrackInfo) {
        playHistory.push(lastcapturedTrackInfo);
        if (playHistory.length > 30) playHistory.shift();
      }
      lastcapturedTrackInfo = currentInfo;
    }
  }

  // Play any track object on demand using DOM match or SPA navigation + native play trigger
  function playTrackOnDemand(trackObj) {
    if (!trackObj) return;
    isTransitioningQueueTrack = true;

    const finishTransition = () => {
      setTimeout(() => {
        isTransitioningQueueTrack = false;
      }, 1000);
    };

    // Case 1: The track row is currently visible on the page (safely escaped CSS query)
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

    // Case 3: Navigate via Spotify's SPA router (history.pushState) to the track page and click its primary Play button
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
    showStatusToast(`Added to Queue: ${trackObj.title}`);
  }

  const DRAG_HANDLE_SVG = `
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M2 5.5h12v1.5H2V5.5zm0 3.5h12v1.5H2V9z"></path>
    </svg>
  `;

  // Unlock disabled buttons in track rows & attach (=) drag handles inside Spotify's "Next in queue" panel
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

  // Adds the two-horizontal-lines (=) click-and-drag handle directly to Spotify's "Next in queue" sidebar
  function enhanceNativeQueuePanel() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, div, span')).filter(
      (el) => el.childElementCount === 0 && (el.textContent || '').trim().toLowerCase() === 'next in queue'
    );
    if (headings.length === 0) return;

    const queuePanel =
      headings[0].closest('aside') ||
      headings[0].closest('[id*="Panel" i]') ||
      headings[0].parentElement?.parentElement?.parentElement;
    if (!queuePanel) return;

    const rows = Array.from(queuePanel.querySelectorAll('[data-testid="tracklist-row"]'));
    // Skip the first row if it sits under "Now playing" above "Next in queue"
    const nextInQueueHeadingTop = headings[0].getBoundingClientRect().top;
    const queueRows = rows.filter((r) => r.getBoundingClientRect().top > nextInQueueHeadingTop);

    queueRows.forEach((row) => {
      if (row.querySelector('.sab-native-queue-drag')) return;

      const handle = document.createElement('span');
      handle.className = 'sab-drag-handle sab-native-queue-drag';
      handle.title = 'Click and drag to reorder queue';
      handle.innerHTML = DRAG_HANDLE_SVG;

      const firstCell = row.firstElementChild || row;
      firstCell.insertBefore(handle, firstCell.firstChild);

      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const rowWrapper = row.closest('[role="row"]') || row;
        const container = rowWrapper.parentElement;
        if (!container) return;

        row.classList.add('sab-dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';

        const onMouseMove = (moveEvent) => {
          const allWrappers = Array.from(container.children).filter((el) => {
            const innerRow = el.matches('[data-testid="tracklist-row"]')
              ? el
              : el.querySelector('[data-testid="tracklist-row"]');
            return innerRow && innerRow.getBoundingClientRect().top > nextInQueueHeadingTop;
          });

          const targetSibling = allWrappers.find((sib) => {
            if (sib === rowWrapper) return false;
            const r = sib.getBoundingClientRect();
            return moveEvent.clientY >= r.top && moveEvent.clientY <= r.bottom;
          });

          if (targetSibling) {
            const r = targetSibling.getBoundingClientRect();
            const midY = r.top + r.height / 2;
            if (moveEvent.clientY < midY) {
              container.insertBefore(rowWrapper, targetSibling);
            } else {
              container.insertBefore(rowWrapper, targetSibling.nextSibling);
            }
          }
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove, true);
          document.removeEventListener('mouseup', onMouseUp, true);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
          row.classList.remove('sab-dragging');

          // Sync the new visual order of "Next in queue" into customQueue
          const updatedRows = Array.from(queuePanel.querySelectorAll('[data-testid="tracklist-row"]')).filter(
            (r) => r.getBoundingClientRect().top > nextInQueueHeadingTop
          );
          const syncedTracks = updatedRows.map(extractTrackFromRow).filter(Boolean);
          if (syncedTracks.length > 0) {
            customQueue = syncedTracks;
            saveCustomQueue();
          }
        };

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
      });
    });
  }

  // Click-and-drag reordering for the Custom Queue Drawer using the (=) handle
  function enableDrawerDragAndDrop(listEl) {
    if (!listEl) return;
    let draggedItem = null;

    listEl.querySelectorAll('.sab-drag-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const item = handle.closest('.sab-q-item');
        if (!item) return;

        e.preventDefault();
        e.stopPropagation();

        draggedItem = item;
        draggedItem.classList.add('sab-dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';

        const onMouseMove = (moveEvent) => {
          if (!draggedItem) return;
          const siblings = Array.from(listEl.querySelectorAll('.sab-q-item'));
          const targetSibling = siblings.find((sib) => {
            if (sib === draggedItem) return false;
            const r = sib.getBoundingClientRect();
            return moveEvent.clientY >= r.top && moveEvent.clientY <= r.bottom;
          });

          if (targetSibling) {
            const r = targetSibling.getBoundingClientRect();
            const midY = r.top + r.height / 2;
            if (moveEvent.clientY < midY) {
              listEl.insertBefore(draggedItem, targetSibling);
            } else {
              listEl.insertBefore(draggedItem, targetSibling.nextSibling);
            }
          }
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove, true);
          document.removeEventListener('mouseup', onMouseUp, true);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';

          if (!draggedItem) return;
          draggedItem.classList.remove('sab-dragging');

          const newOrderIndices = Array.from(listEl.querySelectorAll('.sab-q-item'))
            .map((el) => parseInt(el.getAttribute('data-idx'), 10))
            .filter((i) => !Number.isNaN(i) && i >= 0 && i < customQueue.length);

          if (newOrderIndices.length === customQueue.length) {
            customQueue = newOrderIndices.map((i) => customQueue[i]);
          }

          draggedItem = null;
          saveCustomQueue();
        };

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
      });
    });
  }

  function renderCustomQueueDrawer() {
    if (!document.body) return;
    const drawer = document.getElementById('sab-custom-queue-drawer');
    if (!drawer) return;

    const prevList = drawer.querySelector('.sab-q-list');
    const prevScrollTop = prevList ? prevList.scrollTop : 0;

    const itemsHtml =
      customQueue.length === 0
        ? `<div class="sab-q-empty">Your custom queue is empty.<br/>Use Spotify's right-click or <b>...</b> menu &rarr; <b>Add to queue</b>.</div>`
        : customQueue
            .map(
              (item, idx) => `
          <div class="sab-q-item" data-idx="${idx}">
            <span class="sab-drag-handle" title="Click and drag to reorder">${DRAG_HANDLE_SVG}</span>
            <div class="sab-q-info" data-action="play" data-idx="${idx}" title="Click to play immediately">
              <span class="sab-q-index">${idx + 1}.</span>
              <div class="sab-q-text">
                <div class="sab-q-title">${escapeHtml(item.title)}</div>
                <div class="sab-q-artist">${escapeHtml(item.artist)}</div>
              </div>
            </div>
            <div class="sab-q-actions">
              <button type="button" data-action="remove" data-idx="${idx}" title="Remove">&times;</button>
            </div>
          </div>`
            )
            .join('');

    drawer.innerHTML = `
      <div class="sab-q-header">
        <div>
          <div class="sab-q-heading">Custom Play Queue (${customQueue.length})</div>
          <div class="sab-q-sub">Drag (=) to reorder &bull; Plays via Next button</div>
        </div>
        <div class="sab-q-header-btns">
          ${customQueue.length > 0 ? '<button type="button" id="sab-q-clear">Clear</button>' : ''}
          <button type="button" id="sab-q-close">&times;</button>
        </div>
      </div>
      <div class="sab-q-list">${itemsHtml}</div>
    `;

    const newList = drawer.querySelector('.sab-q-list');
    if (newList) {
      if (prevScrollTop > 0) newList.scrollTop = prevScrollTop;
      enableDrawerDragAndDrop(newList);
    }

    const closeBtn = drawer.querySelector('#sab-q-close');
    if (closeBtn) closeBtn.onclick = () => toggleCustomQueueDrawer(false);

    const clearBtn = drawer.querySelector('#sab-q-clear');
    if (clearBtn) {
      clearBtn.onclick = () => {
        customQueue = [];
        saveCustomQueue();
      };
    }

    drawer.querySelectorAll('[data-action]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const action = el.getAttribute('data-action');
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        if (Number.isNaN(idx) || idx < 0 || idx >= customQueue.length) return;

        if (action === 'play') {
          const [selected] = customQueue.splice(idx, 1);
          saveCustomQueue();
          playTrackOnDemand(selected);
        } else if (action === 'remove') {
          customQueue.splice(idx, 1);
          saveCustomQueue();
        }
      };
    });
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

  // Bind 100% of controls directly to Spotify's native buttons & context menus
  function attachNativeControlListeners() {
    // Prevent attaching duplicate listeners if the circuit breaker resets
    if (controlListenersAttached) return;
    controlListenersAttached = true;

    // Close Custom Queue Drawer on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleCustomQueueDrawer(false);
      }
    });

    // Track right-click or "..." menu clicks on song rows so we know which song is being queued via native menu
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

        // Close Queue Drawer if clicking anywhere outside the drawer and queue buttons
        const drawer = document.getElementById('sab-custom-queue-drawer');
        if (
          drawer &&
          drawer.classList.contains('open') &&
          !target.closest('#sab-custom-queue-drawer') &&
          !target.closest(SELECTORS.queueButton) &&
          !target.closest('.sab-row-queue-btn')
        ) {
          toggleCustomQueueDrawer(false);
        }

        // Track "..." more button on a track row
        const rowForMore = target.closest(SELECTORS.trackRow);
        if (rowForMore && target.closest(SELECTORS.moreButton)) {
          pendingContextTrack = extractTrackFromRow(rowForMore);
        }

        // 0. Native "Add to queue" context-menu item
        const menuItem = target.closest(SELECTORS.menuItem);
        if (menuItem && config.customQueueEnabled) {
          const text = (menuItem.textContent || '').trim().toLowerCase();
          if (text.includes('add to queue') && pendingContextTrack) {
            addTrackToCustomQueue(pendingContextTrack, false);
            pendingContextTrack = null;
          }
        }

        // 1. Native Queue Button in bottom player bar -> Toggles Custom Queue Manager alongside native queue
        const queueBtn = target.closest(SELECTORS.queueButton);
        if (queueBtn && config.customQueueEnabled) {
          toggleCustomQueueDrawer();
        }

        // 2. Native Next / Skip Forward Button
        const nextBtn = target.closest(SELECTORS.skipForward);
        if (nextBtn) {
          if (isAdCurrentlyPlaying) {
            forceSkipForward();
            return;
          }

          // If user has items in their custom queue, play the next queued song immediately!
          if (config.customQueueEnabled && customQueue.length > 0) {
            e.stopPropagation();
            e.preventDefault();
            playNextFromCustomQueue();
            return;
          }

          const mediaBefore = getActiveMediaElement();
          const srcBefore = mediaBefore ? mediaBefore.currentSrc : null;
          const timeBefore = mediaBefore ? mediaBefore.currentTime : 0;

          // Fallback if Spotify's native skip button was ignored due to skip limit
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

        // 3. Native Previous / Skip Back Button
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

    // 4. Native Progress Bar Seeking (Click & Drag directly on Spotify's seek bar)
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

  // evaluateAdState supports shouldScanDom to eliminate unnecessary full-DOM scans during heartbeat ticks
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
  // 6. SAFE OBSERVER & DOM LIFECYCLE MANAGEMENT WITH CIRCUIT BREAKER
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

    // Debounced MutationObserver with isInternalMutation and Circuit Breaker
    const observer = new MutationObserver((mutations) => {
      if (isInternalMutation) return;

      // Practice 3: Circuit breaker check to kill infinite loops immediately
      if (!handleMutationCircuitBreaker()) {
        return;
      }

      // Filter out internal mutations produced by our own UI elements
      let hasRelevantChanges = false;
      for (const m of mutations) {
        const target = m.target;
        if (target instanceof Element) {
          if (
            target.id === 'sab-status-toast' ||
            target.id === 'sab-custom-queue-drawer' ||
            target.classList.contains('sab-row-queue-btn') ||
            target.classList.contains('sab-queue-count-badge') ||
            target.closest('#sab-status-toast') ||
            target.closest('#sab-custom-queue-drawer')
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
      }, 300);
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

  // Low-frequency heartbeat: check media/ad mitigation state without rescanning full DOM
  setInterval(() => {
    if (isAdCurrentlyPlaying || (trackedMedia.size > 0 && Array.from(trackedMedia).some((m) => !m.paused))) {
      evaluateAdState(false);
    }
  }, 1000);
})();
