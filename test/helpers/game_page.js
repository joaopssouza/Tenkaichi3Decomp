// The browser build in a headless Chrome, for the tests that need the real program (boot, battles).
//   const g = await openGame(url, { env: { BT3_DEMO: '1' } });   ... g.printed, g.evaluate(fn), g.readFile(path) ...
//   await g.close();
// runtime.html takes the port's switches as ?env=NAME=value,NAME=value (read before the program starts).
const fs = require('fs');

const CHROME = process.env.BT3_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// what the port prints when the program cannot go on (port/src/plat_mem.c, runtime.html's onAbort)
const FATAL = /does not fit in the game heap|The game stopped|no room below|cannot run/;

async function openGame(url, { env = {} } = {}) {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set BT3_CHROME)`);
  const { chromium } = require('playwright-core');
  // a server, not a plain launch: its process can be killed when a page stuck in a loop keeps close() from returning
  const server = await chromium.launchServer({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const printed = [];
  page.on('console', (m) => printed.push(m.text()));
  page.on('pageerror', (e) => printed.push('page error: ' + e.message));
  const u = new URL(url);
  const pairs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  if (pairs.length) u.searchParams.set('env', pairs.join(','));
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  return {
    page,
    printed,
    fatal: () => printed.find((t) => FATAL.test(t)) || null,
    // a page busy in a loop that never gives way answers nothing: a time limit instead of waiting forever
    evaluate: (fn, arg, ms = 15000) => Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, no) => setTimeout(() => no(new Error(`the page did not answer in ${ms} ms (busy in a loop?)`)), ms)),
    ]),
    readFile(path, ms) {
      return this.evaluate((p) => { try { return FS.readFile(p, { encoding: 'utf8' }); } catch (e) { return null; } }, path, ms);
    },
    close: () => Promise.race([browser.close().then(() => server.close()), new Promise((ok) => setTimeout(ok, 5000))])
      .then(() => server.kill()),
  };
}

module.exports = { openGame };
