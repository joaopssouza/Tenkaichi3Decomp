const test = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');

const PORT = process.env.PORT || 4500;
const WEB_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;

test('Docker Stack Integration Tests', async (t) => {
  // Check if host port is reachable before running host tests
  let hostReachable = false;
  try {
    const probe = await fetch(`${WEB_URL}/health`, { signal: AbortSignal.timeout(1000) });
    hostReachable = probe.ok;
  } catch (e) {
    hostReachable = false;
  }

  if (!hostReachable) {
    t.skip('Docker stack host port is not published or unreachable on this runner');
    return;
  }

  await t.test('1. Static web client with COOP & COEP isolation headers', async () => {
    const res = await fetch(`${WEB_URL}/index.html`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.strictEqual(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
    const html = await res.text();
    assert.match(html, /Budokai Tenkaichi 3/i);
  });

  await t.test('2. Health check proxied to Node.js signaling container', async () => {
    const res = await fetch(`${WEB_URL}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });

  await t.test('3. HTTP Range Request (206 Partial Content) for disc.iso', async () => {
    const res = await fetch(`${WEB_URL}/disc.iso`, {
      headers: { 'Range': 'bytes=0-1023' }
    });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(res.headers.get('content-range'), 'bytes 0-1023/3020816384');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    const buffer = await res.arrayBuffer();
    assert.strictEqual(buffer.byteLength, 1024);
  });

  await t.test('4. WebSocket reverse proxy /net/ws through Nginx', async () => {
    const ws = new WebSocket(`${WS_URL}/net/ws?room=DOCK&role=host&phase=lobby&name=DockerTester&cid=cid-docker`);
    
    const msg = await new Promise((resolve, reject) => {
      ws.on('message', data => resolve(JSON.parse(data.toString())));
      ws.on('error', reject);
    });

    assert.strictEqual(msg.t, 'wait');

    // Ping test through reverse proxy
    ws.send(JSON.stringify({ t: 'ping', ts: 9999 }));
    const pong = await new Promise((resolve) => {
      ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.t === 'pong') resolve(m);
      });
    });

    assert.strictEqual(pong.t, 'pong');
    assert.strictEqual(pong.ts, 9999);

    ws.close();
    await new Promise(r => ws.on('close', r));
  });

  await t.test('5. Quick Match WebSocket reverse proxy /net/queue through Nginx', async () => {
    const ws = new WebSocket(`${WS_URL}/net/queue?name=DockerQueue&cid=cid-queue`);
    
    const countMsg = await new Promise((resolve, reject) => {
      ws.on('message', data => resolve(JSON.parse(data.toString())));
      ws.on('error', reject);
    });

    assert.strictEqual(countMsg.t, 'count');
    assert.ok(countMsg.n >= 1);

    ws.close();
    await new Promise(r => ws.on('close', r));
  });
});
