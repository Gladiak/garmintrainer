#!/usr/bin/env node
'use strict';

// Incolla la tua chiave tra gli apici. Modifica solo il file nella radice del progetto.
const API_KEY = 'INCOLLA_LA_TUA_CHIAVE_API';

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = __dirname;

if (!API_KEY.trim() || API_KEY === 'INCOLLA_LA_TUA_CHIAVE_API' || /[\s\u0000-\u001f\u007f]/.test(API_KEY)) {
  console.error('Apri import-gymfit.command e inserisci la tua chiave nella riga const API_KEY.');
  process.exit(1);
}
if (process.argv.length > 2) {
  console.error('Questo launcher si avvia senza argomenti. Per altre opzioni usa il tool CLI.');
  process.exit(1);
}
const environment = { ...process.env };
// The key written above takes precedence over any previously exported key file.
delete environment.GYMFIT_API_KEY;
delete environment.GYMFIT_API_KEY_FILE;
const started = spawnSync(process.execPath, [path.join(root, 'scripts/docker-local.mjs'), 'db'], {
  cwd: root, env: environment, stdio: 'inherit',
});
if (started.status !== 0) process.exit(started.status || 1);

console.log('Avvio o ripresa dell’importazione GymFit. Ctrl+C interrompe il lavoro.');
environment.GYMFIT_API_KEY = API_KEY.trim();
const child = spawn(process.execPath, [path.join(root, 'scripts/gymfit-import-docker.mjs'), 'auto'], {
  cwd: root, env: environment, stdio: 'inherit', detached: process.platform !== 'win32',
});
const interrupt = () => child.kill('SIGINT');
const terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
child.on('error', () => {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  console.error('Impossibile avviare il tool di importazione.');
  process.exitCode = 1;
});
child.on('exit', code => {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  process.exitCode = code ?? 1;
});
