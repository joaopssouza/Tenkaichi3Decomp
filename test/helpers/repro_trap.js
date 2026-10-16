// Opens a battle and prints the console lines around the first wasm trap (debug aid, not a test).
//   BT3_BOOT_URL=... node test/helpers/repro_trap.js "BT3_TAG=teams:4" [seconds]
const { openGame } = require('./game_page');
(async () => {
  const env = { BT3_DEMO: '1', BT3_HASH: '/tmp/fight.txt' };
  for (const kv of (process.argv[2] || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); env[k] = v; }
  const secs = +(process.argv[3] || 150);
  const g = await openGame(process.env.BT3_BOOT_URL, { env });
  const end = Date.now() + secs * 1000;
  let fatal = null;
  while (Date.now() < end && !(fatal = g.fatal())) await g.page.waitForTimeout(2000);
  if (fatal) {
    const i = g.printed.findIndex((t) => t === fatal);
    console.log(g.printed.slice(Math.max(0, i - 15), i + 40).join('\n'));
  } else {
    console.log('no trap in', secs, 's');
    try { console.log(await g.evaluate(() => [Module._Web_BattleSeq(), Module._Web_BattleWinner(),
      Array.from({ length: Module._Web_FighterCount() }, (_, i) => Module._Web_FighterHp(i))])); } catch (e) { console.log(e.message); }
  }
  if (process.env.DUMP) console.log(g.printed.filter((t) => new RegExp(process.env.DUMP).test(t)).join('\n'));
  await g.close();
})();
