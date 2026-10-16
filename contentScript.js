"use strict";

(() => {
  const CLICK_INTERVAL_MS = 100;
  const FILES_CONTAINER_POLL_MS = 500;
  const FILES_CONTAINER_POLL_TIMEOUT_MS = 10000;
  const RETRY_SCAN_DELAY_MS = 200;

  let processed = new WeakSet();
  let retryCount = new WeakMap();
  const MAX_RETRIES = 10;
  let clickQueue = [];
  let isProcessingQueue = false;

  let retryScanTimerId = null;
  let drainTimerId = null;

  // ---- Migration ----

  const migrateStorage = (callback) => {
    chrome.storage.sync.get(null, (data) => {
      if (data.schemaVersion >= 1) {
        callback();
        return;
      }
      const migrated = {
        schemaVersion: 1,
        globalPatterns: data.patterns || [],
        repoPatterns: data.repoPatterns || {},
      };
      chrome.storage.sync.remove("patterns", () => {
        chrome.storage.sync.set(migrated, callback);
      });
    });
  };

  // ---- Rule matching ----

  let activePatterns = [];

  const getOwnerRepo = () => {
    const match = location.pathname.match(/^\/([^/]+\/[^/]+)/);
    return match ? match[1] : null;
  };

  const loadPatterns = (callback) => {
    migrateStorage(() => {
      chrome.storage.sync.get({ globalPatterns: [], repoPatterns: {} }, (result) => {
        const ownerRepo = getOwnerRepo();
        const repoSpecific = ownerRepo ? (result.repoPatterns[ownerRepo] || []) : [];
        activePatterns = [...result.globalPatterns, ...repoSpecific];
        if (callback) callback();
      });
    });
  };

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.globalPatterns || changes.repoPatterns) {
      loadPatterns();
    }
  });

  // ---- Click queue (throttled) ----

  const enqueueClick = (el) => {
    clickQueue.push(el);
    if (!isProcessingQueue) drainQueue();
  };

  const drainQueue = () => {
    isProcessingQueue = true;
    const next = clickQueue.shift();
    if (!next) {
      isProcessingQueue = false;
      return;
    }
    try {
      next.click();
    } catch (e) {
      console.debug("[auto-viewed] click failed:", e);
    }
    drainTimerId = setTimeout(drainQueue, CLICK_INTERVAL_MS);
  };

  // ---- Core scan ----

  /**
   * Collect all diff-block elements.
   * New UI: <div role="region" id="diff-…">. Not matched by class because the
   *         CSS-module class names are hashed and have changed before.
   * Legacy: .js-file
   */
  const DIFF_SELECTOR = '[role="region"][id^="diff-"]';

  const getDiffElements = () => {
    // New UI (2025+)
    const newEls = document.querySelectorAll(DIFF_SELECTOR);
    if (newEls.length > 0) return newEls;
    // Legacy UI
    return document.querySelectorAll(".js-file");
  };

  const scanFiles = () => {
    // Cancel any pending retry to debounce
    if (retryScanTimerId !== null) {
      clearTimeout(retryScanTimerId);
      retryScanTimerId = null;
    }

    const fileEls = getDiffElements();

    if (fileEls.length === 0 && isFilesPage()) {
      console.warn(
        "[auto-viewed] No diff containers found on Files page — selectors may be outdated."
      );
      return;
    }

    const { clickTargets, marked, pendingRetry } = AutoViewed.scanFilesLogic(
      fileEls, processed, retryCount, activePatterns, MAX_RETRIES
    );

    for (const toggle of clickTargets) {
      enqueueClick(toggle);
    }

    if (marked > 0) {
      console.debug(`[auto-viewed] Queued ${marked} file(s) to mark as Viewed.`);
    }
    if (pendingRetry) {
      retryScanTimerId = setTimeout(scanFiles, RETRY_SCAN_DELAY_MS);
    }
  };

  // ---- URL helpers ----

  /** Match both legacy /files and new /changes URL. */
  const isFilesPage = () =>
    /\/pull\/\d+\/(files|changes)/.test(location.pathname);

  // ---- MutationObserver ----

  let observer = null;

  /**
   * Find the container that holds all diff blocks and observe it.
   * New UI: the <div class="d-flex flex-column gap-3"> that wraps all diffs,
   *         or fall back to the PageLayout content wrapper.
   * Legacy: #files
   */
  const findDiffListContainer = () => {
    // Legacy
    const legacy = document.getElementById("files");
    if (legacy) return legacy;

    // New UI: find the parent of the first diff block
    const firstDiff = document.querySelector(DIFF_SELECTOR);
    if (firstDiff) {
      // Walk up to the list container (the one with many diff children)
      let parent = firstDiff.parentElement;
      while (parent) {
        if (parent.children.length > 1) return parent;
        parent = parent.parentElement;
      }
    }

    // Fallback: PageLayout content area
    return document.querySelector('[class*="prc-PageLayout-Content-"]');
  };

  const observeFilesContainer = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    const target = findDiffListContainer();
    if (!target) return false;

    observer = new MutationObserver(() => scanFiles());
    observer.observe(target, { childList: true, subtree: true });
    return true;
  };

  // Wait for diff container to appear (lazy-rendered by GitHub)
  const waitForFilesContainer = () => {
    if (observeFilesContainer()) return;

    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += FILES_CONTAINER_POLL_MS;
      if (observeFilesContainer() || elapsed >= FILES_CONTAINER_POLL_TIMEOUT_MS) {
        clearInterval(interval);
        if (elapsed >= FILES_CONTAINER_POLL_TIMEOUT_MS) {
          console.warn("[auto-viewed] Diff container not found within timeout.");
        }
      }
    }, FILES_CONTAINER_POLL_MS);
  };

  // ---- Initialization per page ----

  const init = () => {
    if (!isFilesPage()) return;
    console.debug("[auto-viewed] Activated on", location.href);
    // Cancel pending timers to prevent leaks on SPA navigation
    if (retryScanTimerId !== null) { clearTimeout(retryScanTimerId); retryScanTimerId = null; }
    if (drainTimerId !== null) { clearTimeout(drainTimerId); drainTimerId = null; }
    // Reset all state for SPA navigations
    clickQueue = [];
    isProcessingQueue = false;
    processed = new WeakSet();
    retryCount = new WeakMap();
    loadPatterns(() => {
      scanFiles();
      waitForFilesContainer();
    });
  };

  // ---- SPA navigation support ----

  // GitHub Turbo / pjax (legacy)
  document.addEventListener("turbo:load", () => init());
  document.addEventListener("pjax:end", () => init());

  // New React-based UI uses History API
  let deferredTimerId = null;
  let deferredGeneration = 0;
  const deferredInit = () => {
    if (deferredTimerId) clearTimeout(deferredTimerId);
    if (!isFilesPage()) return;
    const gen = ++deferredGeneration;
    let attempts = 0;
    const maxAttempts = 20; // 100ms * 20 = 2s max
    const tryInit = () => {
      if (gen !== deferredGeneration) return; // stale chain — abort
      attempts++;
      if (getDiffElements().length > 0) {
        init();
        return;
      }
      if (attempts >= maxAttempts) {
        console.debug("[auto-viewed] deferredInit timed out — no diff elements found.");
        return;
      }
      deferredTimerId = setTimeout(tryInit, 100);
    };
    tryInit();
  };

  window.addEventListener("popstate", () => deferredInit());

  // URL polling: MV3 content scripts run in an isolated world, so
  // history.pushState/replaceState interception does NOT reach the main
  // page's JS.  GitHub's new React UI also uses the Navigation API which
  // bypasses pushState entirely.  Polling the URL is the most reliable
  // cross-world detection method.
  let lastUrl = location.href;
  let urlPollTimerId = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      deferredInit();
    }
  }, 300);

  // Initial run
  init();
})();
