'use strict';

const { createHash } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { UUID, allIds, verifyTask, ImportError } = require('./model');
const { createRepository } = require('./repository');

// Only these catalog columns can enter or leave a database through this tool.
const COLUMNS = {
  gymfit_imports: ['id', 'status', 'active_slot', 'api_version', 'checkpoint_version', 'request_budget', 'requests_started', 'requests_succeeded', 'requests_per_minute', 'next_request_at', 'quota_remaining', 'quota_reset_at', 'expected_exercises', 'expected_muscles', 'expected_groups', 'catalog_complete', 'muscle_map_complete', 'reference_data', 'checkpoint', 'last_error_code', 'last_request_id', 'started_at', 'updated_at', 'finished_at', 'published_at'],
  gymfit_muscle_groups: ['import_id', 'id', 'name', 'source_payload'],
  gymfit_muscles: ['import_id', 'id', 'group_id', 'name', 'common_name', 'body_part', 'source_payload'],
  gymfit_exercises: ['import_id', 'id', 'slug', 'name', 'equipment', 'body_part', 'category', 'difficulty', 'tracking_type', 'source_payload', 'catalog_seen', 'fetched_at'],
  gymfit_exercise_muscles: ['import_id', 'exercise_id', 'muscle_id', 'role'],
};
const JSON_COLUMNS = new Set(['reference_data', 'checkpoint', 'source_payload']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pair = row => `${row.exercise_id}:${row.muscle_id}`;
const edge = row => `${pair(row)}:${row.role}`;
const sameSet = (a, b) => a.size === b.size && [...a].every(value => b.has(value));

// The caller owns the transaction, allowing export to read a consistent snapshot.
async function readCatalog(connection, id) {
  if (!id) id = (await connection.query('SELECT id FROM gymfit_imports WHERE active_slot=1'))[0]?.id;
  if (!id || !UUID.test(id)) throw new ImportError('IMPORT_NOT_FOUND', 'Catalogo attivo o UUID non trovato.');
  const tables = {};
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const order = table === 'gymfit_exercise_muscles' ? 'exercise_id,muscle_id,role' : 'id';
    const rows = await connection.query(`SELECT ${columns.join(',')} FROM ${table} WHERE ${table === 'gymfit_imports' ? 'id' : 'import_id'}=? ORDER BY ${order}`, [id]);
    tables[table] = rows.map(row => Object.fromEntries(columns.map(column => [column, JSON_COLUMNS.has(column) && typeof row[column] === 'string' ? JSON.parse(row[column]) : row[column]])));
  }
  if (tables.gymfit_imports.length !== 1) throw new ImportError('IMPORT_NOT_FOUND', 'Importazione non trovata.');
  return { schemaVersion: 8, tables };
}

// Compare exact UUID/role sets with every checkpoint, beyond SQL row totals.
function auditCatalog(snapshot) {
  const errors = []; const warnings = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  if (!object(snapshot) || snapshot.schemaVersion !== 8 || !object(snapshot.tables)
    || !sameSet(new Set(Object.keys(snapshot.tables)), new Set(Object.keys(COLUMNS)))
    || Object.values(snapshot.tables).some(rows => !Array.isArray(rows))) {
    return { ok: false, errors: ['Formato o versione del catalogo non supportati.'], warnings };
  }
  const tables = snapshot.tables;
  for (const [table, columns] of Object.entries(COLUMNS)) {
    check(tables[table].every(row => object(row) && sameSet(new Set(Object.keys(row)), new Set(columns))), `Colonne non valide: ${table}.`);
  }
  if (errors.length || tables.gymfit_imports.length !== 1) return { ok: false, errors: [...errors, ...(tables.gymfit_imports.length !== 1 ? ['Attesa una sola importazione.'] : [])], warnings };
  const [run] = tables.gymfit_imports;
  const groups = tables.gymfit_muscle_groups; const muscles = tables.gymfit_muscles;
  const exercises = tables.gymfit_exercises; const links = tables.gymfit_exercise_muscles;
  const groupIds = new Set(groups.map(row => row.id)); const muscleIds = new Set(muscles.map(row => row.id));
  const exerciseIds = new Set(exercises.map(row => row.id)); const edgeIds = new Set(links.map(edge));
  const linkedMuscles = new Set(links.map(row => row.muscle_id)); const linkedExercises = new Set(links.map(row => row.exercise_id));
  const pairs = new Set(links.map(pair));
  check(UUID.test(run.id) && run.api_version === 2 && run.checkpoint_version === 1, 'Identità/versione importazione non valida.');
  check(run.status === 'completed' && run.catalog_complete === 1 && run.muscle_map_complete === 1 && Number.isSafeInteger(run.finished_at), 'Importazione non completata.');
  check((run.active_slot === null || run.active_slot === 1) && (run.active_slot !== 1 || Number.isSafeInteger(run.published_at)), 'Stato di pubblicazione non valido.');
  for (const [rows, expected, label] of [[groups, run.expected_groups, 'gruppi'], [muscles, run.expected_muscles, 'muscoli'], [exercises, run.expected_exercises, 'esercizi']]) {
    check(Number.isSafeInteger(expected) && expected > 0 && rows.length === expected, `Conteggio ${label} diverso da meta.`);
    check(new Set(rows.map(row => row.id)).size === rows.length, `UUID duplicati: ${label}.`);
    check(rows.every(row => UUID.test(row.id) && row.import_id === run.id && typeof row.name === 'string' && row.name.trim() && object(row.source_payload)), `Identità, nome o payload non valido: ${label}.`);
  }
  check(muscles.every(row => row.group_id === null || groupIds.has(row.group_id)), 'Muscoli con gruppi inesistenti.');
  check(muscles.every(row => row.group_id !== null || !linkedMuscles.has(row.id)), 'Muscoli usati dagli esercizi senza gruppo.');
  check(links.every(row => row.import_id === run.id && exerciseIds.has(row.exercise_id) && muscleIds.has(row.muscle_id) && ['target', 'synergist'].includes(row.role)), 'Associazioni con riferimenti o ruoli non validi.');
  check(edgeIds.size === links.length, 'Associazioni duplicate per esercizio/muscolo/ruolo.');
  check(exercises.every(row => row.catalog_seen === 1), 'Esercizi non confermati nel catalogo per famiglie.');
  const slugs = exercises.filter(row => row.slug !== null).map(row => row.slug);
  check(new Set(slugs).size === slugs.length, 'Slug duplicati.');
  const cp = run.checkpoint; const meta = run.reference_data?.meta;
  check(meta?.exercises?.total === run.expected_exercises && meta?.muscles === run.expected_muscles && meta?.muscleGroups === run.expected_groups, 'Conteggi meta non corrispondenti all’importazione.');
  if (!object(cp) || !Array.isArray(cp.catalog) || !Array.isArray(cp.muscles) || !Array.isArray(cp.samples)) errors.push('Checkpoint mancante o non valido.');
  else {
    check(cp.phase === 'completed' && cp.finalMeta === true && !cp.pendingPage, 'Checkpoint non concluso.');
    check(Number.isInteger(cp.sampleCount) && cp.sampleCount >= 1 && cp.samples.length === Math.min(cp.sampleCount, exercises.length) && new Set(cp.samples).size === cp.samples.length && cp.samples.every(id => exerciseIds.has(id)), 'Controlli campione incompleti o duplicati.');
    try {
      [...cp.catalog, ...cp.muscles].forEach(verifyTask);
      check(sameSet(new Set(cp.catalog.flatMap(allIds)), exerciseIds), 'UUID del catalogo SQL diversi dai checkpoint delle famiglie.');
      const expectedEdges = new Set(cp.muscles.flatMap(slice => allIds(slice).map(id => `${id}:${slice.muscleId}:${slice.role}`)));
      check(sameSet(expectedEdges, edgeIds), 'Associazioni SQL diverse dai checkpoint muscolo/ruolo.');
      check(cp.muscles.length === muscles.length * 2 && sameSet(new Set(cp.muscles.map(slice => `${slice.muscleId}:${slice.role}`)), new Set(muscles.flatMap(row => [`${row.id}:target`, `${row.id}:synergist`]))), 'Ricerche mancanti, duplicate o inattese per muscolo/ruolo.');
    } catch { errors.push('Partizioni incomplete, duplicate o con totali discordanti.'); }
  }
  const unmapped = exercises.filter(row => !linkedExercises.has(row.id));
  const unclassified = muscles.filter(row => row.group_id === null);
  const dualRolePairs = links.length - pairs.size;
  if (unmapped.length) warnings.push(`${unmapped.length} esercizi senza associazioni: richiedono una mappa locale per il calcolo dell’impatto.`);
  if (unclassified.length) warnings.push(`${unclassified.length} muscoli senza gruppo e senza esercizi associati.`);
  if (dualRolePairs) warnings.push(`${dualRolePairs} coppie esercizio/muscolo con entrambi i ruoli: aggregare prima dei calcoli.`);
  return { ok: errors.length === 0, id: run.id, active: run.active_slot === 1, errors, warnings,
    counts: { groups: groups.length, muscles: muscles.length, exercises: exercises.length, links: links.length, uniqueExerciseMusclePairs: pairs.size, dualRolePairs, unmappedExercises: unmapped.length },
    unclassifiedMuscles: unclassified.map(row => ({ id: row.id, name: row.name })),
    unmappedExamples: unmapped.slice(0, 10).map(row => ({ id: row.id, name: row.name })),
    samplesVerifiedDuringImport: cp?.samples?.length || 0 };
}

function requireHealthy(snapshot) {
  const report = auditCatalog(snapshot);
  if (!report.ok) throw new ImportError('CATALOG_INVALID', `Catalogo non valido: ${report.errors.join(' ')}`);
  return report;
}

function packCatalog(snapshot) {
  requireHealthy(snapshot);
  return gzipSync(Buffer.from(JSON.stringify({ format: 'garmintrainer-gymfit', version: 1, sha256: digest(snapshot), snapshot })), { level: 9 });
}

function unpackCatalog(buffer) {
  let envelope;
  try { envelope = JSON.parse(gunzipSync(buffer, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8')); }
  catch { throw new ImportError('ARCHIVE_INVALID', 'Pacchetto gzip/JSON non valido o oltre 64 MiB decompressi.'); }
  if (envelope?.format !== 'garmintrainer-gymfit' || envelope.version !== 1 || envelope.sha256 !== digest(envelope.snapshot)) throw new ImportError('ARCHIVE_INVALID', 'Formato o checksum SHA-256 del pacchetto non valido.');
  // Verify the original checksum before adapting an older archive to English names.
  const snapshot = envelope.snapshot;
  if (snapshot?.schemaVersion === 7 && object(snapshot.tables)) {
    const legacyNames = ['name_it', 'name_fr', 'name_es', 'name_de'];
    for (const table of ['gymfit_muscle_groups', 'gymfit_muscles', 'gymfit_exercises']) {
      if (Array.isArray(snapshot.tables[table])) for (const row of snapshot.tables[table]) {
        if (object(row)) for (const column of legacyNames) delete row[column];
      }
    }
    snapshot.schemaVersion = 8;
  }
  requireHealthy(snapshot);
  return snapshot;
}

// Stage a new immutable version. Activation is a separate publish command.
async function restoreCatalog(connection, snapshot) {
  requireHealthy(snapshot);
  const run = structuredClone(snapshot.tables.gymfit_imports[0]);
  const repo = createRepository(connection); await repo.lock();
  if (await repo.get(run.id)) throw new ImportError('IMPORT_EXISTS', 'UUID già presente: nessun dato sovrascritto. Usa audit per verificarlo e publish per attivarlo.');
  run.active_slot = null; run.published_at = null;
  await repo.commit(run, async () => {
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const rows = table === 'gymfit_imports' ? [run] : snapshot.tables[table];
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        const values = batch.flatMap(row => columns.map(column => JSON_COLUMNS.has(column) ? JSON.stringify(row[column]) : row[column]));
        await connection.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',')}`, values);
      }
    }
    requireHealthy(await readCatalog(connection, run.id));
  });
  return requireHealthy(await readCatalog(connection, run.id));
}

module.exports = { readCatalog, auditCatalog, requireHealthy, packCatalog, unpackCatalog, restoreCatalog };
