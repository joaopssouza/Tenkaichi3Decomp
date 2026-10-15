// The browser build starts the game: the page is loaded in a headless Chrome and the game must reach its main loop
// (frames presented: Module.webStats, port/web/target/yield_web.c) without the program stopping on the way.
//
// Needs a served build and Chrome, so it runs only when asked:
//   BT3_BOOT_URL=http://localhost:3999/runtime.html node --test test/boot_smoke.test.js
// Optional: BT3_CHROME (path to chrome.exe), BT3_BOOT_SECONDS (default 90).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const URL_ = process.env.BT3_BOOT_URL;
const CHROME = process.env.BT3_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SECONDS = +(process.env.BT3_BOOT_SECONDS || 90);
// what the port prints when the program cannot go on (port/src/plat_mem.c, runtime.html's onAbort)
const FATAL = /does not fit in the game heap|The game stopped|no room below|cannot run/;

test('the browser build boots into the game loop', { skip: !URL_ && 'set BT3_BOOT_URL to a served runtime.html', timeout: (SECONDS + 60) * 1000 }, async () => {
  assert.ok(fs.existsSync(CHROME), `Chrome not found at ${CHROME} (set BT3_CHROME)`);
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const printed = [];
    page.on('console', (m) => printed.push(m.text()));
    page.on('pageerror', (e) => printed.push('page error: ' + e.message));
    await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });

    const deadline = Date.now() + SECONDS * 1000;
    let fps = 0, fatal = null;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      fatal = printed.find((t) => FATAL.test(t)) || null;
      if (fatal) break;
      fps = await page.evaluate(() => (window.Module && Module.webStats && Module.webStats.fps) || 0).catch(() => 0);
      if (fps > 0) break;
    }
    assert.strictEqual(fatal, null, `the program stopped while starting: ${fatal}`);
    assert.ok(fps > 0, `no frames from the game loop in ${SECONDS} s; last output:\n${printed.slice(-10).join('\n')}`);
  } finally {
    await browser.close();
  }
});
