"use strict";

(() => {
  const CLICK_INTERVAL_MS = 100;
  const FILES_CONTAINER_POLL_MS = 500;
  const FILES_CONTAINER_POLL_TIMEOUT_MS = 10000;

  const processed = new WeakSet();
  let clickQueue = [];
  let isProcessingQueue = false;

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

  const globToRegex = (pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
  };

  const shouldAutoView = (path) =>
    activePatterns.some((p) => globToRegex(p).test(path));

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

  // ---- DOM helpers ----

  /** Strip invisible Unicode markers (e.g. LRM \u200e) that GitHub injects. */
  const cleanText = (text) =>
    text.replace(/[\u200e\u200f\u200b\u200c\u200d\ufeff]/g, "").trim();

  /**
   * Extract the file path from a diff block.
   * New UI (2025+): <a class="Link--primary"> inside an <h3> with CSS-module class.
   * Legacy UI:      <a class="Link--primary"> inside .js-file / .file-header.
   */
  const extractFilePath = (fileEl) => {
    const primary = fileEl.querySelector("a.Link--primary");
    if (primary?.textContent?.includes("/")) {
      return cleanText(primary.textContent);
    }
    // Legacy fallback
    const fallback = fileEl.querySelector(".file-header a");
    if (fallback?.textContent?.includes("/")) {
      return cleanText(fallback.textContent);
    }
    // Last resort: any anchor whose text looks like a file path
    for (const a of fileEl.querySelectorAll("a")) {
      const t = cleanText(a.textContent);
      if (t.includes("/") && !t.startsWith("http")) return t;
    }
    return null;
  };

  /**
   * Find the "Viewed" toggle for a diff block.
   * New UI (2025+): <button> with MarkAsViewedButton class, aria-pressed="true"/"false".
   * Legacy UI:      <input type="checkbox" class="js-reviewed-checkbox">.
   */
  const findViewedToggle = (fileEl) => {
    // New UI: button-based Viewed toggle
    const btn = fileEl.querySelector('button[class*="MarkAsViewedButton"]');
    if (btn) return btn;
    // Legacy UI: checkbox-based Viewed toggle
    return (
      fileEl.querySelector('input.js-reviewed-checkbox[type="checkbox"]') ||
      fileEl.querySelector('input[type="checkbox"][name="file_reviewed"]')
    );
  };

  /** Check whether the Viewed toggle is already marked. */
  const isAlreadyViewed = (toggle) => {
    if (toggle.tagName === "BUTTON") {
      return toggle.getAttribute("aria-pressed") === "true";
    }
    return toggle.checked; // legacy checkbox
  };

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
    setTimeout(drainQueue, CLICK_INTERVAL_MS);
  };

  // ---- Core scan ----

  /**
   * Collect all diff-block elements.
   * New UI: CSS-module class containing "Diff-module__diff__"
   * Legacy: .js-file
   */
  const getDiffElements = () => {
    // New UI (2025+)
    const newEls = document.querySelectorAll('[class*="Diff-module__diff__"]');
    if (newEls.length > 0) return newEls;
    // Legacy UI
    return document.querySelectorAll(".js-file");
  };

  const scanFiles = () => {
    const fileEls = getDiffElements();

    if (fileEls.length === 0 && isFilesPage()) {
      console.warn(
        "[auto-viewed] No diff containers found on Files page — selectors may be outdated."
      );
      return;
    }

    let marked = 0;
    for (const fileEl of fileEls) {
      if (processed.has(fileEl)) continue;
      processed.add(fileEl);

      const path = extractFilePath(fileEl);
      if (!path) continue;
      if (!shouldAutoView(path)) continue;

      const toggle = findViewedToggle(fileEl);
      if (!toggle || isAlreadyViewed(toggle)) continue;

      enqueueClick(toggle);
      marked++;
    }
    if (marked > 0) {
      console.debug(`[auto-viewed] Queued ${marked} file(s) to mark as Viewed.`);
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
    const firstDiff = document.querySelector('[class*="Diff-module__diff__"]');
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
    // Reset queue state for SPA navigations
    clickQueue = [];
    isProcessingQueue = false;
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
  window.addEventListener("popstate", () => setTimeout(init, 100));

  // Intercept pushState/replaceState for SPA navigations that don't fire popstate
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      original.apply(this, args);
      setTimeout(init, 100);
    };
  }

  // Initial run
  init();
})();
