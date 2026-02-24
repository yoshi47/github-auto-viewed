/**
 * Unit tests for lib.js shared logic.
 * Mocks browser/Chrome APIs to test in Node.js.
 */

const fs = require("fs");
const path = require("path");

// Load lib.js — defines global `AutoViewed` via `var`
eval(fs.readFileSync(path.join(__dirname, "lib.js"), "utf8"));

const {
  cleanText,
  globToRegex,
  shouldAutoView,
  extractFilePath,
  findViewedToggle,
  isAlreadyViewed,
  scanFilesLogic,
} = AutoViewed;

// ---- Minimal DOM mock ----
class MockElement {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this._attrs = { ...attrs };
    this._children = children;
    this._classList = new Set((attrs.class || "").split(" ").filter(Boolean));
    this.textContent = attrs.textContent || "";
    this.checked = attrs.checked || false;
    this.parentElement = null;
    this._clicked = false;
    for (const child of children) {
      child.parentElement = this;
    }
  }

  getAttribute(name) {
    return this._attrs[name] ?? null;
  }

  setAttribute(name, value) {
    this._attrs[name] = value;
  }

  get children() {
    return this._children;
  }

  querySelector(selector) {
    const results = this._querySelectorAll(selector);
    return results[0] || null;
  }

  querySelectorAll(selector) {
    return this._querySelectorAll(selector);
  }

  _querySelectorAll(selector) {
    const results = [];
    const check = (el) => {
      if (matchesSelector(el, selector)) results.push(el);
      for (const child of el._children) check(child);
    };
    for (const child of this._children) check(child);
    return results;
  }

  click() {
    this._clicked = true;
  }
}

// Simple selector matcher (supports tag, .class, [attr], [attr*="val"], [attr="val"], tag.class)
const matchesSelector = (el, selector) => {
  // Handle comma-separated selectors
  if (selector.includes(",")) {
    return selector.split(",").some((s) => matchesSelector(el, s.trim()));
  }

  // Handle descendant selectors (space-separated)
  const parts = selector.trim().split(/\s+/);
  if (parts.length > 1) {
    // For simplicity, just match the last part
    return matchesSelector(el, parts[parts.length - 1]);
  }

  const s = parts[0];

  // tag[attr*="val"]
  let m = s.match(/^(\w+)?\[class\*="([^"]+)"\]$/);
  if (m) {
    const [, tag, substr] = m;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    return (el._attrs.class || "").includes(substr);
  }

  // tag[attr="val"]
  m = s.match(/^(\w+)?\[(\w[\w-]*)="([^"]+)"\]$/);
  if (m) {
    const [, tag, attr, val] = m;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    return el._attrs[attr] === val;
  }

  // tag.class or .class
  m = s.match(/^(\w+)?\.([A-Za-z_-][\w-]*)$/);
  if (m) {
    const [, tag, cls] = m;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    return el._classList.has(cls);
  }

  // a.Link--primary
  m = s.match(/^(\w+)\.([A-Za-z_][\w-]*)$/);
  if (m) {
    const [, tag, cls] = m;
    if (el.tagName !== tag.toUpperCase()) return false;
    return el._classList.has(cls);
  }

  // Simple tag
  if (/^\w+$/.test(s)) {
    return el.tagName === s.toUpperCase();
  }

  return false;
};

// ---- Tests ----

let passed = 0;
let failed = 0;

const assert = (condition, msg) => {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
};

// ==== Test 1: extractFilePath handles root-level files ====
console.log("\n== Test 1: extractFilePath — root-level files (no slash) ==");

{
  const link = new MockElement("a", { class: "Link--primary", textContent: "package.json" });
  const fileEl = new MockElement("div", {}, [link]);
  const result = extractFilePath(fileEl);
  assert(result === "package.json", `Root file extracted: "${result}"`);
}

{
  const link = new MockElement("a", { class: "Link--primary", textContent: ".gitignore" });
  const fileEl = new MockElement("div", {}, [link]);
  const result = extractFilePath(fileEl);
  assert(result === ".gitignore", `Dotfile extracted: "${result}"`);
}

{
  const link = new MockElement("a", { class: "Link--primary", textContent: "src/components/App.tsx" });
  const fileEl = new MockElement("div", {}, [link]);
  const result = extractFilePath(fileEl);
  assert(result === "src/components/App.tsx", `Nested path extracted: "${result}"`);
}

{
  const link = new MockElement("a", { class: "Link--primary", textContent: "\u200epackage.json\u200e" });
  const fileEl = new MockElement("div", {}, [link]);
  const result = extractFilePath(fileEl);
  assert(result === "package.json", `Unicode markers stripped: "${result}"`);
}

{
  const fileEl = new MockElement("div", {}, []);
  const result = extractFilePath(fileEl);
  assert(result === null, "No anchors returns null");
}

// ==== Test 2: processed.add timing — toggle not found ====
console.log("\n== Test 2: processed.add timing — toggle missing allows retry ==");

{
  // File with path but no toggle button yet
  const link = new MockElement("a", { class: "Link--primary", textContent: "src/index.ts" });
  const fileEl = new MockElement("div", {}, [link]);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];

  // First scan: toggle missing, should NOT be in processed
  scanFilesLogic([fileEl], processed, retryCount, activePatterns, 10);
  assert(!processed.has(fileEl), "Element NOT processed when toggle missing (retry 1)");
  assert(retryCount.get(fileEl) === 1, "retryCount incremented to 1");

  // Simulate toggle appearing on second scan
  const toggle = new MockElement("button", {
    class: "MarkAsViewedButton-abc123",
    "aria-pressed": "false",
  });
  fileEl._children.push(toggle);

  const result = scanFilesLogic([fileEl], processed, retryCount, activePatterns, 10);
  assert(processed.has(fileEl), "Element processed after toggle appears");
  assert(result.marked === 1, `Marked count: ${result.marked}`);
  assert(toggle._clicked || result.clickTargets.includes(toggle), "Toggle enqueued for click");
}

// ==== Test 3: MAX_RETRIES causes give-up ====
console.log("\n== Test 3: MAX_RETRIES — gives up after limit ==");

{
  // File with path but toggle never appears
  const link = new MockElement("a", { class: "Link--primary", textContent: "src/missing.ts" });
  const fileEl = new MockElement("div", {}, [link]);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];
  const MAX_RETRIES = 3;

  for (let i = 0; i < MAX_RETRIES - 1; i++) {
    scanFilesLogic([fileEl], processed, retryCount, activePatterns, MAX_RETRIES);
  }
  assert(!processed.has(fileEl), `Not processed after ${MAX_RETRIES - 1} retries`);

  scanFilesLogic([fileEl], processed, retryCount, activePatterns, MAX_RETRIES);
  assert(processed.has(fileEl), `Processed (given up) after ${MAX_RETRIES} retries`);
}

// ==== Test 4: MAX_RETRIES for path extraction failure ====
console.log("\n== Test 4: MAX_RETRIES — path extraction failure ==");

{
  // Element with no anchors at all
  const fileEl = new MockElement("div", {}, []);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];
  const MAX_RETRIES = 3;

  for (let i = 0; i < MAX_RETRIES - 1; i++) {
    scanFilesLogic([fileEl], processed, retryCount, activePatterns, MAX_RETRIES);
  }
  assert(!processed.has(fileEl), `Not processed after ${MAX_RETRIES - 1} retries (no path)`);

  scanFilesLogic([fileEl], processed, retryCount, activePatterns, MAX_RETRIES);
  assert(processed.has(fileEl), `Processed (given up) after ${MAX_RETRIES} retries (no path)`);
}

// ==== Test 5: Pattern not matching marks as processed immediately ====
console.log("\n== Test 5: Pattern mismatch — processed immediately ==");

{
  const link = new MockElement("a", { class: "Link--primary", textContent: "README.md" });
  const fileEl = new MockElement("div", {}, [link]);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];

  scanFilesLogic([fileEl], processed, retryCount, activePatterns, 10);
  assert(processed.has(fileEl), "Non-matching file processed immediately");
}

// ==== Test 6: Already viewed marks as processed immediately ====
console.log("\n== Test 6: Already viewed — processed immediately ==");

{
  const link = new MockElement("a", { class: "Link--primary", textContent: "src/app.ts" });
  const toggle = new MockElement("button", {
    class: "MarkAsViewedButton-abc123",
    "aria-pressed": "true",
  });
  const fileEl = new MockElement("div", {}, [link, toggle]);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];

  const result = scanFilesLogic([fileEl], processed, retryCount, activePatterns, 10);
  assert(processed.has(fileEl), "Already-viewed file processed immediately");
  assert(result.marked === 0, "No click enqueued for already-viewed file");
}

// ==== Test 7: globToRegex patterns ====
console.log("\n== Test 7: globToRegex — pattern matching ==");

{
  assert(shouldAutoView("package.json", ["*.json"]), "*.json matches package.json");
  assert(shouldAutoView("src/foo.ts", ["*.ts"]), "*.ts matches src/foo.ts");
  assert(!shouldAutoView("src/foo.tsx", ["*.ts"]), "*.ts does NOT match src/foo.tsx");
  assert(shouldAutoView("src/foo.tsx", ["*.tsx"]), "*.tsx matches src/foo.tsx");
  assert(shouldAutoView("pnpm-lock.yaml", ["pnpm-lock.yaml"]), "Exact match works");
  assert(shouldAutoView("a/b/c.js", ["*/b/*.js"]), "*/b/*.js matches a/b/c.js");
}

// ==== Test 8: SPA navigation resets state ====
console.log("\n== Test 8: State reset simulation ==");

{
  let processed = new WeakSet();
  let retryCount = new WeakMap();

  const link = new MockElement("a", { class: "Link--primary", textContent: "src/app.ts" });
  const toggle = new MockElement("button", {
    class: "MarkAsViewedButton-abc123",
    "aria-pressed": "false",
  });
  const fileEl = new MockElement("div", {}, [link, toggle]);

  // First page load
  scanFilesLogic([fileEl], processed, retryCount, ["*.ts"], 10);
  assert(processed.has(fileEl), "File processed on first page");

  // Simulate SPA navigation reset (what init() does)
  processed = new WeakSet();
  retryCount = new WeakMap();

  // Same element after reset
  toggle.setAttribute("aria-pressed", "false");
  toggle._clicked = false;
  const result = scanFilesLogic([fileEl], processed, retryCount, ["*.ts"], 10);
  assert(result.marked === 1, "File re-processed after state reset");
}

// ==== Test 9: pendingRetry flag ====
console.log("\n== Test 9: pendingRetry — returned when elements need retry ==");

{
  const link = new MockElement("a", { class: "Link--primary", textContent: "src/index.ts" });
  // No toggle — should trigger pendingRetry
  const fileEl = new MockElement("div", {}, [link]);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];

  const result = scanFilesLogic([fileEl], processed, retryCount, activePatterns, 10);
  assert(result.pendingRetry === true, "pendingRetry is true when toggle missing");
  assert(result.marked === 0, "No files marked when toggle missing");
}

{
  // No path — should also trigger pendingRetry
  const fileEl = new MockElement("div", {}, []);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];

  const result = scanFilesLogic([fileEl], processed, retryCount, activePatterns, 10);
  assert(result.pendingRetry === true, "pendingRetry is true when path missing");
}

{
  // All elements fully processed — no pendingRetry
  const link = new MockElement("a", { class: "Link--primary", textContent: "README.md" });
  const fileEl = new MockElement("div", {}, [link]);
  const processed = new WeakSet();
  const retryCount = new WeakMap();
  const activePatterns = ["*.ts"];

  const result = scanFilesLogic([fileEl], processed, retryCount, activePatterns, 10);
  assert(result.pendingRetry === false, "pendingRetry is false when all processed");
}

// ==== Summary ====
console.log(`\n== Results: ${passed} passed, ${failed} failed ==`);
process.exit(failed > 0 ? 1 : 0);
