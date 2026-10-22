'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../app');
const { createGarminProfileManager } = require('../libs/garmin');
const { accountDatabase } = require('./helpers');
const { TEST_API_KEY, PROFILE_PATH } = require('../postman/mocks/garmin/default');

async function main() {
  const { prepareProfileAccess } = await import('../frontend/src/lib/garmin-access.js');
  const baseUrl = process.env.GARMIN_SIMULATION_BASE_URL || 'http://127.0.0.1:4900/garmin';
  const reset = await fetch(`${baseUrl}/__control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset: true, rejectFirstToken: true }),
  });
  assert.equal(reset.status, 200);
  const database = accountDatabase({ after() {} });
  const user = database.createUser({ username: 'simulation', email: 'simulation@example.test', passwordHash: 'unused' });
  const profile = database.updateProfile(database.getUserProfile(user.id).id, { firstName: 'Test', lastName: 'Simulazione', primarySport: 'running', apiKey: TEST_API_KEY });
  const { randomBytes, createHash } = require('node:crypto');
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  database.createAuthSession({ tokenHash: createHash('sha256').update(token).digest('hex'), userId: user.id, csrfToken, expiresAt: Date.now() + 60000 });
  const manager = createGarminProfileManager({ databaseProvider: () => database, config: { baseUrl } });
  const client = (await manager.getClient(profile.id));
  const server = createApp({ garminManager: manager, databaseProvider: () => database }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  console.log(`Express in ascolto sulla porta di test ${server.address().port}`);
  try {
    const origin = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, { method, profileId } = {}) => {
      const response = await fetch(`${origin}${path}`, { method, headers: { Cookie: `garmintrainer_session=${token}`, 'X-CSRF-Token': csrfToken } });
      assert.equal(response.status, 200);
      return response.json();
    };
    const dashboard = await request('/dashboard', { profileId: profile.id });
    const states = [];
    await prepareProfileAccess({ profileId: profile.id, status: dashboard.garmin, request, isCurrent: () => true, onChange: state => states.push(state) });
    assert.equal(states.at(-1).status.valid, true);
    assert.equal(states.at(-1).error, '');
    assert.deepEqual(await client.get(PROFILE_PATH), { timeZone: 'Europe/Rome' });
    const stats = await (await fetch(`${baseUrl}/__stats`)).json();
    assert.deepEqual(stats, { tokenRequests: 2, dataRequests: 2 });
    console.log('Simulazione HTTP OK: accesso automatico frontend, Express, cache e rinnovo dopo 401.');
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    database.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
