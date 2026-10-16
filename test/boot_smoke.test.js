// The browser build starts the game: the page is loaded in a headless Chrome and the game must reach its main loop
// (frames presented: Module.webStats, port/web/target/yield_web.c) without the program stopping on the way.
//
// Needs a served build and Chrome, so it runs only when asked:
//   BT3_BOOT_URL=http://localhost:3999/runtime.html node --test test/boot_smoke.test.js
// Optional: BT3_CHROME (path to chrome.exe), BT3_BOOT_SECONDS (default 90).
const test = require('node:test');
const assert = require('node:assert');
const { openGame } = require('./helpers/game_page');

const URL_ = process.env.BT3_BOOT_URL;
const SECONDS = +(process.env.BT3_BOOT_SECONDS || 90);

test('the browser build boots into the game loop', { skip: !URL_ && 'set BT3_BOOT_URL to a served runtime.html', timeout: (SECONDS + 60) * 1000 }, async () => {
  const g = await openGame(URL_);
  try {
    const deadline = Date.now() + SECONDS * 1000;
    let fps = 0;
    while (Date.now() < deadline) {
      await g.page.waitForTimeout(1000);
      if (g.fatal()) break;
      fps = await g.evaluate(() => (window.Module && Module.webStats && Module.webStats.fps) || 0).catch(() => 0);
      if (fps > 0) break;
    }
    assert.strictEqual(g.fatal(), null, `the program stopped while starting: ${g.fatal()}`);
    assert.ok(fps > 0, `no frames from the game loop in ${SECONDS} s; last output:\n${g.printed.slice(-10).join('\n')}`);
  } finally {
    await g.close();
  }
});
