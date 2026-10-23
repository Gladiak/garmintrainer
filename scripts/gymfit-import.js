#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const mariadb = require('mariadb');
const { readConfig } = require('../libs/config');
const { migrateMariaDatabase } = require('../libs/mariadb-migrations');
const { createRepository } = require('../helpers/gymfit/repository');
const { createHttpClient } = require('../helpers/gymfit/http');
const { newImport, importCatalog, validateCatalog } = require('../helpers/gymfit/importer');
const { ImportError, UUID, progress } = require('../helpers/gymfit/model');
const { readCatalog, auditCatalog, requireHealthy, packCatalog, unpackCatalog, restoreCatalog } = require('../helpers/gymfit/catalog');

const HELP = `Uso: npm run gymfit:import -- <auto|start|resume|status|publish|audit|export|restore> [UUID] [opzioni]

  auto                  Avvia se necessario, altrimenti riprende l'ultima importazione
  start                 Nuova importazione, pubblicata solo dopo la verifica
  resume [UUID]         Riprende il checkpoint (default: ultima importazione)
  status [UUID]         Stato locale e conteggi, senza API o chiave
  publish UUID          Attiva una versione completa importata con --no-publish
  audit [UUID]          Verifica SQL e checkpoint (default: catalogo attivo)
  export [UUID]         Pacchetto gzip su stdout, solo catalogo completo e valido
  restore               Legge il pacchetto da stdin e lo carica SENZA attivarlo

  --preflight           Salva riferimenti e prime pagine, poi si ferma
  --no-publish          Completa il download senza cambiare il catalogo attivo
  --budget 900          Massimo tentativi per importazione (1–1000)
  --rpm 20              Richieste/minuto (1–30)
  --reserve 100         Quota mensile da lasciare disponibile
  --retries 5           Retry per richiesta (0–10)
  --sample 5            Dettagli da confrontare con la mappa (1–20, solo start)
  --timeout-ms 20000    Timeout di ogni richiesta (1000–120000)
  --json                Eventi JSON, una riga per evento
  --help                Mostra questa guida

Chiave: GYMFIT_API_KEY oppure GYMFIT_API_KEY_FILE (mai un argomento CLI).
Database: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD_FILE.
Con Docker: npm run gymfit:import:docker -- start --preflight
Ctrl+C salva la pausa dopo la richiesta in corso; resume riprende i dati confermati.
Codici uscita: 0 completato/status/preflight, 2 pausa/quota, 1 errore.
`;

function options(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      help: { type: 'boolean' }, json: { type: 'boolean' }, preflight: { type: 'boolean' }, 'no-publish': { type: 'boolean' },
      ...Object.fromEntries(['budget', 'rpm', 'reserve', 'retries', 'sample', 'timeout-ms'].map(name => [name, { type: 'string' }])),
    } });
  } catch { throw new ImportError('INVALID_ARGUMENT', 'Opzioni non valide. Usa --help.'); }
  const { values, positionals } = parsed;
  const [command, id] = positionals;
  if (!command || values.help) return { help: true };
  if (!['auto', 'start', 'resume', 'status', 'publish', 'audit', 'export', 'restore'].includes(command) || positionals.length > 2 || (id && !UUID.test(id)) || (['auto', 'start', 'restore'].includes(command) && id) || (command === 'publish' && !id)) throw new ImportError('INVALID_ARGUMENT', 'Comando o UUID non valido. Usa --help.');
  const limits = { budget: [1, 1000], rpm: [1, 30], reserve: [0, 999], retries: [0, 10], sample: [1, 20], 'timeout-ms': [1000, 120000] };
  for (const [name, [min, max]] of Object.entries(limits)) {
    if (values[name] !== undefined && (!/^\d+$/.test(values[name]) || Number(values[name]) < min || Number(values[name]) > max)) throw new ImportError('INVALID_ARGUMENT', `--${name}: atteso un intero fra ${min} e ${max}.`);
    if (values[name] !== undefined) values[name] = Number(values[name]);
  }
  if (command !== 'start' && values.sample !== undefined) throw new ImportError('INVALID_ARGUMENT', '--sample si imposta alla creazione dell’importazione.');
  if (['status', 'publish', 'audit', 'export', 'restore'].includes(command) && Object.keys(values).some(name => !['json', 'help'].includes(name))) throw new ImportError('INVALID_ARGUMENT', 'Le opzioni di download sono disponibili solo con start/resume.');
  if (command === 'export' && values.json) throw new ImportError('INVALID_ARGUMENT', 'export produce un file gzip: non usare --json.');
  return { ...values, command, id: id?.toLowerCase() };
}
function apiKey(env) {
  const value = env.GYMFIT_API_KEY_FILE ? fs.readFileSync(env.GYMFIT_API_KEY_FILE, 'utf8').trim() : env.GYMFIT_API_KEY?.trim();
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) throw new ImportError('API_KEY_REQUIRED', 'Configura una chiave valida in GYMFIT_API_KEY o GYMFIT_API_KEY_FILE.');
  return value;
}
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
function reporter(jsonMode, stream = process.stdout) {
  return event => {
    if (jsonMode) { stream.write(`${JSON.stringify(event)}\n`); return; }
    const percent = event.percent === null ? `scoperta ${event.discovery.done}/${event.discovery.total || '?'}` : `${event.percent.toFixed(1)}%`;
    const quota = event.quotaRemaining === null ? '?' : event.quotaRemaining;
    const prefix = `[${percent}] ${event.phase} | chiamate ${event.requests}/${event.budget} | quota ${quota}`;
    const detail = event.type === 'retry' ? `RETRY ${event.attempt}/${event.maxRetries} ${event.code}, attesa ${event.delaySeconds}s`
      : event.type === 'wait' ? `attesa ${event.seconds}s`
        : event.message || (event.type === 'completed' ? `completato${event.published === undefined ? '' : event.published ? ', catalogo attivato' : ', catalogo non attivato'}` : event.endpoint || '');
    stream.write(`${prefix}${event.estimatedRequests === null ? '' : ` | stima ${event.estimatedRequests}`} | ${clean(detail)}\n`);
  };
}

async function main(args = process.argv.slice(2), env = process.env) {
  let connection; let run; let report; let controller;
  try {
    const settings = options(args);
    if (settings.help) { process.stdout.write(HELP); return 0; }
    // Validate the credential before connecting or mutating the database.
    const secret = ['auto', 'start', 'resume'].includes(settings.command) ? apiKey(env) : null;
    if (settings.command === 'restore' && process.stdin.isTTY) throw new ImportError('ARCHIVE_REQUIRED', 'Passa il pacchetto gzip su stdin: restore < catalogo.json.gz');
    const archive = settings.command === 'restore' ? unpackCatalog(fs.readFileSync(0)) : null;
    report = reporter(settings.json);
    connection = await mariadb.createConnection(readConfig(env).database);
    if (!['status', 'audit', 'export'].includes(settings.command)) await migrateMariaDatabase(connection);
    if (['audit', 'export'].includes(settings.command)) {
      await connection.beginTransaction();
      try {
        const snapshot = await readCatalog(connection, settings.id);
        if (settings.command === 'export') process.stdout.write(packCatalog(snapshot));
        else {
          const audit = auditCatalog(snapshot);
          process.stdout.write(`${JSON.stringify(audit, null, settings.json ? 0 : 2)}\n`);
          return audit.ok ? 0 : 1;
        }
      } finally { await connection.rollback(); }
      return 0;
    }
    if (settings.command === 'restore') {
      const audit = await restoreCatalog(connection, archive);
      process.stdout.write(`${JSON.stringify({ ...audit, staged: true }, null, settings.json ? 0 : 2)}\n`);
      return 0;
    }
    const repo = createRepository(connection);
    if (settings.command !== 'status') await repo.lock();
    run = settings.id ? await repo.get(settings.id) : await repo.latest();
    if (settings.command === 'status') {
      if (!run) throw new ImportError('IMPORT_NOT_FOUND', 'Nessuna importazione presente.');
      report({ type: 'status', ...progress(run), active: run.active_slot === 1, counts: await repo.counts(run), lastError: run.last_error_code, nextRequestAt: run.next_request_at });
      if (!settings.json) {
        const counts = await repo.counts(run);
        process.stdout.write(`UUID: ${run.id}\nStato: ${run.status} | attivo: ${run.active_slot === 1 ? 'sì' : 'no'} | ultimo errore: ${clean(run.last_error_code || 'nessuno')}\nEsercizi: ${counts.exercises} | muscoli: ${counts.muscles} | gruppi: ${counts.groups} | collegamenti: ${counts.links}\n`);
      }
      return 0;
    }
    if (settings.command === 'start' || (settings.command === 'auto' && !run)) {
      run = newImport(settings);
      await repo.create(run);
    } else if (!run) throw new ImportError('IMPORT_NOT_FOUND', 'Importazione non trovata.');
    if (run.checkpoint_version !== undefined && run.checkpoint_version !== 1) throw new ImportError('CHECKPOINT_VERSION', 'Formato checkpoint non supportato da questa versione.');
    if (settings.command === 'publish') {
      if (run.status !== 'completed' || !run.checkpoint.finalMeta) throw new ImportError('INCOMPLETE_IMPORT', 'Solo un catalogo completo può essere pubblicato.');
      requireHealthy(await readCatalog(connection, run.id));
      await validateCatalog(repo, run); await repo.publish(run);
      report({ type: 'completed', ...progress(run), published: true }); return 0;
    }
    if (settings.budget !== undefined) run.request_budget = settings.budget;
    if (run.request_budget < run.requests_started) throw new ImportError('INVALID_ARGUMENT', 'Il budget non può essere inferiore ai tentativi già iniziati.');
    if (settings.rpm !== undefined) run.requests_per_minute = settings.rpm;
    if (settings.reserve !== undefined) run.checkpoint.reserve = settings.reserve;
    if (settings.retries !== undefined) run.checkpoint.retries = settings.retries;
    controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    if (!settings.json) process.stdout.write(`Importazione: ${run.id}\n`);
    try {
      await importCatalog({ repository: repo, client: createHttpClient(secret, { timeoutMs: settings['timeout-ms'] }), run, emit: report, signal: controller.signal, preflight: settings.preflight, publish: !settings['no-publish'] });
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return 0;
  } catch (error) {
    if (error.code === 'PREFLIGHT_COMPLETE') return 0;
    if (error.code === 'ER_NO_SUCH_TABLE') process.stderr.write('SCHEMA_NOT_READY: tabelle GymFit non presenti. Avvia start per applicare la migrazione.\n');
    else if (!report || !run || error.code === 'CHECKPOINT_VERSION') process.stderr.write(`${clean(error.code || 'ERROR')}: ${clean(error instanceof ImportError ? error.message : 'Operazione non riuscita. Verifica configurazione e connessione al database.')}\n`);
    else if (!error.reported) report({ type: 'error', ...progress(run), code: error.code || 'ERROR', message: error instanceof ImportError ? error.message : 'Operazione database non riuscita.' });
    return error.status === 'paused' || error.status === 'waiting_quota' ? 2 : 1;
  } finally { await connection?.end().catch(() => {}); }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, options, reporter, apiKey };
