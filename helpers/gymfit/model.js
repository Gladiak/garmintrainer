'use strict';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const PAGE_SIZE = 100;
const MAX_OFFSET = 1000;

class ImportError extends Error {
  constructor(code, message, status = 'failed') { super(message); this.code = code; this.status = status; }
}

// Reject malformed source records before a page or its cursor can be committed.
function requireValue(condition, message) {
  if (!condition) throw new ImportError('INVALID_RESPONSE', message);
}
function identity(value) {
  requireValue(value && UUID.test(value.id) && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 255, 'Identità o nome non validi nella risposta.');
  value.id = value.id.toLowerCase();
  return value;
}
function page(value, task) {
  requireValue(value && Array.isArray(value.results) && Number.isSafeInteger(value.total) && value.total >= 0 && value.count === value.results.length, 'Pagina o conteggio non validi.');
  requireValue(value.results.length <= task.limit && task.offset + value.results.length <= value.total, 'Dimensione pagina incoerente con il totale.');
  if (task.total !== null) requireValue(task.total === value.total, 'Il totale è cambiato durante la scansione. Ripetere l’importazione con un catalogo stabile.');
  const ids = value.results.map(item => identity(item).id.toLowerCase());
  requireValue(new Set(ids).size === ids.length && !ids.some(id => task.ids.includes(id)), 'UUID duplicati fra le pagine della stessa ricerca.');
  requireValue(ids.length > 0 || task.offset >= value.total, 'Pagina vuota prima della fine dei risultati.');
  return { ...value, results: value.results.map(item => ({ ...item, id: item.id.toLowerCase() })), ids };
}
function task(kind, filters = {}, muscleId = null, role = null) {
  return { kind, filters, muscleId, role, offset: 0, limit: PAGE_SIZE, total: null, ids: [], done: false, children: [], retry: 0 };
}
function leaves(tasks) { return tasks.flatMap(item => item.children.length ? leaves(item.children) : [item]); }
function allIds(item) { return item.children.length ? [...new Set(item.children.flatMap(allIds))] : item.ids; }

// Split oversized searches using disjoint scalar filters, checking parent coverage later.
function splitTask(item, meta) {
  const dimensions = [['category', 'categories'], ['difficulty', 'difficulties'], ['tier', 'tiers'], ['bodyPart', 'bodyParts']];
  const dimension = dimensions.find(([key, values]) => !(item.kind === 'muscle' && key === 'bodyPart') && !Object.hasOwn(item.filters, key) && Array.isArray(meta.values?.[values]) && meta.values[values].length);
  if (!dimension) throw new ImportError('OFFSET_LIMIT', 'Ricerca oltre il limite di offset e nessun altro filtro disponibile.', 'paused');
  item.children = meta.values[dimension[1]].map(value => task(item.kind, { ...item.filters, [dimension[0]]: value }, item.muscleId, item.role));
  item.ids = [];
}
function verifyTask(item) {
  if (item.children.length) item.children.forEach(verifyTask);
  else requireValue(item.done, 'Partizione non completata.');
  requireValue(item.total !== null && allIds(item).length === item.total, 'Copertura delle partizioni incompleta o catalogo variato.');
}
function remaining(item) {
  if (item.children.length) return item.children.reduce((sum, child) => sum + remaining(child), 0);
  return item.done ? 0 : item.total === null ? Math.max(1, Math.ceil((item.expected || 1) / item.limit)) : Math.ceil((item.total - item.offset) / item.limit);
}
function estimate(run) {
  const cp = run.checkpoint;
  return run.requests_started + cp.catalog.reduce((n, item) => n + remaining(item), 0) + cp.muscles.reduce((n, item) => n + remaining(item), 0) + Math.max(0, cp.sampleCount - cp.samples.length) + (cp.finalMeta ? 0 : 1);
}
function progress(run) {
  const cp = run.checkpoint;
  const list = [...cp.catalog, ...cp.muscles];
  const expected = list.reduce((sum, item) => sum + (item.total ?? item.expected ?? 0), 0);
  const seen = list.reduce((sum, item) => sum + allIds(item).length, 0);
  const discovering = cp.phase === 'references' || cp.phase === 'discovery';
  const discovered = leaves(cp.muscles).filter(item => item.total !== null).length;
  const discoveryTotal = leaves(cp.muscles).length;
  return {
    id: run.id, status: run.status, phase: cp.phase, requests: run.requests_started,
    succeeded: run.requests_succeeded, budget: run.request_budget, quotaRemaining: run.quota_remaining,
    estimatedRequests: cp.phase === 'references' ? null : estimate(run),
    percent: run.status === 'completed' ? 100 : discovering ? null : Math.min(99.9, expected ? 100 * seen / expected : 0),
    discovery: { done: discovered, total: discoveryTotal }, rows: { done: seen, expected },
  };
}

module.exports = { UUID, PAGE_SIZE, MAX_OFFSET, ImportError, requireValue, identity, page, task, leaves, allIds, splitTask, verifyTask, estimate, progress };
