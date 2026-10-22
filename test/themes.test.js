'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const themes = require('../libs/themes.json');
const { accountApplication, TEST_API_KEY } = require('./helpers');

const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };

test('tema HTTP per account: omissione conservativa e cache Garmin invariata', async t => {
  const { register, manager, provider } = await accountApplication(t);
  const a = await register({ ...values, theme: 'ember-night', apiKey: TEST_API_KEY });
  const b = await register({ ...values, theme: 'vanilla-pastel' });
  const client = (await manager.getClient(a.profile.id));
  for (const body of [{ ...values, theme: 'ocean-gold' }, values]) {
    assert.equal((await a.api('/profile', { method: 'PATCH', body })).status, 200);
  }
  assert.strictEqual((await manager.getClient(a.profile.id)), client);
  assert.equal((await (await a.api('/dashboard')).json()).profile.theme, 'ocean-gold');
  assert.equal((await (await b.api('/profile')).json()).theme, 'vanilla-pastel');
  const invalid = await a.api('/profile', { method: 'PATCH', body: { ...values, theme: 'invalid' } });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_THEME');
  assert.equal(provider.state.tokenRequests, 0);
});

test('superfici in scala di grigi condivise, accenti leggibili e colori dei dati distinguibili', async () => {
  const { THEMES, UI_PALETTE: ui } = await import('../frontend/src/lib/palette.js');
  function luminance(hex) {
    const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }
  function ratio(a, b) { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  for (const [text, background] of [[ui.ink, ui.ivory], [ui.ink, ui.surface], [ui.textMuted, ui.surface], [ui.textMuted, ui.mist], [ui.onAccent, ui.sageStrong]]) {
    assert.ok(ratio(text, background) >= 4.5, `${text} su ${background}`);
  }
  for (const theme of THEMES) {
    for (const field of ['ivory', 'surface', 'mist', 'mistSoft', 'mossSoft', 'sandSoft', 'sidebarNote', 'ink', 'textMuted', 'border']) {
      assert.equal(theme.palette[field], ui[field]);
      assert.match(ui[field], /^#([a-f0-9]{2})\1\1$/i, `${field} usa una tonalità grigia`);
    }
    assert.ok(ratio(theme.palette.onAccent, theme.palette.sageStrong) >= 4.5, `${theme.id}: testo su pulsanti e navigazione`);
    assert.ok(ratio(theme.palette.accentInk, ui.surface) >= 3, `${theme.id}: focus e icone`);
    assert.equal(theme.mode, 'light');
    for (const color of Object.values(theme.metricColors)) {
      assert.ok(ratio(color, ui.surface) >= 3, `${theme.id}: grafico ${color} su ${ui.surface}`);
    }
  }
  assert.equal(new Set(THEMES.map(theme => theme.metricColors.restingHeartRate)).size, 6);
  assert.equal(new Set(THEMES.map(theme => theme.palette.sageStrong)).size, 6);
});

test('tema separato per profili incompleti: validazione e isolamento account', async t => {
  const { register, provider } = await accountApplication(t);
  const a = await register(); const b = await register(values);
  const changed = await a.api('/profile/theme', { method: 'PATCH', body: { theme: 'ocean-gold', firstName: 'ignored', apiKey: 'ignored' } });
  assert.equal(changed.status, 200);
  const p = await changed.json();
  assert.equal(p.theme, 'ocean-gold'); assert.equal(p.needsCompletion, true);
  assert.equal(p.firstName, ''); assert.equal(p.hasGarminKey, false);
  assert.equal((await (await b.api('/profile')).json()).theme, 'sage-ivory');
  for (const body of [{}, { theme: null }, { theme: 'unknown' }, { theme: [] }]) {
    const invalid = await a.api('/profile/theme', { method: 'PATCH', body });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_THEME');
  }
  assert.equal(provider.state.tokenRequests, 0);
});
