'use strict';

const { randomUUID } = require('node:crypto');
const { InputError } = require('../libs/validation');
const { workoutLoad } = require('../shared/workout-load.mjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new InputError('Scheda non valida.', 400, 'WORKOUT_INVALID');
const missing = () => new InputError('Scheda non trovata.', 404, 'WORKOUT_NOT_FOUND');
const conflict = () => new InputError('La scheda è stata modificata. Ricaricala prima di salvare.', 409, 'WORKOUT_CONFLICT');

function validateWorkout(input, update = false) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120
    || typeof (input.notes ?? '') !== 'string' || (input.notes || '').length > 2000
    || !Array.isArray(input.exercises) || !input.exercises.length || input.exercises.length > 40
    || (update && (!Number.isSafeInteger(input.version) || input.version < 1))) throw invalid();
  let count = 0;
  const exercises = input.exercises.map(exercise => {
    if (!exercise || !UUID.test(exercise.importId) || !UUID.test(exercise.exerciseId)
      || !Array.isArray(exercise.sets) || !exercise.sets.length || exercise.sets.length > 30) throw invalid();
    count += exercise.sets.length;
    const sets = exercise.sets.map(set => {
      if (!set || !Number.isInteger(set.repetitions) || set.repetitions < 1 || set.repetitions > 1000
        || (set.loadKg !== null && (typeof set.loadKg !== 'number' || !Number.isFinite(set.loadKg) || set.loadKg < 0 || set.loadKg > 10000 || Math.abs(set.loadKg * 100 - Math.round(set.loadKg * 100)) > 1e-6))
        || !Number.isInteger(set.restSeconds) || set.restSeconds < 0 || set.restSeconds > 3600) throw invalid();
      return { repetitions: set.repetitions, loadKg: set.loadKg, restSeconds: set.restSeconds };
    });
    return { importId: exercise.importId.toLowerCase(), exerciseId: exercise.exerciseId.toLowerCase(), sets };
  });
  if (count > 300) throw invalid();
  return { name: input.name.trim(), notes: (input.notes || '').trim(), version: input.version, exercises };
}

function pageOptions(input = {}) {
  const page = input.page === undefined ? 1 : Number(input.page);
  if (!Number.isInteger(page) || page < 1 || page > 10000 || (input.q !== undefined && (typeof input.q !== 'string' || input.q.length > 100))) throw invalid();
  return { page, q: (input.q || '').trim(), limit: 24, offset: (page - 1) * 24 };
}

function createWorkoutRepository({ query, transaction }) {
  // SQL only exposes catalog summaries; import checkpoints and raw payloads stay private.
  async function hydrateCatalog(conn, rows) {
    if (!rows.length) return [];
    const pairs = rows.map(row => [row.importId, row.exerciseId]);
    const links = await conn.query(`SELECT em.import_id AS importId, em.exercise_id AS exerciseId, g.id, g.name,
      MAX(em.role='target') AS isTarget FROM gymfit_exercise_muscles em
      JOIN gymfit_muscles m ON m.import_id=em.import_id AND m.id=em.muscle_id
      JOIN gymfit_muscle_groups g ON g.import_id=m.import_id AND g.id=m.group_id
      WHERE (em.import_id,em.exercise_id) IN (${pairs.map(() => '(?,?)').join(',')})
      GROUP BY em.import_id,em.exercise_id,g.id,g.name`, pairs.flat());
    const grouped = new Map();
    for (const link of links) {
      const key = `${link.importId}:${link.exerciseId}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ id: link.id, name: link.name, role: link.isTarget ? 'target' : 'synergist' });
    }
    return rows.map(row => ({ ...row, groups: grouped.get(`${row.importId}:${row.exerciseId}`) || [] }));
  }
  async function read(conn, profileId, id) {
    const [routine] = await conn.query('SELECT id,name,notes,version,created_at AS createdAt,updated_at AS updatedAt FROM workout_routines WHERE id=? AND profile_id=?', [id, profileId]);
    if (!routine) throw missing();
    const entries = await conn.query(`SELECT r.id, r.import_id AS importId, r.exercise_id AS exerciseId, e.name,e.equipment
      FROM workout_routine_exercises r JOIN gymfit_exercises e ON e.import_id=r.import_id AND e.id=r.exercise_id
      WHERE r.routine_id=? ORDER BY r.position`, [id]);
    const sets = await conn.query(`SELECT s.exercise_entry_id AS entryId,s.repetitions,s.load_kg AS loadKg,s.rest_seconds AS restSeconds
      FROM workout_routine_sets s JOIN workout_routine_exercises r ON r.id=s.exercise_entry_id
      WHERE r.routine_id=? ORDER BY r.position,s.position`, [id]);
    const byEntry = new Map();
    for (const set of sets) {
      if (!byEntry.has(set.entryId)) byEntry.set(set.entryId, []);
      byEntry.get(set.entryId).push({ repetitions: set.repetitions, loadKg: set.loadKg === null ? null : Number(set.loadKg), restSeconds: set.restSeconds });
    }
    routine.exercises = (await hydrateCatalog(conn, entries)).map(row => ({ ...row, sets: byEntry.get(row.id) || [] }));
    routine.load = workoutLoad(routine.exercises);
    return routine;
  }
  async function save(profileId, input, id) {
    const value = validateWorkout(input, Boolean(id));
    return transaction(async conn => {
      let version = 1;
      if (id) {
        const [existing] = await conn.query('SELECT version FROM workout_routines WHERE id=? AND profile_id=? FOR UPDATE', [id, profileId]);
        if (!existing) throw missing();
        if (existing.version !== value.version) throw conflict();
        version = existing.version + 1;
      } else id = randomUUID();
      // Validate all references before replacing any saved rows.
      for (const exercise of value.exercises) {
        const [exists] = await conn.query(`SELECT e.id FROM gymfit_exercises e JOIN gymfit_imports i ON i.id=e.import_id
          WHERE e.import_id=? AND e.id=? AND i.status='completed' LOCK IN SHARE MODE`, [exercise.importId, exercise.exerciseId]);
        if (!exists) throw new InputError('Esercizio non disponibile nel catalogo.', 400, 'WORKOUT_EXERCISE_INVALID');
      }
      const time = new Date().toISOString();
      if (version === 1) await conn.query('INSERT INTO workout_routines(id,profile_id,name,notes,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [id, profileId, value.name, value.notes, version, time, time]);
      else {
        await conn.query('UPDATE workout_routines SET name=?,notes=?,version=?,updated_at=? WHERE id=? AND profile_id=?', [value.name, value.notes, version, time, id, profileId]);
        await conn.query('DELETE FROM workout_routine_exercises WHERE routine_id=?', [id]);
      }
      for (const [position, exercise] of value.exercises.entries()) {
        const entryId = randomUUID();
        await conn.query('INSERT INTO workout_routine_exercises(id,routine_id,position,import_id,exercise_id) VALUES (?,?,?,?,?)', [entryId, id, position, exercise.importId, exercise.exerciseId]);
        await conn.batch('INSERT INTO workout_routine_sets(exercise_entry_id,position,repetitions,load_kg,rest_seconds) VALUES (?,?,?,?,?)', exercise.sets.map((set, index) => [entryId, index, set.repetitions, set.loadKg, set.restSeconds]));
      }
      return read(conn, profileId, id);
    });
  }
  return {
    async workoutCatalog() {
      return transaction(async conn => {
        const [active] = await conn.query('SELECT id FROM gymfit_imports WHERE active_slot=1');
        if (!active) return { available: false, groups: [], equipment: [] };
        const groups = await conn.query('SELECT id,name FROM gymfit_muscle_groups WHERE import_id=? ORDER BY name', [active.id]);
        const equipment = await conn.query('SELECT DISTINCT equipment FROM gymfit_exercises WHERE import_id=? AND equipment IS NOT NULL ORDER BY equipment', [active.id]);
        return { available: true, importId: active.id, groups: Array.from(groups), equipment: equipment.map(row => row.equipment) };
      });
    },
    async searchWorkoutExercises(input) {
      const { page, q, limit, offset } = pageOptions(input);
      if ((input.group && (typeof input.group !== 'string' || !UUID.test(input.group))) || (input.equipment && (typeof input.equipment !== 'string' || input.equipment.length > 64))) throw invalid();
      return transaction(async conn => {
        const [active] = await conn.query('SELECT id FROM gymfit_imports WHERE active_slot=1');
        if (!active) return { items: [], total: 0, page, pageSize: limit };
        const params = [active.id, q];
        let where = 'e.import_id=? AND LOCATE(LOWER(?),LOWER(e.name))>0';
        if (input.equipment) { where += ' AND e.equipment=?'; params.push(input.equipment); }
        if (input.group) {
          where += ' AND EXISTS (SELECT 1 FROM gymfit_exercise_muscles em JOIN gymfit_muscles m ON m.import_id=em.import_id AND m.id=em.muscle_id WHERE em.import_id=e.import_id AND em.exercise_id=e.id AND m.group_id=?)'; params.push(input.group);
        }
        const [count] = await conn.query(`SELECT COUNT(*) AS n FROM gymfit_exercises e WHERE ${where}`, params);
        const rows = await conn.query(`SELECT e.import_id AS importId,e.id AS exerciseId,e.name,e.equipment,e.category FROM gymfit_exercises e WHERE ${where} ORDER BY e.name,e.id LIMIT ? OFFSET ?`, [...params, limit, offset]);
        return { items: await hydrateCatalog(conn, rows), total: Number(count.n), page, pageSize: limit };
      });
    },
    async listWorkouts(profileId, input) {
      const { page, q, limit, offset } = pageOptions(input);
      return transaction(async conn => {
        const [count] = await conn.query('SELECT COUNT(*) AS n FROM workout_routines WHERE profile_id=? AND LOCATE(LOWER(?),LOWER(name))>0', [profileId, q]);
        const ids = await conn.query('SELECT id FROM workout_routines WHERE profile_id=? AND LOCATE(LOWER(?),LOWER(name))>0 ORDER BY updated_at DESC,id LIMIT ? OFFSET ?', [profileId, q, limit, offset]);
        const items = [];
        for (const row of ids) items.push(await read(conn, profileId, row.id));
        return { items, total: Number(count.n), page, pageSize: limit };
      });
    },
    getWorkout: (profileId, id) => transaction(conn => read(conn, profileId, id)),
    saveWorkout: save,
    async deleteWorkout(profileId, id, version) {
      if (!Number.isSafeInteger(version) || version < 1) throw invalid();
      return transaction(async conn => {
        const [row] = await conn.query('SELECT version FROM workout_routines WHERE id=? AND profile_id=? FOR UPDATE', [id, profileId]);
        if (!row) throw missing();
        if (row.version !== version) throw conflict();
        await conn.query('DELETE FROM workout_routines WHERE id=? AND profile_id=?', [id, profileId]);
      });
    },
  };
}

module.exports = { createWorkoutRepository, validateWorkout };
