"use strict";

(() => {
  const DEFAULT_PATTERNS = [];

  const patternsEl = document.getElementById("patterns");
  const saveBtn = document.getElementById("save");
  const statusEl = document.getElementById("status");

  const showStatus = (msg) => {
    statusEl.textContent = msg;
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
  };

  const load = () => {
    chrome.storage.sync.get({ patterns: DEFAULT_PATTERNS }, (result) => {
      patternsEl.value = result.patterns.join("\n");
    });
  };

  saveBtn.addEventListener("click", () => {
    const patterns = patternsEl.value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    chrome.storage.sync.set({ patterns }, () => {
      showStatus("Saved!");
    });
  });

  load();
})();
