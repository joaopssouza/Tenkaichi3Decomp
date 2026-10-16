const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { WebSocket } = require('ws');
const { MatchmakingServer } = require('../port/matchmaking/server.js');
const { Database } = require('../port/matchmaking/db.js');

const openWs = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  const msgs = [];
  ws.msgs = msgs;
  ws.on('message', (d, isBinary) => {
    if (!isBinary) {
      try { msgs.push(JSON.parse(d.toString())); } catch (e) {}
    }
  });
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
});

const waitFor = async (fn, ms = 2500) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return false;
};

test('Tag Team 2v2 Multi-Player Matchmaking & Signaling Suite', async (t) => {
  const dbPath = path.join(__dirname, 'test_store_tagteam.json');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  const server = new MatchmakingServer({ port: 0, host: '127.0.0.1', db });
  const { port } = await server.start();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;

  t.after(async () => {
    await server.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  await t.test('4-player Tag Team room creation, connection & auto-slot allocation', async () => {
    const roomCode = 'TAGT';
    const hostUrl = `${wsBase}/net/ws?room=${roomCode}&role=host&phase=lobby&name=Goku_SSJ&cid=c_host&mode=tag&slots=4`;
    const host = await openWs(hostUrl);

    // Host receives wait
    const hostMsgs = [];
    host.on('message', (d) => hostMsgs.push(JSON.parse(d.toString())));

    // Player 2 joins with role=join
    const p2Url = `${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Vegeta_SSJ&cid=c_p2`;
    const p2 = await openWs(p2Url);
    const p2Msgs = [];
    p2.on('message', (d) => p2Msgs.push(JSON.parse(d.toString())));

    // Player 3 joins with role=join (should auto-assign to p3)
    const p3Url = `${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Gohan_SSJ2&cid=c_p3`;
    const p3 = await openWs(p3Url);
    const p3Msgs = [];
    p3.on('message', (d) => p3Msgs.push(JSON.parse(d.toString())));

    // Player 4 joins with role=join (should auto-assign to p4)
    const p4Url = `${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Trunks_SSJ&cid=c_p4`;
    const p4 = await openWs(p4Url);
    const p4Msgs = [];
    p4.on('message', (d) => p4Msgs.push(JSON.parse(d.toString())));

    // Verify room state
    const room = server.rooms.get(roomCode);
    assert.ok(room, 'Room should exist');
    assert.strictEqual(room.maxPlayers, 4);
    assert.strictEqual(room.battleMode, 'tag');
    assert.ok(room.slots.host, 'Host slot occupied');
    assert.ok(room.slots.join, 'Join slot occupied');
    assert.ok(room.slots.p3, 'P3 slot occupied');
    assert.ok(room.slots.p4, 'P4 slot occupied');

    assert.strictEqual(room.slotInfo.host.name, 'Goku_SSJ');
    assert.strictEqual(room.slotInfo.join.name, 'Vegeta_SSJ');
    assert.strictEqual(room.slotInfo.p3.name, 'Gohan_SSJ2');
    assert.strictEqual(room.slotInfo.p4.name, 'Trunks_SSJ');

    // 5th player should be rejected as full
    const p5Url = `${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Piccolo&cid=c_p5`;
    const p5 = new WebSocket(p5Url);
    let p5FullMsg = null;
    let p5CloseCode = null;
    p5.on('message', (d) => { p5FullMsg = JSON.parse(d.toString()); });
    p5.on('close', (code) => { p5CloseCode = code; });

    assert.ok(await waitFor(() => p5CloseCode === 4001));
    assert.strictEqual(p5FullMsg.t, 'full');

    host.close();
    p2.close();
    p3.close();
    p4.close();
  });

  await t.test('Binary multicast relay across all 4 players in combat session', async () => {
    const roomCode = 'FIGT';
    const host = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=host&phase=session&name=P1&cid=c1&mode=tag&slots=4`);
    const p2 = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=join&phase=session&name=P2&cid=c2`);
    const p3 = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=p3&phase=session&name=P3&cid=c3`);
    const p4 = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=p4&phase=session&name=P4&cid=c4`);

    const p2Packets = [];
    const p3Packets = [];
    const p4Packets = [];

    p2.on('message', (data, isBinary) => { if (isBinary) p2Packets.push(Buffer.from(data)); });
    p3.on('message', (data, isBinary) => { if (isBinary) p3Packets.push(Buffer.from(data)); });
    p4.on('message', (data, isBinary) => { if (isBinary) p4Packets.push(Buffer.from(data)); });

    // Host sends a binary controller input packet (32 byte header + 18 byte pad)
    const testPacket = Buffer.alloc(50);
    testPacket.writeUInt32LE(0x4E335442, 0); // "BT3N"
    testPacket.writeUInt32LE(3, 4);          // T_INPUT
    testPacket.write('GOKU_PAD_INPUT', 8);

    host.send(testPacket);

    // All other 3 peers should receive the exact binary packet
    assert.ok(await waitFor(() => p2Packets.length >= 1 && p3Packets.length >= 1 && p4Packets.length >= 1));
    assert.deepStrictEqual(p2Packets[0], testPacket);
    assert.deepStrictEqual(p3Packets[0], testPacket);
    assert.deepStrictEqual(p4Packets[0], testPacket);

    // Active matches in /api/stats
    const stats = await (await fetch(`${baseUrl}/api/stats`)).json();
    assert.strictEqual(stats.activeMatches, 1);

    host.close();
    p2.close();
    p3.close();
    p4.close();
  });

  await t.test('Slot role assignment, go broadcast with role injection, and clean close filtering', async () => {
    const roomCode = 'ROLE';
    const host = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=host&phase=lobby&name=Host&cid=ch&mode=tag&slots=4`);
    const p2 = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Player2&cid=c2`);
    const p3 = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Player3&cid=c3`);

    // Verify p2 received assigned_role='join' and p3 received assigned_role='p3'
    assert.ok(await waitFor(() => p2.msgs.some(m => m.t === 'assigned_role' && m.role === 'join')));
    assert.ok(await waitFor(() => p3.msgs.some(m => m.t === 'assigned_role' && m.role === 'p3')));

    // Host sends 'go'
    host.send(JSON.stringify({ t: 'go', rules: '771', name: 'Host' }));

    // Verify P2 and P3 receive 'go' enriched with their respective roles
    assert.ok(await waitFor(() => p2.msgs.some(m => m.t === 'go' && m.myRole === 'join' && m.humanPlayers === 3)));
    assert.ok(await waitFor(() => p3.msgs.some(m => m.t === 'go' && m.myRole === 'p3' && m.humanPlayers === 3)));

    const p3Go = p3.msgs.find(m => m.t === 'go');
    assert.strictEqual(p3Go.myRole, 'p3');
    assert.strictEqual(p3Go.role, 'p3');
    assert.deepStrictEqual(p3Go.activeRoles, ['host', 'join', 'p3']);

    // When P3 closes cleanly with code 1000 (transition to session), host and P2 must NOT receive 'left'
    p3.close(1000, 'navigating to session');
    await new Promise(r => setTimeout(r, 80));

    assert.strictEqual(host.msgs.filter(m => m.t === 'left').length, 0, 'Host must not receive left on clean 1000 close');
    assert.strictEqual(p2.msgs.filter(m => m.t === 'left').length, 0, 'P2 must not receive left on clean 1000 close');

    host.close();
    p2.close();
  });

  await t.test('Multi-player 3-peer session synchronization: broadcast session_ready with accurate humanPlayers', async () => {
    const roomCode = 'SYNC';
    // Establish lobby with 3 players
    const hostLobby = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=host&phase=lobby&name=Host&cid=ch&mode=tag&slots=4`);
    const p2Lobby = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Player2&cid=c2`);
    const p3Lobby = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=join&phase=lobby&name=Player3&cid=c3`);

    // Host triggers 'go'
    hostLobby.send(JSON.stringify({ t: 'go', rules: '771', name: 'Host' }));
    assert.ok(await waitFor(() => hostLobby.msgs.some(m => m.t === 'go' && m.humanPlayers === 3)));

    // Peers transition to phase=session
    hostLobby.close(1000);
    p2Lobby.close(1000);
    p3Lobby.close(1000);

    const hostSession = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=host&phase=session&name=Host&cid=ch&mode=tag&slots=4`);
    const p2Session = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=join&phase=session&name=Player2&cid=c2`);
    
    // When only 2 of 3 connect, session_ready must NOT yet be sent
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(hostSession.msgs.some(m => m.t === 'session_ready'), false);

    // 3rd peer connects to session
    const p3Session = await openWs(`${wsBase}/net/ws?room=${roomCode}&role=p3&phase=session&name=Player3&cid=c3`);

    // All 3 peers must now receive session_ready with humanPlayers === 3
    assert.ok(await waitFor(() => hostSession.msgs.some(m => m.t === 'session_ready' && m.humanPlayers === 3)));
    assert.ok(await waitFor(() => p2Session.msgs.some(m => m.t === 'session_ready' && m.humanPlayers === 3)));
    assert.ok(await waitFor(() => p3Session.msgs.some(m => m.t === 'session_ready' && m.humanPlayers === 3)));

    hostSession.close();
    p2Session.close();
    p3Session.close();
  });
});
