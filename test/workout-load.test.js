'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { workoutLoad } = require('../shared/workout-load.mjs');
const { validateWorkout } = require('../helpers/workout-repository');
const target = { id: 'chest', name: 'Chest', role: 'target' };
const shoulder = { id: 'shoulders', name: 'Shoulders', role: 'synergist' };
const set = (kg = 40, repetitions = 10) => ({ repetitions, loadKg: kg, restSeconds: 90 });

test('workout volume is conserved and muscle shares are percentages of the whole routine', () => {
  const load = workoutLoad([
    { groups: [target, shoulder], sets: [set(), set(50)] },
    { groups: [{ id: 'legs', name: 'Legs', role: 'target' }], sets: [set(90)] },
  ]);
  assert.equal(load.totalLoad, 1800);
  assert.equal(load.totalSets, 3); assert.equal(load.totalRepetitions, 30);
  assert.equal(load.groups.find(g => g.id === 'legs').percentage, 50);
  assert.equal(load.groups.find(g => g.id === 'chest').load, 600);
  assert.equal(load.groups.find(g => g.id === 'shoulders').load, 300);
  assert.ok(Math.abs(load.groups.reduce((sum, group) => sum + group.percentage, 0) - 100) < 1e-10);
});

test('duplicate muscles or roles in a group cannot multiply volume', () => {
  const original = workoutLoad([{ groups: [target, shoulder], sets: [set()] }]);
  const repeated = workoutLoad([{ groups: [target, target, { ...target, role: 'synergist' }, shoulder, shoulder], sets: [set()] }]);
  assert.deepEqual(repeated, original);
});

test('unknown mappings stay in the denominator and missing or zero kg are never replaced by invented load', () => {
  const load = workoutLoad([{ groups: [target], sets: [set(10)] }, { groups: [], sets: [set(10)] }, { groups: [shoulder], sets: [set(null), set(0)] }]);
  assert.equal(load.totalLoad, 200); assert.equal(load.unknownLoad, 100);
  assert.equal(load.unknownPercentage, 50); assert.equal(load.groups[0].percentage, 50);
  assert.equal(load.missingLoadSets, 1); assert.equal(load.totalSets, 4);
  assert.equal(workoutLoad([]).totalLoad, 0); assert.deepEqual(workoutLoad([]).groups, []);
});

test('increasing every weight equally changes total volume while preserving distribution', () => {
  const exercises = [{ groups: [target, shoulder], sets: [set()] }, { groups: [shoulder], sets: [set(20)] }];
  const before = workoutLoad(exercises);
  const after = workoutLoad(exercises.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, loadKg: s.loadKg * 2 })) })));
  assert.equal(after.totalLoad, before.totalLoad * 2);
  assert.deepEqual(after.groups.map(g => g.percentage), before.groups.map(g => g.percentage));
});

test('routine validation rejects invalid sets, excessive input and stale-write tokens before SQL', () => {
  const valid = { name: ' Upper A ', exercises: [{ importId: '00000000-0000-4000-8000-000000000001', exerciseId: '00000000-0000-4000-8000-000000000002', sets: [set()] }] };
  assert.equal(validateWorkout(valid).name, 'Upper A');
  for (const value of [null, {}, { ...valid, exercises: [] }, { ...valid, name: ' ' }, { ...valid, exercises: Array(41).fill(valid.exercises[0]) }]) assert.throws(() => validateWorkout(value), { code: 'WORKOUT_INVALID' });
  for (const invalid of [set(-1), set(Infinity), set(1.001), set(40, 1.5), { ...set(), restSeconds: -1 }, { ...set(), loadKg: undefined }]) {
    assert.throws(() => validateWorkout({ ...valid, exercises: [{ ...valid.exercises[0], sets: [invalid] }] }), { code: 'WORKOUT_INVALID' });
  }
  assert.throws(() => validateWorkout(valid, true), { code: 'WORKOUT_INVALID' });
});
