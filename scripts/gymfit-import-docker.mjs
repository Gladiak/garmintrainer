import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const environment = { ...process.env, COMPOSE_DISABLE_ENV_FILE: 'true', LOCAL_UID: String(process.getuid?.() || 1000), LOCAL_GID: String(process.getgid?.() || 1000) };
delete environment.COMPOSE_ENV_FILES;
try {
  const needsKey = ['auto', 'start', 'resume'].includes(args[0]) && !args.includes('--help');
  if (needsKey && environment.GYMFIT_API_KEY_FILE) environment.GYMFIT_API_KEY = readFileSync(environment.GYMFIT_API_KEY_FILE, 'utf8').trim();
  if (needsKey && !environment.GYMFIT_API_KEY) throw new Error('key');
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  // Build output stays on stderr so --json has clean stdout (use npm --silent).
  const built = spawnSync('docker', ['compose', '-f', 'compose.yaml', 'build', 'app'], { cwd, env: environment, stdio: ['ignore', 2, 2] });
  if (built.status !== 0) { console.error('Build del container CLI non riuscita.'); process.exit(built.status || 1); }
  // A disposable CLI container uses the app image and secrets, without starting a web server.
  const command = ['compose', '-f', 'compose.yaml', 'run', '--rm', '--no-deps', '-T'];
  if (needsKey) command.push('-e', 'GYMFIT_API_KEY');
  command.push('app', 'node', 'scripts/gymfit-import.js', ...args);
  const child = spawn('docker', command, { cwd, env: environment, stdio: 'inherit', detached: process.platform !== 'win32' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); console.error('Docker non disponibile.'); process.exitCode = 1; });
  child.on('exit', code => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); process.exitCode = code ?? 1; });
} catch { console.error('Configura GYMFIT_API_KEY oppure un GYMFIT_API_KEY_FILE leggibile.'); process.exitCode = 1; }
