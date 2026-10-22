import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: `${root}.env`, quiet: true });
delete process.env.GARMIN_API_KEY;
delete process.env.GARMIN_PERSONAL_API_KEY;
const children = [
  spawn(process.execPath, ['--watch', 'app.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.mjs'], { cwd: root, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
for (const child of children) {
  child.on('error', () => { console.error('Impossibile avviare un servizio di sviluppo.'); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
