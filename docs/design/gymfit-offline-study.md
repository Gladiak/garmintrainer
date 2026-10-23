# GymFit: catalogo locale essenziale

Revisione 4, 23 ottobre 2026. Proposta per Garmin Trainer e MariaDB 11.8.

## Decisione

Ridurre la bozza da **16 a 5 tabelle**: quattro per il catalogo e una per l'importazione. Il requisito è compilare schede con esercizi, serie, ripetizioni e pesi e calcolare nell'app un indice personalizzato per gruppo muscolare. Il catalogo viene importato prima dell'utilizzo e interrogato esclusivamente in locale. Non sono previste richieste GymFit durante creazione, consultazione o calcolo delle schede.

Il [riferimento SQL](gymfit-offline-schema.sql) sostituisce la precedente proposta estesa. Lo schema è implementato dalle migrazioni `006-gymfit-catalog.sql`, `007-gymfit-muscle-roles.sql` e `008-gymfit-english-names.sql`, applicata all'avvio dell'applicazione o del tool CLI. L'importazione del catalogo resta un'operazione esplicita separata. La [guida CLI](../gymfit-import.md) descrive i comandi disponibili.

Questo studio assume l'autorizzazione alla conservazione locale per uso personale, non commerciale e di test già riferita dal proprietario del progetto. Il piano considerato è quello gratuito. Nessuna chiave è stata utilizzata.

## Le cinque tabelle

| Tabella | Contenuto | Motivo per mantenerla |
|---|---|---|
| `gymfit_imports` | Stato, catalogo attivo, budget, contatori, quota, riferimenti API e checkpoint JSON. | Riprendere il lavoro e pubblicare solo una versione completa. Sostituisce sessioni, coda, lease e tabella degli ID visti della vecchia proposta. |
| `gymfit_muscle_groups` | UUID e nome del gruppo, dati originali JSON. | Un'identità stabile per aggregazioni e heatmap personalizzata. |
| `gymfit_muscles` | UUID, gruppo, nome anatomico/comune, parte del corpo e dati originali JSON. | Tassonomia locale, senza ripetere il gruppo in ogni esercizio. |
| `gymfit_exercises` | UUID, slug, nome, attrezzo principale, categoria, difficoltà, parte del corpo, eventuale modalità di registrazione e dati originali JSON. | Ricerca e selezione locale degli esercizi. |
| `gymfit_exercise_muscles` | Esercizio, muscolo e ruolo `target` oppure `synergist`. | Relazione molti-a-molti indispensabile per i calcoli SQL e la distinzione dei ruoli. |

Ogni riga del catalogo appartiene a un'importazione tramite `import_id`. Le chiavi dei dati includono questo identificativo, così due versioni possono contenere gli stessi UUID GymFit senza sovrascriversi. Le FK composite impediscono collegamenti accidentali fra versioni diverse.

La chiave di `gymfit_exercise_muscles` comprende importazione, esercizio, muscolo e ruolo. GymFit può riportare lo stesso muscolo in entrambi i ruoli anche nel dettaglio di un esercizio: verificato sul deltoide di “Alternate Front Raise (Dumbbell)”. Si conservano entrambe le associazioni originali, senza sovrascriverne una. La migrazione `007-gymfit-muscle-roles.sql` aggiorna la chiave mantenendo i collegamenti già acquisiti. Per il modello di impatto proposto si considera una sola volta ciascuna coppia esercizio/muscolo e si dà precedenza al ruolo `target` quando sono presenti entrambi; è una regola locale modificabile, non un coefficiente fornito dall'API.

### Tabelle eliminate

- **Attrezzi e famiglie:** l'attrezzo principale è una colonna dell'esercizio. Gli elenchi dei valori e le famiglie usate per paginare restano in `reference_data` e nel checkpoint. Non richiedono join nel caso d'uso attuale.
- **Collegamenti esercizio–gruppo:** si ricavano da esercizio → muscolo → gruppo. I `primaryGroups` sintetici rimangono nel JSON originale, come informazione del fornitore e confronto di copertura, senza una seconda tabella di relazioni da sincronizzare.
- **Attrezzi accessori, istruzioni, consigli, errori, finalità e varianti:** non servono al calcolo richiesto. Eventuali campi già ricevuti rimangono nel JSON; non si effettuano chiamate per arricchirli.
- **SVG e immagini:** nessun asset GymFit viene importato. La grafica e la corrispondenza gruppo–regione della heatmap sono locali.
- **Job, controlli e ID visti separati:** un solo importatore sequenziale e un checkpoint persistente sostituiscono queste strutture. `catalog_seen` distingue un esercizio enumerato nel catalogo da uno incontrato soltanto in una ricerca muscolare.

Scendere a quattro tabelle incorporando i gruppi nei muscoli sarebbe possibile, ma duplicherebbe identità e nomi utili alla heatmap. Memorizzare i muscoli come array JSON dentro ogni esercizio ridurrebbe ancora il numero di tabelle, sacrificando FK, unicità delle associazioni e query semplici per gruppo. Cinque è il compromesso consigliato per questo progetto.

## Campi SQL e JSON

Si indicizzano solo le informazioni da cercare o collegare: nome, attrezzo, categoria/difficoltà e associazioni muscolari. Le altre informazioni ricevute restano in `source_payload`; `reference_data` conserva meta e liste utilizzate dall'importatore. Non si creano tabelle per ogni proprietà del servizio e non si deve dipendere dalla sua disponibilità per leggere un campo conservato.

Se lo stesso record arriva da risorse diverse, `source_payload` conserva gli oggetti sotto chiavi distinte per origine, ad esempio voce della tassonomia e risultato della ricerca muscoli. Una risposta più povera non deve cancellare campi già acquisiti. Anche la proiezione SQL deve distinguere campo assente da valore esplicitamente nullo; non perdere i capi muscolari ricevuti con i gruppi quando si aggiunge il `bodyPart` da una ricerca.

Gli UUID restano `CHAR(36) ASCII` con confronto binario, coerentemente con il progetto. Le colonne testuali usano `utf8mb4`; i tempi sono millisecondi Unix UTC. I valori di classificazione usano `VARCHAR`, per non vincolare il database a enumerazioni del fornitore.

`tracking_type` è nullable: le risposte sintetiche non documentano questo campo. Per il caso iniziale con pesi e ripetizioni, l'app può scegliere localmente tale modalità di registrazione; non deve presentarla come un dato ricevuto dall'API. Eventuali modalità particolari si configurano localmente. Nessuna chiamata ai dettagli è necessaria per assegnarle.

La variante compatta non promette istruzioni complete o attrezzi accessori di ogni esercizio. Conserva il catalogo sintetico e la mappa muscolare necessari al requisito corrente. Un muscolo presente nella tassonomia può elencare i propri capi, ma questo non prova quali capi siano coinvolti da un singolo esercizio.

## Nomi originali inglesi

Esercizi, muscoli e gruppi muscolari conservano soltanto `name`, il nome inglese ricevuto da GymFit, indipendentemente dalla lingua dell’interfaccia. Anche `common_name` e `source_payload` restano dati originali del fornitore. Le tabelle del catalogo rimangono cinque.

La migrazione `008-gymfit-english-names.sql` rimuove le dodici colonne localizzate della precedente struttura senza cambiare UUID, nomi inglesi, payload o associazioni. Importazione, pubblicazione ed esportazione usano esclusivamente questi nomi; non sono previsti strumenti di traduzione del catalogo.

## Cataloghi isolati e pubblicazione

L'importazione nuova scrive nelle quattro tabelle con un nuovo `import_id`. Durante il download nessuna di queste righe è servita all'app. L'eventuale versione precedentemente pubblicata resta disponibile.

`active_slot` è `NULL` per le versioni non attive e `1` per l'unica attiva. L'indice univoco consente molte versioni inattive e al massimo una attiva. I CHECK richiedono stato `completed`, copertura dichiarata di catalogo e mappa, conteggi attesi noti e date di completamento/pubblicazione. Questi vincoli impediscono un'attivazione palesemente incompleta, ma non sostituiscono la verifica applicativa delle pagine e dei conteggi.

Prima di pubblicare, l'importatore verifica:

1. Tutte le partizioni del catalogo e tutte le coppie muscolo/ruolo sono terminate, inclusi eventuali filtri aggiuntivi per superare il limite di offset.
2. Gli UUID unici con `catalog_seen = 1` corrispondono al totale dichiarato da `/v2/meta`; nessun esercizio trovato solo tramite ricerche muscolari resta senza riconciliazione nel catalogo.
3. Gruppi e muscoli corrispondono ai conteggi attesi; ogni muscolo usato nei calcoli è assegnato a un gruppo valido. `group_id` è nullable per consentire un caricamento provvisorio, non per ignorare un problema al momento della pubblicazione.
4. I risultati di ogni ricerca sono coerenti con il suo `total`, non ci sono conflitti di ruolo e le eventuali assenze sono state controllate. Confrontare i soli totali non prova che gli ID siano gli stessi; variazioni del catalogo durante l'importazione richiedono riconciliazione.
5. Un campione di pochi dettagli esercizio, ad esempio 5 richieste previste nel budget, conferma il significato delle associazioni ricostruite tramite i filtri. I dettagli non vengono scaricati per tutti gli esercizi.

La pubblicazione avviene in una sola transazione: togliere `active_slot` alla versione precedente e impostarlo a `1` sulla nuova, dopo aver registrato esito e date. Se l'operazione fallisce, il rollback conserva la versione attiva precedente. L'app legge esclusivamente righe che appartengono all'importazione attiva.

Le versioni pubblicate si considerano immutabili: un aggiornamento crea una nuova importazione. Un errore, una quota terminata o una sospensione non cancellano dati attivi. Le versioni inattive possono essere eliminate quando non servono più e non sono referenziate da schede o storico. Non è prevista una tabella di stato distinta per ogni utente: il catalogo pubblico è condiviso nell'installazione.

Le due versioni temporaneamente presenti aumentano righe e spazio, non il numero di tabelle o le chiamate API. È una scelta intenzionale per evitare che un calcolo usi metà catalogo vecchio e metà nuovo.

## Ripresa con una sola tabella di importazione

Per il volume previsto basta un importatore sequenziale. Mantiene una connessione MariaDB dedicata con `GET_LOCK('garmintrainer_gymfit_import', 0)` per tutta l'esecuzione. Non usa un pool che possa rilasciare la connessione proprietaria del lock. Se perde la connessione, smette di richiedere dati finché non ha riacquisito il lock e riletto lo stato. MariaDB libera il lock quando la connessione si chiude: non servono tabelle aggiuntive di lease.

Il checkpoint JSON contiene versione del formato, fase corrente e una lista di partizioni. Per ogni famiglia o coppia muscolo/ruolo conserva filtri, `offset` successivo, totale atteso, UUID già ricevuti e stato. Gli UUID permettono di rilevare ripetizioni fra pagine e controllare l'unione delle partizioni senza una tabella aggiuntiva; il JSON cresce con le associazioni del catalogo, ma non duplica tutte le risposte e non contiene la chiave API. Le risposte necessarie stanno nei record del catalogo.

Ogni pagina si salva nella stessa transazione che avanza il checkpoint. Un crash prima del commit lascia il cursore precedente: la pagina si ripete e le PK rendono idempotente il salvataggio, senza sommare conteggi di righe duplicate. Un crash dopo il commit permette di ripartire dalla pagina successiva. Contare gli esercizi con SQL, non sommando ingenuamente le dimensioni delle pagine.

Prima di iniziare una richiesta, incrementare e salvare `requests_started` e il prossimo istante consentito. Il contatore comprende anche tentativi falliti e tentativi forse non partiti dopo un crash: è un limite conservativo. Aggiornare `requests_succeeded` solo dopo una risposta riuscita. Un crash dopo la risposta HTTP e prima del commit può consumare quota due volte quando la pagina viene ripetuta: non esiste garanzia di consumo esattamente una volta.

Impostazioni iniziali: **20 richieste/minuto, budget massimo di 900 tentativi e riserva desiderata di 100 richieste sulla quota mensile**. Il budget per importazione non equivale alla quota residua: leggere sempre gli header e fermarsi prima se l'account ha già consumato chiamate. Un'importazione nuova deve rispettare anche l'ultimo `next_request_at` persistito dalle precedenti, oltre ai limiti comunicati dal servizio, per non ripartire con una raffica di richieste.

Gestire `429 rate_limited` con `Retry-After` e prossima chiamata persistita; `quota_exceeded` porta a `waiting_quota`. Timeout e 5xx richiedono backoff limitato, senza retry infiniti. Le risposte di quota forniscono il periodo effettivo: non assumere rinnovo il primo giorno del mese. La chiave resta in un secret lato backend/importatore, fuori da checkpoint, payload e log.

La semplificazione è adatta a un unico importatore e poche centinaia di richieste: non introduce una coda SQL distribuita, worker paralleli o interrogazioni SQL sui singoli job. Se in futuro servissero queste funzioni, sarebbe giustificato separare una tabella dei job.

## Stima delle chiamate sul piano gratuito

La riduzione delle tabelle **non riduce le chiamate API**. Il risparmio deriva dall'ottenere gli esercizi attraverso filtri muscolari, invece di richiedere il dettaglio di ciascuno.

Fonti analizzate: [documentazione](https://api.gymfit-api.com/docs), [OpenAPI](https://api.gymfit-api.com/openapi.json) e [piano Free](https://www.gymfit-api.com/#pricing). Il piano pubblica 1.000 richieste/mese e 30/minuto. I conteggi derivano dagli esempi pubblici già esaminati, non da richieste autenticate: 5.796 esercizi, 49 muscoli, 21 gruppi e 136 famiglie.

| Passaggio | Richieste |
|---|---:|
| `meta`, `families`, `muscle-groups`, `muscles/search?limit=100` | 4 |
| Catalogo sintetico paginato per famiglia | circa 155 |
| Ricerche per 49 muscoli × 2 ruoli, con paginazione | Variabili |
| Controllo campione sui dettagli | ad esempio 5 |
| Controllo quota e controllo `meta` finale | 2, più un controllo quota a ogni ripresa |
| **Budget di pianificazione totale** | **circa 350–650, con controlli e retry da verificare** |

La ricerca accetta fino a 100 risultati per pagina, ma lo schema documenta `offset <= 1000`. La scansione del catalogo per famiglia evita tale limite negli esempi pubblici, dove la famiglia maggiore ha 262 esercizi. Le 136 famiglie sommano a 5.796 esercizi e richiedono 155 pagine. Questa copertura va confermata dal vivo.

Per il catalogo usare `include=all`, `group=false`, `sort=name` e `limit=100`; senza `include=all`, l'esempio comprende soltanto 1.900 esercizi. La risposta sintetica non contiene tutti i muscoli secondari.

La mappa si ricostruisce con:

```text
GET /v2/muscles/<uuid>/exercises?muscleRole=target&include=all&sort=name&limit=100&offset=<n>
GET /v2/muscles/<uuid>/exercises?muscleRole=synergist&include=all&sort=name&limit=100&offset=<n>
```

Il muscolo è noto dal percorso, il ruolo dal filtro e il gruppo dalla tassonomia. Invertendo le liste si ottengono le righe di `gymfit_exercise_muscles`. Usare `any` non distinguerebbe il ruolo. Una ricerca interrotta non permette di concludere che i collegamenti non ancora ricevuti siano assenti.

La verifica autenticata del 23 ottobre 2026 ha confermato che `/muscle-groups` comprende 48 muscoli, mentre `meta` e `/muscles/search` ne riportano 49. Il muscolo aggiuntivo, Popliteus, non ha gruppo né esercizi associati nei due ruoli: rimane nel DB con gruppo nullo. Non va imposto che il solo elenco dei gruppi copra tutti i muscoli del catalogo. Il tool risolve gli eventuali gruppi mancanti dal campo `group` della ricerca e verifica per primi i muscoli ancora senza gruppo. Un muscolo usato dagli esercizi deve invece avere un gruppo prima dell'attivazione. L'endpoint `/muscles/<uuid>/exercises` rifiuta `group=false` e non documenta `bodyPart`: quei parametri restano riservati alla ricerca generale degli esercizi.

Se nessuna ricerca supera il limite di offset, la formula è:

```text
C_mappa = somma, per ciascuno dei 49 muscoli e 2 ruoli,
          di max(1, ceil(total_risultati / 100))
C_totale = 4 + 155 + C_mappa + C_campione + 2
```

Ipotizzando soltanto per pianificazione 3–6 associazioni medie per esercizio, il modello produce circa 333–605 richieste senza campione. Il budget indicativo arrotondato rimane 350–650: **non è un conteggio misurato e non garantisce di rientrare nella quota**. Ricerche oltre 1.100 risultati richiedono altre partizioni, aumentando il costo.

Le quattro richieste di riferimento, il controllo quota e la prima pagina delle 98 ricerche muscolari consentono una prima previsione con circa **103 tentativi**, che sono già lavoro utile dell'importazione. Se i totali sono troppo grandi, il tool sospende il download prima del resto delle pagine quando la previsione supera il budget; prima dell'attivazione controlla anche la corrispondenza dei dettagli campione. Il limite di 900 tentativi resta un tetto, non una promessa di completamento.

Se la previsione è confermata, l'importazione richiede indicativamente 18–33 minuti a 20/minuto, oltre a latenze, campione e retry. Un export autorizzato JSON/CSV fornito dallo sviluppatore rimane una possibile alternativa se la scansione non rientra nel budget; non è stato richiesto o ricevuto da questo agente.

## Query locale e calcolo dell'impatto

La lettura del catalogo attivo può usare questa query, senza accesso all'API:

```sql
SELECT e.id AS exercise_id, e.name AS exercise_name,
       m.id AS muscle_id, m.name AS muscle_name,
       CASE WHEN MAX(em.role = 'target') = 1 THEN 'target' ELSE 'synergist' END AS role,
       g.id AS group_id, g.name AS group_name
FROM gymfit_imports i
JOIN gymfit_exercises e ON e.import_id = i.id
JOIN gymfit_exercise_muscles em
  ON em.import_id = e.import_id AND em.exercise_id = e.id
JOIN gymfit_muscles m
  ON m.import_id = em.import_id AND m.id = em.muscle_id
JOIN gymfit_muscle_groups g
  ON g.import_id = m.import_id AND g.id = m.group_id
WHERE i.active_slot = 1 AND e.id = ?
GROUP BY e.id, e.name, m.id, m.name, g.id, g.name;
```

La query restituisce una sola riga per coppia esercizio/muscolo anche quando entrambi i ruoli sono presenti nel DB. La selezione degli esercizi parte invece da `gymfit_exercises` della versione attiva: non va limitata a questo inner join, che omette esercizi privi di associazioni. Un esercizio senza collegamenti riportati deve essere indicato come non mappato per il calcolo, senza assegnargli un impatto nullo o inventare relazioni.

Schede, ripetizioni, pesi, coefficienti e risultati sono dati personali dell'app e non appartengono al catalogo GymFit. Le attuali `planned_sessions` descrivono sessioni, non ancora esercizi e serie. La sezione Schede allenamento usa tre tabelle personali: `workout_routines`, `workout_routine_exercises` e `workout_routine_sets`, introdotte dalla migrazione `009`. Sono distinte dalle cinque tabelle del catalogo e dalle sessioni del calendario.

La voce della scheda dovrà conservare `import_id`, UUID dell'esercizio e nome come fotografia storica, oppure una fotografia delle associazioni utilizzate. Il semplice UUID GymFit senza versione non basta a rendere riproducibili vecchi calcoli. Se si usano FK verso una versione, la pulizia delle importazioni inattive dovrà rispettarle, senza cancellare lo storico.

La formula può partire dal volume esterno della serie, ad esempio ripetizioni × kg per esercizi con sovraccarico, e applicare coefficienti locali secondo gruppo e ruolo. Tali coefficienti sono scelte del modello dell'app: GymFit non fornisce una percentuale di attivazione. Occorre definire separatamente corpo libero, assistenza, unilateralità e dati mancanti, e aggregare i muscoli dello stesso gruppo evitando di moltiplicare involontariamente il peso della stessa serie. Coefficienti e versione della formula possono inizialmente stare nella configurazione locale dell'app, senza creare altre tabelle del catalogo.

## Limiti e passaggio successivo

Il catalogo importato rende l'app indipendente da GymFit se backend e MariaDB sono raggiungibili. Se girano su una VPS, usare il telefono completamente senza rete richiederebbe anche dati e interfaccia sul dispositivo; è un lavoro distinto.

L'importatore è implementato in `scripts/gymfit-import.js`, con wrapper Docker e moduli in `helpers/gymfit/`. Offre avvio, preflight, ripresa, stato locale, pubblicazione, percentuali e log JSON. L'importazione autenticata è stata avviata e sono stati verificati alcuni casi reali; la migrazione dello schema è disponibile. L’interfaccia Schede allenamento permette di compilare schede riutilizzabili con esercizi, serie, ripetizioni, kg e recuperi.

## Verifica della bozza

La revisione a cinque tabelle è stata eseguita con esito positivo in un container temporaneo MariaDB 11.8 senza rete, separato dal database dell'applicazione. Verificati: creazione delle cinque tabelle, caricamento degli stessi UUID in due versioni distinte, FK fra versioni, unicità del ruolo, validazione JSON e budget, blocco di pubblicazioni incomplete, una sola versione attiva, rollback e commit della pubblicazione, query delle associazioni della sola versione attiva, rollback congiunto di una pagina e del checkpoint e pulizia a cascata di una versione inattiva. Diciassette istruzioni volutamente non valide sono state rifiutate come previsto.

L'importatore è stato inoltre testato con risposte GymFit sintetiche e uno schema MariaDB temporaneo: paginazione, retry, quota, budget, ripresa delle pagine salvate, doppi ruoli, migrazione con dati esistenti e pubblicazione. I test automatici non consumano la quota reale. Le verifiche autenticate di tassonomia e doppi ruoli sono descritte sopra; il completamento del preflight deve ancora confermare il costo del catalogo intero.
