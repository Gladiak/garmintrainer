# Importazione GymFit da CLI

Il comando importa il catalogo e i collegamenti muscolari nel MariaDB dell'app. Mostra fase, avanzamento, richieste usate, budget, quota residua ed errori/retry. Il catalogo precedente resta attivo finché il nuovo non supera i controlli. Durante l'uso ordinario dell'app non è necessario contattare GymFit.

## Launcher unico con chiave nel file

Nella radice del progetto è disponibile il launcher locale `import-gymfit.command`:

1. Aprilo con un editor e sostituisci `INCOLLA_LA_TUA_CHIAVE_API` nella riga `const API_KEY = '...'`.
2. Avvia Docker, quindi esegui `./import-gymfit.command` dalla radice del progetto. Il file è già eseguibile; su macOS puoi anche aprirlo con doppio clic.

Il launcher avvia MariaDB e il tool Docker con il comando `auto`: crea la prima importazione se non ne esiste una, riprende l'ultima se incompleta e non effettua download se è già completata. Mantiene i limiti e la visualizzazione dei progressi del tool. Non richiede export di variabili o una scelta manuale fra start e resume. Non si ferma al preflight: avvia il download fino al completamento o al raggiungimento dei limiti.

La copia locale contenente la chiave è esclusa sia da Git sia dal contesto di build Docker. Nel repository rimane solo il template senza chiave `scripts/templates/import-gymfit.command`: dopo un nuovo clone, copiarlo nella radice e usare `chmod 700 import-gymfit.command`. Non inserire la chiave nel template versionato. La chiave viene passata al container tramite ambiente, senza comparire negli argomenti del processo.

## Avvio con Docker

Avvia il database, quindi indica un file privato contenente soltanto la chiave API:

```bash
npm run docker:db
export GYMFIT_API_KEY_FILE="/percorso/privato/gymfit.key"
npm run gymfit:import:docker -- start --preflight
```

È supportata anche `GYMFIT_API_KEY` nell'ambiente. Non passare il valore della chiave come argomento del comando. Il file della chiave non viene creato dal tool e deve restare fuori dai file versionati.

Il wrapper costruisce l'immagine aggiornata e avvia un container CLI temporaneo, usando rete, credenziali e MariaDB del progetto; non avvia un altro server web. La prima build può richiedere qualche minuto. La chiave viene passata tramite ambiente al solo container di importazione. Il comando applica anche le migrazioni pendenti, inclusa `006-gymfit-catalog.sql`, senza richiedere la chiave di cifratura Garmin.

`--preflight` salva i riferimenti e la prima pagina di ogni ricerca muscolare, determina i totali e poi si ferma con codice 0. Sono chiamate reali, già riutilizzate dalla successiva ripresa. Non è una simulazione gratuita. Con i conteggi pubblici analizzati, la fase iniziale richiede circa 103 tentativi: controllo quota + quattro riferimenti + 98 ricerche, con richieste aggiuntive se servono suddivisioni o retry.

Per proseguire con l'ultima importazione:

```bash
npm run gymfit:import:docker -- resume
```

Oppure avvia direttamente l'intera importazione, senza fermarti al preflight:

```bash
npm run gymfit:import:docker -- start
```

`start` crea sempre una versione nuova. Per continuare quella esistente usa `resume`, evitando di riscaricare i dati già confermati.

## Avanzamento e stato

Esempio indicativo di output:

```text
Importazione: <UUID>
[scoperta 28/98] discovery | chiamate 33/900 | quota 968 | stima 410
[42.7%] catalog | chiamate 210/900 | quota 791 | stima 493
[42.7%] catalog | chiamate 211/900 | quota 791 | RETRY 1/5 rate_limited, attesa 12s
[100.0%] completed | chiamate 496/900 | quota 507 | completato, catalogo attivato
```

I numeri sono illustrativi. Durante la scoperta non viene presentata una percentuale complessiva, perché il totale è ancora sconosciuto. Poi la percentuale usa esercizi e associazioni attesi; resta al massimo al 99,9% fino a campioni e controlli SQL conclusi. Nuove partizioni possono aggiornare la previsione. Le righe elaborate includono le associazioni, quindi non equivalgono al numero di esercizi unici.

Da un secondo terminale puoi leggere lo stato persistito senza usare l'API o richiedere la chiave:

```bash
npm run gymfit:import:docker -- status
npm run gymfit:import:docker -- status <UUID>
npm run gymfit:import:docker -- resume <UUID>
```

L'UUID viene stampato all'avvio. `status` mostra anche conteggi SQL, stato di attivazione e ultimo errore. Prima del primo `start` lo schema potrebbe non essere ancora stato creato. `--help` elenca tutte le opzioni.

Per strumenti di monitoraggio o un log in formato NDJSON:

```bash
npm run --silent gymfit:import:docker -- resume --json > /tmp/gymfit-import.ndjson
npm run --silent gymfit:import:docker -- status --json
```

Ogni evento contiene UUID, fase, stato, percentuale o scoperta, tentativi, successi, budget, quota e previsione. I retry includono codice, numero del tentativo e attesa. I messaggi della build Docker restano su stderr. Il log non contiene la chiave, le risposte originali dell'API o password del database.

## Interruzioni, retry e quota

- **Ctrl+C/SIGTERM:** il tool si ferma dopo la richiesta in corso. Le pagine già confermate rimangono nel DB. In caso di arresto forzato o perdita di connessione si riparte dall'ultimo commit; una pagina ricevuta ma non confermata potrebbe consumare una chiamata aggiuntiva.
- **Rete, timeout, 5xx e 429:** retry limitati, attesa crescente e rispetto di `Retry-After` e rate limit. Esauriti i retry, il tool si sospende; `resume` apre una nuova serie di tentativi.
- **Quota:** il valore iniziale arriva da `/v2/usage/current`; se la chiave non supporta quell'endpoint, il tool legge gli header di una richiesta `meta`. Il controllo quota viene ripetuto a ogni ripresa che richieda altre chiamate. Una quota vecchia a zero non impedisce di rilevare il periodo nuovo.
- **Budget:** per default 900 tentativi totali per importazione, incluse chiamate di controllo ed errori. Le risposte riuscite e i tentativi sono conteggiati separatamente. Il tool si ferma anche prima del budget se la quota arriva alla riserva di 100 richieste.
- **Dati incoerenti:** duplicati nelle pagine, totali variabili, errori di autenticazione, dettagli campione discordanti o copertura incompleta fermano l'importazione senza sostituire il catalogo attivo. La risposta della pagina resta nel checkpoint se la validazione o il salvataggio SQL falliscono; la ripresa la riutilizza prima di richiedere altre pagine.
- **Doppi ruoli:** GymFit può elencare lo stesso muscolo sia come `target` sia come `synergist` dello stesso esercizio. Il DB conserva entrambi, con una riga per ruolo; `MULTIPLE_MUSCLE_ROLES` è un avviso informativo. La migrazione `007` aggiorna la chiave senza cancellare le associazioni esistenti. Per calcolare l'impatto senza duplicazioni, la query nello studio raggruppa per coppia esercizio/muscolo e sceglie `target` se presente.
- **Gruppi parziali:** `/muscle-groups` può contenere meno muscoli di quelli dichiarati da `meta`. Il tool completa i muscoli con `/muscles/search`, usando il nome del gruppo restituito dalla ricerca quando disponibile. Conserva le risposte di questi due riferimenti anche se la normalizzazione fallisce, così una ripresa dopo la correzione non richiede di scaricarle nuovamente.
- **Muscoli senza gruppo:** vengono controllati per primi nella scoperta. Se non compaiono in alcun esercizio restano nel DB con `group_id=NULL`; se hanno esercizi, il tool si ferma subito con `UNCLASSIFIED_MUSCLE`, prima di avviare il download restante. Il gruppo va risolto esplicitamente nel DB dell'importazione prima di riprendere; non viene dedotto dall'anatomia.
- **Concorrenza:** un lock MariaDB su connessione dedicata consente un solo importatore. `status` funziona anche mentre il download è in corso. La perdita del lock arresta il lavoro; non si riconnette per continuare senza controllo.

Puoi modificare i limiti durante una ripresa:

```bash
npm run gymfit:import:docker -- resume <UUID> --budget 950 --rpm 20 --retries 3
```

Il budget è il tetto complessivo, non il numero di nuove chiamate concesse al comando. Non può scendere sotto i tentativi già iniziati. I massimi del tool restano quelli del piano Free: 1.000 tentativi per importazione e 30 richieste/minuto. `--reserve 100` e `--timeout-ms 20000` sono configurabili. Un budget più alto non aumenta la quota dell'account e la riserva continua ad applicarsi.

Codici di uscita: **0** per completamento, stato o preflight concluso; **2** per pausa, interruzione, quota o budget; **1** per errore di dati/configurazione/database. La percentuale da sola non basta a stabilire il successo: controlla stato finale e codice di uscita.

## Verifica e pubblicazione

Il tool importa per famiglia e per coppia muscolo/ruolo usando `include=all` e pagine da 100. `group=false` si applica soltanto a `/exercises/search`: l'endpoint degli esercizi di un muscolo lo rifiuta. Suddivide le ricerche che superano il limite documentato di offset usando categoria, difficoltà o tier; per il catalogo può usare anche la parte del corpo. Se i filtri non coprono i risultati, segnala l'incompletezza anziché pubblicare dati parziali. La tassonomia attuale deve rientrare in una pagina di ricerca muscoli (fino a 100); se cresce oltre tale limite, il tool si ferma esplicitamente.

Prima dell'attivazione controlla gli UUID unici delle partizioni, i conteggi SQL, l'appartenenza dei muscoli usati dagli esercizi ai gruppi, cinque dettagli campione e un nuovo `meta` per rilevare variazioni dei conteggi. `--sample N` permette di scegliere fra 1 e 20 campioni alla creazione. I controlli non possono imporre un'istantanea immutabile al servizio: se il catalogo cambia durante il download e i controlli lo rilevano, va avviata una nuova importazione.

Per scaricare e verificare senza attivare automaticamente:

```bash
npm run gymfit:import:docker -- start --no-publish
npm run gymfit:import:docker -- publish <UUID>
```

`publish` usa solo il DB, ricontrolla la copertura e cambia catalogo in una transazione. Le cinque tabelle conservano i nomi originali inglesi di esercizi, muscoli e gruppi.

## Trasferimento in produzione

Il catalogo è trasferibile senza rifare chiamate GymFit. Il pacchetto gzip contiene solo le righe della versione scelta nelle cinque tabelle `gymfit_*`, con checkpoint, nomi inglesi e payload originali. Non include utenti, schede personali, dati Garmin o credenziali. Il formato è JSON, con checksum SHA-256 verificato dal tool prima del caricamento; non esegue SQL proveniente dal file.

Prima controlla il catalogo locale ed esportalo. `audit` e `export` usano per default il catalogo attivo; puoi indicare un UUID per scegliere una versione completata diversa:

```bash
mkdir -p data/exports
npm run gymfit:import:docker -- audit
npm run --silent gymfit:import:docker -- export > data/exports/gymfit-catalog.json.gz
shasum -a 256 data/exports/gymfit-catalog.json.gz
```

`audit` confronta UUID, ruoli e partizioni con i checkpoint, oltre ai conteggi SQL, ai riferimenti e ai controlli campione già registrati. Segnala gli esercizi senza associazioni nel report; non consulta l'API né verifica nuovamente i cinque dettagli remoti. L'export viene rifiutato se l'audit trova errori. Il pacchetto richiede lo schema GymFit 8, checkpoint 1 e API v2; il database destinatario deve usare questa versione aggiornata del codice.

Il deploy VPS già previsto dal progetto (`npm run deploy:vps`) include CLI, moduli e migrazioni e crea un backup del DB esistente prima dell'aggiornamento. Si può anche creare un backup dedicato con `npm run deploy:vps -- backup`. Questi comandi agiscono sulla produzione: vanno eseguiti quando si decide di procedere al trasferimento. Esportare il catalogo locale non esegue alcun deploy.

Dopo aver aggiornato il codice in produzione e creato il backup, copia il pacchetto via SCP usando host e identità SSH configurati in `deploy/vps.json`. Accedi al VPS e individua il container dell'app:

```bash
catalog_app_id="$(docker ps --filter label=com.docker.compose.project=garmintrainer-vps --filter label=com.docker.compose.service=app --format '{{.ID}}')"
test -n "$catalog_app_id"
```

Carica il file da una directory privata sul server, usando il percorso effettivo del file copiato:

```bash
docker exec -i "$catalog_app_id" node scripts/gymfit-import.js restore < /percorso/privato/gymfit-catalog.json.gz
docker exec "$catalog_app_id" node scripts/gymfit-import.js audit UUID_IMPORTATO
docker exec "$catalog_app_id" node scripts/gymfit-import.js status
```

`restore` inserisce la versione **inattiva**, in una sola transazione, e ricontrolla il catalogo riletto dal DB prima del commit. Conserva UUID, nomi inglesi e payload. Gli archivi precedenti con schema 7 vengono verificati tramite checksum e adattati eliminando i campi localizzati. Un UUID già presente viene rifiutato senza sovrascrivere dati: in quel caso usa `audit UUID` per controllare la versione esistente. I dati dell'account e il catalogo attivo non vengono modificati dal restore. Il comando funziona anche localmente con `npm run --silent gymfit:import:docker -- restore < file.json.gz`, ma rifiuta l'UUID del catalogo locale già presente.

Annota l'UUID attualmente attivo dal precedente `status`: l'ultimo import e quello attivo possono differire. Per individuarlo in modo certo, usa `audit` senza UUID, che seleziona la versione attiva. Dopo il caricamento verifica conteggi, warning e campioni registrati con `audit UUID_IMPORTATO`; poi attiva esplicitamente:

```bash
docker exec "$catalog_app_id" node scripts/gymfit-import.js publish UUID_IMPORTATO
docker exec "$catalog_app_id" node scripts/gymfit-import.js audit
```

L'attivazione cambia versione in una transazione. Il catalogo precedente rimane nel DB: per tornare a quello precedente, esegui `publish UUID_PRECEDENTE`. Se non esisteva un catalogo attivo, il primo `publish` è la prima attivazione. Conserva pacchetto e backup fino alla verifica dell'app.

### Caricamento diretto del 23 ottobre 2026

Il catalogo `c96bb3ae-df81-409d-bd0f-98d8755bbf6d` è stato caricato e attivato in produzione tramite phpMyAdmin HTTPS: 5.796 esercizi, 49 muscoli, 21 gruppi e 27.329 associazioni. Il confronto di tutti i campi con il pacchetto locale è stato eseguito prima dell'attivazione; utenti e profili esistenti sono rimasti identici. I report e il backup precedente al caricamento sono conservati localmente in `data/exports/` e `data/backups/`, fuori da Git e dalle immagini Docker.

L'accesso SSH non era raggiungibile, quindi il codice dell'applicazione non è stato aggiornato. Le nuove tabelle hanno la struttura GymFit 8, mentre il registro `schema_migrations` resta alla versione 5, compatibile con l'app attualmente distribuita. Il prossimo deploy del codice aggiornato registrerà le migrazioni 006, 007 e 008: la loro esecuzione sulle tabelle già popolate è stata verificata in un database temporaneo, senza modificare il catalogo. Non anticipare manualmente i numeri nel registro finché è in uso il vecchio codice.

## Esecuzione senza Docker e test

Con dipendenze Node installate e MariaDB raggiungibile, lo stesso tool funziona sull'host:

```bash
export DB_HOST=127.0.0.1
export DB_PORT=3307
export DB_NAME=garmintrainer
export DB_USER=garmintrainer
export DB_PASSWORD_FILE="/percorso/privato/db_password"
npm run gymfit:import -- start --preflight
```

Il Compose del progetto non espone MariaDB sull'host: usare il wrapper Docker se non è configurato un accesso separato. In un'immagine già costruita è disponibile anche `node scripts/gymfit-import.js`.

Verifiche riproducibili, con risposte GymFit sintetiche e nessun consumo della quota reale:

```bash
node --test test/gymfit.test.js
npm run test:gymfit:mariadb
```

I test MariaDB creano e rimuovono uno schema temporaneo. Coprono importazione, preflight/resume, errori e rate limit, budget, quota, perdita di esclusività fra worker, interruzione dopo una pagina, rollback dei conflitti, campioni discordanti, partizionamento e output CLI locale.

La migrazione `008` elimina le colonne dei nomi localizzati dalle tre tabelle del catalogo. Gli strumenti e le cache per tradurre gli esercizi sono stati rimossi; i cataloghi dell’interfaccia in `langs/` restano indipendenti.
