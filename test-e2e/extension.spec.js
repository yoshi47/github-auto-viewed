// @ts-check
const { chromium } = require("playwright");
const path = require("path");

const EXTENSION_PATH = path.resolve(__dirname, "..");
const PR_URL = "https://github.com/meetsmore/meetsone/pull/21023/changes";

// Patterns to set for testing
const TEST_PATTERNS = ["*.yaml", "*.ts", "*.json"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("Launching browser with extension...");

  const context = await chromium.launchPersistentContext("", {
    headless: false,
    channel: "chrome",
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  // Get the extension's service worker to set patterns via chrome.storage
  let extensionId;
  let backgroundPage;

  // For MV3 extensions, we need to get the service worker
  // Wait for the service worker to be available
  const serviceWorkers = context.serviceWorkers();
  if (serviceWorkers.length > 0) {
    backgroundPage = serviceWorkers[0];
    extensionId = serviceWorkers[0].url().split("/")[2];
  } else {
    // Wait for service worker to register
    backgroundPage = await context.waitForEvent("serviceworker");
    extensionId = backgroundPage.url().split("/")[2];
  }

  console.log(`Extension loaded: ${extensionId}`);

  // Set test patterns via the extension's storage
  console.log(`Setting globalPatterns: ${JSON.stringify(TEST_PATTERNS)}`);
  await backgroundPage.evaluate((patterns) => {
    return new Promise((resolve) => {
      chrome.storage.sync.set(
        { schemaVersion: 1, globalPatterns: patterns, repoPatterns: {} },
        resolve
      );
    });
  }, TEST_PATTERNS);

  // Verify patterns were set
  const storedPatterns = await backgroundPage.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.sync.get(null, resolve);
    });
  });
  console.log("Stored patterns:", JSON.stringify(storedPatterns));

  // Navigate to the PR
  const page = context.pages()[0] || (await context.newPage());
  console.log(`Navigating to: ${PR_URL}`);
  await page.goto(PR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Check if we need to log in
  const loginForm = await page.$('form[action*="session"]');
  if (loginForm) {
    console.error(
      "ERROR: GitHub login required. Please log in to GitHub in Chrome first,\n" +
        "or provide a user-data-dir with an existing session."
    );
    await context.close();
    process.exit(1);
  }

  console.log("Page loaded. Waiting for diff elements to render...");

  // Wait for diff elements to appear
  await page.waitForSelector(
    '[class*="Diff-module__diff__"], .js-file',
    { timeout: 15000 }
  ).catch(() => {
    console.warn("Diff elements not found with primary selectors, checking page content...");
  });

  // Give the extension time to process
  console.log("Waiting for extension to process files (5s)...");
  await sleep(5000);

  // Check results
  const results = await page.evaluate(() => {
    const diffEls =
      document.querySelectorAll('[class*="Diff-module__diff__"]').length > 0
        ? document.querySelectorAll('[class*="Diff-module__diff__"]')
        : document.querySelectorAll(".js-file");

    const files = [];
    for (const el of diffEls) {
      const linkEl = el.querySelector("a.Link--primary");
      const filePath = linkEl?.textContent?.trim() || "(unknown)";

      const btn = el.querySelector('button[class*="MarkAsViewedButton"]');
      const checkbox = el.querySelector(
        'input.js-reviewed-checkbox[type="checkbox"], input[type="checkbox"][name="file_reviewed"]'
      );
      const toggle = btn || checkbox;

      let viewed = null;
      if (btn) {
        viewed = btn.getAttribute("aria-pressed") === "true";
      } else if (checkbox) {
        viewed = checkbox.checked;
      }

      files.push({ filePath, viewed });
    }
    return files;
  });

  console.log("\n=== Test Results ===");
  console.log(`Total diff blocks found: ${results.length}`);

  if (results.length === 0) {
    console.error("ERROR: No diff blocks found. The page may not have loaded correctly.");
    // Take a screenshot for debugging
    await page.screenshot({
      path: path.join(__dirname, "debug-screenshot.png"),
      fullPage: false,
    });
    console.log("Debug screenshot saved to test-e2e/debug-screenshot.png");
    await context.close();
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const file of results) {
    const matchesPattern = TEST_PATTERNS.some((pattern) => {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
      return regex.test(file.filePath);
    });

    const icon = file.viewed ? "✓ viewed" : "✗ not viewed";
    const expected = matchesPattern ? "should be viewed" : "should NOT be viewed";
    const correct =
      (matchesPattern && file.viewed === true) ||
      (!matchesPattern && file.viewed !== true);

    if (correct) {
      passed++;
      console.log(`  PASS: ${file.filePath} — ${icon} (${expected})`);
    } else {
      failed++;
      console.log(`  FAIL: ${file.filePath} — ${icon} (${expected})`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} files`);

  // Take a screenshot of final state
  await page.screenshot({
    path: path.join(__dirname, "result-screenshot.png"),
    fullPage: false,
  });
  console.log("Result screenshot saved to test-e2e/result-screenshot.png");

  await context.close();
  process.exit(failed > 0 ? 1 : 0);
})();
