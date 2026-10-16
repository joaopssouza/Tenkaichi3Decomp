const test = require('node:test');
const assert = require('node:assert');

// Simulate getSignalingEndpoint logic
function getSignalingEndpoint(pathAndQuery, config = {}, location = { protocol: 'http:', host: 'localhost:8080' }) {
  const customUrl = (config.SIGNALING_URL || config.WS_URL || (config.Module && config.Module.signalingUrl) || config.queryWs || '').trim();
  if (customUrl) {
    if (/^wss?:\/\//i.test(customUrl)) {
      const base = customUrl.replace(/\/+$/, '');
      return `${base}${pathAndQuery}`;
    }
    if (/^https?:\/\//i.test(customUrl)) {
      const proto = customUrl.startsWith('https') ? 'wss' : 'ws';
      const host = customUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return `${proto}://${host}${pathAndQuery}`;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${customUrl.replace(/\/+$/, '')}${pathAndQuery}`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${pathAndQuery}`;
}

test('Frontend Signaling Endpoint Resolution', async (t) => {
  await t.test('defaults to same-origin with ws: on http:', () => {
    const ep = getSignalingEndpoint('/net/ws?room=ABCD', {}, { protocol: 'http:', host: '192.168.1.50:8080' });
    assert.strictEqual(ep, 'ws://192.168.1.50:8080/net/ws?room=ABCD');
  });

  await t.test('defaults to same-origin with wss: on https: (Cloudflare Tunnel)', () => {
    const ep = getSignalingEndpoint('/net/ws?room=ABCD', {}, { protocol: 'https:', host: 'bt3.mydomain.com' });
    assert.strictEqual(ep, 'wss://bt3.mydomain.com/net/ws?room=ABCD');
  });

  await t.test('uses explicit wss:// SIGNALING_URL', () => {
    const ep = getSignalingEndpoint('/net/queue', { SIGNALING_URL: 'wss://signaling.domain.com:443' }, { protocol: 'http:', host: 'localhost' });
    assert.strictEqual(ep, 'wss://signaling.domain.com:443/net/queue');
  });

  await t.test('converts https:// SIGNALING_URL to wss://', () => {
    const ep = getSignalingEndpoint('/net/ws?room=TEST', { SIGNALING_URL: 'https://signaling.domain.com' });
    assert.strictEqual(ep, 'wss://signaling.domain.com/net/ws?room=TEST');
  });

  await t.test('supports query parameter ?ws=', () => {
    const ep = getSignalingEndpoint('/net/queue', { queryWs: 'wss://custom.tunnel.com' });
    assert.strictEqual(ep, 'wss://custom.tunnel.com/net/queue');
  });
});
