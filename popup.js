"use strict";

(() => {
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

  // ---- DOM references ----

  const tabs = document.querySelectorAll(".tab");
  const globalPatternsEl = document.getElementById("global-patterns");
  const repoPatternsEl = document.getElementById("repo-patterns");
  const saveGlobalBtn = document.getElementById("save-global");
  const saveRepoBtn = document.getElementById("save-repo");
  const statusGlobalEl = document.getElementById("status-global");
  const statusRepoEl = document.getElementById("status-repo");
  const repoTab = document.getElementById("repo-tab");
  const repoNameDisplay = document.getElementById("repo-name-display");
  const repoActiveEl = document.getElementById("repo-active");
  const repoDisabledEl = document.getElementById("repo-disabled");

  let currentOwnerRepo = null;

  // ---- Helpers ----

  const showStatus = (el, msg) => {
    el.textContent = msg;
    setTimeout(() => { el.textContent = ""; }, 2000);
  };

  const getOwnerRepoFromUrl = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname !== "github.com") return null;
      const match = u.pathname.match(/^\/([^/]+\/[^/]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  };

  const parseLines = (text) =>
    text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // ---- Tab switching ----

  const switchTab = (tabName) => {
    tabs.forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tabName);
    });
    document.getElementById("panel-global").classList.toggle("active", tabName === "global");
    document.getElementById("panel-repo").classList.toggle("active", tabName === "repo");
  };

  tabs.forEach((t) => {
    t.addEventListener("click", () => {
      if (t.classList.contains("disabled")) return;
      switchTab(t.dataset.tab);
    });
  });

  // ---- Load ----

  const loadGlobal = () => {
    chrome.storage.sync.get({ globalPatterns: [] }, (result) => {
      globalPatternsEl.value = result.globalPatterns.join("\n");
    });
  };

  const loadRepo = () => {
    if (!currentOwnerRepo) return;
    chrome.storage.sync.get({ repoPatterns: {} }, (result) => {
      const patterns = result.repoPatterns[currentOwnerRepo] || [];
      repoPatternsEl.value = patterns.join("\n");
    });
  };

  // ---- Save ----

  saveGlobalBtn.addEventListener("click", () => {
    const patterns = parseLines(globalPatternsEl.value);
    chrome.storage.sync.set({ globalPatterns: patterns }, () => {
      showStatus(statusGlobalEl, "Saved!");
    });
  });

  saveRepoBtn.addEventListener("click", () => {
    if (!currentOwnerRepo) return;
    const patterns = parseLines(repoPatternsEl.value);
    chrome.storage.sync.get({ repoPatterns: {} }, (result) => {
      const repoPatterns = result.repoPatterns;
      if (patterns.length === 0) {
        delete repoPatterns[currentOwnerRepo];
      } else {
        repoPatterns[currentOwnerRepo] = patterns;
      }
      chrome.storage.sync.set({ repoPatterns }, () => {
        showStatus(statusRepoEl, "Saved!");
      });
    });
  });

  // ---- Init ----

  const initRepoTab = (url) => {
    currentOwnerRepo = getOwnerRepoFromUrl(url);
    if (currentOwnerRepo) {
      repoNameDisplay.textContent = currentOwnerRepo;
      repoActiveEl.style.display = "";
      repoDisabledEl.style.display = "none";
      repoTab.classList.remove("disabled");
      loadRepo();
    } else {
      repoActiveEl.style.display = "none";
      repoDisabledEl.style.display = "";
      repoTab.classList.add("disabled");
      switchTab("global");
    }
  };

  migrateStorage(() => {
    loadGlobal();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || "";
      initRepoTab(url);
    });
  });
})();
