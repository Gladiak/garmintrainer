'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const mariadb = require('mariadb');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { readConfig } = require('../libs/config');
const { migrateMariaDatabase } = require('../libs/mariadb-migrations');
const { createRepository } = require('../helpers/gymfit/repository');
const { newImport, importCatalog } = require('../helpers/gymfit/importer');
const { ImportError } = require('../helpers/gymfit/model');
const { gymfitFixture, id } = require('./gymfit-fixtures');
const { readCatalog, auditCatalog, packCatalog, unpackCatalog, restoreCatalog } = require('../helpers/gymfit/catalog');
const { gzipSync, gunzipSync } = require('node:zlib');

test('GymFit MariaDB: importazione, retry, ripresa e pubblicazione isolata', async t => {
  const connection = await mariadb.createConnection(readConfig().database);
  const schema = `gymfit_test_${randomUUID().replaceAll('-', '')}`;
  await connection.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE ${schema}`);
  t.after(async () => { await connection.query(`DROP DATABASE ${schema}`); await connection.end(); });
  await migrateMariaDatabase(connection); await migrateMariaDatabase(connection);
  assert.equal((await connection.query('SELECT MAX(version) AS n FROM schema_migrations'))[0].n, 9);
  const repo = createRepository(connection); await repo.lock();
  const fixture = gymfitFixture(); const events = [];
  const execute = (run, extra = {}, provider = fixture) => importCatalog({ repository: repo, client: provider.client, run, emit: event => events.push(event), now: () => provider.clock, sleep: provider.sleep, random: () => 0, ...extra });
  let first;

  await t.test('preflight salva prime pagine e retry senza pubblicare', async () => {
    let metaFailed = false; let rateFailed = false;
    fixture.fault = (path, params) => {
      if (path === '/v2/meta' && !metaFailed) { metaFailed = true; return { status: 503, data: { code: 'internal_error' } }; }
      if (path.includes('/muscles/') && params.muscleRole === 'target' && !rateFailed) { rateFailed = true; return { status: 429, headers: new Headers({ 'Retry-After': '5' }), data: { code: 'rate_limited' } }; }
      return null;
    };
    first = newImport({ sample: 2 }); await repo.create(first);
    await assert.rejects(execute(first, { preflight: true }), error => error.code === 'PREFLIGHT_COMPLETE');
    first = await repo.get(first.id);
    assert.equal(first.status, 'paused'); assert.equal(first.checkpoint.phase, 'catalog');
    assert.equal(first.active_slot, null);
    assert.equal((await repo.counts(first)).links, 200);
    assert.equal(events.filter(event => event.type === 'retry').length, 2);
    assert.ok(events.some(event => event.code === 'rate_limited' && event.delaySeconds >= 5));
    fixture.fault = null;
  });

  await t.test('resume non ripete le prime pagine e attiva solo a verifica conclusa', async () => {
    await execute(first);
    first = await repo.get(first.id);
    assert.equal(first.status, 'completed'); assert.equal(first.active_slot, 1);
    assert.deepEqual(await repo.counts(first), { groups: 2, muscles: 2, exercises: 130, links: 260, unseen: 0, ungrouped: 0 });
    assert.equal(events.at(-1).percent, 100);
    const firstPages = fixture.calls.filter(call => call.path === `/v2/muscles/${id(3)}/exercises` && call.params.muscleRole === 'target' && call.params.offset === 0);
    assert.equal(firstPages.length, 2, 'una risposta 429 e una riuscita, nessuna ripetizione dopo resume');
  });

  await t.test('migrazione dei ruoli conserva le associazioni e il catalogo già attivo', async () => {
    await connection.query('ALTER TABLE gymfit_exercise_muscles DROP PRIMARY KEY, ADD PRIMARY KEY(import_id,exercise_id,muscle_id)');
    await connection.query('DELETE FROM schema_migrations WHERE version>=7');
    await migrateMariaDatabase(connection); await migrateMariaDatabase(connection);
    assert.equal((await repo.counts(first)).links, 260);
    assert.equal((await repo.get(first.id)).active_slot, 1);
    const indexes = await connection.query('SHOW INDEX FROM gymfit_exercise_muscles WHERE Key_name=?', ['PRIMARY']);
    assert.deepEqual(indexes.map(item => item.Column_name), ['import_id', 'exercise_id', 'muscle_id', 'role']);
  });

  await t.test('rimozione colonne lingua conserva integralmente il catalogo e consente il deploy da schema 5', async () => {
    const before = await readCatalog(connection, first.id);
    const tables = ['gymfit_muscle_groups', 'gymfit_muscles', 'gymfit_exercises'];
    for (const table of tables) {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN name_it VARCHAR(255) NULL, ADD COLUMN name_fr VARCHAR(255) NULL, ADD COLUMN name_es VARCHAR(255) NULL, ADD COLUMN name_de VARCHAR(255) NULL`);
      await connection.query(`UPDATE ${table} SET name_it='Dato da rimuovere', name_fr='Élévation'`);
    }
    await connection.query('DELETE FROM schema_migrations WHERE version>=8');
    await migrateMariaDatabase(connection);
    assert.deepEqual(await readCatalog(connection, first.id), before);
    const remaining = await connection.query("SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name IN (?,?,?) AND column_name IN ('name_it','name_fr','name_es','name_de')", [schema, ...tables]);
    assert.equal(remaining.length, 0);
    // Production runs the old app with registry 5 but already contains this catalog.
    await connection.query('DELETE FROM schema_migrations WHERE version>=6');
    await migrateMariaDatabase(connection); await migrateMariaDatabase(connection);
    assert.deepEqual(await readCatalog(connection, first.id), before);
    assert.equal((await connection.query('SELECT MAX(version) AS n FROM schema_migrations'))[0].n, 9);
  });

  await t.test('archivi precedenti verificati vengono ripristinati con i soli nomi inglesi', async () => {
    const expected = await readCatalog(connection, first.id);
    const legacy = structuredClone(expected); legacy.schemaVersion = 7;
    for (const table of ['gymfit_muscle_groups', 'gymfit_muscles', 'gymfit_exercises']) for (const row of legacy.tables[table]) {
      Object.assign(row, { name_it: 'Da eliminare', name_fr: null, name_es: null, name_de: null });
    }
    const envelope = { format: 'garmintrainer-gymfit', version: 1, sha256: createHash('sha256').update(JSON.stringify(legacy)).digest('hex'), snapshot: legacy };
    assert.deepEqual(unpackCatalog(gzipSync(JSON.stringify(envelope))), expected);
    legacy.tables.gymfit_exercises[0].name_it = 'Alterato dopo il checksum';
    assert.throws(() => unpackCatalog(gzipSync(JSON.stringify(envelope))), error => error.code === 'ARCHIVE_INVALID');
  });

  await t.test('un altro worker non può acquisire il lock', async () => {
    const secondConnection = await mariadb.createConnection({ ...readConfig().database, database: schema });
    try { await assert.rejects(createRepository(secondConnection).lock(), error => error.code === 'IMPORT_LOCKED'); }
    finally { await secondConnection.end(); }
  });

  await t.test('quota e budget sospendono senza toccare la versione attiva', async () => {
    const scarce = gymfitFixture(); scarce.remaining = 102;
    const run = newImport(); await repo.create(run);
    await assert.rejects(execute(run, {}, scarce), error => error.status === 'waiting_quota');
    assert.equal((await repo.get(run.id)).status, 'waiting_quota');
    const limited = newImport({ budget: 2 }); await repo.create(limited);
    await assert.rejects(execute(limited), error => error.code === 'BUDGET_REACHED');
    assert.equal((await repo.get(limited.id)).requests_started, 2);
    assert.equal((await repo.get(first.id)).active_slot, 1);
  });

  await t.test('retry di rete limitati e recupero tramite resume', async () => {
    const provider = gymfitFixture(3);
    provider.fault = endpoint => endpoint === '/v2/meta' ? 'network' : null;
    const run = newImport({ retries: 1, sample: 1 }); await repo.create(run);
    await assert.rejects(execute(run, {}, provider), error => error.code === 'RETRY_LIMIT');
    const saved = await repo.get(run.id);
    assert.equal(saved.status, 'paused');
    assert.equal(provider.calls.filter(call => call.path === '/v2/meta').length, 2);
    provider.fault = null;
    await execute(saved, { publish: false }, provider);
    assert.equal((await repo.get(run.id)).status, 'completed');
  });

  await t.test('quota da header: una vecchia quota zero non blocca il nuovo periodo', async () => {
    const provider = gymfitFixture(3);
    provider.fault = endpoint => endpoint === '/v2/usage/current' ? { status: 403, data: { code: 'forbidden' } } : null;
    const run = newImport({ sample: 1 }); run.quota_remaining = 0; await repo.create(run);
    await execute(run, { publish: false }, provider);
    assert.equal((await repo.get(run.id)).status, 'completed');
  });

  await t.test('tassonomia parziale nei gruppi viene completata dalla ricerca muscoli', async () => {
    const provider = gymfitFixture(3); provider.groups[1].muscles = [];
    const run = newImport({ sample: 1 }); await repo.create(run);
    await execute(run, { publish: false }, provider);
    const saved = await repo.get(run.id);
    assert.equal(saved.status, 'completed');
    assert.deepEqual(await repo.counts(saved), { groups: 2, muscles: 2, exercises: 3, links: 6, unseen: 0, ungrouped: 0 });
    const [muscle] = await connection.query('SELECT group_id FROM gymfit_muscles WHERE import_id=? AND id=?', [run.id, id(4)]);
    assert.equal(muscle.group_id, id(2));
    assert.ok(events.some(event => event.id === run.id && event.code === 'GROUPED_TAXONOMY_PARTIAL'));
  });

  await t.test('una risposta riferimenti riuscita viene riutilizzata dopo errore di normalizzazione', async () => {
    const provider = gymfitFixture(3); const run = newImport({ sample: 1 }); await repo.create(run);
    const normalize = repo.groups;
    repo.groups = async () => { throw new ImportError('INVALID_RESPONSE', 'Errore di normalizzazione simulato.'); };
    try { await assert.rejects(execute(run, {}, provider), error => error.code === 'INVALID_RESPONSE'); }
    finally { repo.groups = normalize; }
    const saved = await repo.get(run.id);
    assert.deepEqual(saved.reference_data.responses.groups, provider.groups);
    assert.equal((await repo.counts(saved)).groups, 0);
    await execute(saved, { publish: false }, provider);
    const completed = await repo.get(run.id);
    assert.equal(completed.status, 'completed');
    assert.equal(provider.calls.filter(call => call.path === '/v2/muscle-groups').length, 1);
    assert.equal(Object.hasOwn(completed.reference_data.responses, 'groups'), false);
  });

  await t.test('una pagina esercizi rimane in cache se la transazione fallisce e resume non la riscarica', async () => {
    const provider = gymfitFixture(3); const run = newImport({ sample: 1 }); await repo.create(run);
    const normalize = repo.exercises;
    repo.exercises = async (...args) => { await normalize(...args); throw new ImportError('INVALID_RESPONSE', 'Errore pagina simulato.'); };
    try { await assert.rejects(execute(run, {}, provider), error => error.code === 'INVALID_RESPONSE'); }
    finally { repo.exercises = normalize; }
    const saved = await repo.get(run.id);
    assert.equal(saved.checkpoint.pendingPage.data.results.length, 3);
    assert.equal(saved.checkpoint.muscles[0].offset, 0);
    assert.equal((await repo.counts(saved)).links, 0);
    assert.equal((await repo.counts(saved)).exercises, 0);
    await execute(saved, { publish: false }, provider);
    const completed = await repo.get(run.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.checkpoint.pendingPage, undefined);
    assert.equal(provider.calls.filter(call => call.path === `/v2/muscles/${id(3)}/exercises` && call.params.muscleRole === 'target').length, 1);
  });

  await t.test('un muscolo usato privo di gruppo impedisce la pubblicazione', async () => {
    const provider = gymfitFixture(3); provider.groups[1].muscles = []; provider.muscles[1].group = null;
    const run = newImport({ sample: 1 }); await repo.create(run);
    await assert.rejects(execute(run, {}, provider), error => error.code === 'UNCLASSIFIED_MUSCLE');
    assert.equal((await repo.counts(run)).ungrouped, 1);
    assert.equal((await repo.get(run.id)).active_slot, null);
    assert.equal(provider.calls.filter(call => call.path === '/v2/exercises/search').length, 0);
    assert.equal(provider.calls.filter(call => call.path.includes(`/muscles/${id(3)}/exercises`)).length, 0);
  });

  await t.test('un muscolo senza gruppo e senza esercizi resta nel catalogo senza bloccarlo', async () => {
    const provider = gymfitFixture(3);
    provider.muscles.push({ id: id(5), name: 'Unused muscle', group: null, bodyPart: 'Legs' });
    const run = newImport({ sample: 1 }); await repo.create(run);
    await execute(run, { publish: false }, provider);
    const saved = await repo.get(run.id);
    assert.equal(saved.status, 'completed');
    assert.equal((await repo.counts(saved)).muscles, 3);
    const firstMuscleCall = provider.calls.find(call => /\/muscles\/[^/]+\/exercises$/.test(call.path));
    assert.equal(firstMuscleCall.path, `/v2/muscles/${id(5)}/exercises`);
  });

  await t.test('CTRL+C conferma la pagina in corso e resume riparte da quella successiva', async () => {
    const provider = gymfitFixture(); const controller = new AbortController();
    provider.fault = path => { if (path === '/v2/exercises/search') controller.abort(); return null; };
    const run = newImport({ sample: 2 }); await repo.create(run);
    await assert.rejects(execute(run, { signal: controller.signal }, provider), error => error.code === 'INTERRUPTED');
    const saved = await repo.get(run.id);
    assert.equal(saved.checkpoint.catalog[0].offset, 100);
    assert.equal((await repo.get(first.id)).active_slot, 1);
    provider.fault = null;
    await execute(saved, {}, provider);
    assert.equal(provider.calls.filter(call => call.path === '/v2/exercises/search' && call.params.offset === 0).length, 1);
    const [exercise] = await connection.query('SELECT name FROM gymfit_exercises WHERE import_id=? AND id=?', [saved.id, id(100)]);
    assert.equal(exercise.name, provider.exercises[0].name);
  });

  await t.test('entrambi i ruoli sono conservati e verificati con i dettagli campione', async () => {
    const provider = gymfitFixture(); provider.roleConflict = true;
    const run = newImport({ sample: 2 }); await repo.create(run);
    await execute(run, { publish: false }, provider);
    const saved = await repo.get(run.id);
    assert.equal(saved.status, 'completed');
    assert.equal((await repo.counts(saved)).links, 390);
    assert.equal((await repo.links(saved, id(100))).length, 3);
    assert.equal(saved.active_slot, null);
    assert.ok(events.some(event => event.id === run.id && event.code === 'MULTIPLE_MUSCLE_ROLES'));
    const effective = await connection.query(`SELECT muscle_id, CASE WHEN MAX(role='target')=1 THEN 'target' ELSE 'synergist' END AS role
      FROM gymfit_exercise_muscles WHERE import_id=? AND exercise_id=? GROUP BY muscle_id ORDER BY muscle_id`, [run.id, id(100)]);
    assert.deepEqual(effective.map(item => ({ ...item })), [{ muscle_id: id(3), role: 'target' }, { muscle_id: id(4), role: 'synergist' }]);
    const counts = await repo.counts(saved);
    await repo.commit(saved, () => repo.exercises(saved, provider.exercises.slice(0, 3), saved.checkpoint.muscles[1]));
    assert.deepEqual(await repo.counts(saved), counts, 'ripetere lo stesso ruolo non deve aggiungere righe');
  });

  await t.test('dettagli campione discordanti impediscono la pubblicazione', async () => {
    const provider = gymfitFixture(3); provider.invalidSample = true;
    const run = newImport({ sample: 1 }); await repo.create(run);
    await assert.rejects(execute(run, {}, provider), /campione/);
    assert.equal((await repo.get(run.id)).active_slot, null);
  });

  await t.test('oltre 1100 risultati usa partizioni senza superare offset=1000', async () => {
    const provider = gymfitFixture(1200); const run = newImport({ sample: 1 }); await repo.create(run);
    await execute(run, { publish: false }, provider);
    const saved = await repo.get(run.id);
    assert.equal(saved.status, 'completed'); assert.equal(saved.active_slot, null);
    assert.equal((await repo.counts(saved)).exercises, 1200);
    assert.ok(provider.calls.every(call => (call.params.offset || 0) <= 1000));
    assert.equal(saved.checkpoint.catalog[0].children.length, 2);
  });

  await t.test('CLI status legge lo stato locale in JSON senza chiave API', async () => {
    const latest = await repo.latest();
    const result = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../scripts/gymfit-import.js'), 'status', latest.id, '--json'], {
      env: { ...process.env, DB_NAME: schema, GYMFIT_API_KEY: '', GYMFIT_API_KEY_FILE: '' },
    });
    const status = JSON.parse(result.stdout);
    assert.equal(status.id, latest.id); assert.equal(status.status, 'completed');
    assert.equal(status.counts.exercises, 1200); assert.equal(status.percent, 100);
  });

  await t.test('audit verifica gli UUID delle associazioni oltre ai conteggi SQL', async () => {
    const snapshot = await readCatalog(connection, first.id);
    assert.equal(auditCatalog(snapshot).ok, true);
    const broken = structuredClone(snapshot);
    const link = broken.tables.gymfit_exercise_muscles[0];
    link.muscle_id = link.muscle_id === id(3) ? id(4) : id(3);
    const audit = auditCatalog(broken);
    assert.equal(audit.ok, false);
    assert.ok(audit.errors.some(error => error.includes('checkpoint muscolo/ruolo')));
  });

  await t.test('export e restore verificano SHA-256 e caricano solo un catalogo inattivo', async () => {
    const source = await readCatalog(connection, first.id);
    const incomingId = randomUUID(); source.tables.gymfit_imports[0].id = incomingId;
    source.tables.gymfit_imports[0].active_slot = 1;
    source.tables.gymfit_exercises[0].name = 'Shoulder exercise – Unicode test';
    for (const rows of Object.values(source.tables)) for (const row of rows) if (Object.hasOwn(row, 'import_id')) row.import_id = incomingId;
    const packed = packCatalog(source);
    const unpacked = unpackCatalog(packed);
    assert.deepEqual(unpacked, source);
    assert.equal(Object.keys(unpacked.tables).length, 5);
    const tampered = JSON.parse(gunzipSync(packed));
    tampered.snapshot.tables.gymfit_exercises[0].name = 'Tampered';
    assert.throws(() => unpackCatalog(gzipSync(JSON.stringify(tampered))), error => error.code === 'ARCHIVE_INVALID');
    const activeBefore = (await connection.query('SELECT id FROM gymfit_imports WHERE active_slot=1'))[0].id;
    const usersBefore = Number((await connection.query('SELECT COUNT(*) AS n FROM users'))[0].n);
    const report = await restoreCatalog(connection, unpacked);
    assert.equal(report.ok, true); assert.equal(report.active, false);
    assert.deepEqual(report.counts, auditCatalog(source).counts);
    const restored = await readCatalog(connection, incomingId);
    const expected = structuredClone(source);
    Object.assign(expected.tables.gymfit_imports[0], { active_slot: null, published_at: null, updated_at: restored.tables.gymfit_imports[0].updated_at });
    assert.deepEqual(restored, expected, 'nomi inglesi, dati e JSON rimangono invariati');
    assert.equal((await connection.query('SELECT id FROM gymfit_imports WHERE active_slot=1'))[0].id, activeBefore);
    assert.equal(Number((await connection.query('SELECT COUNT(*) AS n FROM users'))[0].n), usersBefore);
    await assert.rejects(restoreCatalog(connection, unpacked), error => error.code === 'IMPORT_EXISTS');
    const cli = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../scripts/gymfit-import.js'), 'publish', incomingId, '--json'], {
      env: { ...process.env, DB_NAME: schema, GYMFIT_API_KEY: '', GYMFIT_API_KEY_FILE: '' },
    }).catch(error => error);
    // This connection owns the import lock, so a different CLI must refuse publication.
    assert.equal(cli.code, 2);
    const staged = await repo.get(incomingId); await repo.publish(staged);
    assert.equal((await repo.get(incomingId)).active_slot, 1);
    await repo.publish(await repo.get(activeBefore));
    assert.equal((await repo.get(activeBefore)).active_slot, 1, 'rollback al catalogo precedente');
  });

  await t.test('un errore SQL durante restore annulla l’intero caricamento', async () => {
    const snapshot = await readCatalog(connection, first.id); const incomingId = randomUUID();
    snapshot.tables.gymfit_imports[0].id = incomingId;
    for (const rows of Object.values(snapshot.tables)) for (const row of rows) if (Object.hasOwn(row, 'import_id')) row.import_id = incomingId;
    const query = connection.query.bind(connection);
    connection.query = async (...args) => {
      const result = await query(...args);
      if (args[0].startsWith('INSERT INTO gymfit_exercises')) throw new Error('Errore SQL simulato.');
      return result;
    };
    try { await assert.rejects(restoreCatalog(connection, snapshot), /simulato/); }
    finally { connection.query = query; }
    assert.equal(await repo.get(incomingId), undefined);
    assert.equal(Number((await connection.query('SELECT COUNT(*) AS n FROM gymfit_exercises WHERE import_id=?', [incomingId]))[0].n), 0);
  });

});
