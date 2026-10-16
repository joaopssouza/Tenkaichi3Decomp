// Tag Team battles without menus or network (stage 1): the attract-demo battle of the browser build, turned into a
// battle of N fighters by BT3_TAG=<teams|ffa>:<n> (port/src/headless.c), read through the queries of
// src/battle/tag_team.c (Web_FighterCount, Web_FighterHp, Web_FighterSide, Web_FighterCoord100).
//
// Needs a served build and Chrome, so it runs only when asked:
//   BT3_BOOT_URL=http://localhost:3999/runtime.html node --test test/tag_offline.test.js
const test = require('node:test');
const assert = require('node:assert');
const { openGame } = require('./helpers/game_page');

const URL_ = process.env.BT3_BOOT_URL;
const SECONDS = +(process.env.BT3_BATTLE_SECONDS || 200);
const skip = !URL_ && 'set BT3_BOOT_URL to a served runtime.html';
const opts = { skip, timeout: (SECONDS + 90) * 1000 };

// the fighters as the game has them: [{ hp, side, pos: [x, y, z] }]
const fighters = (g) => g.evaluate(() => {
  const n = Module._Web_FighterCount();
  return Array.from({ length: n }, (_, i) => ({
    hp: Module._Web_FighterHp(i), side: Module._Web_FighterSide(i),
    pos: [0, 1, 2].map((a) => Module._Web_FighterCoord100(i, a) / 100),
  }));
});
// vertical blanks of fighting so far (BT3_HASH lines with fight values, port/src/gs/state.c)
const fightBlanks = async (g) => ((await g.readFile('/tmp/fight.txt')) || '').split('\n').slice(0, -1).filter((l) => / hp /.test(l)).length;

// waits until the fight has run `blanks` vertical blanks; returns the fighters then
async function afterFighting(g, blanks) {
  const deadline = Date.now() + SECONDS * 1000;
  while (Date.now() < deadline) {
    await g.page.waitForTimeout(3000);
    assert.strictEqual(g.fatal(), null, `the program stopped: ${g.fatal()}`);
    if ((await fightBlanks(g)) >= blanks) return fighters(g);
  }
  assert.fail(`the fight did not reach ${blanks} vertical blanks in ${SECONDS} s`);
}

const distinct = (list) => new Set(list.map((f) => f.pos.map((v) => v.toFixed(1)).join(','))).size;

test('the extra memory for Tag Team fighters is there, 16 MB, and a two-fighter battle leaves it untouched', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt' } });
  try {
    await afterFighting(g, 10);
    assert.deepStrictEqual(await g.evaluate(() => [Module._Web_ExtraSize(), Module._Web_ExtraUsed()]), [16 << 20, 0]);
  } finally {
    await g.close();
  }
});

test('without BT3_TAG the demo battle has its two fighters, one per side', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt' } });
  try {
    const f = await afterFighting(g, 10);
    assert.strictEqual(f.length, 2);
    assert.deepStrictEqual(f.map((x) => x.side), [0, 1]);
    assert.ok(f.every((x) => x.hp > 0), 'both fighters have health');
  } finally {
    await g.close();
  }
});

test('BT3_TAG=ffa:4 puts four fighters on the stage, and they move', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'ffa:4' } });
  try {
    const first = await afterFighting(g, 10);
    assert.strictEqual(first.length, 4, 'four fighters');
    assert.strictEqual(distinct(first), 4, `four different places: ${JSON.stringify(first.map((x) => x.pos))}`);
    assert.ok(first.every((x) => x.hp > 0), 'all four have health');
    const later = await afterFighting(g, 180);
    const moved = later.filter((x, i) => x.pos.some((v, a) => Math.abs(v - first[i].pos[a]) > 1)).length;
    assert.ok(moved >= 3, `only ${moved} of the four moved`);
  } finally {
    await g.close();
  }
});

test('BT3_TAG=teams:4 puts two fighters on each side', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'teams:4' } });
  try {
    const f = await afterFighting(g, 10);
    assert.strictEqual(f.length, 4);
    assert.deepStrictEqual(f.map((x) => x.side & 1).sort(), [0, 0, 1, 1]);
  } finally {
    await g.close();
  }
});

test('BT3_TAG=teams:4 gives every fighter its own model and object, their work in the extra memory', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'teams:4' } });
  try {
    const f = await afterFighting(g, 10);
    const ids = await g.evaluate(() => [0, 1, 2, 3].map((i) => Module._Web_FighterObjId(i)));
    assert.strictEqual(new Set(ids).size, 4, `four objects: ${ids}`);
    assert.ok(ids.every((id) => id >= 0), `objects exist: ${ids}`);
    assert.ok(f.every((x) => x.hp > 0), `all four have health: ${f.map((x) => x.hp)}`);
    assert.ok((await g.evaluate(() => Module._Web_ExtraUsed())) >= 2 * 0x1A0C0, 'the extra fighters work in the extra memory');
  } finally {
    await g.close();
  }
});

// Every battle pool arena stays inside its size (src/battle/btl_pool.c): the effect managers size themselves by the
// fighter count, and with four the game's pool 1 ran over into pool 2 (two task lists on the same memory, a trap).
for (const tag of [null, 'teams:4', 'ffa:4']) {
  test(`the battle pools stay inside their arenas (${tag || 'two fighters'})`, opts, async () => {
    const env = { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt' };
    if (tag) env.BT3_TAG = tag;
    const g = await openGame(URL_, { env });
    try {
      await afterFighting(g, 30);
      assert.strictEqual(await g.evaluate(() => Module._Web_BattlePoolOverflow()), 0, 'bit n: slot n ran over its arena');
    } finally {
      await g.close();
    }
  });
}

test('BT3_TAG=teams:4 starts each partner beside its leader, on the ground (the mod\'s shallow V)', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'teams:4' } });
  try {
    const f = await afterFighting(g, 1);
    const dist = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
    for (const [leader, partner] of [[0, 2], [1, 3]]) {
      const d = dist(f[leader], f[partner]);
      assert.ok(d >= 60 && d <= 400, `fighter ${partner} is ${d.toFixed(0)} from its leader`);
      assert.ok(f[partner].pos[1] > -600, `fighter ${partner} is on the ground (y ${f[partner].pos[1]})`);
    }
    assert.ok(dist(f[2], f[3]) > dist(f[0], f[1]) * 0.5, 'the partners are not on top of each other');
  } finally {
    await g.close();
  }
});

test('BT3_TAG=ffa:4 fighters hurt each other: at least three of the four take damage', { skip, timeout: (SECONDS * 3 + 90) * 1000 }, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'ffa:4' } });
  try {
    const start = await afterFighting(g, 1);
    const deadline = Date.now() + SECONDS * 3 * 1000;
    let hurt = 0, f = [];
    while (Date.now() < deadline && hurt < 3) {
      await g.page.waitForTimeout(5000);
      assert.strictEqual(g.fatal(), null, `the program stopped: ${g.fatal()}`);
      f = await fighters(g);
      hurt = f.filter((x, i) => x.hp < start[i].hp).length;
    }
    assert.ok(hurt >= 3, `only ${hurt} of the four took damage: ${f.map((x) => x.hp)}`);
  } finally {
    await g.close();
  }
});

// the battle up to its decision (sequence state 4, finish, or later); returns the fighters and the winning side
async function untilDecided(g) {
  const deadline = Date.now() + SECONDS * 3 * 1000;
  while (Date.now() < deadline) {
    await g.page.waitForTimeout(3000);
    assert.strictEqual(g.fatal(), null, `the program stopped: ${g.fatal()}`);
    const [seq, winner] = await g.evaluate(() => [Module._Web_BattleSeq(), Module._Web_BattleWinner()]);
    if (seq >= 4) {
      assert.strictEqual(await g.evaluate(() => Module._Web_BattlePoolOverflow()), 0, 'a battle pool ran over its arena');
      return { f: await fighters(g), winner };
    }
  }
  assert.fail(`the battle was not decided in ${SECONDS * 3} s`);
}

test('teams:4 ends only when both fighters of a side are down, and that side loses', { skip, timeout: (SECONDS * 3 + 90) * 1000 }, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'teams:4', BT3_TAG_HP: '4' } });
  try {
    const { f, winner } = await untilDecided(g);
    const down = (side) => f.filter((x, i) => (i & 1) === side).every((x) => x.hp <= 0);
    assert.ok(down(0) || down(1), `a side has both fighters down: ${f.map((x) => x.hp)}`);
    assert.strictEqual(winner, down(1) ? 0 : 1, `the side still standing wins (winner ${winner}, hp ${f.map((x) => x.hp)})`);
  } finally {
    await g.close();
  }
});

test('ffa:4 ends with at most one fighter standing', { skip, timeout: (SECONDS * 3 + 90) * 1000 }, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'ffa:4', BT3_TAG_HP: '4' } });
  try {
    const { f } = await untilDecided(g);
    assert.ok(f.filter((x) => x.hp > 0).length <= 1, `standing at the end: ${f.map((x) => x.hp)}`);
  } finally {
    await g.close();
  }
});

test('teams:4 draws health bars over the other fighters (screenshot in the temp folder)', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'teams:4' } });
  try {
    await afterFighting(g, 30);
    let most = 0;
    for (let k = 0; k < 10 && most < 3; k++) {
      await g.page.waitForTimeout(1000);
      most = Math.max(most, await g.evaluate(() => Module._Web_OverheadBars()));
    }
    await g.page.screenshot({ path: require('path').join(require('os').tmpdir(), 'bt3_tag_bars.png') });
    assert.ok(most >= 1, `bars drawn: ${most}`);
  } finally {
    await g.close();
  }
});

test('an invalid BT3_TAG is said and ignored: the usual two-fighter battle', opts, async () => {
  const g = await openGame(URL_, { env: { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt', BT3_TAG: 'ffa:9' } });
  try {
    const f = await afterFighting(g, 10);
    assert.strictEqual(f.length, 2);
    assert.ok(g.printed.some((t) => /BT3_TAG ignored/.test(t)), 'a message says why');
  } finally {
    await g.close();
  }
});
