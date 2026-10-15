const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { WebSocket } = require('ws');
const { MatchmakingServer } = require('../port/matchmaking/server.js');
const { Database } = require('../port/matchmaking/db.js');

test('BT3 Platform API & Batch Streamer Test Suite', async (t) => {
  const testDbPath = path.join(__dirname, 'test_store.json');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = new Database(testDbPath);
  const server = new MatchmakingServer({ port: 0, host: '127.0.0.1', db });
  const { port } = await server.start();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;

  t.after(async () => {
    await server.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  let userToken = '';
  let gokuUser = null;
  let vegetaUser = null;

  await t.test('POST /api/auth/register creates user and returns token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tagname: 'Goku_Super',
        displayName: 'Son Goku',
        country: 'BR',
        password: 'kamehameha123'
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.user.tagname, 'Goku_Super');
    assert.strictEqual(body.user.country, 'BR');
    assert.strictEqual(body.user.elo, 1000);
    assert.ok(body.token);
    userToken = body.token;
    gokuUser = body.user;
  });

  await t.test('POST /api/auth/login validates credentials', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tagname: 'Goku_Super',
        password: 'kamehameha123'
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.token);
  });

  await t.test('GET /api/profile returns authenticated user profile', async () => {
    const res = await fetch(`${baseUrl}/api/profile`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.user.tagname, 'Goku_Super');
  });

  await t.test('POST /api/auth/guest generates guest fighter', async () => {
    const res = await fetch(`${baseUrl}/api/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Vegeta Prince', country: 'US' })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.match(body.user.tagname, /Vegeta/);
    assert.strictEqual(body.user.country, 'US');
  });

  await t.test('Friends system: send request and list friends', async () => {
    // Register 2nd user
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagname: 'Vegeta_SSJ', displayName: 'Vegeta', country: 'JP', password: 'finalflash' })
    });
    const vegetaData = await regRes.json();
    const vegetaToken = vegetaData.token;
    vegetaUser = vegetaData.user;

    // Goku sends request to Vegeta
    const reqRes = await fetch(`${baseUrl}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({ targetTagname: 'Vegeta_SSJ' })
    });
    assert.strictEqual(reqRes.status, 200);
    const reqBody = await reqRes.json();
    assert.strictEqual(reqBody.status, 'pending');

    // Vegeta accepts by also requesting Goku
    const acceptRes = await fetch(`${baseUrl}/api/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${vegetaToken}`
      },
      body: JSON.stringify({ targetTagname: 'Goku_Super' })
    });
    const acceptBody = await acceptRes.json();
    assert.strictEqual(acceptBody.status, 'accepted');

    // Goku checks friend list
    const friendsRes = await fetch(`${baseUrl}/api/friends`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const friendsBody = await friendsRes.json();
    assert.strictEqual(friendsBody.success, true);
    assert.strictEqual(friendsBody.friends.length, 1);
    assert.strictEqual(friendsBody.friends[0].tagname, 'Vegeta_SSJ');
    assert.strictEqual(friendsBody.friends[0].friendshipStatus, 'accepted');
  });

  await t.test('GET /api/leaderboard returns sorted players with matches (filters zeroed players)', async () => {
    // Record a match between Goku and Vegeta so they have stats
    server.db.recordMatchResult('ABCD', gokuUser.id, vegetaUser.id, 0);

    const res = await fetch(`${baseUrl}/api/leaderboard?limit=10`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.leaderboard));
    assert.strictEqual(body.leaderboard.length, 2);
    // Verified: all returned entries must have (wins + losses > 0)
    for (const player of body.leaderboard) {
      assert.ok((player.wins + player.losses) > 0, `Player ${player.tagname} should have played matches`);
    }
  });

  await t.test('POST /game-assets/v1/batch streams binary content', async () => {
    const res = await fetch(`${baseUrl}/game-assets/v1/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths: ['index.json', 'non_existent_file.bin']
      })
    });
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length >= 4);
    const count = buf.readUInt32LE(0);
    assert.strictEqual(count, 2);
  });

  await t.test('WebSocket /net/chat receives and broadcasts messages and challenges', async () => {
    const c1 = new WebSocket(`${wsBase}/net/chat?name=Goku&tag=Goku_Super`);
    const c2 = new WebSocket(`${wsBase}/net/chat?name=Vegeta&tag=Vegeta_SSJ`);

    await new Promise(r => c1.on('open', r));
    await new Promise(r => c2.on('open', r));

    const c2Messages = [];
    c2.on('message', data => c2Messages.push(JSON.parse(data.toString('utf8'))));

    // Send global chat
    c1.send(JSON.stringify({ text: 'Oi, eu sou o Goku!' }));

    // Wait for message delivery
    await new Promise(r => setTimeout(r, 60));
    const chatMsg = c2Messages.find(m => m.t === 'chat');
    assert.ok(chatMsg);
    assert.strictEqual(chatMsg.text, 'Oi, eu sou o Goku!');
    assert.strictEqual(chatMsg.from, 'Goku');

    // Send direct challenge
    c1.send(JSON.stringify({ t: 'challenge', toTag: 'Vegeta_SSJ', room: 'ZFIG' }));
    await new Promise(r => setTimeout(r, 60));
    const challengeMsg = c2Messages.find(m => m.t === 'challenged');
    assert.ok(challengeMsg);
    assert.strictEqual(challengeMsg.room, 'ZFIG');
    assert.strictEqual(challengeMsg.fromTag, 'Goku_Super');

    c1.close();
    c2.close();
    await new Promise(r => setTimeout(r, 50));
  });
});
