/* eslint-disable strict */
var AutoViewed = (() => {
  "use strict";
  /** Strip invisible Unicode markers (e.g. LRM \u200e) that GitHub injects. */
  const cleanText = (text) =>
    text.replace(/[\u200e\u200f\u200b\u200c\u200d\ufeff]/g, "").trim();

  const globToRegex = (pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
  };

  const shouldAutoView = (path, activePatterns) =>
    activePatterns.some((p) => globToRegex(p).test(path));

  /**
   * Extract the file path from a diff block.
   * New UI (2025+): <a class="Link--primary"> inside an <h3> with CSS-module class.
   * Legacy UI:      <a class="Link--primary"> inside .js-file / .file-header.
   */
  const extractFilePath = (fileEl) => {
    const primary = fileEl.querySelector("a.Link--primary");
    if (primary?.textContent?.trim()) {
      return cleanText(primary.textContent);
    }
    // Legacy fallback
    const fallback = fileEl.querySelector(".file-header a");
    if (fallback?.textContent?.trim()) {
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

  /**
   * Pure scan logic: iterate diff elements and determine which toggles to click.
   * Returns { clickTargets, marked, pendingRetry }.
   */
  const scanFilesLogic = (fileEls, processed, retryCount, activePatterns, MAX_RETRIES) => {
    const clickTargets = [];
    let marked = 0;
    let pendingRetry = false;

    for (const fileEl of fileEls) {
      if (processed.has(fileEl)) continue;

      const count = (retryCount.get(fileEl) || 0) + 1;
      retryCount.set(fileEl, count);

      const path = extractFilePath(fileEl);
      if (!path) {
        if (count >= MAX_RETRIES) processed.add(fileEl);
        else pendingRetry = true;
        continue;
      }
      if (!shouldAutoView(path, activePatterns)) {
        processed.add(fileEl);
        continue;
      }

      const toggle = findViewedToggle(fileEl);
      if (!toggle) {
        if (count >= MAX_RETRIES) processed.add(fileEl);
        else pendingRetry = true;
        continue;
      }
      if (isAlreadyViewed(toggle)) {
        processed.add(fileEl);
        continue;
      }

      processed.add(fileEl);
      clickTargets.push(toggle);
      marked++;
    }

    return { clickTargets, marked, pendingRetry };
  };

  return {
    cleanText,
    globToRegex,
    shouldAutoView,
    extractFilePath,
    findViewedToggle,
    isAlreadyViewed,
    scanFilesLogic,
  };
})();
