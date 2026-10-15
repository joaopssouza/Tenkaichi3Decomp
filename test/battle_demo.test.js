// A battle loads and runs: the game's own attract-demo battle (CPU against CPU, port/src/headless.c BT3_DEMO) is
// started without menus in the browser build, and its fight values (BT3_HASH, port/src/gs/state.c: one line per
// vertical blank, with " hp " and the fighters' positions once the fight is on) must keep coming and change.
//
// Needs a served build and Chrome, so it runs only when asked:
//   BT3_BOOT_URL=http://localhost:3999/runtime.html node --test test/battle_demo.test.js
// Optional: BT3_BATTLE_SECONDS (default 150).
const test = require('node:test');
const assert = require('node:assert');
const { openGame } = require('./helpers/game_page');

const URL_ = process.env.BT3_BOOT_URL;
const SECONDS = +(process.env.BT3_BATTLE_SECONDS || 150);
// fight lines to wait for: the fight opens with the fighters standing still for its introduction (about 60 vertical
// blanks in the attract demo), so the window has to reach well past it before they can be seen moving
const WANT = 120;

// The log is read while the game writes it: only the lines it has finished (ended by a newline) count.
const doneLines = (log) => (log || '').split('\n').slice(0, -1);

// " hp 40000 40000 pos 4263c5a2 00000000 c2847c6a  ..." -> the six position words
const positions = (line) => {
  const m = / pos ((?:[0-9a-f]{8}\s+){5}[0-9a-f]{8})/.exec(line);
  return m ? m[1].split(/\s+/) : null;
};

// The attract demo is the same fight every time. Its fight values (third column of BT3_HASH: health, positions,
// battle clock and the C library generator) at these vertical blanks, recorded from the build of 81507cd, before
// any Tag Team work: a change that alters an ordinary two-fighter battle in any way changes them.
const BEFORE_TAG_TEAM = { 261: 'dca04588e1526f9b', 312: 'd47a89d4905dab08', 341: 'e0ec385d31a4c4bf' };

test('the attract-demo battle is the same fight as before the Tag Team work', { skip: !URL_ && 'set BT3_BOOT_URL to a served runtime.html', timeout: (SECONDS + 90) * 1000 }, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt' } });
  try {
    const deadline = Date.now() + SECONDS * 1000;
    const last = Math.max(...Object.keys(BEFORE_TAG_TEAM).map(Number));
    let got = {};
    while (Date.now() < deadline) {
      await g.page.waitForTimeout(3000);
      assert.strictEqual(g.fatal(), null, `the program stopped: ${g.fatal()}`);
      const log = (await g.readFile('/tmp/fight.txt')) || '';
      got = Object.fromEntries(doneLines(log).map((l) => l.split(' ')).filter((w) => w.length >= 3).map((w) => [w[0], w[2]]));
      if (got[last] !== undefined) break;
    }
    const want = Object.keys(BEFORE_TAG_TEAM);
    assert.deepStrictEqual(Object.fromEntries(want.map((k) => [k, got[k]])), BEFORE_TAG_TEAM);
  } finally {
    await g.close();
  }
});

test('the attract-demo battle loads and its fighters move', { skip: !URL_ && 'set BT3_BOOT_URL to a served runtime.html', timeout: (SECONDS + 90) * 1000 }, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt' } });
  try {
    const deadline = Date.now() + SECONDS * 1000;
    let fight = [];
    while (Date.now() < deadline) {
      await g.page.waitForTimeout(3000);
      assert.strictEqual(g.fatal(), null, `the program stopped: ${g.fatal()}`);
      const log = await g.readFile('/tmp/fight.txt'); // (throws when the page is stuck in a loop)
      fight = doneLines(log).filter((l) => / hp /.test(l));
      if (fight.length >= WANT) break;
    }
    assert.ok(fight.length >= WANT, `only ${fight.length} vertical blanks of fighting in ${SECONDS} s`);
    const first = positions(fight[0]), last = positions(fight[fight.length - 1]);
    assert.ok(first && last, `no positions in the fight lines:\n${fight[0]}`);
    assert.notDeepStrictEqual(last, first, 'the fighters did not move');
  } finally {
    await g.close();
  }
});
