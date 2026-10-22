'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProfile, validateSession } = require('../libs/validation');
const themes = require('../libs/themes.json');

const profile = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
const session = { title: 'Easy run', sport: 'running', date: '2028-02-29', time: '18:30', durationMinutes: 45 };

test('profilo: nomi, cinque sport e credenziali escluse dai metadati', () => {
  for (const primarySport of ['running', 'cycling', 'swimming', 'gym', 'hiit']) {
    const result = validateProfile({ ...profile, firstName: ' Ada ', primarySport, apiKey: 'private-key' });
    assert.equal(result.firstName, 'Ada'); assert.equal(result.primarySport, primarySport);
    assert.equal(result.apiKey, undefined);
  }
  for (const value of [{ ...profile, firstName: '' }, { ...profile, lastName: ' ' }, { ...profile, firstName: 'a'.repeat(81) }, { ...profile, primarySport: 'walking' }, { ...profile, apiKey: 'one\ntwo' }, { ...profile, apiKey: 123 }]) {
    assert.throws(() => validateProfile(value), { code: 'INVALID_INPUT' });
  }
});

test('profilo: lingue e temi ammessi, omissioni e valori espliciti non validi', () => {
  for (const language of ['en', 'it', 'fr', 'es', 'de']) assert.equal(validateProfile({ ...profile, language }).language, language);
  for (const theme of themes) assert.equal(validateProfile({ ...profile, theme: theme.id }).theme, theme.id);
  assert.equal(validateProfile(profile).language, undefined);
  assert.equal(validateProfile(profile).theme, undefined);
  for (const language of [null, '', 'EN', 'en-GB', 'pt', [], {}, 42, true]) assert.throws(() => validateProfile({ ...profile, language }), { code: 'INVALID_LANGUAGE' });
  for (const theme of [null, '', 'unknown', [], 42]) assert.throws(() => validateProfile({ ...profile, theme }), { code: 'INVALID_THEME' });
});

test('piano: date reali, orari e durata valida prima di salvare', () => {
  assert.equal(validateSession(session).date, '2028-02-29');
  assert.equal(validateSession({ ...session, durationMinutes: 1440 }).durationMinutes, 1440);
  for (const value of [{ ...session, date: '2026-02-29' }, { ...session, date: '2026-02-30' }, { ...session, time: '25:00' }, { ...session, durationMinutes: 0 }, { ...session, durationMinutes: 1441 }, { ...session, sport: 'unknown' }, { ...session, title: ' ' }]) {
    assert.throws(() => validateSession(value), { code: 'INVALID_INPUT' });
  }
});
