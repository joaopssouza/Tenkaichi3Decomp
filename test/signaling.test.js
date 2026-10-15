const test = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { MatchmakingServer } = require('../port/matchmaking/server.js');

function createMessageQueue(ws) {
  const queue = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    const item = { data, isBinary };
    if (waiters.length > 0) {
      waiters.shift()(item);
    } else {
      queue.push(item);
    }
  });
  return {
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise(resolve => waiters.push(resolve));
    },
    async nextJson() {
      const item = await this.next();
      return JSON.parse(item.data.toString('utf8'));
    }
  };
}

test('Signaling Server Test Suite', async (t) => {
  const server = new MatchmakingServer({ port: 0, host: '127.0.0.1' });
  const { port } = await server.start();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;

  t.after(async () => {
    await server.close();
  });

  await t.test('GET /health returns 200 and status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.rooms, 0);
  });

  await t.test('POST and GET /net/stat telemetry', async () => {
    const postRes = await fetch(`${baseUrl}/net/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: 'TEST', event: 'round_started' })
    });
    assert.strictEqual(postRes.status, 204);

    const getRes = await fetch(`${baseUrl}/net/stat?room=TEST`);
    assert.strictEqual(getRes.status, 200);
    const text = await getRes.text();
    assert.match(text, /round_started/);
  });

  await t.test('Host connects and receives wait message', async () => {
    const ws = new WebSocket(`${wsBase}/net/ws?room=ABCD&role=host&phase=lobby&name=Goku&cid=cid-1`);
    const q = createMessageQueue(ws);
    const msg = await q.nextJson();
    assert.strictEqual(msg.t, 'wait');
    ws.close();
    await new Promise(r => setTimeout(r, 50));
  });

  await t.test('Peer pairing and SDP/ICE signaling relay', async () => {
    const hostWs = new WebSocket(`${wsBase}/net/ws?room=BATL&role=host&phase=lobby&name=Goku&cid=cid-goku`);
    const hostQ = createMessageQueue(hostWs);
    const waitMsg = await hostQ.nextJson();
    assert.strictEqual(waitMsg.t, 'wait');

    const joinWs = new WebSocket(`${wsBase}/net/ws?room=BATL&role=join&phase=lobby&name=Vegeta&cid=cid-vegeta`);
    const joinQ = createMessageQueue(joinWs);

    const [hostPeerMsg, joinPeerMsg] = await Promise.all([
      hostQ.nextJson(),
      joinQ.nextJson()
    ]);

    assert.strictEqual(hostPeerMsg.t, 'peer');
    assert.strictEqual(hostPeerMsg.name, 'Vegeta');
    assert.strictEqual(joinPeerMsg.t, 'peer');
    assert.strictEqual(joinPeerMsg.name, 'Goku');

    // Host sends SDP offer -> Join receives it
    hostWs.send(JSON.stringify({ t: 'sig', sdp: { type: 'offer', sdp: 'fake-sdp-offer' } }));
    const receivedOffer = await joinQ.nextJson();
    assert.strictEqual(receivedOffer.t, 'sig');
    assert.strictEqual(receivedOffer.sdp.type, 'offer');
    assert.strictEqual(receivedOffer.sdp.sdp, 'fake-sdp-offer');

    // Join sends SDP answer -> Host receives it
    joinWs.send(JSON.stringify({ t: 'sig', sdp: { type: 'answer', sdp: 'fake-sdp-answer' } }));
    const receivedAnswer = await hostQ.nextJson();
    assert.strictEqual(receivedAnswer.t, 'sig');
    assert.strictEqual(receivedAnswer.sdp.type, 'answer');

    // Binary packet relay: Host -> Join
    const binaryData = Buffer.from([0x42, 0x54, 0x33, 0x4E, 0x09, 0x00]);
    hostWs.send(binaryData);
    const receivedBinary = await joinQ.next();
    assert.strictEqual(receivedBinary.isBinary, true);
    assert.deepStrictEqual(Buffer.from(receivedBinary.data), binaryData);

    // Disconnect event: Join closes -> Host gets left
    joinWs.close();
    const leftMsg = await hostQ.nextJson();
    assert.strictEqual(leftMsg.t, 'left');

    hostWs.close();
    await new Promise(r => setTimeout(r, 50));
  });

  await t.test('Quick Match Queue pairs 2 players into a room', async () => {
    const p1 = new WebSocket(`${wsBase}/net/queue?name=Piccolo&cid=cid-piccolo`);
    const q1 = createMessageQueue(p1);
    const p2 = new WebSocket(`${wsBase}/net/queue?name=Gohan&cid=cid-gohan`);
    const q2 = createMessageQueue(p2);

    let p1Msg, p2Msg;
    while (!p1Msg) {
      const m = await q1.nextJson();
      if (m.t === 'match') p1Msg = m;
    }
    while (!p2Msg) {
      const m = await q2.nextJson();
      if (m.t === 'match') p2Msg = m;
    }

    assert.strictEqual(p1Msg.t, 'match');
    assert.strictEqual(p2Msg.t, 'match');
    assert.strictEqual(p1Msg.room, p2Msg.room);
    assert.strictEqual(p1Msg.role, 'host');
    assert.strictEqual(p2Msg.role, 'join');
    assert.strictEqual(p1Msg.vs, 'Gohan');
    assert.strictEqual(p2Msg.vs, 'Piccolo');

    p1.close();
    p2.close();
    await new Promise(r => setTimeout(r, 50));
  });

  await t.test('Join connecting without host in lobby receives nohost', async () => {
    const ws = new WebSocket(`${wsBase}/net/ws?room=NONE&role=join&phase=lobby&name=Trunks&cid=cid-trunks`);
    const q = createMessageQueue(ws);
    const msg = await q.nextJson();
    assert.strictEqual(msg.t, 'nohost');
    await new Promise(r => ws.on('close', (code) => {
      assert.strictEqual(code, 4002);
      r();
    }));
  });

  await t.test('Second host with different cid is rejected as taken', async () => {
    const host1 = new WebSocket(`${wsBase}/net/ws?room=HOST&role=host&phase=lobby&name=Host1&cid=cid-h1`);
    const q1 = createMessageQueue(host1);
    await q1.nextJson(); // wait

    const host2 = new WebSocket(`${wsBase}/net/ws?room=HOST&role=host&phase=lobby&name=Host2&cid=cid-h2`);
    const q2 = createMessageQueue(host2);
    const msg2 = await q2.nextJson();
    assert.strictEqual(msg2.t, 'taken');
    await new Promise(r => host2.on('close', (code) => {
      assert.strictEqual(code, 4001);
      r();
    }));

    host1.close();
    await new Promise(r => setTimeout(r, 50));
  });

  await t.test('Same cid reconnecting replaces previous socket', async () => {
    const host1 = new WebSocket(`${wsBase}/net/ws?room=REPL&role=host&phase=lobby&name=Goku&cid=cid-reconnect`);
    const q1 = createMessageQueue(host1);
    await q1.nextJson(); // wait

    let host1ClosedCode = null;
    host1.on('close', (code) => { host1ClosedCode = code; });

    const host2 = new WebSocket(`${wsBase}/net/ws?room=REPL&role=host&phase=lobby&name=Goku&cid=cid-reconnect`);
    const q2 = createMessageQueue(host2);
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(host1ClosedCode, 4000);
    host2.close();
    await new Promise(r => setTimeout(r, 50));
  });

  await t.test('Ping returns pong with timestamp', async () => {
    const ws = new WebSocket(`${wsBase}/net/ws?room=PING&role=host&phase=lobby&name=Goku&cid=cid-ping`);
    const q = createMessageQueue(ws);
    await q.nextJson(); // wait

    ws.send(JSON.stringify({ t: 'ping', ts: 123456 }));
    const pong = await q.nextJson();
    assert.strictEqual(pong.t, 'pong');
    assert.strictEqual(pong.ts, 123456);

    ws.close();
    await new Promise(r => setTimeout(r, 50));
  });
});
