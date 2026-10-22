'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const sharp = require('sharp');
const { normalizeAvatar, MAX_AVATAR_BYTES } = require('../libs/avatar');
const { accountApplication, TEST_API_KEY } = require('./helpers');

const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
const dataUrl = (bytes, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;
async function picture(color = '#24634e') {
  return sharp({ create: { width: 420, height: 280, channels: 3, background: color } }).png().toBuffer();
}
test('le foto vengono ricodificate a 256 × 256, con orientamento corretto e senza metadati', async () => {
  const original = await sharp(await picture()).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const avatar = await normalizeAvatar(dataUrl(original, 'image/jpeg'));
  const metadata = await sharp(Buffer.from(avatar.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 256); assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
});

test('avatar HTTP: caricamento, sostituzione, omissione e rimozione per account', async t => {
  const { register, database, manager, provider } = await accountApplication(t);
  const a = await register({ ...values, apiKey: TEST_API_KEY, avatar: dataUrl(await picture()) });
  const b = await register(values);
  assert.match(a.profile.avatar, /^data:image\/webp;base64,/);
  const client = (await manager.getClient(a.profile.id));
  await a.api('/profile', { method: 'PATCH', body: { ...values, firstName: 'Anna' } });
  assert.equal(database.getProfile(a.profile.id).avatar, a.profile.avatar);
  const changed = await a.api('/profile', { method: 'PATCH', body: { ...values, avatar: dataUrl(await picture('#d48b59')) } });
  const newAvatar = (await changed.json()).avatar;
  assert.notEqual(newAvatar, a.profile.avatar);
  assert.equal((await (await b.api('/profile')).json()).avatar, null);
  assert.strictEqual((await manager.getClient(a.profile.id)), client);
  assert.equal(database.getGarminCredential(a.profile.id).apiKey, TEST_API_KEY);
  const removed = await a.api('/profile', { method: 'PATCH', body: { ...values, avatar: null } });
  assert.equal(removed.status, 200); assert.equal((await removed.json()).avatar, null);
  assert.equal(provider.state.tokenRequests, 0);
});

test('le immagini oltre 32 KB passano solo dal parser del profilo', async t => {
  const { register } = await accountApplication(t);
  const a = await register(values);
  const bytes = await sharp(randomBytes(180 * 180 * 3), { raw: { width: 180, height: 180, channels: 3 } }).png().toBuffer();
  assert.ok(bytes.length > 32 * 1024);
  assert.equal((await a.api('/profile', { method: 'PATCH', body: { ...values, avatar: dataUrl(bytes) } })).status, 200);
  assert.equal((await a.api('/sessions', { method: 'POST', body: { notes: 'a'.repeat(33 * 1024) } })).status, 413);
});

test('avatar non validi rifiutati senza modifiche parziali', async t => {
  const { register, database } = await accountApplication(t);
  const a = await register(values);
  const png = await picture();
  for (const avatar of [true, '', 'https://example.com/avatar.png', 'data:image/svg+xml;base64,PHN2Zy8+', dataUrl(Buffer.from('<svg/>'), 'image/jpeg'), dataUrl(png, 'image/jpeg'), dataUrl(png.subarray(0, 40)), dataUrl(Buffer.alloc(MAX_AVATAR_BYTES + 1)), 'data:image/png;base64,%%%invalid']) {
    const invalid = await a.api('/profile', { method: 'PATCH', body: { ...values, firstName: 'Do not save', avatar } });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_AVATAR');
    assert.equal(database.getProfile(a.profile.id).firstName, values.firstName);
  }
});
