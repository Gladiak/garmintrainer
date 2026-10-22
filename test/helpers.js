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

module.exports = { listen, setup, TEST_API_KEY };
