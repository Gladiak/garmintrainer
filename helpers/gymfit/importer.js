'use strict';

const { randomUUID } = require('node:crypto');
const { ImportError, requireValue, identity, page, task, leaves, allIds, splitTask, verifyTask, estimate, progress, MAX_OFFSET } = require('./model');

function newImport({ budget = 900, rpm = 20, reserve = 100, retries = 5, sample = 5 } = {}) {
  return {
    id: randomUUID(), status: 'running', active_slot: null, request_budget: budget,
    requests_started: 0, requests_succeeded: 0, requests_per_minute: rpm,
    next_request_at: null, quota_remaining: null, quota_reset_at: null,
    expected_exercises: null, expected_muscles: null, expected_groups: null,
    catalog_complete: 0, muscle_map_complete: 0, reference_data: {},
    checkpoint: { phase: 'references', catalog: [], muscles: [], samples: [], sampleCount: sample, reserve, retries, retry: null, finalMeta: false },
  };
}
const key = value => JSON.stringify([value.kind, value.muscleId, value.role, value.filters]);
const find = (cp, slice) => leaves([...cp.catalog, ...cp.muscles]).find(item => key(item) === key(slice));
const header = (headers, name) => headers?.get ? headers.get(name) : headers?.[name.toLowerCase()];
const numberHeader = (headers, name) => /^\d+$/.test(header(headers, name) || '') ? Number(header(headers, name)) : null;
const safeCode = value => /^[a-zA-Z0-9_-]{1,64}$/.test(value || '') ? value : 'HTTP_ERROR';

// State changes are applied to a clone and become visible only after the DB commit.
async function importCatalog({ repository: repo, client, run, emit = () => {}, signal, preflight = false, publish = true, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random }) {
  const report = (type, extra = {}) => emit({ type, ...progress(run), ...extra });
  const interrupted = () => { if (signal?.aborted) throw new ImportError('INTERRUPTED', 'Interruzione richiesta. Ripresa disponibile con resume.', 'paused'); };
  async function waitUntil(time) {
    let reportedAt = 0;
    while (time > now()) {
      interrupted();
      if (time - now() > 1000 && now() - reportedAt >= 10_000) { report('wait', { seconds: Math.ceil((time - now()) / 1000) }); reportedAt = now(); }
      await sleep(Math.min(1000, time - now()));
    }
  }
  async function commit(change, write) {
    const draft = structuredClone(run);
    await change(draft);
    await repo.commit(draft, write ? () => write(draft) : undefined);
    Object.assign(run, draft);
    report('progress');
  }
  async function reference(name, path, parameters = {}) {
    if (Object.hasOwn(run.reference_data.responses || {}, name)) return run.reference_data.responses[name];
    const value = await request(path, parameters);
    // Keep the successful HTTP response even if normalization later rolls back.
    // Resuming after a validation fix must not spend quota downloading it again.
    await commit(draft => { draft.reference_data.responses ||= {}; draft.reference_data.responses[name] = value; });
    return value;
  }
  async function request(path, parameters = {}, { quota = false } = {}) {
    const requestKey = JSON.stringify([path, parameters]);
    if (run.checkpoint.retry?.key !== requestKey) run.checkpoint.retry = { key: requestKey, attempt: 0 };
    while (true) {
      interrupted();
      if (run.requests_started >= run.request_budget) throw new ImportError('BUDGET_REACHED', 'Budget esaurito. I dati restano salvati; usare resume con un budget maggiore se disponibile.', 'paused');
      if (!quota && run.quota_remaining !== null && run.quota_remaining <= run.checkpoint.reserve) throw new ImportError('QUOTA_RESERVE', 'Raggiunta la riserva della quota mensile.', 'waiting_quota');
      await waitUntil(run.next_request_at || 0);
      await repo.guard();
      run.requests_started++;
      run.checkpoint.retry.attempt++;
      run.next_request_at = now() + Math.ceil(60_000 / run.requests_per_minute);
      await repo.save(run);
      report('request', { endpoint: path });
      let response;
      try { response = await client(path, parameters); }
      catch (error) { if (!(error instanceof ImportError) || error.code !== 'NETWORK_ERROR') throw error; response = { status: 0, data: { code: 'NETWORK_ERROR' } }; }
      const remaining = numberHeader(response.headers, 'X-Quota-Remaining');
      if (remaining !== null) run.quota_remaining = remaining;
      const rateRemaining = numberHeader(response.headers, 'RateLimit-Remaining');
      const reset = numberHeader(response.headers, 'RateLimit-Reset');
      if (rateRemaining === 0 && reset !== null) run.next_request_at = Math.max(run.next_request_at, now() + reset * 1000);
      run.last_request_id = String(header(response.headers, 'X-Request-Id') || '').replace(/[^\w.-]/g, '').slice(0, 255) || null;
      if (response.status >= 200 && response.status < 300) {
        run.requests_succeeded++;
        run.checkpoint.retry = null;
        run.last_error_code = null;
        await repo.save(run);
        requireValue(response.data !== null && response.data !== undefined, 'Risposta JSON mancante o non valida.');
        return response.data;
      }
      if (quota && response.status === 403) { run.checkpoint.retry = null; await repo.save(run); report('warning', { code: 'QUOTA_ENDPOINT_UNAVAILABLE', message: 'Quota verificata tramite gli header delle risposte successive.' }); return null; }
      const code = safeCode(response.data?.code);
      run.last_error_code = code;
      if (code === 'quota_exceeded') { await repo.save(run); throw new ImportError(code, 'Quota mensile esaurita.', 'waiting_quota'); }
      const retryable = response.status === 0 || response.status === 429 || response.status >= 500;
      if (!retryable) { await repo.save(run); throw new ImportError(code, `Richiesta rifiutata: HTTP ${response.status} (${code}).`); }
      const retryAfter = header(response.headers, 'Retry-After');
      const retryMs = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Math.max(0, Date.parse(retryAfter) - now()) : 0;
      const delay = Math.max(Number.isFinite(retryMs) ? retryMs : 0, Math.min(30_000, 1000 * 2 ** (run.checkpoint.retry.attempt - 1)) + Math.floor(random() * 500));
      run.next_request_at = Math.max(run.next_request_at, now() + delay);
      await repo.save(run);
      if (run.checkpoint.retry.attempt > run.checkpoint.retries) throw new ImportError('RETRY_LIMIT', `Tentativi esauriti dopo ${code}. Riprendere con resume.`, 'paused');
      report('retry', { code, httpStatus: response.status, attempt: run.checkpoint.retry.attempt, maxRetries: run.checkpoint.retries, delaySeconds: Math.ceil((run.next_request_at - now()) / 1000), requestId: run.last_request_id });
    }
  }
  async function readSlice(slice) {
    if (slice.offset > MAX_OFFSET) {
      await commit(draft => splitTask(find(draft.checkpoint, slice), draft.reference_data.meta));
      return;
    }
    const parameters = { ...slice.filters, include: 'all', sort: 'name', limit: slice.limit, offset: slice.offset };
    if (slice.kind === 'muscle') parameters.muscleRole = slice.role;
    else parameters.group = false;
    const path = slice.kind === 'muscle' ? `/v2/muscles/${slice.muscleId}/exercises` : '/v2/exercises/search';
    const requestKey = JSON.stringify([path, parameters]);
    let response = run.checkpoint.pendingPage?.key === requestKey ? run.checkpoint.pendingPage.data : undefined;
    if (response === undefined) {
      response = await request(path, parameters);
      await commit(draft => { draft.checkpoint.pendingPage = { key: requestKey, data: response }; });
    }
    const result = page(response, slice);
    const mustSplit = result.total > MAX_OFFSET + (result.results.length || slice.limit) || slice.offset > MAX_OFFSET;
    let associations;
    await commit(draft => {
      const current = find(draft.checkpoint, slice);
      delete draft.checkpoint.pendingPage;
      current.total = result.total;
      if (mustSplit) splitTask(current, draft.reference_data.meta);
      else {
        current.ids.push(...result.ids);
        current.offset += result.results.length;
        current.done = current.offset === result.total;
        if (!current.done && result.results.length < current.limit) current.limit = result.results.length;
      }
    }, async draft => { if (!mustSplit) associations = await repo.exercises(draft, result.results, slice); });
    if (mustSplit) report('warning', { code: 'SEARCH_PARTITIONED', message: 'Ricerca troppo grande: aggiunte partizioni per rispettare il limite di offset.' });
    if (associations?.dualRoleLinks) report('warning', { code: 'MULTIPLE_MUSCLE_ROLES', message: `${associations.dualRoleLinks} associazioni presenti in entrambi i ruoli: conservati entrambi i dati del servizio.` });
  }
  try {
    if (run.status === 'completed') { report('completed'); return run; }
    run.status = 'running'; run.checkpoint.retry = null;
    run.next_request_at = Math.max(run.next_request_at || 0, await repo.lastRequestAt());
    await repo.save(run);
    report('progress');
    const apiDone = run.checkpoint.phase === 'validation' && run.checkpoint.finalMeta;
    const usage = apiDone ? null : await request('/v2/usage/current', {}, { quota: true });
    if (usage) {
      requireValue(Number.isSafeInteger(usage.remaining) && usage.remaining >= 0, 'Quota residua non valida.');
      run.quota_remaining = usage.remaining;
      run.quota_reset_at = Number.isFinite(Date.parse(usage.periodEnd)) ? Date.parse(usage.periodEnd) : null;
      await repo.save(run);
    }
    if (!run.reference_data.meta || (!usage && !apiDone)) {
      // A dashboard-only quota endpoint may return 403. Refresh quota headers even
      // when the saved allowance is zero and the billing period has since renewed.
      const meta = await request('/v2/meta', {}, { quota: !usage });
      for (const value of [meta.exercises?.total, meta.muscles, meta.muscleGroups, meta.families]) requireValue(Number.isSafeInteger(value) && value > 0, 'Conteggi del catalogo non validi.');
      if (!run.reference_data.meta) await commit(draft => { draft.reference_data.meta = meta; draft.expected_exercises = meta.exercises.total; draft.expected_muscles = meta.muscles; draft.expected_groups = meta.muscleGroups; });
      else requireValue(meta.exercises.total === run.expected_exercises && meta.muscles === run.expected_muscles && meta.muscleGroups === run.expected_groups, 'Il catalogo è cambiato durante la pausa.');
    }
    if (run.quota_remaining === null) throw new ImportError('QUOTA_UNKNOWN', 'Quota residua non disponibile: importazione sospesa prima della scansione.', 'paused');
    if (!run.reference_data.families) {
      const families = await request('/v2/families');
      requireValue(Array.isArray(families) && families.length === run.reference_data.meta.families && new Set(families.map(item => item.id)).size === families.length, 'Elenco famiglie incompleto o duplicato.');
      for (const family of families) requireValue(typeof family.id === 'string' && /^[\w-]{1,128}$/.test(family.id) && Number.isSafeInteger(family.total) && family.total >= 0, 'Famiglia non valida.');
      await commit(draft => { draft.reference_data.families = families; draft.checkpoint.catalog = families.map(item => ({ ...task('catalog', { family: item.id }), expected: item.total })); });
    }
    if (!run.reference_data.groups) {
      const groups = await reference('groups', '/v2/muscle-groups');
      await commit(draft => { draft.reference_data.groups = groups; delete draft.reference_data.responses.groups; }, draft => repo.groups(draft, groups));
      const groupedMuscles = new Set(groups.flatMap(group => group.muscles.map(muscle => muscle.id))).size;
      if (groupedMuscles !== run.expected_muscles) report('warning', { code: 'GROUPED_TAXONOMY_PARTIAL', message: `I gruppi elencano ${groupedMuscles} muscoli; meta ne dichiara ${run.expected_muscles}. Completo la tassonomia dalla ricerca muscoli.` });
    }
    if (!run.reference_data.muscles) {
      const value = page(await reference('muscles', '/v2/muscles/search', { limit: 100 }), task('reference'));
      requireValue(value.total === run.expected_muscles && value.results.length === value.total, 'La ricerca muscoli non contiene tutta la tassonomia entro una pagina.');
      await commit(draft => {
        draft.reference_data.muscles = value.results;
        delete draft.reference_data.responses.muscles;
        draft.checkpoint.muscles = value.results.flatMap(item => ['target', 'synergist'].map(role => task('muscle', {}, item.id, role)));
        draft.checkpoint.phase = 'discovery';
      }, draft => repo.muscleSummaries(draft, value.results));
    }
    if (run.checkpoint.phase === 'discovery') {
      const unclassified = new Map((await repo.unclassifiedMuscles(run)).map(item => [item.id, item.name]));
      const checkClassification = () => {
        const used = run.checkpoint.muscles.find(item => unclassified.has(item.muscleId) && item.total > 0);
        if (used) throw new ImportError('UNCLASSIFIED_MUSCLE', `Il muscolo ${unclassified.get(used.muscleId)} compare negli esercizi ma GymFit non ne indica il gruppo. Associare un gruppo nel DB prima di riprendere.`);
      };
      checkClassification();
      let slice;
      while (true) {
        const pending = leaves(run.checkpoint.muscles).filter(item => item.total === null);
        slice = pending.find(item => unclassified.has(item.muscleId)) || pending[0];
        if (!slice) break;
        await readSlice(slice);
        checkClassification();
      }
      await commit(draft => { draft.checkpoint.phase = 'catalog'; });
    }
    if (preflight) throw new ImportError('PREFLIGHT_COMPLETE', 'Conteggi iniziali salvati. Usare resume per completare il download.', 'paused');
    if (estimate(run) > run.request_budget) throw new ImportError('BUDGET_INSUFFICIENT', `La previsione richiede circa ${estimate(run)} tentativi, oltre il budget ${run.request_budget}.`, 'paused');
    for (const [collection, phase] of [['catalog', 'catalog'], ['muscles', 'muscles']]) {
      if (['samples', 'validation', 'completed'].includes(run.checkpoint.phase)) break;
      if (collection === 'catalog' && run.checkpoint.phase === 'muscles') continue;
      await commit(draft => { draft.checkpoint.phase = phase; });
      let slice;
      while ((slice = leaves(run.checkpoint[collection]).find(item => !item.done))) await readSlice(slice);
      run.checkpoint[collection].forEach(verifyTask);
    }
    await commit(draft => { draft.checkpoint.phase = 'samples'; });
    const ids = await repo.samples(run, run.checkpoint.sampleCount);
    for (const id of ids) {
      if (run.checkpoint.samples.includes(id)) continue;
      const detail = identity(run.reference_data.diagnostic_details?.[id] || await request(`/v2/exercises/${id}`));
      requireValue(detail.id.toLowerCase() === id && Array.isArray(detail.targetMuscles) && Array.isArray(detail.secondaryMuscles), 'Dettaglio campione non valido.');
      const expected = [...detail.targetMuscles.map(muscle => `${identity(muscle).id.toLowerCase()}:target`), ...detail.secondaryMuscles.map(muscle => `${identity(muscle).id.toLowerCase()}:synergist`)].sort();
      const actual = (await repo.links(run, id)).map(item => `${item.muscle_id}:${item.role}`).sort();
      requireValue(JSON.stringify(expected) === JSON.stringify(actual), 'Le associazioni ricostruite non corrispondono al dettaglio campione.');
      await commit(draft => { draft.checkpoint.samples.push(id); });
    }
    await commit(draft => { draft.checkpoint.phase = 'validation'; });
    if (!run.checkpoint.finalMeta) {
      const meta = await request('/v2/meta'); const initial = run.reference_data.meta;
      requireValue(meta.exercises?.total === run.expected_exercises && meta.muscles === run.expected_muscles && meta.muscleGroups === run.expected_groups && meta.families === initial.families, 'Il catalogo è cambiato durante l’importazione.');
      await commit(draft => { draft.checkpoint.finalMeta = true; });
    }
    interrupted();
    await validateCatalog(repo, run);
    const draft = structuredClone(run);
    draft.status = 'completed'; draft.catalog_complete = 1; draft.muscle_map_complete = 1;
    draft.finished_at = now(); draft.checkpoint.phase = 'completed';
    if (publish) await repo.publish(draft); else await repo.save(draft);
    Object.assign(run, draft);
    report('completed', { published: publish });
    return run;
  } catch (error) {
    run.status = error.status || 'failed'; run.last_error_code = error.code || 'DATABASE_ERROR';
    await repo.save(run).catch(() => {});
    report('stopped', { code: run.last_error_code, message: error instanceof ImportError ? error.message : 'Operazione database non riuscita. Il checkpoint confermato resta disponibile.' });
    error.reported = true;
    throw error;
  }
}

async function validateCatalog(repo, run) {
  [...run.checkpoint.catalog, ...run.checkpoint.muscles].forEach(verifyTask);
  const counts = await repo.counts(run);
  const links = run.checkpoint.muscles.reduce((sum, item) => sum + allIds(item).length, 0);
  requireValue(counts.exercises === run.expected_exercises && counts.groups === run.expected_groups && counts.muscles === run.expected_muscles && counts.links === links && counts.unseen === 0 && counts.ungrouped === 0, 'Conteggi SQL o copertura del catalogo non corrispondenti.');
}

module.exports = { newImport, importCatalog, validateCatalog };
