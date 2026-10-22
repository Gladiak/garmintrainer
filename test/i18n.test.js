'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalogs = Object.fromEntries(['en', 'it', 'fr', 'es', 'de'].map(code => [code, require(`../langs/${code}.json`)]));

test('all locale catalogs have the same keys and interpolation parameters', () => {
  const keys = Object.keys(catalogs.en).sort();
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [language, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), keys, language);
    for (const key of keys) {
      assert.equal(typeof catalog[key], 'string', `${language}:${key}`);
      assert.ok(catalog[key].trim(), `${language}:${key}`);
      assert.deepEqual(placeholders(catalog[key]), placeholders(catalogs.en[key]), `${language}:${key}`);
    }
  }
});

test('live switch notifies subscribers, supports pluralization and interpolates user content as plain text', async () => {
  const { createI18n, translate } = await import('../frontend/src/lib/i18n.js');
  const store = createI18n();
  assert.equal(store.getLanguage(), 'en');
  assert.equal(store.t('nav.overview'), 'Overview');
  const changes = [];
  const unsubscribe = store.subscribe(() => changes.push(store.getLanguage()));
  store.setLanguage('it');
  assert.equal(store.t('profile.language'), 'Lingua');
  assert.equal(store.t('plan.sessions', { count: 1 }), '1 sessione');
  assert.equal(store.t('plan.sessions', { count: 0 }), '0 sessioni');
  assert.equal(store.t('plan.sessions', { count: 2 }), '2 sessioni');
  store.setLanguage('it');
  store.setLanguage('de');
  assert.equal(store.t('plan.sessions', { count: 2 }), '2 Einheiten');
  assert.equal(store.t('plan.delete', { title: '<b>Run</b>' }), 'Löschen: <b>Run</b>');
  assert.deepEqual(changes, ['it', 'de']);
  unsubscribe();
  store.setLanguage('es');
  assert.equal(changes.length, 2);
  for (const language of [null, 'unknown', ['en'], {}, 'constructor']) {
    assert.equal(translate('nav.overview', {}, language), 'Overview');
  }
  assert.equal(translate('missing.key'), 'missing.key');
  assert.equal(translate('constructor'), 'constructor');
});

test('profile language preview cancels, saves and switches without leaking to another profile', async () => {
  const { createI18n } = await import('../frontend/src/lib/i18n.js');
  const store = createI18n();
  store.setProfileLanguage('it', 'a');
  store.previewLanguage('fr');
  assert.equal(store.getLanguage(), 'fr');
  store.setProfileLanguage('it', 'a'); // An ordinary dashboard refresh keeps the open form preview.
  assert.equal(store.getLanguage(), 'fr');
  store.clearPreview();
  assert.equal(store.getLanguage(), 'it');
  store.previewLanguage('de');
  store.setProfileLanguage('de', 'a');
  store.clearPreview();
  assert.equal(store.getLanguage(), 'de');
  store.previewLanguage('es');
  store.setProfileLanguage('fr', 'b');
  assert.equal(store.getLanguage(), 'fr');
  store.setProfileLanguage();
  assert.equal(store.getLanguage(), 'en');
});

test('date/month labels and duration follow the current language while calendar dates stay stable', async (t) => {
  const { setLanguage, translationError, messageText } = await import('../frontend/src/lib/i18n.js');
  const { formatDay, durationLabel, weekDays } = await import('../frontend/src/lib/dates.js');
  t.after(() => setLanguage('en'));
  for (const [language, month] of [['en', 'October'], ['it', 'ottobre'], ['fr', 'octobre'], ['es', 'octubre'], ['de', 'Oktober']]) {
    setLanguage(language);
    assert.equal(formatDay('2026-10-22', { month: 'long' }), month);
    assert.equal(weekDays('2026-10-22')[0], '2026-10-19');
  }
  assert.equal(durationLabel(90), '1 Std. 30 Min.');
  const error = translationError('errors.INVALID_LANGUAGE');
  setLanguage('it');
  assert.equal(messageText(error), 'Seleziona una lingua disponibile.');
  assert.equal(messageText(translationError('unknown.error')), catalogs.it['errors.requestFailed']);
});
