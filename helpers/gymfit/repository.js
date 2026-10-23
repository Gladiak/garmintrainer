'use strict';

const { ImportError, identity, requireValue } = require('./model');
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const decode = row => row && { ...row, reference_data: json(row.reference_data), checkpoint: json(row.checkpoint) };

// The dedicated connection owns the advisory lock until the CLI closes it.
function createRepository(connection) {
  let locked = false;
  async function lock() {
    const [row] = await connection.query("SELECT GET_LOCK('garmintrainer_gymfit_import', 0) AS acquired");
    if (row.acquired !== 1) throw new ImportError('IMPORT_LOCKED', 'Un’altra importazione è già in esecuzione.', 'paused');
    locked = true;
  }
  async function guard() {
    if (!locked) throw new ImportError('IMPORT_LOCKED', 'Lock dell’importazione non acquisito.');
    const [row] = await connection.query("SELECT IS_USED_LOCK('garmintrainer_gymfit_import') = CONNECTION_ID() AS owned");
    if (row.owned !== 1) throw new ImportError('IMPORT_LOCK_LOST', 'Connessione o lock persi. Riprendere con resume.', 'paused');
  }
  async function save(run) {
    await guard();
    await connection.query(`UPDATE gymfit_imports SET status=?,request_budget=?,requests_started=?,requests_succeeded=?,requests_per_minute=?,
      next_request_at=?,quota_remaining=?,quota_reset_at=?,expected_exercises=?,expected_muscles=?,expected_groups=?,
      catalog_complete=?,muscle_map_complete=?,reference_data=?,checkpoint=?,last_error_code=?,last_request_id=?,updated_at=?,finished_at=? WHERE id=?`,
    [run.status, run.request_budget, run.requests_started, run.requests_succeeded, run.requests_per_minute,
      run.next_request_at, run.quota_remaining, run.quota_reset_at, run.expected_exercises, run.expected_muscles, run.expected_groups,
      run.catalog_complete || 0, run.muscle_map_complete || 0, JSON.stringify(run.reference_data), JSON.stringify(run.checkpoint),
      run.last_error_code || null, run.last_request_id || null, Date.now(), run.finished_at || null, run.id]);
  }
  async function commit(run, write = async () => {}) {
    await guard();
    await connection.beginTransaction();
    try { await write(); await save(run); await connection.commit(); }
    catch (error) { await connection.rollback(); throw error; }
  }
  async function upsert(table, run, item, fields, source) {
    identity(item);
    const [existing] = await connection.query(`SELECT source_payload FROM ${table} WHERE import_id=? AND id=?`, [run.id, item.id]);
    const payload = { ...(existing ? json(existing.source_payload) : {}), [source]: item };
    const values = { name: item.name, ...fields, source_payload: JSON.stringify(payload) };
    const names = Object.keys(values);
    await connection.query(`INSERT INTO ${table} (import_id,id,${names.join(',')}) VALUES (?,?${',?'.repeat(names.length)})
      ON DUPLICATE KEY UPDATE ${names.map(name => `${name}=VALUES(${name})`).join(',')}`, [run.id, item.id, ...Object.values(values)]);
  }
  async function groups(run, value) {
    requireValue(Array.isArray(value) && value.length === run.expected_groups, 'Elenco gruppi incompleto.');
    const ids = new Set(); const muscles = new Set();
    for (const group of value) {
      identity(group); requireValue(!ids.has(group.id) && Array.isArray(group.muscles), 'Gruppo duplicato o privo di muscoli.'); ids.add(group.id);
      await upsert('gymfit_muscle_groups', run, group, {}, 'taxonomy');
      for (const muscle of group.muscles) {
        identity(muscle); requireValue(!muscles.has(muscle.id), 'Muscolo ripetuto nella tassonomia.'); muscles.add(muscle.id);
        await upsert('gymfit_muscles', run, muscle, { group_id: group.id, common_name: optional(muscle.commonName, 255) }, 'taxonomy');
      }
    }
    // The grouped endpoint can omit catalog muscles. Complete the canonical set
    // from /muscles/search instead of equating this grouped view with /meta.
  }
  async function muscleSummaries(run, items) {
    const groups = await connection.query('SELECT id,name FROM gymfit_muscle_groups WHERE import_id=?', [run.id]);
    const byName = new Map(groups.map(group => [group.name.trim().toLowerCase(), group.id]));
    requireValue(byName.size === groups.length, 'Nomi dei gruppi muscolari ambigui.');
    for (const item of items) {
      const [existing] = await connection.query('SELECT group_id FROM gymfit_muscles WHERE import_id=? AND id=?', [run.id, item.id]);
      let groupId = existing?.group_id || null;
      const groupName = optional(item.group, 255);
      if (groupName?.trim()) {
        const fromSearch = byName.get(groupName.trim().toLowerCase());
        requireValue(fromSearch, 'La ricerca muscoli indica un gruppo non presente nell’elenco dei gruppi.');
        requireValue(!groupId || groupId === fromSearch, 'Gruppo muscolare discordante fra tassonomia e ricerca.');
        groupId = fromSearch;
      }
      await upsert('gymfit_muscles', run, item, { group_id: groupId, body_part: optional(item.bodyPart, 32), common_name: optional(item.commonName, 255) }, 'search');
    }
  }
  async function exercises(run, items, slice) {
    let dualRoleLinks = 0;
    for (const item of items) {
      const [existing] = await connection.query('SELECT catalog_seen FROM gymfit_exercises WHERE import_id=? AND id=?', [run.id, item.id]);
      const fields = { fetched_at: Date.now(), catalog_seen: slice.kind === 'catalog' || existing?.catalog_seen ? 1 : 0 };
      for (const [key, target, size] of [['slug', 'slug', 255], ['equipment', 'equipment', 64], ['bodyPart', 'body_part', 32], ['category', 'category', 32], ['difficulty', 'difficulty', 32], ['trackingType', 'tracking_type', 32]]) {
        if (Object.hasOwn(item, key)) fields[target] = optional(item[key], size);
      }
      await upsert('gymfit_exercises', run, item, fields, 'search');
      if (slice.kind === 'muscle') {
        const links = await connection.query('SELECT role FROM gymfit_exercise_muscles WHERE import_id=? AND exercise_id=? AND muscle_id=?', [run.id, item.id, slice.muscleId]);
        if (!links.some(link => link.role === slice.role)) {
          if (links.length) dualRoleLinks++;
          await connection.query('INSERT INTO gymfit_exercise_muscles(import_id,exercise_id,muscle_id,role) VALUES (?,?,?,?)', [run.id, item.id, slice.muscleId, slice.role]);
        }
      }
    }
    return { dualRoleLinks };
  }
  async function counts(run) {
    const result = {};
    for (const [key, table] of [['groups', 'gymfit_muscle_groups'], ['muscles', 'gymfit_muscles'], ['exercises', 'gymfit_exercises'], ['links', 'gymfit_exercise_muscles']]) {
      const [row] = await connection.query(`SELECT COUNT(*) AS n FROM ${table} WHERE import_id=?`, [run.id]); result[key] = Number(row.n);
    }
    const [missing] = await connection.query('SELECT COUNT(*) AS n FROM gymfit_exercises WHERE import_id=? AND catalog_seen=0', [run.id]); result.unseen = Number(missing.n);
    const [ungrouped] = await connection.query(`SELECT COUNT(*) AS n FROM gymfit_muscles m WHERE m.import_id=? AND m.group_id IS NULL
      AND EXISTS (SELECT 1 FROM gymfit_exercise_muscles em WHERE em.import_id=m.import_id AND em.muscle_id=m.id)`, [run.id]); result.ungrouped = Number(ungrouped.n);
    return result;
  }
  async function samples(run, count) {
    const items = await connection.query('SELECT id FROM gymfit_exercises WHERE import_id=? ORDER BY id', [run.id]);
    return [...new Set(Array.from({ length: Math.min(count, items.length) }, (_, i) => items[Math.floor(i * (items.length - 1) / Math.max(1, Math.min(count, items.length) - 1))].id))];
  }
  async function links(run, exerciseId) {
    return connection.query('SELECT muscle_id,role FROM gymfit_exercise_muscles WHERE import_id=? AND exercise_id=?', [run.id, exerciseId]);
  }
  async function publish(run) {
    await guard();
    await connection.beginTransaction();
    try {
      const [old] = await connection.query('SELECT id FROM gymfit_imports WHERE active_slot=1 FOR UPDATE');
      if (old && old.id !== run.id) {
        await connection.query('UPDATE gymfit_imports SET active_slot=NULL WHERE id=?', [old.id]);
      }
      await save(run);
      await connection.query('UPDATE gymfit_imports SET active_slot=1,published_at=? WHERE id=?', [Date.now(), run.id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
  }
  return {
    lock, guard, save, commit, groups, muscleSummaries, exercises, counts, samples, links, publish,
    async create(run) {
      await guard();
      await connection.query('INSERT INTO gymfit_imports(id,reference_data,checkpoint,started_at,updated_at) VALUES (?,?,?,?,?)', [run.id, '{}', JSON.stringify(run.checkpoint), Date.now(), Date.now()]);
      await save(run);
    },
    async get(id) { return decode((await connection.query('SELECT * FROM gymfit_imports WHERE id=?', [id]))[0]); },
    async latest() { return decode((await connection.query('SELECT * FROM gymfit_imports ORDER BY started_at DESC,id DESC LIMIT 1'))[0]); },
    async lastRequestAt() { return Number((await connection.query('SELECT MAX(next_request_at) AS n FROM gymfit_imports'))[0].n || 0); },
    async unclassifiedMuscles(run) { return connection.query('SELECT id,name FROM gymfit_muscles WHERE import_id=? AND group_id IS NULL', [run.id]); },
    async muscleIds(run) { return (await connection.query('SELECT id FROM gymfit_muscles WHERE import_id=? ORDER BY id', [run.id])).map(item => item.id); },
  };
}

function optional(value, max) {
  requireValue(value == null || (typeof value === 'string' && value.length <= max), 'Campo testuale del servizio non valido.');
  return value ?? null;
}

module.exports = { createRepository };
