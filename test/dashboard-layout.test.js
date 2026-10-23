'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLayout, upgradeLayout, defaultLayout, catalog, moduleRequirements } = require('../helpers/dashboard-layout');
const { arrangeModules, changeModule, createModule, overlaps, readingOrder, responsiveModules, MAX_GRID_ROWS } = require('../shared/dashboard-grid.mjs');
const { accountApplication } = require('./helpers');

const layout = modules => ({ version: 3, sections: { overview: modules, wellness: [] } });
const card = (id, x = 0, y = 0, type = 'heart-card') => ({ id, type, x, y, w: 1, h: 3 });

function validGrid(modules, columns = 4) {
  for (const [index, module] of modules.entries()) {
    assert.ok(module.x >= 0 && module.x + module.w <= columns);
    assert.ok(module.y >= 0 && module.y + module.h <= MAX_GRID_ROWS);
    assert.ok(!modules.slice(0, index).some(other => overlaps(module, other)));
  }
}

test('v3 preserves position, size, empty pages and one instance per type per page', () => {
  const input = layout([{ ...card('a', 1, 5), w: 3, h: 5 }]);
  input.sections.wellness = [card('b')];
  assert.deepEqual(validateLayout(input), input);
  assert.deepEqual(validateLayout(layout([])), layout([]));
  assert.throws(() => validateLayout(layout([card('a'), card('b', 1)])));
  assert.throws(() => validateLayout({ ...input, sections: { ...input.sections, wellness: [card('a')] } }));
});

test('v3 rejects corrupt geometry, overlapping panels and invalid sections', () => {
  for (const change of [{ x: -1 }, { y: -1 }, { x: 4 }, { w: 0 }, { w: 5 }, { h: 2 }, { h: 25 },
    { y: MAX_GRID_ROWS }, { x: 0.5 }, { w: '2' }, { h: null }, { y: Infinity }, { x: undefined },
    { type: 'heart-rate', w: 1, h: 7 }, { type: 'training-status', w: 4, h: 6 }, { type: 'respiration' }, { type: '__proto__' }]) {
    assert.throws(() => validateLayout(layout([{ ...card('a'), ...change }])));
  }
  assert.throws(() => validateLayout(layout([card('a'), card('b', 0, 1, 'stress-card')])));
  assert.throws(() => validateLayout({ version: 3, sections: { overview: [], wellness: null } }));
});

test('all integrated components can be selected, including more than twelve modules', () => {
  for (const view of ['overview', 'wellness']) {
    const modules = Object.entries(catalog).filter(([, definition]) => definition.sections.includes(view))
      .map(([type]) => ({ id: `${view}-${type}`, type }));
    const input = { version: 3, sections: { overview: [], wellness: [], [view]: arrangeModules(modules) } };
    assert.deepEqual(validateLayout(input), input);
    assert.ok(input.sections[view].length > 12);
    validGrid(input.sections[view]);
  }
});

test('legacy layouts migrate once with stable IDs, first duplicate retained and no overlaps', () => {
  const input = { version: 2, sections: {
    overview: [{ id: 'old-heart', type: 'heart-card' }, { id: 'duplicate', type: 'heart-card' }, { id: 'old-chart', type: 'heart-rate' }],
    wellness: [],
  } };
  const upgraded = upgradeLayout(input);
  assert.equal(upgraded.version, 3);
  assert.deepEqual(upgraded.sections.overview.map(item => item.id), ['old-heart', 'old-chart']);
  assert.deepEqual(upgradeLayout(upgraded), upgraded);
  assert.equal(input.sections.overview.length, 3, 'migration does not mutate the stored input');
  validGrid(upgraded.sections.overview);
  for (const modules of Object.values(defaultLayout.sections)) validGrid(modules);
});

test('moving exchanges same-size modules; resizing pushes collisions down and preserves unrelated positions', () => {
  const original = [card('a'), card('b', 1, 0, 'stress-card'), card('c', 1, 3, 'sleep-card'), card('unrelated', 3, 20, 'hrv-card')];
  const next = changeModule(original, 'a', { x: 1 });
  assert.equal(next[0].x, 1);
  assert.equal(next[1].x, 0); assert.equal(next[1].y, 0);
  assert.deepEqual(next[2], original[2]);
  assert.deepEqual(next[3], original[3]);
  assert.equal(original[0].x, 0);
  const resized = changeModule(original, 'a', { w: 2 });
  assert.equal(resized[1].y, 3); assert.equal(resized[2].y, 6);
  const large = changeModule(next, 'a', { w: 8, h: 30, x: 9 });
  assert.equal(large[0].w, 4); assert.equal(large[0].h, 24); assert.equal(large[0].x, 0);
  const chart = arrangeModules([{ id: 'chart', type: 'heart-rate' }]);
  assert.equal(changeModule(chart, 'chart', { w: 1, h: 1 })[0].w, 2);
  assert.equal(changeModule(chart, 'chart', { w: 1, h: 1 })[0].h, 6);
  validGrid(large);
});

test('dragging a lower module onto an occupied slot exchanges it without growing the page', () => {
  const original = [card('top'), card('bottom', 0, 12, 'stress-card'), card('unrelated', 3, 6, 'sleep-card')];
  const next = changeModule(original, 'bottom', { x: 0, y: 0 });
  assert.equal(next[0].y, 12); assert.equal(next[1].y, 0);
  assert.deepEqual(next[2], original[2]); validGrid(next);
  assert.deepEqual(changeModule(next, 'bottom', { y: 12 }), original);
  const partial = changeModule(original, 'top', { y: 1 });
  validGrid(partial);
});

test('mixed-size and multiple collisions reflow without losing modules or permitting saved overlaps', () => {
  const original = [card('moving', 0, 9), card('left', 0, 0, 'stress-card'), card('right', 1, 0, 'sleep-card')];
  const larger = changeModule(original, 'moving', { y: 0, w: 2 });
  assert.equal(larger[1].y, 3); assert.equal(larger[2].y, 3);
  assert.deepEqual(larger.map(item => item.id), original.map(item => item.id)); validGrid(larger);
  const different = [{ ...card('moving'), w: 2 }, card('small', 2, 0, 'stress-card')];
  const shifted = changeModule(different, 'moving', { x: 1 });
  assert.equal(shifted[1].y, 3); validGrid(shifted);
});

test('repeated drag/resize operations remain deterministic, bounded and collision free', () => {
  let modules = structuredClone(defaultLayout.sections.wellness);
  for (let i = 0; i < 120; i += 1) {
    const item = modules[i % modules.length];
    const change = { x: i % 4, y: (i * 7) % 40, ...(i % 2 ? {} : { w: i % 5, h: (i * 3) % 18 }) };
    const next = changeModule(modules, item.id, change);
    assert.deepEqual(changeModule(modules, item.id, change), next);
    assert.deepEqual(validateLayout({ version: 3, sections: { overview: [], wellness: next } }).sections.wellness, next);
    validGrid(next);
    modules = next;
  }
});

test('responsive reflow follows visual order without altering saved coordinates or API requirements', () => {
  const modules = [card('a', 3, 0), card('b', 0, 0, 'stress-card')];
  const snapshot = structuredClone(modules);
  const requirements = moduleRequirements({ modules }, '2026-10-23', '2026-10-23');
  for (const columns of [1, 2, 4]) {
    const next = responsiveModules(modules, columns);
    assert.deepEqual(next.map(item => item.id), ['b', 'a']);
    validGrid(next, columns);
    assert.deepEqual(moduleRequirements({ modules: next }, '2026-10-23', '2026-10-23'), requirements);
  }
  assert.deepEqual(modules, snapshot);
  const added = createModule(modules, 'sleep-card', 'new');
  assert.equal(added.x, 1); assert.equal(added.y, 0);
  const mixed = [card('left'), { id: 'middle', type: 'heart-rate', x: 1, y: 0, w: 2, h: 7 }, card('right', 3, 0, 'stress-card')];
  for (const columns of [1, 2, 4]) {
    const next = responsiveModules(mixed, columns);
    assert.deepEqual(readingOrder(next).map(item => item.id), ['left', 'middle', 'right'], 'later cards never backfill above an earlier panel');
    validGrid(next, columns);
  }
});

test('HTTP layout roundtrip is account scoped, validates geometry and makes no Garmin requests', async t => {
  const { register, provider } = await accountApplication(t);
  const a = await register(); const b = await register();
  const input = layout([{ ...card('custom', 1, 4), w: 2, h: 4 }]);
  const saved = await a.api('/dashboard/layout', { method: 'PUT', body: input });
  assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), input);
  assert.deepEqual((await (await a.api('/dashboard')).json()).layout, input);
  assert.deepEqual((await (await b.api('/dashboard')).json()).layout, defaultLayout);
  assert.equal((await a.api('/dashboard/layout', { method: 'PUT', body: layout([card('invalid', 4)]) })).status, 400);
  assert.deepEqual((await (await a.api('/dashboard')).json()).layout, input, 'invalid writes leave the saved layout intact');
  assert.equal((await a.api('/dashboard/layout', { method: 'PUT', body: layout([]) })).status, 200);
  assert.deepEqual((await (await a.api('/dashboard')).json()).requirements, {});
  assert.equal(provider.state.tokenRequests, 0); assert.equal(provider.state.dataRequests, 0);
});
