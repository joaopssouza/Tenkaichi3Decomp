const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocket } = require('ws');
const { MatchmakingServer } = require('../port/matchmaking/server.js');
const { Database } = require('../port/matchmaking/db.js');

const open = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  ws.on('open', () => res(ws));
  ws.on('error', rej);
});
const waitFor = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)); }
  return false;
};

test('Stats endpoint & root page', async (t) => {
  const dbPath = path.join(__dirname, 'test_store_stats.json');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const pub = fs.mkdtempSync(path.join(os.tmpdir(), 'bt3pub-'));
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>portal</title>');
  const server = new MatchmakingServer({ port: 0, host: '127.0.0.1', db: new Database(dbPath), publicDir: pub });
  const { port } = await server.start();
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { await server.close(); if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); });

  await t.test('/?net=join... serves the portal HTML, not health JSON', async () => {
    const res = await fetch(`${base}/?net=join&room=QWDE&rules=768&lobby=1`);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /portal/);
  });

  await t.test('/health still returns JSON', async () => {
    const body = await (await fetch(`${base}/health`)).json();
    assert.strictEqual(body.status, 'ok');
  });

  await t.test('idle stats are zero, registered counts accounts', async () => {
    let s = await (await fetch(`${base}/api/stats`)).json();
    assert.strictEqual(s.activeMatches, 0);
    assert.strictEqual(s.onlinePlayers, 0);
    assert.strictEqual(s.registeredUsers, 0);
    await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagname: 'Vegeta_01', displayName: 'Vegeta', country: 'BR', password: 'galickgun123' })
    });
    s = await (await fetch(`${base}/api/stats`)).json();
    assert.strictEqual(s.registeredUsers, 1);
  });

  await t.test('online players = chat visitors; active match needs 2 peers', async () => {
    const chat = await open(`ws://127.0.0.1:${port}/net/chat?name=A&tag=A`);
    assert.ok(await waitFor(async () => (await (await fetch(`${base}/api/stats`)).json()).onlinePlayers === 1));

    const host = await open(`ws://127.0.0.1:${port}/net/ws?room=ABCD&role=host&phase=lobby&name=H&cid=h1`);
    let s = await (await fetch(`${base}/api/stats`)).json();
    assert.strictEqual(s.activeMatches, 0, 'room with only host is not a match');

    const join = await open(`ws://127.0.0.1:${port}/net/ws?room=ABCD&role=join&phase=lobby&name=J&cid=j1`);
    assert.ok(await waitFor(async () => (await (await fetch(`${base}/api/stats`)).json()).activeMatches === 1));

    host.close(); join.close(); chat.close();
    assert.ok(await waitFor(async () => {
      const x = await (await fetch(`${base}/api/stats`)).json();
      return x.activeMatches === 0 && x.onlinePlayers === 0;
    }));
  });
});
