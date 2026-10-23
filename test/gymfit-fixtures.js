'use strict';

const { ImportError } = require('../helpers/gymfit/model');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Synthetic provider: no request reaches GymFit or consumes a real API quota.
function gymfitFixture(count = 130) {
  let billed = 0;
  const groups = [
    { id: id(1), name: 'Chest', aliases: [], muscles: [{ id: id(3), name: 'Pectoralis major', commonName: 'Pecs', heads: [] }] },
    { id: id(2), name: 'Triceps', aliases: [], muscles: [{ id: id(4), name: 'Triceps brachii', commonName: 'Triceps', heads: [] }] },
  ];
  const muscles = groups.flatMap(group => group.muscles.map(muscle => ({ ...muscle, group: group.name, bodyPart: 'Arms' })));
  const exercises = Array.from({ length: count }, (_, n) => ({ id: id(100 + n), name: `Exercise ${n + 1}`, slug: `exercise-${n + 1}`, equipment: 'Barbell', category: n % 2 ? 'Cardio' : 'Strength', difficulty: 'Intermediate', primaryGroups: ['Chest'] }));
  const meta = () => ({ exercises: { total: count, default: count }, muscles: muscles.length, muscleGroups: groups.length, families: 1, values: { categories: ['Strength', 'Cardio'], difficulties: ['Intermediate'], tiers: ['Standard'], bodyParts: ['Arms'] } });
  const fixture = { groups, muscles, exercises, calls: [], fault: null, roleConflict: false, invalidSample: false, remaining: 1000, clock: Date.now() };
  fixture.sleep = async ms => { fixture.clock += ms; };
  fixture.client = async (path, params = {}) => {
    fixture.calls.push({ path, params: { ...params }, at: fixture.clock });
    const fault = fixture.fault?.(path, params);
    if (fault === 'network') throw new ImportError('NETWORK_ERROR', 'Errore rete simulato.', 'paused');
    if (fault) return fault;
    if (/\/muscles\/[^/]+\/exercises$/.test(path)) {
      // This endpoint has a smaller documented query DTO than exercise search.
      const supported = new Set(['include', 'sort', 'limit', 'offset', 'muscleRole', 'category', 'difficulty', 'tier']);
      if (Object.keys(params).some(key => !supported.has(key))) return { status: 400, data: { code: 'validation_failed' } };
    }
    let data;
    if (path === '/v2/usage/current') data = { remaining: fixture.remaining - billed, periodEnd: new Date(Date.now() + 86400000).toISOString() };
    else if (path === '/v2/meta') data = meta();
    else if (path === '/v2/families') data = [{ id: 'press', label: 'Press', total: count, exercises: count }];
    else if (path === '/v2/muscle-groups') data = groups;
    else if (path === '/v2/muscles/search') data = { results: muscles, count: muscles.length, total: muscles.length };
    else if (path === '/v2/exercises/search' || /\/muscles\/[^/]+\/exercises$/.test(path)) {
      let items = exercises;
      if (path !== '/v2/exercises/search') {
        const muscle = path.split('/')[3];
        const match = (muscle === id(3) && params.muscleRole === 'target') || (muscle === id(4) && params.muscleRole === 'synergist') || (fixture.roleConflict && muscle === id(3));
        if (!match) items = [];
      }
      for (const key of ['category', 'difficulty']) if (params[key]) items = items.filter(item => item[key] === params[key]);
      const results = items.slice(params.offset || 0, (params.offset || 0) + (params.limit || 100));
      data = { results, total: items.length, count: results.length };
    } else if (/^\/v2\/exercises\//.test(path)) {
      data = { ...exercises.find(item => item.id === path.split('/')[3]), targetMuscles: fixture.invalidSample ? [] : [muscles[0]], secondaryMuscles: fixture.roleConflict ? [muscles[0], muscles[1]] : [muscles[1]] };
    } else throw new Error(`Unexpected test endpoint ${path}`);
    if (path !== '/v2/usage/current') billed++;
    return { status: 200, headers: new Headers({ 'X-Quota-Remaining': String(fixture.remaining - billed), 'X-Request-Id': 'synthetic-request' }), data: structuredClone(data) };
  };
  return fixture;
}

module.exports = { gymfitFixture, id };
