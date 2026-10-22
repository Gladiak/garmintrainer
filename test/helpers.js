'use strict';

const http = require('node:http');
const { once } = require('node:events');
const { createGarminMock, TEST_API_KEY } = require('../postman/mocks/garmin/default');
const { createGarminClient } = require('../libs/garmin');

async function listen(t, target) {
  const server = typeof target.address === 'function' ? target : http.createServer(target);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function setup(t, mockOptions = {}, clientOptions = {}) {
  const mock = createGarminMock(mockOptions);
  const baseUrl = await listen(t, http.createServer(mock.handler));
  const client = createGarminClient({ apiKey: TEST_API_KEY, baseUrl, ...clientOptions });
  return { ...mock, client, baseUrl };
}

function accountDatabase(t) {
  const { createMemoryRepository } = require('./memory-repository');
  const database = createMemoryRepository();
  t.after(() => database.close());
  return database;
}
async function accountApplication(t, mockOptions = {}) {
  const provider = await setup(t, mockOptions);
  const database = accountDatabase(t);
  const { createApp } = require('../app');
  const { createGarminProfileManager } = require('../libs/garmin');
  const manager = createGarminProfileManager({ databaseProvider: () => database, config: { baseUrl: provider.baseUrl } });
  const base = await listen(t, createApp({ databaseProvider: () => database, garminManager: manager }));
  const raw = (endpoint, { body, method = 'GET', headers = {} } = {}) => fetch(`${base}/api${endpoint}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let sequence = 0;
  async function register(profileValues) {
    const username = `test-user-${++sequence}`;
    const password = 'testing-only-long-passphrase';
    const response = await raw('/auth/register', { method: 'POST', body: { username, email: `${username}@example.test`, password, passwordConfirmation: password } });
    if (response.status !== 201) throw new Error(`Registration failed: ${response.status}`);
    const session = await response.json();
    const headers = { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken };
    const api = (endpoint, options = {}) => raw(endpoint, { ...options, headers: { ...headers, ...options.headers } });
    let profile = session.profile;
    if (profileValues) profile = await (await api('/profile', { method: 'PATCH', body: profileValues })).json();
    return { ...session, profile, headers, api, username, password };
  }
  return { database, manager, provider, base, raw, register };
}

module.exports = { listen, setup, TEST_API_KEY, accountDatabase, accountApplication };
