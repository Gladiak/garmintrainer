'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { readConfig } = require('../libs/config');
const { listen } = require('./helpers');

for (const hops of [0, 1]) {
  test(`rate limit con ${hops} proxy: identità IP e header HTTPS`, async t => {
    const app = createApp({ config: readConfig({ TRUST_PROXY_HOPS: String(hops) }) });
    const base = await listen(t, app);
    async function invalidLogin(ip) {
      return fetch(`${base}/api/auth/login`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip,
          'X-Forwarded-Proto': 'https', Origin: base.replace('http:', 'https:') }, body: '{}' });
    }
    // HTTPS forwarded headers are trusted only behind the private VPS proxy.
    const forwarded = await invalidLogin('192.0.2.1');
    assert.equal(forwarded.status, hops ? 401 : 403);
    const login = ip => fetch(`${base}/api/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: '{}' });
    for (let i = hops ? 1 : 0; i < 30; i++) assert.equal((await login('192.0.2.1')).status, 401);
    assert.equal((await login('192.0.2.1')).status, 429);
    assert.equal((await login('192.0.2.2')).status, hops ? 401 : 429);
  });
}
