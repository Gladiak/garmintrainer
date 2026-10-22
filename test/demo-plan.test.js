'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('preview seeds completed history, rest days and planned workouts including two sessions today', async () => {
  const { createDemoPlan } = await import('../frontend/src/lib/demo-plan.js');
  const { trainingLoad, trainingMonthPair, trainingIntensity } = await import('../frontend/src/lib/training-load.js');
  const plan = createDemoPlan('2026-10-22');
  const current = plan.sessions.filter(session => session.date === '2026-10-22');
  assert.equal(current.length, 2);
  assert.deepEqual(current.map(session => session.status), ['completed', 'planned']);
  assert.ok(plan.sessions.some(session => session.date > '2026-10-22'));
  assert.ok(plan.sessions.filter(session => session.date > '2026-10-22').every(session => session.status === 'planned'));
  assert.equal(new Set(plan.sessions.map(session => session.id)).size, plan.sessions.length);
  assert.ok(plan.sessions.every(session => session.id.startsWith('preview:')));
  const load = trainingLoad(plan.sessions, trainingMonthPair('2026-10-22'), '2026-10-22');
  assert.ok(load.activeDays > 20);
  assert.ok(load.minutes > 0);
  assert.deepEqual([...new Set(load.daily.map(day => trainingIntensity(day.value)))].sort(), [0, 1, 2, 3, 4]);
});

test('preview creation, completion and deletion update the calendar without mutating the seeded plan', async () => {
  const { createDemoPlan, demoPlanReducer } = await import('../frontend/src/lib/demo-plan.js');
  const { trainingLoad, trainingMonthPair } = await import('../frontend/src/lib/training-load.js');
  const original = createDemoPlan('2026-10-22');
  const snapshot = JSON.stringify(original);
  const range = trainingMonthPair('2026-10-22');
  const baseline = trainingLoad(original.sessions, range, '2026-10-22').minutes;
  const created = demoPlanReducer(original, { type: 'create', values: { title: 'My preview workout', sport: 'running', date: '2026-10-22', durationMinutes: 90, notes: 'Custom note' } });
  const session = created.sessions.at(-1);
  assert.equal(session.status, 'planned');
  assert.ok(session.id.startsWith('preview:custom:'));
  assert.equal(trainingLoad(created.sessions, range, '2026-10-22').minutes, baseline);
  const completed = demoPlanReducer(created, { type: 'status', id: session.id, status: 'completed' });
  assert.equal(trainingLoad(completed.sessions, range, '2026-10-22').minutes, baseline + 90);
  assert.equal(created.sessions.at(-1).status, 'planned');
  const deleted = demoPlanReducer(completed, { type: 'delete', id: session.id });
  assert.equal(trainingLoad(deleted.sessions, range, '2026-10-22').minutes, baseline);
  assert.equal(deleted.sessions.length, original.sessions.length);
  assert.equal(JSON.stringify(original), snapshot);
  const next = demoPlanReducer(deleted, { type: 'create', values: { title: 'Another preview', sport: 'walking', date: '2026-10-22', durationMinutes: 30 } });
  assert.notEqual(next.sessions.at(-1).id, session.id);
});

test('reopening preview discards temporary changes and resets its dates to the new day', async () => {
  const { createDemoPlan, demoPlanReducer } = await import('../frontend/src/lib/demo-plan.js');
  const initial = createDemoPlan('2026-10-22');
  const edited = demoPlanReducer(initial, { type: 'delete', id: initial.sessions[0].id });
  assert.deepEqual(demoPlanReducer(edited, { type: 'reset', endDay: '2026-10-22' }), initial);
  const reset = demoPlanReducer(edited, { type: 'reset', endDay: '2026-10-23' });
  assert.equal(reset.sessions.filter(session => session.date === '2026-10-23').length, 2);
  assert.equal(reset.nextId, 1);
});

test('sample titles and notes follow all five languages while custom preview text is preserved', async () => {
  const { createDemoPlan, demoPlanReducer, translateDemoSessions } = await import('../frontend/src/lib/demo-plan.js');
  const { translate } = await import('../frontend/src/lib/i18n.js');
  const initial = createDemoPlan('2026-10-22');
  const plan = demoPlanReducer(initial, { type: 'create', values: { title: 'My own title', sport: 'running', date: '2026-10-22', durationMinutes: 20, notes: 'Keep this note' } });
  for (const language of ['en', 'it', 'fr', 'es', 'de']) {
    const localized = translateDemoSessions(plan.sessions, (key) => translate(key, {}, language));
    for (const session of localized.slice(0, -1)) {
      assert.notEqual(session.title, session.titleKey);
      assert.notEqual(session.notes, session.notesKey);
    }
    assert.equal(localized.at(-1).title, 'My own title');
    assert.equal(localized.at(-1).notes, 'Keep this note');
  }
  assert.equal(translateDemoSessions(plan.sessions, key => translate(key, {}, 'it')).find(session => session.id.endsWith(':morning')).title, 'Corsa facile');
  assert.equal(translateDemoSessions(plan.sessions, key => translate(key, {}, 'en')).find(session => session.id.endsWith(':morning')).title, 'Easy run');
});
