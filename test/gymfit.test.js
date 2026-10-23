'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { task, page, splitTask, verifyTask, leaves, progress } = require('../helpers/gymfit/model');
const { newImport } = require('../helpers/gymfit/importer');
const { createHttpClient } = require('../helpers/gymfit/http');
const { options, reporter } = require('../scripts/gymfit-import');
const { id } = require('./gymfit-fixtures');

test('GymFit: argomenti e limiti Free sono verificati prima di connettersi', () => {
  assert.equal(options(['start', '--budget', '900', '--preflight']).preflight, true);
  assert.equal(options(['auto']).command, 'auto');
  assert.equal(options(['audit', '--json']).command, 'audit');
  assert.equal(options(['export', id(1)]).id, id(1));
  assert.equal(options(['restore']).command, 'restore');
  for (const args of [['restore', id(1)], ['export', '--json'], ['audit', '--rpm', '20']]) assert.throws(() => options(args), error => error.code === 'INVALID_ARGUMENT');
  for (const args of [['start', '--rpm', '31'], ['resume', 'bad-id'], ['start', '--budget', '1001'], ['status', '--budget', '1'], ['resume', '--sample', '2'], ['start', '--unknown'], ['auto', id(1)]]) assert.throws(() => options(args), error => error.code === 'INVALID_ARGUMENT');
  const cli = path.resolve(__dirname, '../scripts/gymfit-import.js');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /preflight/);
  const missing = spawnSync(process.execPath, [cli, 'start'], { encoding: 'utf8', env: { ...process.env, GYMFIT_API_KEY: '', GYMFIT_API_KEY_FILE: '' } });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /API_KEY_REQUIRED/);
});

test('GymFit: paginazione rifiuta duplicati, buchi e totali variabili', () => {
  const slice = task('catalog');
  const first = page({ total: 2, count: 1, results: [{ id: id(1), name: 'One' }] }, slice);
  slice.total = first.total; slice.ids = first.ids; slice.offset = 1;
  assert.throws(() => page({ total: 2, count: 1, results: [{ id: id(1), name: 'One' }] }, slice), /duplicati/);
  assert.throws(() => page({ total: 2, count: 0, results: [] }, slice), /vuota/);
  assert.throws(() => page({ total: 3, count: 1, results: [{ id: id(2), name: 'Two' }] }, slice), /cambiato/);
});

test('GymFit: le partizioni devono coprire gli UUID del totale del padre', () => {
  const root = task('muscle', {}, id(3), 'target'); root.total = 2;
  splitTask(root, { values: { categories: ['Strength', 'Cardio'] } });
  assert.equal(leaves([root]).length, 2);
  for (const child of root.children) { child.total = 1; child.done = true; child.ids = [id(1)]; }
  assert.throws(() => verifyTask(root), /Copertura/);
  root.children[1].ids = [id(2)]; verifyTask(root);
  const muscle = task('muscle', { category: 'Strength', difficulty: 'Intermediate', tier: 'Standard' }, id(3), 'target');
  assert.throws(() => splitTask(muscle, { values: { bodyParts: ['Arms'] } }), error => error.code === 'OFFSET_LIMIT');
  const catalog = task('catalog', { category: 'Strength', difficulty: 'Intermediate', tier: 'Standard' });
  splitTask(catalog, { values: { bodyParts: ['Arms'] } });
  assert.equal(catalog.children[0].filters.bodyPart, 'Arms');
});

test('GymFit: percentuale incerta durante la scoperta, mai 100% prima delle verifiche', () => {
  const run = newImport(); assert.equal(progress(run).percent, null);
  run.checkpoint.phase = 'samples';
  const slice = task('catalog'); slice.total = 1; slice.ids = [id(1)]; slice.done = true;
  run.checkpoint.catalog = [slice]; assert.equal(progress(run).percent, 99.9);
  run.status = 'completed'; assert.equal(progress(run).percent, 100);
});

test('GymFit: chiave confinata all’origine, redirect disabilitati, errori senza segreti', async () => {
  const secret = 'synthetic-test-key'; let captured;
  const client = createHttpClient(secret, { fetchImpl: async (url, settings) => { captured = { url, settings }; return new Response('{"ok":true}', { status: 200 }); } });
  assert.deepEqual((await client('/v2/meta')).data, { ok: true });
  assert.equal(captured.url.origin, 'https://api.gymfit-api.com');
  assert.equal(captured.settings.redirect, 'error'); assert.equal(captured.settings.headers['X-API-Key'], secret);
  await assert.rejects(client('https://example.test/v2/meta'), /Endpoint/);
  const broken = createHttpClient(secret, { fetchImpl: async () => { throw new Error(secret); } });
  await assert.rejects(broken('/v2/meta'), error => error.code === 'NETWORK_ERROR' && !error.message.includes(secret));
});

test('GymFit: output leggibile e JSON mantengono retry e stato', () => {
  let output = ''; const stream = { write: chunk => { output += chunk; } };
  const event = { type: 'retry', ...progress(newImport()), code: 'rate_limited', attempt: 1, maxRetries: 5, delaySeconds: 3 };
  reporter(false, stream)(event); assert.match(output, /RETRY 1\/5/);
  output = ''; reporter(true, stream)(event); assert.equal(JSON.parse(output).code, 'rate_limited');
});

test('GymFit Docker: stdout JSON pulito e chiave passata per nome, senza valore negli argomenti', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gymfit-docker-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, 'calls.jsonl');
  fs.writeFileSync(path.join(directory, 'docker'), `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.GYMFIT_TEST_LOG,JSON.stringify(args)+'\\n'); if(args.includes('build')) console.log('synthetic build'); else console.log(JSON.stringify({type:'status'}));\n`, { mode: 0o700 });
  const env = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, GYMFIT_TEST_LOG: log, GYMFIT_API_KEY: 'synthetic-secret', GYMFIT_API_KEY_FILE: '' };
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/gymfit-import-docker.mjs'), 'start', '--json'], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).type, 'status'); assert.match(result.stderr, /synthetic build/);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls[1].includes('GYMFIT_API_KEY')); assert.ok(!calls.flat().includes('synthetic-secret'));
});

test('GymFit launcher: chiave nel file, database automatico e ripresa senza argomenti sensibili', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gymfit-launcher-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'scripts'));
  const template = fs.readFileSync(path.resolve(__dirname, '../scripts/templates/import-gymfit.command'), 'utf8');
  const launcher = path.join(directory, 'import-gymfit.command');
  fs.writeFileSync(launcher, template);
  const missing = spawnSync(process.execPath, [launcher], { encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /const API_KEY/);
  const log = path.join(directory, 'calls.jsonl');
  const stub = `import fs from 'node:fs'; import path from 'node:path'; fs.appendFileSync(process.env.GYMFIT_LAUNCH_TEST_LOG,JSON.stringify({file:path.basename(process.argv[1]),args:process.argv.slice(2),hasKey:Boolean(process.env.GYMFIT_API_KEY),correctKey:process.env.GYMFIT_API_KEY==='synthetic-local-key',hasKeyFile:Boolean(process.env.GYMFIT_API_KEY_FILE)})+'\\n'); process.exit(process.argv[2]==='auto'?2:0);`;
  for (const name of ['docker-local.mjs', 'gymfit-import-docker.mjs']) fs.writeFileSync(path.join(directory, 'scripts', name), stub);
  fs.writeFileSync(launcher, template.replace("const API_KEY = 'INCOLLA_LA_TUA_CHIAVE_API';", "const API_KEY = 'synthetic-local-key';"));
  const result = spawnSync(process.execPath, [launcher], { encoding: 'utf8', cwd: os.tmpdir(), env: { ...process.env, GYMFIT_LAUNCH_TEST_LOG: log, GYMFIT_API_KEY: 'old-key', GYMFIT_API_KEY_FILE: '/missing/old-key-file' } });
  assert.equal(result.status, 2, result.stderr);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.args), [['db'], ['auto']]);
  assert.equal(calls[0].hasKey, false); assert.equal(calls[1].correctKey, true);
  assert.ok(calls.every(call => !call.hasKeyFile));
  assert.ok(!result.stdout.includes('synthetic-local-key'));
});
