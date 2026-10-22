'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const checker = path.resolve(__dirname, '../scripts/check-secrets.mjs');

async function fixture(t) {
  const { SECRET_FILES, GIT_CRYPT_HEADER } = await import('../scripts/secret-files.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-crypt-guard-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = args => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (filename, value) => {
    const full = path.join(directory, filename);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, value);
  };
  git(['init', '-q']);
  git(['config', 'user.name', 'Encryption Guard Tests']);
  git(['config', 'user.email', 'tests@example.test']);
  git(['config', 'commit.gpgsign', 'false']);
  write('.gitattributes', SECRET_FILES.map(filename => `/${filename} filter=git-crypt diff=git-crypt -text`).join('\n'));
  write('.gitignore', '.local-keys/\n*.git-crypt.key\n');
  // Synthetic format fixtures test the guard, without reading installation keys.
  const ciphertext = Buffer.concat([GIT_CRYPT_HEADER, Buffer.alloc(32, 17)]);
  for (const filename of SECRET_FILES) write(filename, ciphertext);
  git(['add', '--all']);
  return { directory, git, write, ciphertext, files: SECRET_FILES,
    check: (args = ['--staged'], input) => spawnSync(process.execPath, [checker, ...args], { cwd: directory, encoding: 'utf8', input }),
    commit() { git(['add', '--all']); git(['commit', '-q', '-m', 'test snapshot']); return git(['rev-parse', 'HEAD']); },
  };
}

test('guard: indice cifrato accettato; password in chiaro bloccata senza stamparla', async t => {
  const f = await fixture(t);
  assert.equal(f.check().status, 0);
  const value = 'plain-text-password-test-only';
  f.write(f.files[0], value); f.git(['add', f.files[0]]);
  const result = f.check();
  assert.equal(result.status, 1); assert.match(result.stderr, /NON cifrato/);
  assert.ok(!result.stderr.includes(value));
});

test('guard: secret mancante e attributi rimossi vengono rifiutati', async t => {
  const f = await fixture(t);
  f.git(['rm', '-f', '-q', f.files[0]]);
  assert.match(f.check().stderr, /Secret mancante/);
  f.write(f.files[0], f.ciphertext); f.git(['add', f.files[0]]);
  f.write('.gitattributes', ''); f.git(['add', '.gitattributes']);
  assert.match(f.check().stderr, /Filtro git-crypt mancante/);
});

test('guard: chiave di sblocco forzata nell’indice bloccata', async t => {
  const f = await fixture(t);
  f.write('.local-keys/garmintrainer.git-crypt.key', 'synthetic-test-key');
  f.git(['add', '-f', '.local-keys/garmintrainer.git-crypt.key']);
  const result = f.check();
  assert.equal(result.status, 1); assert.match(result.stderr, /Chiave di sblocco/);
});

test('guard: pre-push rileva un commit intermedio in chiaro anche se HEAD è cifrato', async t => {
  const f = await fixture(t);
  const before = f.commit();
  f.write(f.files[0], 'synthetic-plaintext'); f.commit();
  f.write(f.files[0], f.ciphertext); const head = f.commit();
  assert.equal(f.check().status, 0);
  const history = f.check(['--history']);
  assert.equal(history.status, 1); assert.match(history.stderr, /NON cifrato/);
  const push = f.check(['--pre-push'], `refs/heads/main ${head} refs/heads/main ${before}\n`);
  assert.equal(push.status, 1); assert.match(push.stderr, /NON cifrato/);
});

test('guard: push valido e cancellazione di un ramo non richiedono la chiave privata', async t => {
  const f = await fixture(t);
  const head = f.commit();
  assert.equal(f.check(['--history']).status, 0);
  assert.equal(f.check(['--pre-push'], `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`).status, 0);
  assert.equal(f.check(['--pre-push'], `(delete) ${'0'.repeat(40)} refs/heads/main ${head}\n`).status, 0);
});
