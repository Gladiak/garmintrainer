'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runDeploy(t, action, failCommand) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-deploy-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, 'commands.jsonl');
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify({ command, args }) + '\\n');
if (command === process.env.DEPLOY_TEST_FAIL) process.exit(255);
`;
  for (const command of ['ssh', 'scp', 'tar']) {
    fs.writeFileSync(path.join(directory, command), stub, { mode: 0o700 });
  }
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/deploy-vps.mjs'), action], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      DEPLOY_TEST_LOG: log,
      DEPLOY_TEST_FAIL: failCommand || '',
    },
  });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { result, calls };
}

function assertConnection(calls) {
  const connections = calls.filter(call => ['ssh', 'scp'].includes(call.command));
  const controlPath = connections[0].args.find(arg => arg.startsWith('ControlPath='));
  assert.ok(controlPath);
  for (const { args } of connections) {
    assert.ok(args.includes('BatchMode=no'), 'SSH must allow its native password prompt');
    assert.ok(args.includes('ControlMaster=auto'));
    assert.ok(args.includes('ControlPersist=60'));
    assert.ok(args.includes(controlPath), 'SSH and SCP must share the authenticated connection');
  }
  const cleanup = connections.at(-1);
  assert.equal(cleanup.command, 'ssh');
  assert.deepEqual(cleanup.args.slice(-3, -1), ['-O', 'exit']);
  assert.equal(fs.existsSync(path.dirname(controlPath.slice('ControlPath='.length))), false);
}

test('deploy: permette il prompt SSH e riusa la connessione per SCP e comandi remoti', t => {
  const { result, calls } = runDeploy(t, 'deploy');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls.map(call => call.command), ['tar', 'ssh', 'scp', 'ssh', 'ssh']);
  assertConnection(calls);
});

test('status: permette il prompt e chiude la connessione al termine', t => {
  const { result, calls } = runDeploy(t, 'status');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls.map(call => call.command), ['ssh', 'ssh']);
  assertConnection(calls);
});

test('deploy: un errore di autenticazione interrompe il deploy e ripulisce la connessione', t => {
  const { result, calls } = runDeploy(t, 'deploy', 'ssh');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ssh: operazione non riuscita \(255\)/);
  assert.deepEqual(calls.map(call => call.command), ['tar', 'ssh', 'ssh']);
  assertConnection(calls);
});
