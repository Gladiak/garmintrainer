# Garmin Connect Personal API — schema e studio preliminare

Verifica documentale: **22 ottobre 2026**. Stato: **dashboard reale implementata; ulteriori estensioni solo progettate**.

Questo documento censisce tutte le operazioni nello Swagger pubblico indicato,
collega i dati ai componenti attuali e propone caricamento, refresh e conservazione
privata. Le scelte applicative definite qui non sono garanzie fornite da Garmin.
Non sono state usate chiavi personali né scaricati dati reali degli utenti.

Perimetro chiarito dall'autore: **applicazione a uso personale, con più account
per tester collegati a dispositivi diversi**. Non si sta progettando un servizio
commerciale. Ogni tester collega il proprio account Garmin al proprio profilo
locale. Le decisioni seguenti sono la base da seguire nell'implementazione;
le prove reali servono a verificare gli adapter, non a rinviare queste scelte.

## Stato dell’implementazione dashboard

Implementato il primo perimetro richiesto: lettura di dati reali, refresh manuale,
cache cifrata nel DB e navigazione con richieste sugli intervalli necessari.
La dashboard non contiene più generatori o modalità di anteprima dei dati.
Il planner locale resta separato dalle attività Garmin della heatmap.

- `controllers/garmin-*.js`: un controller dichiarativo per ciascuna delle 26
  operazioni GET del catalogo, più un controller dedicato al POST token.
  Solo gli endpoint necessari alla dashboard vengono chiamati automaticamente.
- `helpers/garmin-endpoint.js`: validazione dei parametri, percorsi e forma radice,
  limiti di intervallo e un retry limitato per timeout/5xx. Il client Axios condiviso
  mantiene token in RAM, riusa il Bearer, gestisce 401/429, annullamento e ID lossless.
- `GET /api/dashboard`: lettura locale autenticata, con date, disponibilità e
  acquisizioni per risorsa. Il bootstrap legge prima il calendario server e gli
  estremi futuri vengono limitati a oggi nel fuso Garmin, evitando richieste per
  giorni futuri quando browser e profilo sono su date diverse. `POST /api/garmin/sync`: import del range richiesto,
  `resources` opzionale e `force` per ignorare il TTL; protezione CSRF già esistente.
- `helpers/dashboard-measurements.js`: intervalli, cache, chiamate, normalizzazione,
  controllo identità e salvataggio; nessun endpoint generico che accetti URL arbitrari.
- Migrazione `002-garmin-measurements.sql`: collegamento, misure per risorsa/giorno,
  stato di sync e lease DB per profilo. I campi sanitari, le date e gli ID provider
  sono cifrati AES-256-GCM con chiavi HKDF distinte per profilo/scopo; indici HMAC.
  Le risorse sono in righe distinte: non duplicano lo stesso payload giornaliero.
- La sync è asincrona per l’interfaccia tramite fetch/Axios, ma la richiesta HTTP
  resta aperta fino al completamento: **nessun worker o job persistente** in questa
  prima versione, per mantenere il flusso lineare. Il lease DB scade dopo 120 secondi;
  le richieste hanno un segnale di annullamento a 90 secondi. Le chiamate Axios sono
  limitate a 2 contemporanee per processo e 15 secondi per lettura. Più processi
  condividono il lock per profilo, non ancora un limite globale di traffico.
- Sono applicati gli orizzonti di navigazione di 90 giorni wellness e 365 giorni
  attività. La pulizia automatica dello storico, la retention dei backup, un
  keyring per rotazione master e le azioni dedicate di cancellazione import restano
  fuori dal perimetro corrente; non vanno considerate già operative.

I dettagli progettuali successivi restano il riferimento per eventuali estensioni,
in particolare job persistenti e manutenzione dello storico. Le fonti Garmin
indicano HRV in millisecondi e la metrica notturna: il mapping `lastNightAvg` →
`hrv` in ms è adottato con questo riscontro documentale, senza attribuire una
precisione diagnostica ai valori. [HRV Status, Garmin](https://www.garmin.com/en-GB/garmin-technology/health-science/hrv-status/).
Le verifiche automatiche usano solo un provider HTTP sintetico, senza chiavi reali.

## Indice

- [Revisione proposta: tempo condiviso e moduli dinamici](#revisione-proposta-tempo-condiviso-e-moduli-dinamici)
- [Fonti e perimetro](#fonti-e-perimetro)
- [Conclusioni e criticità](#conclusioni-e-criticità)
- [Decisioni adottate](#decisioni-adottate)
- [Dashboard: fonti e significato delle misure](#dashboard-fonti-e-significato-delle-misure)
- [Finestre temporali e budget delle chiamate](#finestre-temporali-e-budget-delle-chiamate)
- [Caricamento e refresh](#caricamento-e-refresh)
- [Persistenza e cifratura](#persistenza-e-cifratura)
- [Contratto interno proposto](#contratto-interno-proposto)
- [Rimozione dellanteprima](#rimozione-dellanteprima)
- [Altri indicatori possibili](#altri-indicatori-possibili)
- [Piano di implementazione e verifica](#piano-di-implementazione-e-verifica)
- [Catalogo completo degli endpoint](#catalogo-completo-degli-endpoint)
- [Dizionario completo delle risposte](#dizionario-completo-delle-risposte)

## Revisione proposta: tempo condiviso e moduli dinamici

Analisi del 22 ottobre 2026, successiva alla prima implementazione. **Solo proposta:
nessuna modifica a interfaccia, sincronizzazione o schema DB applicata in questa
revisione.** Questa sezione sostituisce, per la prossima evoluzione, le politiche
di finestre separate e primo import fisso descritte nello studio iniziale sotto.
Il catalogo Garmin resta valido. La fonte dei contratti è lo
[Swagger ufficiale](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/).

### Problemi riscontrati nel codice attuale

| Componente | Comportamento attuale | Effetto |
| --- | --- | --- |
| `useDashboard` | Periodo wellness 7/14/30, download di almeno 12 giorni | Il periodo richiesto non coincide sempre con quello selezionato |
| Card in `App.jsx` | Ultimo valore finito di ciascuna metrica; sparkline di 12 giorni | Le card possono riferirsi a date diverse; non sono necessariamente valori del giorno finale |
| `SleepChart` | Ultimi 7 giorni indipendentemente dal periodo | Il grafico sonno cambia significato temporale rispetto al trend |
| `TrainingLoad` | Coppie di mesi con navigazione propria | Il filtro wellness non governa le attività |
| Planner | Settimana e giorno locali separati | Un'ulteriore selezione temporale, senza rapporto esplicito con gli altri pannelli |
| Sincronizzazione | Gruppo fisso wellness/HRV/sonno/attività | Scarica anche risorse non necessarie al modulo visualizzato |
| Primo import | 30 giorni wellness anche se il range è più corto | Anticipa dati senza derivare il fabbisogno dai moduli |
| Stato UI | Caricamento ed errore prevalentemente globali | Navigare in un pannello coinvolge tutta la dashboard |

Nelle impostazioni esiste la scheda «Personalizza dashboard», ma il suo pannello
è ancora vuoto: nel codice attuale non c'è un gestore operativo di moduli o una
persistenza del layout. Questa proposta ne prepara il contratto, senza darlo per
già disponibile.

### Un solo contesto temporale, rappresentazioni diverse

Adottare uno stato condiviso `{ mode, anchorDate, timeZone }`, con modalità
`day`, `7d`, `14d`, `30d`. La data di riferimento D è il termine inclusivo del
periodo: giorno = D; 7 giorni = D−6…D; analogamente per 14 e 30. Default proposto:
14 giorni fino a oggi, conservando l'abitudine attuale. Aggiungere calendario,
frecce e «Oggi» nella testata della dashboard, fuori da qualsiasi modulo.

La selezione serve tutti i moduli, indipendentemente da ordine e dimensione.
Il cambio di durata conserva D; le frecce spostano di una durata e vengono
disabilitate oltre i limiti; un input diretto viene validato. Non introdurre
selezioni diverse implicite nei componenti. Gli estremi effettivi risolti dal
server sono restituiti nella risposta e diventano quelli mostrati nella testata.

«Uniforme» significa stesso riferimento e stessa finestra dichiarata; non una
stessa aggregazione per ogni dato:

- Le card compatte mostrano il valore attribuito a D e la relativa data. La
  sparkline usa esattamente il periodo scelto; in modalità giorno si omette o
  rappresenta una vera serie intragiornaliera disponibile, senza scaricare 12
  giorni nascosti per riempirla.
- Se a D non esiste il valore, la card mostra «— / Non disponibile per D».
  Un eventuale ultimo valore precedente è solo un'informazione secondaria con
  data esplicita, recuperata dalla cache; non sostituisce il valore principale
  e non avvia ricerche remote su giorni aggiuntivi.
- I grafici di intervallo mostrano un punto/barra per ciascun giorno incluso,
  con buchi nei giorni mancanti. Nessuna interpolazione o media usata come
  sostituto di un valore assente.
- Un numero di sintesi dell'intero periodo deve essere etichettato, per esempio
  «Media dei giorni disponibili, 10/14». Non introdurre una media generica in
  tutte le card: «ultimo valore», «media», «minimo» e «massimo» sono indicatori
  distinti. Nessun confronto percentuale implica il download occulto di un
  periodo precedente: l'eventuale confronto è una funzione esplicita.

Esempio: scegliendo 7–20 ottobre, tutti i trend e il sonno mostrano 7–20 ottobre,
le card indicano il dato del 20, e le attività sommano solo quelle del 7–20.
Un dato del 19 non viene presentato come dato del 20. Scegliendo il solo 20,
si entra nelle rappresentazioni giornaliere indicate sotto.

### Significato dei moduli nel giorno e nell'intervallo

| Modulo | Un giorno D | Più giorni | Fonti e attenzione |
| --- | --- | --- | --- |
| FC di riferimento | Valore giornaliero a riposo/minimo sostitutivo, con etichetta attuale | Un valore di riferimento al giorno | V2 `heartRate.restingValue`; non confonderlo con la serie cardiaca |
| Frequenza cardiaca | Curva delle letture del giorno e, se presenti, minimo/massimo | Trend giornaliero della FC di riferimento, chiarendo il cambio di indicatore; niente campioni intragiornalieri per ogni giorno | Dettaglio `/wellness-service/wellness/dailyHeartRate` per il giorno; V2 per intervalli. Il valore di riepilogo e il dettaglio hanno campi diversi e mantengono provenienze distinte |
| Body Battery | Riepilogo del giorno e andamento temporale/limiti min–max dei segmenti restituiti | Un `latestValue` per giorno, esplicitamente «ultimo valore giornaliero»; min/max solo se disponibili da fonte corretta | V2 per card e trend; `/wellness-service/wellness/bodyBattery/reports/daily` solo per dettaglio del giorno |
| HRV | Media della notte attribuita a D e, nel modulo esteso, letture di quella notte | Un `lastNightAvg` per giorno; eventuale `weeklyAvg` in serie distinta | `/hrv-service/hrv/{calendarDate}` per dettaglio; `/hrv-service/hrv/daily/{fromDate}/{toDate}` per intervallo |
| Sonno | Totale e composizione della notte attribuita a D | Barre e totale per ogni data nel medesimo intervallo globale | Riepiloghi sonno; niente limite visivo fisso a 7 giorni. Per il giorno non serve simulare una timeline delle fasi dai soli totali |
| Stress | Media giornaliera, indicata come parziale se oggi | Medie giornaliere sul periodo | V2; non inventare una curva oraria partendo dalla media. Un futuro dettaglio richiederà una fonte adatta |
| Attività Garmin | Elenco e totali delle attività iniziate a D | Heatmap e totali limitati al periodo globale | Ricerca attività paginata. Eventuali celle di calendario esterne al range sono solo contesto visivo e non entrano nelle richieste o nei totali |
| Planner locale | Giorno D evidenziato nella sua settimana | Settimana contenente D, dichiarata nel titolo | Fonte locale, può contenere futuro. Non genera richieste Garmin né entra nei totali delle attività importate |

Per HRV, «giornaliero» non significa monitoraggio continuo sulle 24 ore: Garmin
descrive la media dell'intero sonno e il massimo su cinque minuti della notte.
La curva usa le letture notturne effettivamente fornite, senza prolungarla nel
resto del giorno. Fonti: [HRV Status](https://www.garmin.com/en-GB/garmin-technology/health-science/hrv-status/)
e [approfondimento Garmin](https://www.garmin.com/en-US/blog/fitness/understanding-the-hrv-status-on-your-garmin-smartwatch/).

Il report Body Battery restituisce array con descrittori; `chunks` rappresenta
segmenti intragiornalieri con valori min/max. Non interpretare quei limiti come
campioni puntuali esatti e non scegliere una cadenza inventata. La prima lettura
usa il comportamento predefinito del provider; un valore `chunks` esplicito va
adottato solo dopo aver verificato il payload e la resa desiderata. Per FC usare
`heartRateValueDescriptors`, non indici di colonne fissati a mano.

Le rappresentazioni proposte dipendono dai campi realmente disponibili: un
riepilogo disponibile e una serie assente sono stati separati dello stesso
modulo. Il dettaglio non disponibile non deve far scomparire il riepilogo.

Il planner resta l'unica eccezione semantica dichiarata: pianificare il futuro
è diverso dall'esplorare misure acquisite. Segue inizialmente la settimana di D;
la sua navigazione locale può cambiare settimana e mostra sempre le date, senza
spostare silenziosamente il contesto Garmin. Un comando esplicito può riallinearlo.
Le attività perdono invece il vincolo fisso dei due mesi: seguono il filtro comune.

### Moduli dinamici e responsabilità del layout

Ogni card, grafico, pannello sonno, attività e planner diventa un'istanza con ID
stabile. La posizione non è l'identità del modulo. Più istanze dello stesso tipo
possono condividere dati, per esempio due grafici dello stesso periodo con metriche
diverse. Partirei da pochi componenti concreti e un catalogo di metadati, evitando
un motore di plugin o classi generiche per questo progetto personale.

Contratto di configurazione proposto, da validare anche sul backend:

```json
{
  "version": 1,
  "modules": [
    { "id": "battery-main", "type": "body-battery", "size": "wide", "options": { "view": "chart" } },
    { "id": "hrv-summary", "type": "hrv", "size": "compact", "options": { "view": "summary" } }
  ]
}
```

L'ordine nell'array determina l'ordine visivo. Nel primo rilascio userei taglie
predefinite `compact`/`wide` e griglia responsive, senza coordinate libere o layout
mobile duplicati. Ogni istanza rimane aggiungibile, eliminabile e riordinabile
anche tramite pulsanti accessibili. Le preferenze sono per profilo, versionate,
con validazione dei tipi/opzioni e un numero massimo di istanze (proposta: 12).
Salvare solo configurazione, mai copie dei dati Garmin dentro il layout.

Il catalogo dichiara: tipo, componente, modalità supportate, opzioni ammesse e
risorse necessarie per modalità/rappresentazione. Esempio: Body Battery compatto
richiede V2; Body Battery con grafico in modalità giorno aggiunge il report;
HRV compatta richiede il riepilogo, mentre quella estesa richiede il dettaglio
notturno. Il layout decide cosa mostrare; non conosce Axios, token o endpoint.

Tutti i moduli seguono il tempo globale nella prima versione. Un eventuale
«periodo proprio» futuro deve essere una scelta esplicita del modulo, con badge,
date locali e comando «Segui dashboard»; non lo introdurrei ora, perché
riprodurrebbe subito l'incoerenza da risolvere. La granularità interna giorno/notte
non costituisce un periodo indipendente nascosto.

### Richieste derivate dai moduli presenti

Flusso proposto: layout confermato + contesto temporale → elenco dei fabbisogni →
unione per risorsa e intervallo → lettura DB → acquisizioni necessarie → aggiornamento
dei moduli interessati. Nessuna richiesta Axios autonoma in ciascuna card: tre
card FC/Body Battery/stress condividono la stessa lettura V2. Il cambio di tab o
rappresentazione aggiunge una risorsa soltanto se cambia il fabbisogno effettivo.

- Primo accesso: caricare profilo, layout e contesto, poi solo le risorse richieste.
  Eliminare il recupero iniziale fisso di 30 giorni e i 12 giorni impliciti.
- Cambio periodo: leggere subito la cache della nuova finestra; acquisire buchi e
  porzioni scadute, raggruppati in intervalli contigui. Dividere secondo i limiti
  specifici dell'endpoint, senza una chiamata per giorno per i riepiloghi.
- «Aggiorna dashboard»: forzare tutte e sole le risorse necessarie ai moduli
  presenti nel layout confermato, nell'intervallo effettivo. La cache viene mostrata
  durante il refresh ma non lo soddisfa. «Aggiorna modulo» forza le sue dipendenze;
  se condivise, anche gli altri moduli ricevono il valore aggiornato.
- Aggiunta di un modulo: acquisire solo le dipendenze mancanti/scadute. Riordino,
  tema e ridimensionamento senza cambio di rappresentazione non chiamano Garmin.
  Durante la modifica del layout usare la configurazione provvisoria per la UI;
  pianificare import solo al salvataggio, evitando richieste a ogni trascinamento.
- Rimozione: elimina il fabbisogno del modulo, non i dati già cifrati nel DB.
  «Presente» significa nel layout confermato, anche sotto la piega della pagina;
  non basta `display:none`. Nessun fetch legato allo scroll nella prima versione.
- Duplicati condividono richieste e risultati. Una richiesta si annulla quando
  nessun modulo la richiede più; non quando viene smontata una sola delle istanze.

Il server deve validare tipi, modalità e finestre e risolvere le dipendenze da
una whitelist condivisa: non fidarsi di URL o nomi di campi arbitrari dal browser.
Si possono evolvere i controller dashboard/sync esistenti per ricevere contesto
e moduli, mantenendo gli attuali controller Garmin. Non serve un endpoint HTTP
duplicato per ogni istanza e non serve WebSocket/polling continuo.

«Dinamico» significa reagire a selezione temporale, layout confermato e refresh,
non aggiornarsi in continuazione con un timer. Il refresh rilegge ciò che Garmin
ha già ricevuto: non forza la sincronizzazione dell'orologio. Per un valore
intragiornaliero mostrare l'ora dell'ultima lettura quando disponibile, distinta
dall'ora in cui il server ha effettuato la chiamata; mai chiamarlo «live» soltanto
perché il refresh è appena terminato.

Esempi indicativi di budget, esclusi token/impostazioni, pagine attività e retry:

- FC di riferimento + Body Battery + stress su 14 giorni: **1 GET V2**, non tre.
- Aggiungendo HRV e sonno: **3 GET complessivi**, se non soddisfatti da cache valida.
- Solo i tre grafici estesi giornalieri FC, Body Battery e HRV: **3 GET dettaglio**;
  eventuali altri moduli possono richiedere ulteriori riepiloghi. Non scaricare
  questi dettagli per tutti i 14/30 giorni quando si seleziona un intervallo.
- Solo planner: **0 richieste Garmin**. Rimuovere HRV dal layout deve eliminare
  il suo import, anche se il tipo resta disponibile nel catalogo.

Mantenere concorrenza 2, timeout, deduplicazione e cooldown 429 già introdotti.
Navigazioni rapide richiedono identità delle richieste per risorsa/range e un
controllo della selezione corrente: una risposta vecchia può popolare la cache
corretta, ma non sostituire i valori del periodo appena selezionato.

### Cache cifrata, metadati e aggiornamento indipendente

Riepiloghi e dettagli sono risorse diverse: aggiungere per esempio `heart-rate-day`,
`body-battery-day`, `hrv-night`. Ogni payload giornaliero resta cifrato con lo stesso
isolamento profilo/collegamento, AAD e indici HMAC. `resource VARCHAR(16)` richiede
nomi brevi oppure una migrazione esplicita; non introdurre valori più lunghi
silenziosamente. Il layout non modifica le chiavi crittografiche dei dati.

Un solo cache record per risorsa/giorno, riusato da tutti i moduli. Conservare gli
istanti reali e i descrittori normalizzati necessari, senza loggare payload o
archiviare FIT/dettagli estranei. Limitare dimensione HTTP e numero di campioni;
non leggere tutte le serie storiche quando si richiede un solo giorno.

TTL iniziali proposti: riepiloghi e dettagli recenti 15 minuti; giorni più vecchi
24 ore; anche assenza verificata con TTL. Il refresh manuale ignora il TTL ma non
429. Orizzonte iniziale di navigazione comune: 90 giorni per i dati Garmin;
non estendere automaticamente il dettaglio allo storico annuale delle attività.
Si può conservare la cache attività precedente senza esporre finestre diverse.
Retenzione automatica/backup resta una decisione separata: nessuna cancellazione
del DB è implicata da questa analisi o dalla rimozione di un modulo.

Lo stato attuale `garmin_sync_state` per sola risorsa è troppo ampio per una
dashboard modulare: un errore su una data non deve invalidarne un'altra. Servono
copertura e freschezza per risorsa/giorno e stato della richiesta per finestra.
Gli eventuali estremi persistiti rimangono cifrati o indicizzati HMAC; `retryAt`
del provider resta un vincolo dell'account e vale anche per gli altri moduli.

Ogni modulo espone separatamente caricamento, aggiornamento, disponibilità,
errore, copertura, data del valore e ultima acquisizione. Distinguere «nessun dato»,
«dispositivo non supportato», «oggi parziale», «cache non aggiornata» e «errore»;
un 204 non dimostra da solo che il dispositivo non supporti la metrica.
Un errore HRV non blocca sonno/planner e non fa sparire la FC già disponibile.
La testata può sintetizzare «2 moduli aggiornati, 1 da verificare», senza un unico
timestamp che faccia sembrare tutti i dati contemporanei.

Per ottenere aggiornamenti effettivamente indipendenti, il coordinatore può
raggruppare richieste locali per risorsa e applicarne i risultati appena arrivano,
con sincronizzazione server sempre protetta dal lease del profilo. Se si mantiene
un solo POST aggregato, i moduli possono avere stati distinti ma ricevono i nuovi
valori solo al termine dell'intero batch: questo limite deve essere esplicito.
La scelta consigliata è mantenere un coordinatore e una coda semplice, senza
richieste concorrenti non coordinate da ogni componente e senza un nuovo worker
persistente. Il lock non deve trasformare una richiesta accodata in un errore UI.
Le risposte devono riportare risorsa, range risolto e identificatore della
selezione. Durante una navigazione, i valori del periodo precedente non possono
apparire sotto le nuove date: mostrare uno stato di attesa o conservarli con il
vecchio intervallo esplicitamente indicato, fino all'arrivo del nuovo snapshot.

### Date, notte e verifiche prima del rilascio

Usare il fuso Garmin validato, con i fallback già definiti; un solo «oggi» fornito
dal server. Estremi inclusivi per le date, non intervalli costruiti sommando
86.400.000 ms. Le serie intragiornaliere usano istanti UTC e rendering nel fuso
coerente del report. Nei passaggi d'ora un giorno può durare 23/25 ore: niente
griglia fissa di 24 campioni. Il giorno di sonno/HRV è `calendarDate` Garmin;
la notte può iniziare il giorno precedente e non va tagliata a mezzanotte.
Se un report di viaggio non permette un offset storico affidabile, mostrare i
timestamp locali del report senza inventare conversioni.

Ordine di implementazione consigliato:

1. Contesto temporale comune, eliminazione di `slice(-12)`/`slice(-7)` e finestre
   attività separate; card riferite a D, limiti e calendario coerenti.
2. Estrazione dei pannelli da `App.jsx`, catalogo moduli e layout versionato per
   profilo; fabbisogni derivati dal layout anche prima dell'editor completo.
3. Coordinatore richieste/cache/stati per risorsa e finestra; bootstrap e refresh
   basati sui moduli, preservando controller e helper già presenti.
4. Adapter e cache cifrata del dettaglio giorno FC/Body Battery/HRV, verificando
   timestamp, descrittori e sentinelle con fixture rappresentative.
5. Gestore di layout e controlli locali di refresh; verifica responsive/accessibile.

Verifiche di accettazione: stesso D/range in ogni pannello Garmin; notte a cavallo
di due date; cambi d'ora e fusi diversi; nessun dato a D ma dato a D−1; prima
importazione senza 30 giorni impliciti; 7/14/30 giorni esatti; nessun import per
modulo assente; una sola V2 per tre moduli; riordino senza rete; istanze duplicate;
aggiunta/rimozione durante un import; rapidi cambi di data; refresh di uno o tutti
i moduli; errore/429 parziale; cambio credenziale/utente; persistenza del layout e
serie cifrate nel DB. Questa revisione documenta il comportamento proposto per
la prossima implementazione; non modifica quello già operativo.

## Fonti e perimetro

Fonti primarie:

1. [Swagger Personal API](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/).
2. [Istruzioni Personal API e ottenimento token](https://developer.garmin.com/gc-developer-program/personal/personal-api/).
3. [FAQ Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-faq/).

La pagina carica uno schema OpenAPI **3.0.1**, titolo `Garmin Connect Personal API`,
versione dichiarata **1.0.0**, incorporato nel componente JavaScript pubblico.
Il catalogo seguente contiene **26 operazioni GET, 26 percorsi e 109 modelli**;
il dizionario elenca tutte le **1.587 proprietà dichiarate nei modelli**, con tipi,
riferimenti, campi obbligatori e vincoli tecnici. Le proprietà annidate sono
raggiungibili attraverso i collegamenti fra modelli o descritte nel tipo inline.
Gli esempi di contratto applicativo sono proposte, non risposte Garmin osservate.

Base URL ufficiale: `https://personal.connectapi.garmin.com`.

L'endpoint token è documentato nelle istruzioni e nella FAQ, ma **non compare fra
le 26 operazioni nello Swagger**:

```http
POST /personalapitoken-service/personal-api/personal-api-key/token
Authorization: ApiKey <chiave-personale>
```

Non inviare un body non documentato. Il client esistente riceve il token come
testo JWT; questo formato va confermato con una prova di integrazione, perché
la pagina introduttiva non ne definisce un modello di risposta OpenAPI.
Le richieste dati usano `Authorization: Bearer <access-token>`, solo dal backend.
La FAQ indica durata del token di 24 ore o fino alla scadenza della chiave,
se precedente, e assenza di refresh token: il rinnovo richiede nuovamente la
chiave personale. Il client attuale gestisce già rinnovo anticipato e un retry
su 401; manca l'importazione delle misure.

La chiave personale ha una scadenza scelta alla creazione (30, 90, 180 giorni
o un anno secondo la FAQ), è mostrata una sola volta e può essere revocata.
Un token valido non dimostra che la chiave continuerà a funzionare al prossimo
rinnovo: il profilo deve distinguere «chiave salvata», «accesso riuscito» e
«ultimo import riuscito».

## Conclusioni e criticità

**Soluzione adottata:** mantenere una cache cifrata per profilo, importare solo i riepiloghi
necessari ai grafici, leggere la cache all'apertura e avviare una sincronizzazione
automatica. Il pulsante Aggiorna forza una nuova lettura Garmin dell'intervallo
visualizzato. Nessun dato simulato deve essere usato nell'interfaccia finale.

| Punto | Soluzione scelta |
| --- | --- |
| Uso dell'app | Uso personale con account separati per i tester e chiavi proprie; nessuna migrazione al programma commerciale in questa fase. La precisazione descrive il progetto, non costituisce una conferma rilasciata da Garmin. |
| FC a riposo ambigua | Usare V2 con etichetta «FC di riferimento» e spiegazione del possibile minimo sostitutivo; nessuna richiesta legacy aggiuntiva e nessuna falsa certezza di FC a riposo. |
| Timestamp e unità incoerenti | Adapter specifici per endpoint, unità normalizzate e regole esplicite; una variante non verificata rende indisponibile la sola misura coinvolta. |
| ID int64 | Parsing JSON lossless e ID come stringhe decimali, dal primo parsing fino al DB/API interna. |
| Dispositivi con metriche differenti | Disponibilità per metrica e per giorno; assenza non convertita in zero né interpretata automaticamente come dispositivo incompatibile. |
| Cambio chiave/account e job obsoleti | Identità verificata, collegamento stabile e contatore di invalidazione; controllo dentro la transazione prima del commit. |
| Limiti e fallimenti di rete | Worker con concorrenza globale 2, un job per profilo, limiti di volume e backoff; 429 rinvia le richieste senza falsi successi. |
| Date diverse fra schede | Ultimo dato valido scelto separatamente per ogni metrica e data della misura sempre visibile. |
| Allenamenti duplicati | Heatmap alimentata solo da attività Garmin; piano locale separato, senza matching automatico. |
| Dati corretti successivamente | Upsert e merge per risorsa, ricontrollo dei tre giorni recenti e refresh forzato di tutta la finestra visibile. |
| Privacy nel DB | JSON cifrato AES-GCM, chiavi derivate per profilo/scopo e indici HMAC per giorni e identificativi Garmin. |
| Richieste lunghe | Sync asincrona con job persistente e polling breve; GET dashboard sempre locale e veloce. |

## Decisioni adottate

Le scelte hanno due livelli: **comportamento definito** e **verifica tecnica di
compatibilità**. Per esempio, l'interfaccia non chiamerà mai FC a riposo un
valore indistinguibile dal minimo; una prova su un device non elimina questa
ambiguità dello schema. Un dispositivo che non fornisce HRV non blocca le altre
metriche, e la sua assenza di dati non diventa un errore generale.

Il primo rilascio dell'import comprenderà i tre riepiloghi wellness, le attività
Garmin per la heatmap e il refresh dei range visibili. Nutrizione, ciclo, file
attività e serie intragiornaliere restano esclusi. La heatmap Garmin è un job
separato, così un lungo storico di allenamenti non rallenta le schede wellness.
Non si avviano sincronizzazioni periodiche in assenza di aperture/azioni utente.

### Compatibilità dei payload e tester

Ogni adapter verifica separatamente il proprio envelope (`data`, `hrvSummaries`
o array radice), i giorni e le misure necessarie. Campi nuovi non utilizzati
sono ignorati; tipi incompatibili o unità non verificabili non vengono convertiti
per tentativi. Un envelope errato invalida la risorsa; un campo singolo errato
lascia `null` quella misura e marca la risorsa `partial`, senza scartare quelle
valide dello stesso giorno. Il client JSON viene sostituito con parsing lossless:
nessuna conversione degli ID passa prima da un `Number` JavaScript impreciso.

Per il sonno si usano i campi esplicitamente in secondi, evitando di ricavare la
durata dalla differenza fra timestamp ambigui. Un timestamp GMT documentato come
stringa senza suffisso si interpreta in UTC; un timestamp locale senza offset
resta una data/ora locale associata al fuso e non viene forzato a un istante se
il cambio ora lo rende ambiguo. Stringhe con offset/Z si rispettano; eventuali
valori numerici in millisecondi si accettano solo per campi e varianti verificati,
mai con euristiche basate sulla grandezza del numero. I pattern contenenti una
data di esempio vengono sostituiti nell'adapter da una validazione di calendario
reale, lasciando intatta la trascrizione dello Swagger nel catalogo.

Per HRV si sceglie `lastNightAvg`, senza sostituirlo con `weeklyAvg`: l'adapter
pubblica l'unità ms soltanto dopo un riscontro del significato con Garmin Connect
nei test di integrazione. Fino a quel riscontro, conserva l'assenza con causa
`unit_unverified`; non espone valori numerici come ms per semplice plausibilità.
Il riscontro valida il mapping dell'endpoint/versione, non richiede una conferma
manuale per ogni nuovo tester. Una variante di payload differente viene isolata.

La matrice di test coprirà: dispositivo con tutti i dati, senza HRV, senza REM,
senza sonno, account senza storico, dati parziali e fusi diversi. Conserveremo
nei test solo fixture sintetiche. Le disponibilità saranno per funzione e data,
non una lista rigida di modelli di orologio: i payload non garantiscono sempre
un identificativo dispositivo utilizzabile. `deviceRemCapable=false` indica
esplicitamente REM non supportata; un semplice 204 indica solo assenza dati.

Non risultano documentati in questo Swagger endpoint di scrittura del piano,
webhook, cursori incrementali o un'API dedicata al Training Readiness. Non
dedurne l'esistenza da API non ufficiali o da altri programmi Garmin.

## Dashboard: fonti e significato delle misure

Stato storico del codice al momento dello studio, precedente all'implementazione
descritta all'inizio di questo documento:

- `routes/dashboard.js` restituisce `measurements.state = "not_imported"` e `daily = []`.
- `libs/garmin.js` gestisce token e GET JSON ma non ha adapter delle misure.
- `frontend/src/hooks/useDashboard.js` legge la dashboard e prepara il token;
  anche il refresh attuale ricarica questi dati senza importare wellness.
- `frontend/src/App.jsx` seleziona dati reali vuoti oppure dati demo, con
  sparkline sugli ultimi 12 elementi e trend selezionabile a 7/14/30 giorni.
- `frontend/src/components/Charts.jsx` mostra sonno sugli ultimi 7 elementi e
  riporta ancora etichette di esempio nei tooltip.
- `frontend/src/components/TrainingLoad.jsx` mostra due mesi di sessioni locali
  completate. Il nome «carico» indica attualmente ore svolte, non un indice
  fisiologico Garmin.

| Elemento | Endpoint consigliato | Campo di risposta | Conversione e significato |
| --- | --- | --- | --- |
| FC di riferimento e relativo trend | `/usersummary-service/v2/dailysummaries` | `data[].heartRate.restingValue` | bpm; etichetta «FC di riferimento», aiuto «FC a riposo fornita da Garmin; se assente, Garmin può usare il minimo rilevato». Provenienza `garmin_resting_or_minimum`; nessuna distinzione inventata. |
| Body Battery corrente e trend | stesso V2 | `data[].bodyBattery.latestValue` | Ultimo valore del giorno; non usare la media giornaliera o `endOfDayValue` al suo posto. Per una misura «al risveglio» serve un altro campo/fonte e una diversa etichetta. |
| Stress corrente e sparkline | stesso V2 | `data[].stress.avgLevel` | Media giornaliera sulla scala Garmin 0–100; il giorno corrente è parziale, non è uno stress istantaneo. |
| HRV nel trend | `/hrv-service/hrv/daily/{fromDate}/{toDate}` | `hrvSummaries[].lastNightAvg` | Media della notte; mapping in ms abilitato solo dopo verifica dell’adapter, come definito nella compatibilità payload. `weeklyAvg` è una misura diversa e non la sostituisce. |
| Totale sonno | `/sleep-service/sleep/dailySleepSummariesByDate` | `[].sleepTimeSeconds` | Secondi → minuti per la vista; esclude i sonnellini. Non calcolarlo sommando solo le tre fasi, perché esiste sonno non classificabile. |
| Barre sonno | stesso endpoint sonno | `[].deepSleepSeconds`, `lightSleepSeconds`, `remSleepSeconds` | Secondi → ore nel grafico o minuti nel modello UI; non confondere unità. Conservare anche `awakeSleepSeconds`, `unmeasurableSleepSeconds` e `deviceRemCapable` per interpretare i dati mancanti. |
| Piano settimanale | DB locale, `planned_sessions` | sessioni dell'utente | Rimane un piano creato dall'utente; non c'è scrittura piani Garmin nel catalogo. Rimuovere solo il piano dimostrativo. |
| Ore di attività realmente registrate | `/activitylist-service/activities/search/activities` | `[].activityId`, `startTimeLocal`, `duration`, `activityType` | Fonte separata e in sola lettura; `duration` è in secondi e può essere frazionaria. Il suo utilizzo nella heatmap richiede la regola anti-duplicazione descritta sotto. |

Per la FC si adotta V2 senza fallback di rete al legacy: nessuna ulteriore
chiamata giornaliera per ricostruire 30 giorni. Si rinomina anche il campo interno
in `heartRateReferenceBpm`, insieme a etichette, tooltip e testi accessibili nelle
cinque lingue, per non continuare a propagare la vecchia semantica implicita.
Il valore resta una misura reale Garmin; l'etichetta ne rappresenta il limite
informativo. Non usare `/dailyHeartRate` per lo storico di riepilogo.

### Normalizzazione, date e assenza di dati

Usare `calendarDate` fornita da Garmin per associare la misura al giorno. Unire
V2, HRV e sonno per data, non per posizione nell'array. Ordinare e costruire
un calendario completo con `null` nei giorni mancanti: `slice(-30)` di 30 righe
discontinue non equivale agli ultimi 30 giorni.

`today()` è oggi fissato a `Europe/Rome` in `frontend/src/lib/dates.js`; usare il
fuso del profilo Garmin (`UserSettingsDTO.timeZone`), validato come fuso IANA.
Fallback scelto: ultimo fuso valido dello stesso collegamento, poi fuso IANA del
browser acquisito all'accesso, infine UTC; la risposta indica `timeZoneSource`.
Non sovrascrivere il fuso dei dati storici quando l'utente viaggia. Il fuso serve
per richieste e «oggi»; le date storiche restano quelle attribuite da Garmin,
gestendo cambio ora e viaggi. Non interpretare un timestamp locale senza offset
nel fuso del server. I timestamp GMT senza `Z` richiedono interpretazione UTC
nel relativo adapter, mentre quelli locali non vanno convertiti alla cieca.

Separare:

- nessun dato per un giorno, risposta vuota o 204;
- metrica non supportata dal dispositivo;
- giorno corrente parziale o notte non ancora sincronizzata;
- errore di accesso, timeout o errore di validazione;
- dato reale salvato in precedenza ma non aggiornabile al momento.

L'assenza di REM non significa necessariamente zero REM. Non usare somme con
`null` che JavaScript converte in zero. Validare range e valori sentinella sui
payload reali; non assumere una codifica negativa universale. Distinguere le
scale Garmin: Stress 0–100; Body Battery V2 dichiara 5–100, mentre il report
dedicato descrive carica/scarica sulla scala 0–100.

V2 ammette anche `source = "fitbit"`: non presentare questi dati come misurazioni Garmin.
Si accetta `source` in modo case-insensitive e si importa solo `garmin`; non si
sommano sorgenti diverse. Duplicati identici per `(calendarDate, source)` vengono
collassati. Duplicati discordanti, senza una versione provider ordinabile
verificata, producono `ambiguous_response`: si mantiene il dato precedente e si
richiede una nuova lettura, senza scegliere arbitrariamente il primo o l'ultimo.

## Finestre temporali e budget delle chiamate

### Limiti documentati e politica scelta

| Risorsa | Limite dichiarato Garmin per richiesta | Politica scelta |
| --- | --- | --- |
| Riepiloghi V2 | 1 anno | 30 giorni iniziali, solo buchi o giorni recenti dopo; niente anno completo al login |
| Riepiloghi sonno | 31 giorni | 30 iniziali per totale e sparklines, 7 per le barre; spezzare eventuali recuperi lunghi in blocchi ≤31 |
| HRV giornaliero | Non dichiarato | Blocchi applicativi di 30 giorni, da verificare nella prova; nessuna assunzione di storico illimitato |
| Stress e passi dedicati | 28 giorni | Non necessari al primo rilascio: V2 copre i riepiloghi. Per nuove viste, blocchi ≤28 |
| Idratazione e report Body Battery | 31 giorni | Fuori dal primo caricamento; V2 basta per le metriche aggregate |
| Attività | `start = 0`, `limit = 99` di default; massimo non dichiarato | Date esplicite, paginazione controllata; 99 è un default, non un limite garantito |
| Impostazioni utente | Nessun intervallo | Una chiamata iniziale e dopo scadenza della cache/cambio collegamento |

Calcolare estremi inclusivi senza sommare millisecondi fissi: per N giorni
`startDate = oggi - (N - 1 giorni di calendario)` e `endDate = oggi`.
Verificare l'inclusività dove la descrizione dell'endpoint non la esplicita.

### Primo caricamento

Con intervalli da 30 giorni accettati e dati disponibili:

1. Un GET delle impostazioni per il fuso e le unità.
2. Un GET V2 per FC/Body Battery/stress e ulteriori aggregati.
3. Un GET HRV per 30 giorni.
4. Un GET sonno per 30 giorni.

Totale previsto: **4 richieste dati**, più **1 POST token** solo se necessario.
Le tre richieste wellness usano il limite globale di concorrenza 2, condiviso
fra tester con scheduling equo; non avviare una richiesta per giorno.
Nessun download ZIP/FIT, dettagli attività o campione HR/SpO2 è necessario per questi grafici.

### Refresh e cambio periodo

L'intervallo da aggiornare è l'unione di trend selezionato, sparkline e sonno:
`max(periodoTrend, 12, 7)` giorni, quindi 14 di default, 12 se il trend è a 7,
30 se è a 30. Non ridurre il DB o lo storico già caricato quando cambia il filtro.
Il refresh forza **3 GET** delle risorse wellness in quella finestra, oltre al
token se scaduto; non deve essere soddisfatto dalla sola cache locale. Passare
gli estremi effettivi dal client, validandoli sul server.

Il cambio a 30 giorni può usare i riepiloghi iniziali già salvati se copertura e
freschezza sono sufficienti; se mancano, scaricare solo la finestra richiesta.
TTL iniziali scelti: 15 minuti per oggi e i due giorni precedenti, 24 ore per i
giorni più vecchi della finestra richiesta e per le impostazioni. All'apertura
si ricontrollano i tre giorni recenti se scaduti e gli altri buchi/dati scaduti
solo entro la finestra visibile. Il primo caricamento scarica 30 giorni; quelli
successivi non aggiornano automaticamente tutti i 30 giorni se non sono visibili.
Anche una risposta di assenza verificata ha TTL: non si interroga continuamente
un dispositivo senza HRV, ma si potranno acquisire dati disponibili in seguito.
Questi valori sono configurabili e sono limiti applicativi, non quote Garmin.
Evitare un secondo import automatico per ogni semplice modifica di sessione locale o preferenze.

### Heatmap e attività reali

Il componente mostra mese precedente e corrente (59–62 giorni complessivi),
ma si scaricano attività solo fino a oggi. Sull'esempio del 22 ottobre 2026:
visualizzazione settembre–ottobre, import dal 1 settembre al 22 ottobre.
I mesi più vecchi si importano solo quando l'utente vi naviga; i mesi futuri
non producono chiamate Garmin. Spostare il range fuori dallo stato privato di
`TrainingLoad` per comunicarlo al backend.

Scaricare liste paginate con `startDate`, `endDate`, `start`, `limit`, ordine
stabile e deduplicazione per `activityId`. Con pagine da 99 e arresto sulla
prima pagina corta, servono `floor(A / 99) + 1` GET per A attività, inclusa la
pagina vuota finale quando A è multiplo di 99. Imporre un tetto applicativo
di 10 pagine per job (990 attività con pagine da 99) e segnalare copertura
incompleta se raggiunto; nessun conteggio definitivo su intervalli incompleti.
Ordinare per `startLocal` discendente e deduplicare per ID; se il contratto reale
non supporta l'ordinamento richiesto, non fingere una paginazione stabile.
La paginazione a offset può cambiare mentre vengono aggiunte attività: sovrapporre le finestre
recenti, deduplicare e prevedere una riconciliazione, senza promettere snapshot.

`excludeChildren = true` evita il conteggio contemporaneo di genitore e figli
multisport. **La heatmap userà solo attività Garmin**, con titolo «Attività
registrate» e sottotitolo «Ore di attività in Garmin Connect». Il planner conserva
le sessioni locali e i loro completamenti senza contribuire a questo totale:
nessun matching automatico e nessuna nuova funzione di riconciliazione nel primo
rilascio. Le attività importate sono in sola lettura e non creano sessioni locali.

Si somma `duration` in secondi prima di arrotondare per la vista, senza sostituirlo
con `elapsedDuration` o `movingDuration`. L'attività conta nel giorno di inizio
locale Garmin, senza dividerla artificialmente a mezzanotte. Le attività manuali
presenti in Garmin Connect restano incluse, con provenienza manuale conservata:
«registrate» non significa esclusivamente misurate da un sensore. Il valore zero
è mostrato solo per giorni già coperti da una risposta completa; quelli non
importati/incompleti restano distinti e i giorni futuri sono esclusi dai totali.
`activityTrainingLoad` resta un indicatore Garmin diverso, fuori da questa heatmap.

### Volume e conservazione

Per i grafici si trasferiscono al frontend al massimo 30 righe normalizzate
giornaliere, non i payload completi. Primo obiettivo: 30 giorni wellness e il
solo intervallo attività richiesto. Retention scelta: **90 giorni wellness** e
**12 mesi di attività**, scaricati progressivamente solo quando visualizzati;
nessun import preventivo dell'intero anno. La navigazione iniziale si limita a
questi orizzonti e lo comunica. La pulizia aggiorna anche copertura e job, così
non rimangono intervalli indicati come disponibili dopo la cancellazione.
Le copie diagnostiche raw non vengono conservate. La politica da adottare per
i backup privati è una retention di 30 giorni: una cancellazione dal DB non è una cancellazione immediata da backup
già creati, che devono scadere o essere eliminati separatamente.

Stima di progetto, non misurazione Garmin: con 0,5–2 KiB per record normalizzato
cifrato, 90 record occupano circa 45–180 KiB per profilo, prima di indici e backup.
Il JSON sanitario selezionato va conservato una sola volta, non duplicato in
tre tabelle più un payload raw perpetuo. Misurare bytes delle risposte e dei
record, memoria e latenza p50/p95 nella prova prima di fissare limiti reali.

## Caricamento e refresh

Separare lettura locale e sincronizzazione con scritture: si mantiene
`GET /api/dashboard` come lettura autenticata e aggiungere
`POST /api/garmin/sync` protetto dal CSRF esistente. Non sincronizzare soltanto
quando si preme Aggiorna: la stessa operazione parte automaticamente all'apertura.

Flusso scelto:

1. Rendere immediatamente disponibili i dati reali cifrati già presenti nel DB,
   insieme a data di acquisizione, copertura e stato di ciascuna risorsa.
2. Senza chiave, mostrare l'invito nel profilo, dati pregressi eventualmente
   marcati come non aggiornabili e nessun tentativo Garmin.
3. Con chiave, avviare la sincronizzazione degli intervalli mancanti/scaduti;
   al primo accesso, dei 30 giorni. Un caricamento a cache valida può evitare
   chiamate; il refresh manuale usa sempre `force = true`.
4. Riutilizzare il client e il rinnovo token esistenti. Raccogliere risposte
   per risorsa, validare/normalizzare e cifrare prima di ogni scrittura.
5. Aggiornare con upsert; lo stato del job segnala le risorse completate e il
   frontend rilegge la dashboard dopo ogni avanzamento utile, senza svuotare le
   schede mentre si sincronizza.
6. Mostrare successo solo per ciò che è stato realmente aggiornato. Se fallisce
   il sonno e riesce V2, mantenere il sonno precedente con stato `stale` e
   aggiornare le altre schede. Non avanzare indiscriminatamente `lastSyncAt`.

### Job, concorrenza e budget scelti

La sync sarà **asincrona fin dall'inizio**: `POST /api/garmin/sync` restituisce
202 con un `jobId` opaco; `GET /api/garmin/sync/:jobId` restituisce solo job del
profilo autenticato. Il frontend esegue polling ogni 2 secondi mentre il job è
attivo, interrompendolo su chiusura/logout, stato terminale o dopo 120 secondi.
Riprendendo la pagina si può rileggere lo stato senza creare un secondo import.
Al cambio utente il frontend svuota lo stato precedente e applica risultati solo
alla sessione/profilo che ha avviato il caricamento. Il job eventualmente già
partito resta associato al suo profilo originario, mai al nuovo utente.
Il refresh riguarda sia il range wellness sia quello della heatmap attualmente
visibile, con due job/stati separati; il budget delle 3 GET si riferisce solo
alle misure wellness, cui si aggiungono le pagine attività effettivamente necessarie.

Job e avanzamento vengono salvati in MariaDB (`garmin_sync_jobs`). Un worker nel
backend li acquisisce atomicamente e usa un lease di 45 secondi con heartbeat
ogni 10; i job orfani possono essere ripresi con checkpoint idempotenti. Ogni
acquisizione incrementa un fencing token: heartbeat e commit devono presentare
il token del tentativo corrente, così un worker rallentato non scrive dopo che
un altro ha riacquisito il job.
Limiti iniziali: 2 richieste Garmin contemporanee globalmente, 1 job attivo per
profilo, 90 secondi di esecuzione per job e 15 secondi per singola richiesta,
sempre entro il tempo residuo. Il tempo in coda non consuma il budget di esecuzione.
Se ci sono più processi, slot e lease sono coordinati nel DB, non in sole mappe
RAM. La coda limita a 2 job pendenti per profilo oltre a quello attivo; richieste
identiche si accorpano e le altre vengono rifiutate esplicitamente quando piena.

Una richiesta manuale con `force=true` supera il TTL, non i limiti di concorrenza
o i tempi di attesa imposti dal provider. Si può unire a un job già attivo se
questo sta davvero scaricando la stessa risorsa/intervallo; il completamento di
un vecchio job o una cache calda non vengono spacciati per una nuova lettura.
Le risorse aggiuntive vengono accodate. Non tenere transazioni DB aperte durante
la rete. All'interno del commit acquisire la riga collegamento e verificare
identità ed epoch, poi fare merge sotto lock della riga giornaliera: due risorse
non devono sovrascriversi il JSON cifrato con una strategia «ultimo writer vince».

Limiti difensivi scelti: 8 MiB di risposta non compressa per GET, 100 righe per
risposta wellness di 30 giorni, 99 attività richieste per pagina. Un superamento
rende la risorsa incompleta senza troncare silenziosamente i dati; l'ultimo
snapshot valido resta disponibile. I limiti si misurano e si possono aumentare
esplicitamente, senza introdurre download illimitati.

401: un solo rinnovo token; se fallisce, stato di accesso da correggere nel
profilo. 403: nessun retry automatico e risorsa `forbidden`, senza dichiarare
che tutto l'account è privo di dati. 429: nessun retry immediato; rispettare
`Retry-After` numerico o HTTP-date, registrare `nextAllowedAt` e rinviare la
risorsa. Senza header valido, backoff esponenziale da 30 secondi fino a 15 minuti,
con jitter solo positivo. Il cooldown minimo del profilo coinvolge tutte le
sue risorse; 429 su profili distinti attivano anche una pausa globale prudente.
Il refresh durante la pausa mostra il tempo di attesa e non un falso successo.
Timeout/5xx: massimo un retry GET con jitter positivo se resta budget; altrimenti
cache precedente e stato `stale`. Nessun retry automatico di payload invalidi.
Errori o payload invalidi non cancellano i dati buoni.
Il client corrente non distingue 429 e non espone `Retry-After`: va esteso.
Va esteso anche per propagare `AbortSignal` e imporre limiti ai bytes della
risposta e al numero di elementi prima della persistenza. Il limite JSON delle
richieste Express non limita automaticamente le risposte ricevute da Garmin.

## Persistenza e cifratura

**Valutazione: sì, conservare i dati normalizzati cifrati è utile** per tempi di
caricamento, disponibilità durante guasti Garmin, storico e limiti di chiamata.
Conservare solo in RAM costringerebbe a riscaricare dopo ogni riavvio.

Schema logico scelto (nuove tabelle, ancora da implementare):

| Tabella | Chiave / indice | Dati da conservare |
| --- | --- | --- |
| `garmin_connections` | `profile_id`, `connection_id` UUID opaco; `sync_epoch` per invalidazione | Identità Garmin cifrata + fingerprint keyed, fuso, stato e versione chiave; connection_id stabile finché l'identità verificata è la stessa |
| `garmin_daily_metrics` | UNIQUE `(profile_id, connection_id, source, calendar_day_lookup)` | Giorno e JSON normalizzato cifrati, provenienza per campo, versione modello e freschezza per risorsa; giorno indicizzato tramite HMAC |
| `garmin_sync_coverage` | profilo + collegamento + risorsa + HMAC giorno | Dati/assenza verificata, ultimo tentativo/successo, completezza e codice errore sanitizzato; gli estremi del range stanno in un payload cifrato |
| `garmin_activities` | UNIQUE `(profile_id, connection_id, garmin_activity_lookup)` | Riepilogo minimo cifrato, ID provider cifrato + HMAC lookup e giorno indicizzato via HMAC; nessun collegamento automatico al planner |
| `garmin_sync_jobs` | `job_id` UUID opaco, profilo, epoch, stato/lease | Richiesta e checkpoint sensibili cifrati, avanzamento, owner del lease, scadenza e codici di errore senza body provider |

Riutilizzare AES-256-GCM di `libs/credentials.js` estendendo il vault per dati
sanitari e versionamento. Ogni cifratura usa un nonce casuale nuovo; AAD include
profilo, collegamento stabile, risorsa, lookup della riga e versione, ad esempio
`garmin:v1:<profileId>:<connectionId>:daily:<dayLookup>:<source>`.
Non riciclare il solo identificatore del profilo come AAD di tutti i record.

Si sceglie **HKDF-SHA256** dal master esistente, con separazione per profilo e
scopo: cifratura, HMAC identità/attività e HMAC giorni. Contesto e key ID sono
versionati; la derivazione resta stabile dopo riavvio e non usa password utente.
Nonce casuale 96 bit per ogni cifratura, tag GCM 128 bit, chiave AES 256 bit.
Non si introduce in questa fase un servizio KMS o una chiave privata custodita
nel browser. Il backend può decifrare: non è cifratura end-to-end.

Il DB non conserva valori sanitari, date delle misure o ID Garmin in chiaro.
Per range brevi il backend calcola gli HMAC delle singole date richieste e legge
le righe corrispondenti, poi ordina i giorni dopo decifratura. Gli HMAC comprendono
profilo e collegamento, così lo stesso giorno/ID non produce un indice uguale fra
tester. I metadati tecnici in chiaro sono limitati a UUID locali, stati, lease,
versioni e tempi di acquisizione. Anche range/checkpoint dei job sono cifrati.

La chiave master resta fuori dal DB e i token di accesso restano in memoria.
Versionare formato cifrato e key ID per permettere rotazione e recupero;
DB e chiavi devono avere backup coordinati. Il vault attuale genera la chiave
se mancante in alcune condizioni: le nuove scritture su un archivio già cifrato
devono fallire se la chiave è persa, senza sostituirla con una chiave casuale.
Le query e le transazioni non devono registrare i payload in chiaro.
La rotazione usa key ID e keyring: nuove scritture sulla chiave attiva, lettura
delle vecchie versioni finché la ricifratura non è verificata. Non eliminare una
chiave necessaria a record o backup ancora conservati. Fallire la decifratura
isola la risorsa e segnala un errore di storage, senza rigenerare misure o chiavi.

**Limite della protezione:** chi legge solo SQL vede ciphertext delle metriche,
ma il backend autorizzato può decifrarle. Un compromesso del backend e del
master non è coperto dalla sola cifratura DB. Gli indici HMAC nascondono le date
e gli identificativi in un dump SQL senza chiavi, ma restano osservabili associazione
al profilo locale, uguaglianza degli indici nel medesimo collegamento, frequenza
degli aggiornamenti e quantità di record. Questo limite è documentato, senza
promettere occultamento del traffico o dei volumi.

Limitare il JSON persistito alle misure usate: le risposte V2 possono contenere
nomi di attività, viaggi e altri dati non necessari. Non conservare raw sanitari
per default. Eventuali fixture diagnostiche devono essere sintetiche o
minimizzate/cifrate, mai committate con dati identificativi reali. Loggare solo
endpoint, durata, numero record, bytes e codici sanitizzati; niente chiavi,
Bearer token, coordinate o body provider.

### Identità, isolamento e cancellazione

Il middleware deriva già il profilo dalla sessione: mantenerlo come unica
autorità per le query, ignorando profili arbitrari inviati dal client. La chiave
Garmin può però appartenere a una persona diversa dal precedente collegamento:
non unire storici solo perché il profilo locale è lo stesso.

Alla sostituzione chiave si incrementano `credential_revision` e `sync_epoch`
e si sospendono i job vecchi. Si verifica l'identificatore Garmin presente nelle
risposte (`userProfilePk` o equivalente), normalizzato come stringa lossless:
V2, HRV e sonno devono essere coerenti quando lo forniscono. Un ID incoerente
blocca la nuova acquisizione, senza modificare lo storico valido. Il controllo
di epoch avviene anche dentro la transazione di scrittura.

Se l'identità coincide, si riutilizza `connection_id`: ruotare una chiave non
azzera lo storico e non richiede ricifrarlo con una generazione diversa. Se
cambia l'identità, si crea un nuovo collegamento e il precedente viene archiviato,
escluso dalla dashboard e mantenuto soltanto fino alla sua scadenza di retention.
Durante la verifica la cache precedente resta sospesa dalla vista per non
mescolare persone. In caso di rimozione chiave si interrompono i job, ma la
cache dello stesso collegamento resta leggibile come non aggiornabile: nessuna
cancellazione dello storico implicita nel semplice scollegamento.
Le impostazioni non garantiscono un ID numerico e lo Swagger non offre un
endpoint autonomo di identità: non trattare `displayName` come identificatore
immutabile. Finché l'identità non è verificabile non si persistono nuove misure
nel collegamento precedente: stato `identity_pending`. Se tutte le risorse sono
vuote, mostrare «Nessun dato disponibile per verificare il collegamento» e
permettere un successivo tentativo; non inferire l'identità dal dispositivo,
dal nome o da un JWT decodificato senza una verifica applicabile al suo contratto.

Per 204/array vuoti non presumere un account diverso né cancellare
indiscriminatamente il range precedente. Un intervallo incompleto o fallito non
è autorevole per dedurre cancellazioni. Un dato precedentemente presente ma
assente dopo una lettura completa riuscita viene marcato `not_in_latest_response`,
non contato come aggiornato e conservato come precedente dato reale segnalato.
Per le attività non concorre ai totali correnti finché non ricompare. Nessuna
purga irreversibile viene dedotta da una sola risposta vuota.

L'azione esplicita «rimuovi dati importati» incrementa prima `sync_epoch`, cancella
misure/attività/copertura/job del profilo e non cancella il planner. La rimozione
del profilo cancella a cascata anche questi dati. I job in corso vengono cancellati
e qualsiasi loro scrittura tardiva è respinta; i backup seguono i 30 giorni di
retention dichiarati. Importazioni e cancellazioni hanno test di concorrenza.

La migrazione attuale in `libs/mariadb.js` supporta solo versione 1 e rifiuta
versioni maggiori: occorre un runner sequenziale per le nuove migrazioni.
Non basta aggiungere un file SQL alla cartella. Le sessioni di allenamento già
presenti sono in chiaro: cifrare i nuovi import non rende retroattivamente
privati titolo e note di `planned_sessions`.

## Contratto interno proposto

Il frontend non deve dipendere direttamente dai 109 DTO Garmin. Esempio puramente
strutturale della futura porzione `measurements` della dashboard:

```json
{
  "state": "partial",
  "range": { "from": "2026-09-23", "to": "2026-10-22" },
  "timeZone": "Europe/Rome",
  "timeZoneSource": "garmin",
  "sync": {
    "wellness": { "state": "fresh", "lastSuccessAt": "2026-10-22T10:00:00Z" },
    "hrv": { "state": "fresh", "lastSuccessAt": "2026-10-22T10:00:00Z" },
    "sleep": { "state": "stale", "lastSuccessAt": "2026-10-21T10:00:00Z", "errorCode": "GARMIN_TIMEOUT" }
  },
  "daily": [
    {
      "date": "2026-10-22",
      "source": "garmin",
      "heartRateReferenceBpm": null,
      "heartRateBasis": "unavailable",
      "hrv": null,
      "bodyBattery": null,
      "stress": null,
      "sleepMinutes": null,
      "deep": null,
      "light": null,
      "rem": null,
      "awakeMinutes": null,
      "unclassifiedSleepMinutes": null,
      "availability": {
        "heartRateReferenceBpm": "no_data",
        "hrv": "no_data",
        "bodyBattery": "no_data",
        "stress": "no_data",
        "sleepMinutes": "unknown",
        "deep": "unknown",
        "light": "unknown",
        "rem": "unknown"
      }
    }
  ]
}
```

Contratto: FC in bpm, HRV in ms solo dopo verifica dell'unità, stress e Body Battery
nelle scale dichiarate, tutte le durate UI in minuti (anche frazionari), date
locali `YYYY-MM-DD`, timestamp di sincronizzazione UTC. Il totale sonno è un
campo distinto dalle fasi. Lo stato `fresh` descrive una richiesta completa riuscita;
`partial` indica una risposta utile ma incompleta e `availability` descrive
anche la singola misura, non solo l'intera famiglia. I valori sono `available`,
`no_data`, `not_supported`, `unit_unverified`, `invalid`, `not_in_latest_response`
o `unknown`; `not_supported` richiede un segnale esplicito del provider.
Una richiesta riuscita può non aver trovato dati. Dati salvati non aggiornati restano dati reali.

## Rimozione dell'anteprima

Da fare solo nella successiva implementazione, insieme all'import reale:

- Rimuovere toggle, banner, stato `demo`, generatori e reducer demo da `App.jsx`;
  le azioni del planner lavorano sempre sulle sessioni effettive dell'utente.
- Spostare `METRICS` fuori da `demo.js` prima di eliminare il modulo: anche
  `Charts.jsx` lo importa. Aggiornare `demo-plan` e i relativi test senza perdere
  i test del planner reale.
- Eliminare «esempio/anteprima» da tooltip, badge, didascalie, aria-label e
  dalle cinque traduzioni dove usati per i dati dimostrativi. Non eliminare
  l'anteprima delle preferenze lingua/tema, che è una funzione diversa.
- Rendere espliciti caricamento, prima sincronizzazione, ultima acquisizione,
  collegamento assente, nessun dato e dati non aggiornati. Niente fallback demo.
- Correggere schede: scegliere l'ultima misura disponibile **per metrica**, con
  data visibile; usare la data per il filtro, senza comprimere i giorni assenti.
- Correggere `SleepChart`: il limite fisso `maxValue = 10` può troncare notti
  reali più lunghe. Asse dinamico, fasi incomplete gestite e totale sonno ufficiale.
- Sostituire la fonte della heatmap con le attività Garmin, aggiornare titolo,
  didascalie, totali e accessibilità; il planner mantiene le sue sessioni locali.
- Mostrare l'ultimo dato valido per metrica solo entro l'orizzonte richiesto,
  con giorno e stato; nessun salto silenzioso a un valore molto vecchio fuori range.
- Adeguare i grafici perché i giorni mancanti interrompano le linee e perché
  selezionare un periodo filtri date di calendario, non il numero di record.
  REM non supportata resta assente, non una barra a zero.

## Altri indicatori possibili

| Famiglia | Campi / modelli disponibili | Possibile estensione, fuori dal primo caricamento |
| --- | --- | --- |
| Movimento | `movement.steps`, `pushes`, `floorsAscended`, `floorsDescended` | Passi, distanza, piani e obiettivi; V2 già scaricato |
| Energia | `calories.burnedResting`, `burnedActive`, `burnedTotal`, `consumedValue` | Bilancio calorico, distinguendo valori mancanti e obiettivi |
| Intensità | `intensityMinutes.goal`, `moderate`, `vigorous` | Minuti di intensità; non sommarli alla durata sport senza spiegare la definizione |
| HRV | `weeklyAvg`, `lastNight5MinHigh`, `baseline`, `status` | Andamento rispetto alla baseline, senza diagnosi |
| Recupero Body Battery | `minValue`, `maxValue`, `chargedValue`, `drainedValue`, `endOfDayValue` | Escursione/recupero giornaliero; serie intragiornaliera solo su richiesta |
| Sonno | `sleepScores`, `awakeCount`, `napTimeSeconds`, `sleepNeed`, `breathingDisruptionSeverity` | Punteggi, risvegli, sonnellini, necessità di sonno; verificare unità e device |
| Respirazione e SpO2 | `respiration`, `pulseOx`, `DailySpO2AndAcclimationDTO` | Aggregati da V2; dettaglio solo per una vista dedicata |
| Idratazione | `hydration`, `UserDailyHydrationDTO` | Quantità/obiettivo in ml; endpoint dedicato se servono ulteriori dettagli |
| Attività | `SummarizedActivityDTO`, `SummaryDTO` | Distanza m, durata s, passo da velocità m/s, FC bpm, potenza W, cadenza, dislivello m, Training Effect, `activityTrainingLoad`, `vO2MaxValue` |
| Zone FC | `HeartRateZonesDTO` | Configurazione zone per sport; `generateDefaults` richiede una scelta esplicita per non generare default inutili |
| Fitness Age | `FitnessAgeDTO` | Età fitness, componenti, aggiornamento; `fullHistoryScan=false` limita la ricerca ai 28 giorni precedenti |
| Peso/composizione | `DateWeightDTO`, `WeightRangeDTO`, obiettivi peso | Peso (kg nello schema), BMI, grasso, acqua, muscolo e obiettivi; unità dei campi non espliciti da verificare |
| Nutrizione | `DailyNutritionSummaryDTO`, `NutritionContentDTO` | Macro/micronutrienti e pasti; disattivare media non usati, non importare ora |
| Ciclo e gravidanza | `MenstrualCycleSummaryDTO`, `DetailedMenstrualCycleDayDTO` | Dati particolarmente intimi, non necessari alla dashboard: esclusi dall'import automatico |
| Attività wellness | `WellnessActivitySummaryDTO` | Riepiloghi, zone e metadati del dispositivo; non sostituire la lista allenamenti sportivi senza verificare la semantica |

Non ogni campo è necessariamente popolato sul dispositivo dell'utente. I nomi
di punteggi o mappe non enumerati nello schema restano aperti: conservarli come
chiavi provider fino a una mappatura verificata. Non scaricare tutte le famiglie
solo perché il catalogo le rende disponibili.

## Piano di implementazione e verifica

1. **Prova tecnica autorizzata:** tre endpoint wellness su 1–3 giorni, poi 30;
   verificare payload, device, fuso, unità HRV, semantica FC e inclusività date.
   Eseguire chiamate reali solo nella fase di integrazione, mantenendo segreti
   e dati personali fuori dai file versionati.
2. **Backend e DB:** migrazioni sequenziali, adapter, cifratura/versionamento,
   copertura, lock condiviso, collegamenti/epoch, 429 e budget. Prima introdurre
   il contratto di lettura e sync, poi collegare il frontend.
3. **Dashboard reale:** sincronizzazione iniziale, refresh forzato, intervalli,
   stati parziali e rimozione completa dei soli dati demo.
4. **Attività e heatmap:** job paginato separato, solo fonte Garmin e nessuna
   fusione automatica con il planner; niente dettaglio scaricato per attività.
5. **Validazione:** fixture sintetiche di giorno vuoto, 204, dati parziali,
   sonno senza REM, notte >10 ore, ID >2^53−1, DST/viaggi, 401/403/429/timeout,
   cambio chiave/account durante import, più tab e riavvio durante il job.
6. **Privacy e integrità:** test di lettura fra account, ciphertext non leggibile
   in SQL, scambio ciphertext fra righe respinto da AAD, key loss, rotazione,
   migrazione da DB v1 e cancellazione con job in corso. Misurare anche che
   apertura/refresh non producano richieste duplicate o download annuali.

Le decisioni progettuali sono definite per il perimetro personale indicato.
Prima di abilitare ogni adapter sui dati reali si verifica la corrispondenza
con il contratto e la matrice di device; una funzionalità non verificabile resta
non disponibile senza bloccare quelle già validate. Non si richiedono ulteriori
scelte di prodotto per risolvere i punti sopra durante l'implementazione.
Il resto del documento conserva il catalogo pubblico, senza modificarne i DTO
per adattarli alle nostre decisioni interne.

## Catalogo completo degli endpoint

Tutte le operazioni sotto sono GET senza body documentato. Tutte richiedono
accesso autenticato; lo schema non dichiara `securitySchemes` né `security`:
il Bearer token è descritto nelle istruzioni ufficiali, non dedotto da quei campi.
Per i parametri query senza `required: true`, «No» riporta lo Swagger, non
garantisce che sia sicuro ometterli: gli adapter invieranno sempre le date.
Gli errori elencati sono solo i codici espressamente presenti nel contratto;
l’assenza di 401/429/5xx non implica che non possano verificarsi.

| # | Operazione | Risposta principale |
| --- | --- | --- |
| 01 | [Dettaglio attività](#api-01) | [ActivitySummaryDTO](#schema-activitysummarydto) |
| 02 | [Workout associati a una attività](#api-02) | array di [ActivityWorkoutDTO](#schema-activityworkoutdto) |
| 03 | [Ricerca attività](#api-03) | array di [SummarizedActivityDTO](#schema-summarizedactivitydto) |
| 04 | [Zone di frequenza cardiaca](#api-04) | array di [HeartRateZonesDTO](#schema-heartratezonesdto) |
| 05 | [File originale attività](#api-05) | non specificato |
| 06 | [Fitness Age](#api-06) | array di [FitnessAgeDTO](#schema-fitnessagedto) |
| 07 | [Obiettivi peso effettivi](#api-07) | [UserGoalsRangeDTO](#schema-usergoalsrangedto) |
| 08 | [HRV giornaliera dettagliata](#api-08) | [HrvChartDTO](#schema-hrvchartdto) |
| 09 | [Riepiloghi HRV per intervallo](#api-09) | [HrvDailySummaryDTO](#schema-hrvdailysummarydto) |
| 10 | [Diario nutrizione](#api-10) | [DailyNutritionSummaryDTO](#schema-dailynutritionsummarydto) |
| 11 | [Riepilogo ciclo](#api-11) | [MenstrualCycleSummaryDTO](#schema-menstrualcyclesummarydto) |
| 12 | [Dettaglio giornaliero ciclo](#api-12) | [DetailedMenstrualCycleDayDTO](#schema-detailedmenstrualcycledaydto) |
| 13 | [Sonno di una data](#api-13) | [DailySleepDTO](#schema-dailysleepdto) |
| 14 | [Sonno per intervallo](#api-14) | array di [DailySleepDTO](#schema-dailysleepdto) |
| 15 | [Impostazioni profilo Garmin](#api-15) | [UserSettingsDTO](#schema-usersettingsdto) |
| 16 | [Idratazione per intervallo](#api-16) | array di [UserDailyHydrationDTO](#schema-userdailyhydrationdto) |
| 17 | [Passi per intervallo](#api-17) | array di [StepsDailyStatDTO](#schema-stepsdailystatdto) |
| 18 | [Stress per intervallo](#api-18) | array di [MultiValueWellnessChartItemDTO](#schema-multivaluewellnesschartitemdto) |
| 19 | [Riepilogo giornaliero legacy](#api-19) | [UserDailySummaryDto](#schema-userdailysummarydto) |
| 20 | [Riepiloghi giornalieri V2](#api-20) | [ApiDocumentListUserDailySummaryV2DTO](#schema-apidocumentlistuserdailysummaryv2dto) |
| 21 | [Tutte le pesate](#api-21) | array di [DateWeightDTO](#schema-dateweightdto) |
| 22 | [Riepiloghi peso](#api-22) | [WeightRangeDTO](#schema-weightrangedto) |
| 23 | [Report Body Battery](#api-23) | array di [BodyBatteryDailyReportDTO](#schema-bodybatterydailyreportdto) |
| 24 | [SpO2 giornaliera dettagliata](#api-24) | [DailySpO2AndAcclimationDTO](#schema-dailyspo2andacclimationdto) |
| 25 | [Frequenza cardiaca giornaliera dettagliata](#api-25) | [DailyHeartRateDTO](#schema-dailyheartratedto) |
| 26 | [Attività wellness per intervallo](#api-26) | array di [WellnessActivitySummaryDTO](#schema-wellnessactivitysummarydto) |

<a id="api-01"></a>

### 01. Dettaglio attività

`GET /activity-service/activity/{activityId}`

Dettaglio di una attività già identificata.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `activityId` | path | Sì | `integer/int64` | — | ID attività; conservarlo senza perdita di precisione. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [ActivitySummaryDTO](#schema-activitysummarydto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 404 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Su richiesta; non serve per costruire la lista o la heatmap.

<a id="api-02"></a>

### 02. Workout associati a una attività

`GET /activity-service/activity/{activityId}/workouts`

Sequenza dei workout eseguiti durante una attività.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `activityId` | path | Sì | `integer/int64` | — | ID attività; conservarlo senza perdita di precisione. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [ActivityWorkoutDTO](#schema-activityworkoutdto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 404 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Restituisce anche passi strutturati dei workout; non è un endpoint per inviarli a un dispositivo.

<a id="api-03"></a>

### 03. Ricerca attività

`GET /activitylist-service/activities/search/activities`

Elenco filtrato e paginato dei riepiloghi sportivi.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `start` | query | No | `integer/int32` | default=`0` | Offset a base zero, non numero di pagina. |
| `limit` | query | No | `integer/int32` | default=`99` | Numero massimo richiesto di attività per pagina; massimo accettato non specificato. |
| `favorite` | query | No | `integer/int32` | default=`-1` | 1 preferite, 0 non preferite, -1 nessun filtro. |
| `sortOrder` | query | No | `string` | default=`"desc"` | asc o desc, senza distinzione maiuscole/minuscole. |
| `excludeChildren` | query | No | `boolean` | default=`true` | Esclude le attività figlie dei multisport. |
| `sortBy` | query | No | `string` | — | Campo di ordinamento; la descrizione indica startLocal come default, non presente nel default dello schema. |
| `search` | query | No | `string` | — | Ricerca testuale su nome e descrizione attività. |
| `activityType` | query | No | `string` | — | Chiave tipo principale, per esempio running o cycling; non sottotipo. |
| `activitySubType` | query | No | `string` | — | Chiave sottotipo coerente con activityType, se presente. |
| `eventType` | query | No | `string` | — | Chiave categoria evento, per esempio race o training. |
| `minDistance` | query | No | `integer/int64` | — | Distanza minima inclusiva, metri. |
| `maxDistance` | query | No | `integer/int64` | — | Distanza massima inclusiva, metri. |
| `minDuration` | query | No | `integer/int64` | — | Durata timer minima inclusiva, secondi. |
| `maxDuration` | query | No | `integer/int64` | — | Durata timer massima inclusiva, secondi. |
| `minElevation` | query | No | `integer/int64` | — | Dislivello positivo minimo inclusivo, metri. |
| `maxElevation` | query | No | `integer/int64` | — | Dislivello positivo massimo inclusivo, metri. |
| `startDate` | query | No | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | query | No | `string/date` | — | Fine intervallo YYYY-MM-DD. |
| `upperLatitude` | query | No | `number/double` | — | Confine nord in gradi; filtro applicato con tutte e quattro le coordinate. |
| `rightLongitude` | query | No | `number/double` | — | Confine est in gradi; filtro applicato con tutte e quattro le coordinate. |
| `lowerLatitude` | query | No | `number/double` | — | Confine sud in gradi; filtro applicato con tutte e quattro le coordinate. |
| `leftLongitude` | query | No | `number/double` | — | Confine ovest in gradi; filtro applicato con tutte e quattro le coordinate. |
| `lowerMaxDepth` | query | No | `integer/int64` | — | Limite inferiore inclusivo della profondità massima, centimetri. |
| `upperMaxDepth` | query | No | `integer/int64` | — | Limite superiore inclusivo della profondità massima, centimetri. |
| `decoDive` | query | No | `boolean` | — | Filtro attività con/senza decompressione; omesso non filtra. |
| `minElapsedDuration` | query | No | `integer/int64` | — | Tempo totale minimo inclusivo, pause comprese, secondi. |
| `maxElapsedDuration` | query | No | `integer/int64` | — | Tempo totale massimo inclusivo, pause comprese, secondi. |
| `minBottomTime` | query | No | `integer/int64` | — | Tempo di fondo minimo inclusivo, secondi. |
| `maxBottomTime` | query | No | `integer/int64` | — | Tempo di fondo massimo inclusivo, secondi. |
| `minAvgPower` | query | No | `integer/int64` | — | Potenza media minima inclusiva, watt. |
| `excludedActivitySubType` | query | No | array di `string` | — | Ripetere il parametro per più sottotipi da escludere. |
| `requiredField` | query | No | array di `string` | — | Ripetere il parametro per richiedere più campi non null; condizione AND. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [SummarizedActivityDTO](#schema-summarizedactivitydto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Usare date, paginazione e excludeChildren=true; array vuoto quando non ci sono risultati. Non è documentato un massimo per limit.

<a id="api-04"></a>

### 04. Zone di frequenza cardiaca

`GET /biometric-service/heartRateZones/v2`

Configurazione delle zone FC per sport.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `generateDefaults` | query | No | `boolean` | default=`true` | Generazione delle zone di default se non configurate. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [HeartRateZonesDTO](#schema-heartratezonesdto) |

**Uso e cautele:** generateDefaults=true può produrre zone predefinite se non configurate. Non necessario per i grafici attuali.

<a id="api-05"></a>

### 05. File originale attività

`GET /download-service/files/activity/{activityId}`

Download binario della attività.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `activityId` | path | Sì | `integer/int64` | — | ID attività; conservarlo senza perdita di precisione. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| default | `application/x-zip-compressed` | non specificato |

**Uso e cautele:** Content-Type dichiarato application/x-zip-compressed; lo Swagger non definisce uno schema binario né un codice successo specifico. Il client GET attuale, che forza JSON, non è adatto.

<a id="api-06"></a>

### 06. Fitness Age

`GET /fitnessage-service/fitnessage/v2/{calendarDate}`

Ultima età fitness disponibile alla data richiesta.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `calendarDate` | path | Sì | `string/date` | — | Giorno richiesto in YYYY-MM-DD. |
| `fullHistoryScan` | query | No | `boolean` | default=`true` | Ricerca in tutto lo storico; false limita ai 28 giorni precedenti. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [FitnessAgeDTO](#schema-fitnessagedto) |

**Uso e cautele:** Risposta array, non oggetto singolo. fullHistoryScan=false cerca nei 28 giorni precedenti; true è il default.

<a id="api-07"></a>

### 07. Obiettivi peso effettivi

`GET /goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}`

Obiettivi e intervalli obiettivo nel periodo richiesto.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [UserGoalsRangeDTO](#schema-usergoalsrangedto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Non serve al primo import wellness; distingue obiettivi puntuali e range.

<a id="api-08"></a>

### 08. HRV giornaliera dettagliata

`GET /hrv-service/hrv/{calendarDate}`

Riepilogo notturno e letture HRV della data.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `calendarDate` | path | Sì | `string/date` | — | Giorno richiesto in YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [HrvChartDTO](#schema-hrvchartdto) |
| 204 | non specificato | nessun dato (nessun body con 204) |

**Uso e cautele:** 204 = nessun dato. Per il grafico giornaliero preferire il riepilogo per intervallo.

<a id="api-09"></a>

### 09. Riepiloghi HRV per intervallo

`GET /hrv-service/hrv/daily/{fromDate}/{toDate}`

Riepiloghi HRV notturni di più giorni.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `fromDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `toDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [HrvDailySummaryDTO](#schema-hrvdailysummarydto) |
| 204 | non specificato | nessun dato (nessun body con 204) |

**Uso e cautele:** Risposta oggetto con hrvSummaries, non array alla radice. 204 = nessun dato; limite di intervallo non dichiarato.

<a id="api-10"></a>

### 10. Diario nutrizione

`GET /nutrition-service/food/logs/{date}`

Riepilogo giornaliero di alimenti, nutrienti, pasti e obiettivi.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `includeGoals` | query | No | `boolean` | default=`true` | Includere obiettivi nutrizionali. |
| `includeNutrition` | query | No | `boolean` | default=`true` | Includere informazioni nutrizionali. |
| `includeMedia` | query | No | `boolean` | default=`true` | Includere immagini/media. |
| `mealId` | query | No | `integer/int64` | — | ID del pasto richiesto. |
| `date` | path | Sì | `string/date` | — | Data richiesta YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [DailyNutritionSummaryDTO](#schema-dailynutritionsummarydto) |

**Uso e cautele:** Data interpretata nel fuso locale utente. includeMedia=false evita immagini non necessarie; fuori dalla prima integrazione.

<a id="api-11"></a>

### 11. Riepilogo ciclo

`GET /periodichealth-service/menstrualcycle/summary/{calendarDate}`

Stato e previsione del ciclo alla data richiesta.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `calendarDate` | path | Sì | `string/date` | — | Giorno richiesto in YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [MenstrualCycleSummaryDTO](#schema-menstrualcyclesummarydto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Escluso dall’import automatico della dashboard: nessuna metrica attuale lo richiede.

<a id="api-12"></a>

### 12. Dettaglio giornaliero ciclo

`GET /periodichealth-service/menstrualcycle/dayview/{calendarDate}`

Diario, riepilogo ciclo ed eventuali obiettivi della gravidanza.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `calendarDate` | path | Sì | `string/date` | — | Giorno richiesto in YYYY-MM-DD. |
| `todayDate` | query | No | `string/date` | — | Oggi dal punto di vista del chiamante; riferimento per previsioni. |
| `reducedResponse` | query | No | `boolean` | default=`false` | Richiedere un payload ridotto. |
| `skipbm` | query | No | `boolean` | default=`false` | Escludere movimenti del bambino. |
| `includeAnalysis` | query | No | `boolean` | default=`false` | Includere analisi del ciclo. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [DetailedMenstrualCycleDayDTO](#schema-detailedmenstrualcycledaydto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** reducedResponse, skipbm e includeAnalysis permettono di ridurre/selezionare il contenuto; non importare per default.

<a id="api-13"></a>

### 13. Sonno di una data

`GET /sleep-service/sleep/dailySleep`

Riepilogo sonno di un giorno.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `date` | query | No | `string/date` | — | Data richiesta YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [DailySleepDTO](#schema-dailysleepdto) |

**Uso e cautele:** Risposta DailySleepDTO direttamente alla radice, senza un wrapper dailySleepDTO documentato. Passare sempre la data anche se non marcata required.

<a id="api-14"></a>

### 14. Sonno per intervallo

`GET /sleep-service/sleep/dailySleepSummariesByDate`

Riepiloghi del sonno di più giorni.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | query | No | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | query | No | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [DailySleepDTO](#schema-dailysleepdto) |

**Uso e cautele:** Massimo documentato 31 giorni. Totale sonno esclude naps; usare questo endpoint per le barre e lo storico, non N chiamate giornaliere.

<a id="api-15"></a>

### 15. Impostazioni profilo Garmin

`GET /userprofile-service/userprofile/settings`

Preferenze di fuso, unità e calendario.

**Ingresso**

Nessun parametro dichiarato.

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [UserSettingsDTO](#schema-usersettingsdto) |

**Uso e cautele:** Nessun parametro; non garantisce un ID numerico del titolare. Non sovrascrivere automaticamente lingua/tema locali.

<a id="api-16"></a>

### 16. Idratazione per intervallo

`GET /usersummary-service/stats/hydration/daily/{startDate}/{endDate}`

Quantità, obiettivo e campi idratazione giornaliera.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [UserDailyHydrationDTO](#schema-userdailyhydrationdto) |

**Uso e cautele:** Massimo documentato 31 giorni; V2 basta per i soli aggregati già utilizzabili.

<a id="api-17"></a>

### 17. Passi per intervallo

`GET /usersummary-service/stats/steps/daily/{startDate}/{endDate}`

Passi, distanza e obiettivo per giorno.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [StepsDailyStatDTO](#schema-stepsdailystatdto) |

**Uso e cautele:** Massimo documentato 28 giorni; usare due richieste per 30 giorni solo se serve davvero questo endpoint.

<a id="api-18"></a>

### 18. Stress per intervallo

`GET /usersummary-service/stats/stress/daily/{startDate}/{endDate}`

Mappa di aggregati stress per giorno.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [MultiValueWellnessChartItemDTO](#schema-multivaluewellnesschartitemdto) |

**Uso e cautele:** Massimo documentato 28 giorni. values è una mappa: overallStressLevel, highStressDuration, mediumStressDuration, lowStressDuration, restStressDuration; durate in secondi. Non è la struttura V2.

<a id="api-19"></a>

### 19. Riepilogo giornaliero legacy

`GET /usersummary-service/usersummary/daily`

Riepilogo piatto di movimento, wellness e altre misure.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `calendarDate` | query | No | `string/date` | — | Giorno richiesto in YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [UserDailySummaryDto](#schema-userdailysummarydto) |

**Uso e cautele:** Risposta senza wrapper; utile per confrontare semantica FC o lastSyncTimestampGMT. Non scegliere questo endpoint per fare automaticamente 30 GET al posto di uno V2.

<a id="api-20"></a>

### 20. Riepiloghi giornalieri V2

`GET /usersummary-service/v2/dailysummaries`

Aggregati giornalieri raggruppati per famiglia di misura.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | query | No | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | query | No | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [ApiDocumentListUserDailySummaryV2DTO](#schema-apidocumentlistuserdailysummaryv2dto) |

**Uso e cautele:** Massimo documentato 1 anno. Risposta {data: [...]}; prima scelta per FC, stress e Body Battery. Le durate seguono la convenzione V2 in millisecondi salvo indicazioni diverse.

<a id="api-21"></a>

### 21. Tutte le pesate

`GET /weight-service/weight/all/{startDate}/{endDate}`

Misure di peso e composizione nel periodo.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [DateWeightDTO](#schema-dateweightdto) |

**Uso e cautele:** Estremi inclusivi nel calendario locale utente; peso in kg nello schema, non assumere grammi per analogia con altri servizi.

<a id="api-22"></a>

### 22. Riepiloghi peso

`GET /weight-service/weight/range/{startDate}/{endDate}`

Ultime pesate giornaliere, medie e misure adiacenti.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |
| `includeAll` | query | No | `boolean` | default=`false` | Includere tutte le pesate giornaliere. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [WeightRangeDTO](#schema-weightrangedto) |

**Uso e cautele:** Estremi inclusivi. includeAll=false restituisce l’ultima misura per giorno, true include tutte. Non confondere previousDateWeight e nextDateWeight con dati dentro il range.

<a id="api-23"></a>

### 23. Report Body Battery

`GET /wellness-service/wellness/bodyBattery/reports/daily`

Serie e report giornalieri Body Battery.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `startDate` | query | No | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `endDate` | query | No | `string/date` | — | Fine intervallo YYYY-MM-DD. |
| `chunks` | query | No | `integer/int32` | — | Numero di intervalli intragiornalieri; restituisce min/max per intervallo. Default/min/max non specificati. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [BodyBatteryDailyReportDTO](#schema-bodybatterydailyreportdto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Massimo documentato 31 giorni. chunks determina intervalli e valori minimo/massimo per intervallo; non è un numero di giorni o un indice di pagina. Usare i descrittori delle colonne.

<a id="api-24"></a>

### 24. SpO2 giornaliera dettagliata

`GET /wellness-service/wellness/daily/spo2acclimation/{calendarDate}`

Letture SpO2 e acclimatazione della data.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `calendarDate` | path | Sì | `string/date` | — | Giorno richiesto in YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [DailySpO2AndAcclimationDTO](#schema-dailyspo2andacclimationdto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Serie con descrittori di colonna: non fissare posizioni senza leggerli. V2 copre gli aggregati di base.

<a id="api-25"></a>

### 25. Frequenza cardiaca giornaliera dettagliata

`GET /wellness-service/wellness/dailyHeartRate`

Riepilogo FC e serie di campioni per un giorno.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `date` | query | No | `string/date` | — | Data richiesta YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | [DailyHeartRateDTO](#schema-dailyheartratedto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Usare heartRateValueDescriptors per decodificare heartRateValues; fuori dal caricamento dei grafici di riepilogo.

<a id="api-26"></a>

### 26. Attività wellness per intervallo

`GET /wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}`

Riepiloghi delle attività wellness nel periodo.

**Ingresso**

| Parametro | Posizione | Obbligatorio | Tipo | Default/vincoli | Significato |
| --- | --- | --- | --- | --- | --- |
| `fromDate` | path | Sì | `string/date` | — | Inizio intervallo YYYY-MM-DD. |
| `untilDate` | path | Sì | `string/date` | — | Fine intervallo YYYY-MM-DD. |

**Uscita**

| HTTP | Content-Type | Struttura del body |
| --- | --- | --- |
| 200 | `application/json` | array di [WellnessActivitySummaryDTO](#schema-wellnessactivitysummarydto) |
| 400 | non specificato | body di errore non modellato |
| 401 | non specificato | body di errore non modellato |
| 403 | non specificato | body di errore non modellato |
| 500 | non specificato | body di errore non modellato |

**Uso e cautele:** Estremi fromDate/untilDate inclusivi; limite massimo non dichiarato. Semantica da distinguere dalle attività sportive della search.

## Dizionario completo delle risposte

I seguenti 109 modelli riportano tutte le proprietà dichiarate nello Swagger.
«—» nella colonna obbligatorio significa non incluso in `required`.
Assenza di `nullable` non è una garanzia pratica di completezza dei dati:
la validazione dovrà distinguere errori di contratto, campi assenti e metriche
non disponibili. `object` senza proprietà non autorizza a inventarne il contenuto.
Le mappe `additionalProperties` e le composizioni sono descritte nel tipo.
I vincoli, anche quelli sospetti, sono trascritti dal contratto e non corretti
arbitrariamente. Nomi e tipi permettono la navigazione completa delle strutture;
le unità sono annotate solo dove esplicite nella descrizione del campo.

I grandi modelli sono richiudibili per rendere leggibile il documento su GitHub.

<a id="schema-activitysummarydto"></a>

<details>
<summary>ActivitySummaryDTO — 19 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `activityId` | `integer/int64` | — | — |
| `activityUUID` | allOf: [UUID](#schema-uuid) | — | — |
| `activityName` | `string` | — | — |
| `description` | `string` | — | — |
| `userProfileId` | `integer/int64` | — | — |
| `parentId` | `integer/int64` | — | — |
| `parentName` | `string` | — | — |
| `isMultiSportParent` | `boolean` | — | — |
| `activityTypeDTO` | allOf: [ActivityTypeDTO](#schema-activitytypedto) | — | — |
| `eventTypeDTO` | allOf: [EventTypeDTO](#schema-eventtypedto) | — | — |
| `accessControlRuleDTO` | allOf: [AccessControlRuleDTO](#schema-accesscontrolruledto) | — | — |
| `timeZoneUnitDTO` | allOf: [TimeZoneUnitDTO](#schema-timezoneunitdto) | — | — |
| `metadataDTO` | allOf: [MetadataDTO](#schema-metadatadto) | — | — |
| `summaryDTO` | allOf: [SummaryDTO](#schema-summarydto) | — | — |
| `locationName` | `string` | — | — |
| `diveInfo` | allOf: [DiveInfoDTO](#schema-diveinfodto) | — | — |
| `splitSummaries` | array di [SplitSummaryDTO](#schema-splitsummarydto) | — | — |
| `videoGameInfo` | allOf: [VideoGameInfoDTO](#schema-videogameinfodto) | — | — |
| `deviceDisplayUnitsDTO` | allOf: [DeviceDisplayUnitsDTO](#schema-devicedisplayunitsdto) | — | — |

</details>

<a id="schema-activitytypedto"></a>

<details>
<summary>ActivityTypeDTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `typeId` | `integer/int64` | — | — |
| `typeKey` | `string` | — | — |
| `parentTypeId` | `integer/int64` | — | — |

</details>

<a id="schema-eventtypedto"></a>

<details>
<summary>EventTypeDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `typeId` | `integer/int64` | — | — |
| `typeKey` | `string` | — | — |

</details>

<a id="schema-accesscontrolruledto"></a>

<details>
<summary>AccessControlRuleDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `typeId` | `integer/int64` | — | — |
| `typeKey` | `string` | — | — |

</details>

<a id="schema-timezoneunitdto"></a>

<details>
<summary>TimeZoneUnitDTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `unitId` | `integer/int64` | — | — |
| `unitKey` | `string` | — | — |
| `timeZone` | `string` | — | — |

</details>

<a id="schema-metadatadto"></a>

<details>
<summary>MetadataDTO — 29 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `isOriginal` | `boolean` | — | — |
| `fileFormat` | [ApplicationFormatDTO](#schema-applicationformatdto) | — | — |
| `lastUpdateDate` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+$"` |
| `uploadedDate` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+$"` |
| `videoUrl` | `string` | — | — |
| `userInfoDto` | [UserInfoDto](#schema-userinfodto) | — | — |
| `childIds` | array di `integer/int64` | — | — |
| `childActivityTypes` | array di `string` | — | — |
| `sensors` | array di [SensorInfoDTO](#schema-sensorinfodto) | — | — |
| `activityImages` | array di [ActivityImageDTO](#schema-activityimagedto) | — | — |
| `manufacturer` | `string` | — | — |
| `lapCount` | `integer/int32` | — | — |
| `eBikeMaxAssistModes` | `integer/int32` | — | — |
| `eBikeBatteryUsage` | `integer/int32` | — | — |
| `eBikeBatteryRemaining` | `integer/int32` | — | — |
| `eBikeAssistModeInfoDTOList` | array di [EBikeAssistModeInfoDTO](#schema-ebikeassistmodeinfodto) | — | — |
| `hasRunPowerWindData` | `boolean` | — | — |
| `calendarEventInfo` | [CalendarEventInfoDTO](#schema-calendareventinfodto) | — | — |
| `isWheelchair` | `boolean` | — | — |
| `specializedWorkoutCategories` | array di `string` | — | uniqueItems=`true` |
| `hasMultiDayActivities` | `boolean` | — | — |
| `personalRecord` | `boolean` | — | — |
| `gcj02` | `boolean` | — | — |
| `runPowerWindDataEnabled` | `boolean` | — | — |
| `trimmed` | `boolean` | — | — |
| `manualActivity` | `boolean` | — | — |
| `elevationCorrected` | `boolean` | — | — |
| `autoCalcCalories` | `boolean` | — | — |
| `favorite` | `boolean` | — | — |

</details>

<a id="schema-applicationformatdto"></a>

<details>
<summary>ApplicationFormatDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `formatId` | `integer/int64` | — | — |
| `formatKey` | `string` | — | — |

</details>

<a id="schema-userinfodto"></a>

<details>
<summary>UserInfoDto — 6 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfilePk` | `integer/int64` | — | — |
| `displayname` | `string` | — | — |
| `fullname` | `string` | — | — |
| `profileImageUrlLarge` | `string` | — | — |
| `profileImageUrlMedium` | `string` | — | — |
| `profileImageUrlSmall` | `string` | — | — |

</details>

<a id="schema-uuid"></a>

<details>
<summary>UUID — 1 campi</summary>

Tipo radice: `object`.

Vincoli del modello: readOnly=`true`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `uuid` | `string` | — | pattern=`"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"` |

</details>

<a id="schema-sensorinfodto"></a>

<details>
<summary>SensorInfoDTO — 13 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `manufacturer` | `string` | — | — |
| `serialNumber` | `integer/int64` | — | — |
| `sku` | `string` | — | — |
| `fitProductNumber` | `integer/int32` | — | — |
| `sourceType` | `string` | — | — |
| `antplusDeviceType` | `string` | — | — |
| `localDeviceType` | `string` | — | — |
| `bodyLocation` | `string` | — | — |
| `softwareVersion` | `number/float` | — | — |
| `batteryStatus` | `string` | — | — |
| `bleDeviceType` | `string` | — | — |
| `productName` | `string` | — | — |
| `batteryLevel` | `integer/int32` | — | — |

</details>

<a id="schema-activityimagedto"></a>

<details>
<summary>ActivityImageDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `url` | `string` | — | — |
| `smallUrl` | `string` | — | — |
| `mediumUrl` | `string` | — | — |
| `expirationTimestamp` | `integer/int64` | — | — |

</details>

<a id="schema-ebikeassistmodeinfodto"></a>

<details>
<summary>EBikeAssistModeInfoDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `ebikeAssistMode` | `integer/int32` | — | — |
| `ebikeAssistModeName` | `string` | — | — |

</details>

<a id="schema-calendareventinfodto"></a>

<details>
<summary>CalendarEventInfoDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `completionTargetValue` | `number/float` | — | m se il campo UnitType associato è distance, s se è time |
| `completionTargetUnitType` | `string` | — | enum=`["distance","time"]` |
| `customGoalValue` | `number/float` | — | m se il campo UnitType associato è distance, s se è time |
| `customGoalUnitType` | `string` | — | enum=`["distance","time"]` |

</details>

<a id="schema-summarydto"></a>

<details>
<summary>SummaryDTO — 188 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `startTimeLocal` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+$"` |
| `startTimeGMT` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+$"` |
| `startLatitude` | `number/double` | — | unità documentata: gradi decimali |
| `startLongitude` | `number/double` | — | unità documentata: gradi decimali |
| `distance` | `number/double` | — | unità documentata: m |
| `duration` | `number/double` | — | unità documentata: s |
| `movingDuration` | `number/double` | — | unità documentata: s |
| `elapsedDuration` | `number/double` | — | unità documentata: s |
| `elevationGain` | `number/double` | — | unità documentata: m |
| `elevationLoss` | `number/double` | — | unità documentata: m |
| `maxElevation` | `number/double` | — | unità documentata: m |
| `minElevation` | `number/double` | — | unità documentata: m |
| `avgElevation` | `number/double` | — | unità documentata: m |
| `averageSpeed` | `number/double` | — | unità documentata: m/s |
| `averageMovingSpeed` | `number/double` | — | unità documentata: m/s |
| `maxSpeed` | `number/double` | — | unità documentata: m/s |
| `calories` | `number/double` | — | unità documentata: kcal |
| `bmrCalories` | `number/double` | — | unità documentata: kcal |
| `averageHR` | `number/double` | — | unità documentata: bpm |
| `maxHR` | `number/double` | — | unità documentata: bpm |
| `minHR` | `number/double` | — | unità documentata: bpm |
| `averageRunCadence` | `number/double` | — | — |
| `maxRunCadence` | `number/double` | — | — |
| `maxLapAvgRunCadence` | `number/double` | — | — |
| `averageBikeCadence` | `number/double` | — | — |
| `maxBikeCadence` | `number/double` | — | — |
| `averageSwimCadence` | `number/double` | — | — |
| `maxSwimCadence` | `number/double` | — | — |
| `averageTemperature` | `number/double` | — | unità documentata: °C |
| `maxTemperature` | `number/double` | — | unità documentata: °C |
| `minTemperature` | `number/double` | — | unità documentata: °C |
| `averagePower` | `number/double` | — | unità documentata: W |
| `maxPower` | `number/double` | — | unità documentata: W |
| `maxPowerTwentyMinutes` | `number/double` | — | unità documentata: W |
| `minPower` | `number/double` | — | unità documentata: W |
| `normalizedPower` | `number/double` | — | unità documentata: W |
| `functionalThresholdPower` | `number/double` | — | unità documentata: W |
| `totalWork` | `number/double` | — | unità documentata: kcal |
| `leftBalance` | `number/double` | — | — |
| `rightBalance` | `number/double` | — | — |
| `leftTorqueEffectiveness` | `number/double` | — | — |
| `rightTorqueEffectiveness` | `number/double` | — | — |
| `leftPedalSmoothness` | `number/double` | — | — |
| `rightPedalSmoothness` | `number/double` | — | — |
| `groundContactTime` | `number/double` | — | unità documentata: ms |
| `groundContactBalanceLeft` | `number/double` | — | — |
| `strideLength` | `number/double` | — | unità documentata: cm |
| `verticalOscillation` | `number/double` | — | unità documentata: cm |
| `trainingEffect` | `number/double` | — | — |
| `anaerobicTrainingEffect` | `number/double` | — | — |
| `aerobicTrainingEffectMessage` | `string` | — | enum=`["MINOR_AEROBIC_BENEFIT_0","MAINTAINING_AEROBIC_FITNESS_1","IMPROVING_AEROBIC_FITNESS_2","HIGHLY_IMPROVING_AEROBIC_FITNESS_3","OVERREACHING_4","RECOVERY_5","MINOR_AEROBIC_BENEFIT_6","MAINTAINING_AEROBIC_BASE_7","IMPROVING_AEROBIC_BASE_8","IMPROVING_AEROBIC_ENDURANCE_9","HIGHLY_IMPROVING_AEROBIC_ENDURANCE_10","OVERREACHING_11","IMPROVING_LACTATE_THRESHOLD_12","HIGHLY_IMPROVING_LACTATE_THRESHOLD_13","OVERREACHING_14","IMPROVING_VO2_MAX_15","HIGHLY_IMPROVING_VO2_MAX_16","OVERREACHING_17","NO_AEROBIC_BENEFIT_18","MAINTAINING_LACTATE_THRESHOLD_19","MAINTAINING_VO2_MAX_20","MAINTAINING_TEMPO_21","IMPACTING_TEMPO_22","HIGHLY_IMPACTING_TEMPO_23","OVERREACHING_TEMPO_24"]` |
| `anaerobicTrainingEffectMessage` | `string` | — | enum=`["NO_ANAEROBIC_BENEFIT_0","MAINTAINING_ANAEROBIC_BASE_1","IMPROVING_ANAEROBIC_BASE_2","HIGHLY_IMPROVING_ANAEROBIC_CAPACITY_AND_POWER_3","OVERREACHING_4","MINOR_FAST_FORCE_BENEFIT_5","MAINTAINING_FAST_FORCE_PRODUCTION_6","MAINTAINING_ANAEROBIC_POWER_7","IMPROVING_ANAEROBIC_CAPACITY_AND_POWER_8","MINOR_FAST_FORCE_BENEFIT_9","MAINTAINING_ECONOMY_AND_ANAEROBIC_BASE_10","IMPROVING_ECONOMY_AND_ANAEROBIC_BASE_11","IMPROVING_ANAEROBIC_CAPACITY_AND_SPEED_12","HIGHLY_IMPROVING_ANAEROBIC_CAPACITY_AND_SPEED_13","HIGHLY_IMPROVING_ECONOMY_AND_ANAEROBIC_BASE_14","MINOR_ANAEROBIC_BENEFIT_15","OVERREACHING_SPEED_16"]` |
| `trainingStressScore` | `number/double` | — | — |
| `intensityFactor` | `number/double` | — | — |
| `poolLength` | `number/double` | — | — |
| `numberOfActiveLengths` | `integer/int32` | — | — |
| `unitOfPoolLength` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `totalNumberOfStrokes` | `integer/int32` | — | — |
| `averageStrokes` | `number/double` | — | — |
| `minimumStrokes` | `number/double` | — | — |
| `averageSWOLF` | `number/double` | — | — |
| `minSWOLF` | `number/double` | — | — |
| `strokeDistance` | `number/double` | — | unità documentata: m |
| `standingCount` | `integer/int32` | — | — |
| `seatedTime` | `number/double` | — | unità documentata: s |
| `standingTime` | `number/double` | — | unità documentata: s |
| `maxSeatedPower` | `number/double` | — | unità documentata: W |
| `maxStandingPower` | `number/double` | — | unità documentata: W |
| `averageSeatedPower` | `number/double` | — | unità documentata: W |
| `averageStandingPower` | `number/double` | — | unità documentata: W |
| `maxSeatedCadence` | `number/double` | — | — |
| `maxStandingCadence` | `number/double` | — | — |
| `averageSeatedCadence` | `number/double` | — | — |
| `averageStandingCadence` | `number/double` | — | — |
| `leftPowerPhaseStart` | `number/double` | — | — |
| `leftPowerPhaseEnd` | `number/double` | — | — |
| `leftPowerPhaseArcLength` | `number/double` | — | — |
| `leftPowerPhaseArcCenter` | `number/double` | — | — |
| `leftPowerPhasePeakStart` | `number/double` | — | — |
| `leftPowerPhasePeakEnd` | `number/double` | — | — |
| `leftPowerPhasePeakArcLength` | `number/double` | — | — |
| `leftPowerPhasePeakArcCenter` | `number/double` | — | — |
| `leftPlatformCenterOffset` | `number/double` | — | — |
| `rightPowerPhaseStart` | `number/double` | — | — |
| `rightPowerPhaseEnd` | `number/double` | — | — |
| `rightPowerPhaseArcLength` | `number/double` | — | — |
| `rightPowerPhaseArcCenter` | `number/double` | — | — |
| `rightPowerPhasePeakStart` | `number/double` | — | — |
| `rightPowerPhasePeakEnd` | `number/double` | — | — |
| `rightPowerPhasePeakArcLength` | `number/double` | — | — |
| `rightPowerPhasePeakArcCenter` | `number/double` | — | — |
| `rightPlatformCenterOffset` | `number/double` | — | — |
| `lactateThresholdHeartRate` | `number/double` | — | unità documentata: bpm |
| `averageGforce` | `number/double` | — | — |
| `maxGforce` | `number/double` | — | — |
| `verticalRatio` | `number/double` | — | — |
| `lactateThresholdSpeed` | `number/double` | — | unità documentata: m/s |
| `directFunctionalThresholdPower` | `number/double` | — | unità documentata: W |
| `distancePerStroke` | `number/double` | — | unità documentata: m |
| `strokeCadence` | `number/double` | — | — |
| `averageStrokeDistance` | `number/double` | — | unità documentata: m |
| `averageStrokeCadence` | `number/double` | — | — |
| `maxStrokeCadence` | `number/double` | — | — |
| `riderPosition` | `integer/int32` | — | — |
| `startTimeGMTDoubleValue` | `number/double` | — | — |
| `totalExerciseReps` | `integer/int32` | — | — |
| `totalReps` | `integer/int32` | — | — |
| `totalSets` | `integer/int32` | — | — |
| `activeSets` | `integer/int32` | — | — |
| `maxLapRepCount` | `integer/int32` | — | — |
| `maxDepth` | `number/double` | — | unità documentata: m |
| `averageDepth` | `number/double` | — | unità documentata: m |
| `surfaceInterval` | `number/double` | — | unità documentata: s |
| `startCns` | `number/double` | — | — |
| `endCns` | `number/double` | — | — |
| `startN2` | `number/double` | — | — |
| `endN2` | `number/double` | — | — |
| `bottomTime` | `number/double` | — | unità documentata: s |
| `maxBottomTime` | `number/double` | — | unità documentata: s |
| `diveAlert` | `string` | — | — |
| `endLatitude` | `number/double` | — | unità documentata: gradi decimali |
| `endLongitude` | `number/double` | — | unità documentata: gradi decimali |
| `isDecoDive` | `boolean` | — | — |
| `floorsClimbed` | `number/double` | — | — |
| `floorsDescended` | `number/double` | — | — |
| `avgVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `maxVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `perceivedWorkoutEffort` | `integer/int32` | — | — |
| `flow` | `number/double` | — | — |
| `grit` | `number/double` | — | — |
| `jumpCount` | `integer/int32` | — | — |
| `caloriesEstimated` | `number/double` | — | unità documentata: kcal |
| `caloriesConsumed` | `number/double` | — | unità documentata: kcal |
| `waterEstimated` | `number/double` | — | unità documentata: ml |
| `waterConsumed` | `number/double` | — | unità documentata: ml |
| `minRespirationRate` | `number/double` | — | — |
| `maxRespirationRate` | `number/double` | — | — |
| `avgRespirationRate` | `number/double` | — | — |
| `trainingEffectLabel` | `string` | — | — |
| `activityTrainingLoad` | `number/double` | — | — |
| `avgFlow` | `number/double` | — | — |
| `avgGrit` | `number/double` | — | — |
| `minActivityLapDuration` | `number/double` | — | unità documentata: s |
| `startStress` | `number/double` | — | — |
| `endStress` | `number/double` | — | — |
| `differenceStress` | `number/double` | — | — |
| `directWorkoutFeel` | `integer/int32` | — | — |
| `directWorkoutRpe` | `integer/int32` | — | — |
| `directWorkoutComplianceScore` | `integer/int32` | — | — |
| `targetDuration` | `number/double` | — | unità documentata: s |
| `targetDistance` | `number/double` | — | unità documentata: m |
| `targetAverageSpeed` | `number/double` | — | unità documentata: m/s |
| `moderateIntensityMinutes` | `integer/int32` | — | unità documentata: min |
| `vigorousIntensityMinutes` | `integer/int32` | — | unità documentata: min |
| `steps` | `integer/int32` | — | — |
| `avgStress` | `number/double` | — | minimum=`0`; maximum=`100` |
| `maxStress` | `number/double` | — | minimum=`0`; maximum=`100` |
| `recoveryHeartRate` | `integer/int32` | — | unità documentata: bpm |
| `beginPotentialStamina` | `number/double` | — | — |
| `endPotentialStamina` | `number/double` | — | — |
| `minAvailableStamina` | `number/double` | — | — |
| `gainSolarActivityTime` | `number/double` | — | unità documentata: s |
| `avgSolarChargePercent` | `number/double` | — | — |
| `avgEbikeAssistLevelPercent` | `number/double` | — | — |
| `avgGradeAdjustedSpeed` | `number/double` | — | unità documentata: m/s |
| `avgWheelchairCadence` | `number/double` | — | — |
| `maxWheelchairCadence` | `number/double` | — | — |
| `avgJumpRopeCadence` | `number/double` | — | — |
| `maxJumpRopeCadence` | `number/double` | — | — |
| `avgElapsedDurationVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `surfaceTypeUnpavedPercentage` | `number/double` | — | — |
| `differenceBodyBattery` | `integer/int32` | — | — |
| `beginPackWeight` | `number/double` | — | minimum=`0`; exclusiveMinimum=`false` |
| `impactLoad` | `number/double` | — | unità documentata: m |
| `stepSpeedLoss` | `number/double` | — | unità documentata: m |
| `stepSpeedLossPercent` | `number/double` | — | — |
| `diveCount` | `integer/int32` | — | — |
| `longestPoolApneaInterval` | `number/double` | — | unità documentata: s |
| `avgForce` | `number/double` | — | — |
| `maxForce` | `number/double` | — | — |
| `normalizedForce` | `number/double` | — | — |
| `poolApneaBreathHoldDuration` | `number/double` | — | unità documentata: s |
| `avgSpo2` | `integer/int32` | — | — |
| `minSpo2` | `integer/int32` | — | — |
| `maxSpo2` | `integer/int32` | — | — |
| `carbonOffset` | `number/double` | — | — |
| `packWeightCalories` | `integer/int32` | — | unità documentata: kcal |
| `decoDive` | `boolean` | — | — |

</details>

<a id="schema-unitdto"></a>

<details>
<summary>UnitDTO — 1 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `unitKey` | `string` | — | — |

</details>

<a id="schema-diveinfodto"></a>

<details>
<summary>DiveInfoDTO — 14 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `weight` | `number/double` | — | — |
| `weightUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `exposureSuit` | `string` | — | — |
| `suitThickness` | `number/double` | — | — |
| `visibility` | `number/double` | — | — |
| `visibilityUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `surfaceCondition` | `string` | — | — |
| `current` | `string` | — | — |
| `entryType` | `string` | — | — |
| `equipments` | `string` | — | — |
| `buddy` | `string` | — | — |
| `diveSettings` | allOf: [DiveSettingsDTO](#schema-divesettingsdto) | — | — |
| `diveGases` | array di [DiveGasDTO](#schema-divegasdto) | — | — |
| `totalSurfaceTime` | `integer/int64` | — | unità documentata: s |

</details>

<a id="schema-divesettingsdto"></a>

<details>
<summary>DiveSettingsDTO — 12 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `name` | `string` | — | — |
| `model` | `integer/int32` | — | — |
| `gfLow` | `integer/int32` | — | — |
| `gfHigh` | `integer/int32` | — | — |
| `waterType` | `integer/int32` | — | — |
| `waterDensity` | `number/float` | — | unità documentata: kg |
| `ccrLowSetpointSwitchMode` | `integer/int32` | — | — |
| `ccrLowSetpoint` | `number/float` | — | — |
| `ccrLowSetpointDepth` | `number/float` | — | unità documentata: m |
| `ccrHighSetpointSwitchMode` | `integer/int32` | — | — |
| `ccrHighSetpoint` | `number/float` | — | — |
| `ccrHighSetpointDepth` | `number/float` | — | unità documentata: m |

</details>

<a id="schema-divegasdto"></a>

<details>
<summary>DiveGasDTO — 15 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `heliumContent` | `integer/int32` | — | — |
| `oxygenContent` | `integer/int32` | — | — |
| `status` | `integer/int32` | — | — |
| `gasIndex` | `integer/int32` | — | — |
| `volume` | `number/double` | — | — |
| `volumeUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `tankType` | `string` | — | — |
| `tankStartingPressure` | `number/double` | — | — |
| `tankStartingPressureUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `tankEndingPressure` | `number/double` | — | — |
| `tankEndingPressureUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `tankSize` | `number/double` | — | — |
| `tankSizeUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `sacRate` | `number/double` | — | — |
| `gasMode` | `integer/int32` | — | — |

</details>

<a id="schema-splitsummarydto"></a>

<details>
<summary>SplitSummaryDTO — 224 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `startTimeLocal` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+$"` |
| `startTimeGMT` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+$"` |
| `startLatitude` | `number/double` | — | unità documentata: gradi decimali |
| `startLongitude` | `number/double` | — | unità documentata: gradi decimali |
| `distance` | `number/double` | — | unità documentata: m |
| `duration` | `number/double` | — | unità documentata: s |
| `movingDuration` | `number/double` | — | unità documentata: s |
| `elapsedDuration` | `number/double` | — | unità documentata: s |
| `elevationGain` | `number/double` | — | unità documentata: m |
| `elevationLoss` | `number/double` | — | unità documentata: m |
| `maxElevation` | `number/double` | — | unità documentata: m |
| `minElevation` | `number/double` | — | unità documentata: m |
| `avgElevation` | `number/double` | — | unità documentata: m |
| `averageSpeed` | `number/double` | — | unità documentata: m/s |
| `averageMovingSpeed` | `number/double` | — | unità documentata: m/s |
| `maxSpeed` | `number/double` | — | unità documentata: m/s |
| `calories` | `number/double` | — | unità documentata: kcal |
| `bmrCalories` | `number/double` | — | unità documentata: kcal |
| `averageHR` | `number/double` | — | unità documentata: bpm |
| `maxHR` | `number/double` | — | unità documentata: bpm |
| `minHR` | `number/double` | — | unità documentata: bpm |
| `averageRunCadence` | `number/double` | — | — |
| `maxRunCadence` | `number/double` | — | — |
| `maxLapAvgRunCadence` | `number/double` | — | — |
| `averageBikeCadence` | `number/double` | — | — |
| `maxBikeCadence` | `number/double` | — | — |
| `averageSwimCadence` | `number/double` | — | — |
| `maxSwimCadence` | `number/double` | — | — |
| `averageTemperature` | `number/double` | — | unità documentata: °C |
| `maxTemperature` | `number/double` | — | unità documentata: °C |
| `minTemperature` | `number/double` | — | unità documentata: °C |
| `averagePower` | `number/double` | — | unità documentata: W |
| `maxPower` | `number/double` | — | unità documentata: W |
| `maxPowerTwentyMinutes` | `number/double` | — | unità documentata: W |
| `minPower` | `number/double` | — | unità documentata: W |
| `normalizedPower` | `number/double` | — | unità documentata: W |
| `functionalThresholdPower` | `number/double` | — | unità documentata: W |
| `totalWork` | `number/double` | — | unità documentata: kcal |
| `leftBalance` | `number/double` | — | — |
| `rightBalance` | `number/double` | — | — |
| `leftTorqueEffectiveness` | `number/double` | — | — |
| `rightTorqueEffectiveness` | `number/double` | — | — |
| `leftPedalSmoothness` | `number/double` | — | — |
| `rightPedalSmoothness` | `number/double` | — | — |
| `groundContactTime` | `number/double` | — | unità documentata: ms |
| `groundContactBalanceLeft` | `number/double` | — | — |
| `strideLength` | `number/double` | — | unità documentata: cm |
| `verticalOscillation` | `number/double` | — | unità documentata: cm |
| `trainingEffect` | `number/double` | — | — |
| `anaerobicTrainingEffect` | `number/double` | — | — |
| `aerobicTrainingEffectMessage` | `string` | — | enum=`["MINOR_AEROBIC_BENEFIT_0","MAINTAINING_AEROBIC_FITNESS_1","IMPROVING_AEROBIC_FITNESS_2","HIGHLY_IMPROVING_AEROBIC_FITNESS_3","OVERREACHING_4","RECOVERY_5","MINOR_AEROBIC_BENEFIT_6","MAINTAINING_AEROBIC_BASE_7","IMPROVING_AEROBIC_BASE_8","IMPROVING_AEROBIC_ENDURANCE_9","HIGHLY_IMPROVING_AEROBIC_ENDURANCE_10","OVERREACHING_11","IMPROVING_LACTATE_THRESHOLD_12","HIGHLY_IMPROVING_LACTATE_THRESHOLD_13","OVERREACHING_14","IMPROVING_VO2_MAX_15","HIGHLY_IMPROVING_VO2_MAX_16","OVERREACHING_17","NO_AEROBIC_BENEFIT_18","MAINTAINING_LACTATE_THRESHOLD_19","MAINTAINING_VO2_MAX_20","MAINTAINING_TEMPO_21","IMPACTING_TEMPO_22","HIGHLY_IMPACTING_TEMPO_23","OVERREACHING_TEMPO_24"]` |
| `anaerobicTrainingEffectMessage` | `string` | — | enum=`["NO_ANAEROBIC_BENEFIT_0","MAINTAINING_ANAEROBIC_BASE_1","IMPROVING_ANAEROBIC_BASE_2","HIGHLY_IMPROVING_ANAEROBIC_CAPACITY_AND_POWER_3","OVERREACHING_4","MINOR_FAST_FORCE_BENEFIT_5","MAINTAINING_FAST_FORCE_PRODUCTION_6","MAINTAINING_ANAEROBIC_POWER_7","IMPROVING_ANAEROBIC_CAPACITY_AND_POWER_8","MINOR_FAST_FORCE_BENEFIT_9","MAINTAINING_ECONOMY_AND_ANAEROBIC_BASE_10","IMPROVING_ECONOMY_AND_ANAEROBIC_BASE_11","IMPROVING_ANAEROBIC_CAPACITY_AND_SPEED_12","HIGHLY_IMPROVING_ANAEROBIC_CAPACITY_AND_SPEED_13","HIGHLY_IMPROVING_ECONOMY_AND_ANAEROBIC_BASE_14","MINOR_ANAEROBIC_BENEFIT_15","OVERREACHING_SPEED_16"]` |
| `trainingStressScore` | `number/double` | — | — |
| `intensityFactor` | `number/double` | — | — |
| `poolLength` | `number/double` | — | — |
| `numberOfActiveLengths` | `integer/int32` | — | — |
| `unitOfPoolLength` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `totalNumberOfStrokes` | `integer/int32` | — | — |
| `averageStrokes` | `number/double` | — | — |
| `minimumStrokes` | `number/double` | — | — |
| `averageSWOLF` | `number/double` | — | — |
| `minSWOLF` | `number/double` | — | — |
| `strokeDistance` | `number/double` | — | unità documentata: m |
| `standingCount` | `integer/int32` | — | — |
| `seatedTime` | `number/double` | — | unità documentata: s |
| `standingTime` | `number/double` | — | unità documentata: s |
| `maxSeatedPower` | `number/double` | — | unità documentata: W |
| `maxStandingPower` | `number/double` | — | unità documentata: W |
| `averageSeatedPower` | `number/double` | — | unità documentata: W |
| `averageStandingPower` | `number/double` | — | unità documentata: W |
| `maxSeatedCadence` | `number/double` | — | — |
| `maxStandingCadence` | `number/double` | — | — |
| `averageSeatedCadence` | `number/double` | — | — |
| `averageStandingCadence` | `number/double` | — | — |
| `leftPowerPhaseStart` | `number/double` | — | — |
| `leftPowerPhaseEnd` | `number/double` | — | — |
| `leftPowerPhaseArcLength` | `number/double` | — | — |
| `leftPowerPhaseArcCenter` | `number/double` | — | — |
| `leftPowerPhasePeakStart` | `number/double` | — | — |
| `leftPowerPhasePeakEnd` | `number/double` | — | — |
| `leftPowerPhasePeakArcLength` | `number/double` | — | — |
| `leftPowerPhasePeakArcCenter` | `number/double` | — | — |
| `leftPlatformCenterOffset` | `number/double` | — | — |
| `rightPowerPhaseStart` | `number/double` | — | — |
| `rightPowerPhaseEnd` | `number/double` | — | — |
| `rightPowerPhaseArcLength` | `number/double` | — | — |
| `rightPowerPhaseArcCenter` | `number/double` | — | — |
| `rightPowerPhasePeakStart` | `number/double` | — | — |
| `rightPowerPhasePeakEnd` | `number/double` | — | — |
| `rightPowerPhasePeakArcLength` | `number/double` | — | — |
| `rightPowerPhasePeakArcCenter` | `number/double` | — | — |
| `rightPlatformCenterOffset` | `number/double` | — | — |
| `lactateThresholdHeartRate` | `number/double` | — | unità documentata: bpm |
| `averageGforce` | `number/double` | — | — |
| `maxGforce` | `number/double` | — | — |
| `verticalRatio` | `number/double` | — | — |
| `lactateThresholdSpeed` | `number/double` | — | unità documentata: m/s |
| `directFunctionalThresholdPower` | `number/double` | — | unità documentata: W |
| `distancePerStroke` | `number/double` | — | unità documentata: m |
| `strokeCadence` | `number/double` | — | — |
| `averageStrokeDistance` | `number/double` | — | unità documentata: m |
| `averageStrokeCadence` | `number/double` | — | — |
| `maxStrokeCadence` | `number/double` | — | — |
| `riderPosition` | `integer/int32` | — | — |
| `startTimeGMTDoubleValue` | `number/double` | — | — |
| `totalExerciseReps` | `integer/int32` | — | — |
| `totalReps` | `integer/int32` | — | — |
| `totalSets` | `integer/int32` | — | — |
| `activeSets` | `integer/int32` | — | — |
| `maxLapRepCount` | `integer/int32` | — | — |
| `maxDepth` | `number/double` | — | unità documentata: m |
| `averageDepth` | `number/double` | — | unità documentata: m |
| `surfaceInterval` | `number/double` | — | unità documentata: s |
| `startCns` | `number/double` | — | — |
| `endCns` | `number/double` | — | — |
| `startN2` | `number/double` | — | — |
| `endN2` | `number/double` | — | — |
| `bottomTime` | `number/double` | — | unità documentata: s |
| `maxBottomTime` | `number/double` | — | unità documentata: s |
| `diveAlert` | `string` | — | — |
| `endLatitude` | `number/double` | — | unità documentata: gradi decimali |
| `endLongitude` | `number/double` | — | unità documentata: gradi decimali |
| `isDecoDive` | `boolean` | — | — |
| `floorsClimbed` | `number/double` | — | — |
| `floorsDescended` | `number/double` | — | — |
| `avgVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `maxVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `perceivedWorkoutEffort` | `integer/int32` | — | — |
| `flow` | `number/double` | — | — |
| `grit` | `number/double` | — | — |
| `jumpCount` | `integer/int32` | — | — |
| `caloriesEstimated` | `number/double` | — | unità documentata: kcal |
| `caloriesConsumed` | `number/double` | — | unità documentata: kcal |
| `waterEstimated` | `number/double` | — | unità documentata: ml |
| `waterConsumed` | `number/double` | — | unità documentata: ml |
| `minRespirationRate` | `number/double` | — | — |
| `maxRespirationRate` | `number/double` | — | — |
| `avgRespirationRate` | `number/double` | — | — |
| `trainingEffectLabel` | `string` | — | — |
| `activityTrainingLoad` | `number/double` | — | — |
| `avgFlow` | `number/double` | — | — |
| `avgGrit` | `number/double` | — | — |
| `minActivityLapDuration` | `number/double` | — | unità documentata: s |
| `startStress` | `number/double` | — | — |
| `endStress` | `number/double` | — | — |
| `differenceStress` | `number/double` | — | — |
| `directWorkoutFeel` | `integer/int32` | — | — |
| `directWorkoutRpe` | `integer/int32` | — | — |
| `directWorkoutComplianceScore` | `integer/int32` | — | — |
| `targetDuration` | `number/double` | — | unità documentata: s |
| `targetDistance` | `number/double` | — | unità documentata: m |
| `targetAverageSpeed` | `number/double` | — | unità documentata: m/s |
| `moderateIntensityMinutes` | `integer/int32` | — | unità documentata: min |
| `vigorousIntensityMinutes` | `integer/int32` | — | unità documentata: min |
| `steps` | `integer/int32` | — | — |
| `avgStress` | `number/double` | — | minimum=`0`; maximum=`100` |
| `maxStress` | `number/double` | — | minimum=`0`; maximum=`100` |
| `recoveryHeartRate` | `integer/int32` | — | unità documentata: bpm |
| `beginPotentialStamina` | `number/double` | — | — |
| `endPotentialStamina` | `number/double` | — | — |
| `minAvailableStamina` | `number/double` | — | — |
| `gainSolarActivityTime` | `number/double` | — | unità documentata: s |
| `avgSolarChargePercent` | `number/double` | — | — |
| `avgEbikeAssistLevelPercent` | `number/double` | — | — |
| `avgGradeAdjustedSpeed` | `number/double` | — | unità documentata: m/s |
| `avgWheelchairCadence` | `number/double` | — | — |
| `maxWheelchairCadence` | `number/double` | — | — |
| `avgJumpRopeCadence` | `number/double` | — | — |
| `maxJumpRopeCadence` | `number/double` | — | — |
| `avgElapsedDurationVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `surfaceTypeUnpavedPercentage` | `number/double` | — | — |
| `differenceBodyBattery` | `integer/int32` | — | — |
| `beginPackWeight` | `number/double` | — | minimum=`0`; exclusiveMinimum=`false` |
| `impactLoad` | `number/double` | — | unità documentata: m |
| `stepSpeedLoss` | `number/double` | — | unità documentata: m |
| `stepSpeedLossPercent` | `number/double` | — | — |
| `diveCount` | `integer/int32` | — | — |
| `longestPoolApneaInterval` | `number/double` | — | unità documentata: s |
| `avgForce` | `number/double` | — | — |
| `maxForce` | `number/double` | — | — |
| `normalizedForce` | `number/double` | — | — |
| `poolApneaBreathHoldDuration` | `number/double` | — | unità documentata: s |
| `avgSpo2` | `integer/int32` | — | — |
| `minSpo2` | `integer/int32` | — | — |
| `maxSpo2` | `integer/int32` | — | — |
| `carbonOffset` | `number/double` | — | — |
| `packWeightCalories` | `integer/int32` | — | unità documentata: kcal |
| `messageIndex` | `integer/int32` | — | — |
| `splitType` | `string` | — | enum=`["PACE_PRO_SPLIT","ASCENT_SPLIT","DESCENT_SPLIT","INTERVAL_ACTIVE","INTERVAL_REST","INTERVAL_WARMUP","INTERVAL_COOLDOWN","INTERVAL_RECOVERY","INTERVAL_OTHER","CLIMB_ACTIVE","CLIMB_REST","SURF_ACTIVE","RUN_ACTIVE","RUN_REST","WORKOUT_ROUND","LIVE_EVENT_SPLIT","POWER_GUIDANCE_SPLIT","RWD_RUN","RWD_WALK","CLIMB_PRO_CYCLING_CLIMB","CLIMB_PRO_CYCLING_CLIMB_SECTION","WINDSURF_ACTIVE","RWD_STAND","TRANSITION","SWIM_STRAIGHTNESS","ROUND_ACTIVE","ROUND_REST","SKI_LIFT_SPLIT","SKI_RUN_SPLIT","OBSTACLE","CYCLING_GROUP_RIDE","DIVE","DIVE_SECTION","SURFACE_TYPE_UNPAVED","DYNAMIC_APNEA_DIVE","DYNAMIC_APNEA_STA","DYNAMIC_APNEA_REST","MARKER_MILE","MARKER_KILOMETER","MARKER_HALF_MARATHON","MARKER_MANUAL","SURFACE_TYPE_PAVED","TIMING_GATE","TIMING_RUN","VIRTUAL_ACTIVITY_SECTION","DOWNHILL_RUN","DOWNHILL_LIFT","SKI_RUN_SPLIT_SECTION","PROVISIONAL_END","TRAIL_DIFFICULTY_SECTION","SHOT_TIMER_SET","SHOT_TIMER_SHOT","DYNAMIC_APNEA_BREATHEUP","DYNAMIC_APNEA_SURFACE","MARKER_5K","PACK_WEIGHT","INTERVAL_WALK","DANCE_ACTIVE","DANCE_REST"]` |
| `noOfSplits` | `integer/int32` | — | — |
| `averagePowerTarget` | `number/double` | — | unità documentata: W |
| `numFalls` | `integer/int32` | — | — |
| `numClimbSends` | `integer/int32` | — | — |
| `numClimbsAttempted` | `integer/int32` | — | — |
| `numClimbsCompleted` | `integer/int32` | — | — |
| `maxElevationGain` | `number/double` | — | unità documentata: m |
| `averageElevationGain` | `number/double` | — | unità documentata: m |
| `maxDistance` | `integer/int32` | — | unità documentata: m |
| `maxDistanceWithPrecision` | `number/double` | — | unità documentata: m |
| `maxGradeValue` | allOf: [GradeValueDTO](#schema-gradevaluedto) | — | — |
| `mode` | `string` | — | enum=`["ADVANCED","SIMPLE"]` |
| `gamesWon` | `integer/int32` | — | — |
| `swimStraightnessScore` | `integer/int32` | — | — |
| `swimStraightnessExtraDistance` | `number/double` | — | unità documentata: m |
| `weightedMeanBestFiveMaxSpeedOverTenSeconds` | `number/double` | — | unità documentata: m/s |
| `maxPisteDifficulty` | `string` | — | enum=`["GREEN","BLUE","RED","BLACK","DOUBLE_BLACK"]` |
| `avgReactionTime` | `number/double` | — | unità documentata: s |
| `minReactionTime` | `number/double` | — | unità documentata: s |
| `avgStepFrequency` | `number/double` | — | — |
| `maxStepFrequency` | `number/double` | — | — |
| `gctAirTimeRatio` | `number/double` | — | — |
| `maxAcceleration` | `number/double` | — | unità documentata: m/s |
| `avgMaxAcceleration` | `number/double` | — | unità documentata: m/s |
| `avgMaxSpeed` | `number/double` | — | unità documentata: m/s |
| `minStanceTime` | `number/double` | — | unità documentata: ms |
| `avgStanceTime` | `number/double` | — | unità documentata: ms |
| `avgStanceTimePercent` | `number/double` | — | — |
| `avgStepLength` | `number/double` | — | unità documentata: m |
| `maxStepLength` | `number/double` | — | unità documentata: m |
| `avgDistanceToMaxSpeed` | `number/double` | — | unità documentata: m |
| `avgPackWeight` | `integer/int32` | — | — |
| `maxPackWeight` | `integer/int32` | — | — |
| `maxDuration` | `number/double` | — | unità documentata: s |
| `decoDive` | `boolean` | — | — |

</details>

<a id="schema-gradevaluedto"></a>

<details>
<summary>GradeValueDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `valueKey` | `string` | — | — |
| `scale` | `string` | — | enum=`["YDS","UIAA","FRENCH","BRITISH_ADJECTIVAL","BRITISH_TECHNICAL","EWBANK","BRAZILIAN","SAXON","VERMIN","FONT","DANKYU","YDS_PM"]` |

</details>

<a id="schema-videogameinfodto"></a>

<details>
<summary>VideoGameInfoDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `name` | `string` | — | — |
| `type` | `string` | — | enum=`["GENERIC_WIN_LOSS_RESULT","GENERIC_PLACEMENT_RESULT","SANDBOX","MATCH_PLAY","BATTLE_ROYALE"]` |

</details>

<a id="schema-devicedisplayunitsdto"></a>

<details>
<summary>DeviceDisplayUnitsDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `distanceDisplayMeasure` | `string` | — | — |
| `elevationDisplayMeasure` | `string` | — | — |
| `speedDisplayMeasure` | `string` | — | — |
| `verticalSpeedDisplayMeasure` | `string` | — | — |

</details>

<a id="schema-activityworkoutdto"></a>

<details>
<summary>ActivityWorkoutDTO — 8 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `index` | `integer/int32` | — | — |
| `workoutName` | `string` | — | — |
| `timeCreated` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+$"` |
| `sport` | `string` | — | — |
| `manufacturer` | `string` | — | — |
| `multisportSet` | `integer/int32` | — | — |
| `steps` | array di [WorkoutStepDTO](#schema-workoutstepdto) | — | — |
| `workoutPhrase` | `string` | — | readOnly=`true` |

</details>

<a id="schema-workoutstepdto"></a>

<details>
<summary>WorkoutStepDTO — 15 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `stepIndex` | `integer/int32` | — | — |
| `name` | `string` | — | — |
| `intensity` | `string` | — | — |
| `durationType` | `string` | — | — |
| `durationValue` | `number/double` | — | — |
| `targetType` | `string` | — | — |
| `targetValue` | `number/double` | — | — |
| `targetValueLow` | `number/double` | — | unità documentata: m/s |
| `targetValueHigh` | `number/double` | — | — |
| `notes` | `string` | — | — |
| `equipmentType` | `string` | — | — |
| `exerciseCategory` | `string` | — | — |
| `exerciseName` | `string` | — | — |
| `exerciseWeightValue` | `number/double` | — | unità documentata: kg |
| `weightDisplayUnit` | `string` | — | — |

</details>

<a id="schema-summarizedactivitydto"></a>

<details>
<summary>SummarizedActivityDTO — 230 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `activityId` | `integer/int64` | — | — |
| `activityName` | `string` | — | — |
| `description` | `string` | — | — |
| `startTimeLocal` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$"` |
| `startTimeGMT` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$"` |
| `activityType` | allOf: [ActivityTypeDTO](#schema-activitytypedto) | — | — |
| `eventType` | allOf: [EventTypeDTO](#schema-eventtypedto) | — | — |
| `comments` | array di [ActivityCommentDTO](#schema-activitycommentdto) | — | — |
| `isFavorite` | `boolean` | — | — |
| `isPR` | `boolean` | — | — |
| `isAutoCalcCalories` | `boolean` | — | — |
| `isParent` | `boolean` | — | — |
| `parentId` | `integer/int64` | — | — |
| `distance` | `number/double` | — | unità documentata: m |
| `duration` | `number/double` | — | unità documentata: s |
| `elapsedDuration` | `number/double` | — | unità documentata: s |
| `movingDuration` | `number/double` | — | unità documentata: s |
| `elevationGain` | `number/double` | — | unità documentata: m |
| `elevationLoss` | `number/double` | — | unità documentata: m |
| `averageSpeed` | `number/double` | — | unità documentata: m/s |
| `maxSpeed` | `number/double` | — | unità documentata: m/s |
| `startLatitude` | `number/double` | — | unità documentata: gradi decimali |
| `startLongitude` | `number/double` | — | unità documentata: gradi decimali |
| `hasPolyline` | `boolean` | — | — |
| `hasImages` | `boolean` | — | — |
| `ownerId` | `integer/int64` | — | — |
| `ownerDisplayName` | `string` | — | — |
| `ownerFullName` | `string` | — | — |
| `ownerProfileImageUrlSmall` | `string` | — | — |
| `ownerProfileImageUrlMedium` | `string` | — | — |
| `ownerProfileImageUrlLarge` | `string` | — | — |
| `calories` | `number/double` | — | unità documentata: kcal |
| `bmrCalories` | `number/double` | — | unità documentata: kcal |
| `averageHR` | `number/double` | — | unità documentata: bpm |
| `maxHR` | `number/double` | — | unità documentata: bpm |
| `averageRunningCadenceInStepsPerMinute` | `number/double` | — | — |
| `maxRunningCadenceInStepsPerMinute` | `number/double` | — | — |
| `maxLapAvgRunCadence` | `number/double` | — | — |
| `averageBikingCadenceInRevPerMinute` | `number/double` | — | — |
| `maxBikingCadenceInRevPerMinute` | `number/double` | — | — |
| `averageSwimCadenceInStrokesPerMinute` | `number/double` | — | — |
| `maxSwimCadenceInStrokesPerMinute` | `number/double` | — | — |
| `averageSwolf` | `number/double` | — | — |
| `activeLengths` | `integer/int64` | — | — |
| `steps` | `integer/int64` | — | — |
| `numberOfActivityLikes` | `integer/int32` | — | — |
| `numberOfActivityComments` | `integer/int32` | — | — |
| `likedByUser` | `boolean` | — | — |
| `commentedByUser` | `boolean` | — | — |
| `activityLikeDisplayNames` | array di `string` | — | — |
| `activityLikeFullNames` | array di `string` | — | — |
| `activityLikeProfileImageUrls` | array di `string` | — | — |
| `requestorRelationship` | `string` | — | — |
| `privacy` | allOf: [AccessControlRuleDTO](#schema-accesscontrolruledto) | — | — |
| `poolLength` | `number/double` | — | unità documentata: cm |
| `unitOfPoolLength` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `hasVideo` | `boolean` | — | — |
| `videoUrl` | `string` | — | — |
| `beginTimestamp` | `integer/int64` | — | unità documentata: ms |
| `sportTypeId` | `integer/int32` | — | — |
| `avgPower` | `number/double` | — | unità documentata: W |
| `maxPower` | `number/double` | — | unità documentata: W |
| `aerobicTrainingEffect` | `number/double` | — | — |
| `anaerobicTrainingEffect` | `number/double` | — | — |
| `strokes` | `number/double` | — | — |
| `normPower` | `number/double` | — | unità documentata: W |
| `leftBalance` | `number/double` | — | — |
| `rightBalance` | `number/double` | — | — |
| `avgLeftBalance` | `number/double` | — | — |
| `max20MinPower` | `number/double` | — | unità documentata: W |
| `avgVerticalOscillation` | `number/double` | — | unità documentata: cm |
| `avgGroundContactTime` | `number/double` | — | unità documentata: ms |
| `avgStrideLength` | `number/double` | — | unità documentata: cm |
| `avgFractionalCadence` | `number/double` | — | — |
| `maxFractionalCadence` | `number/double` | — | — |
| `trainingStressScore` | `number/double` | — | — |
| `intensityFactor` | `number/double` | — | — |
| `vO2MaxValue` | `number/double` | — | — |
| `avgVerticalRatio` | `number/double` | — | — |
| `avgGroundContactBalance` | `number/double` | — | — |
| `lactateThresholdBpm` | `number/double` | — | unità documentata: bpm |
| `getlactateThresholdSpeed` | `number/double` | — | unità documentata: cm |
| `maxFtp` | `number/double` | — | unità documentata: W |
| `avgStrokeDistance` | `number/double` | — | unità documentata: cm |
| `avgStrokeCadence` | `number/double` | — | — |
| `maxStrokeCadence` | `number/double` | — | — |
| `avgStrokes` | `number/double` | — | — |
| `minStrokes` | `number/double` | — | — |
| `minTemperature` | `number/double` | — | unità documentata: °C |
| `maxTemperature` | `number/double` | — | unità documentata: °C |
| `minElevation` | `number/double` | — | unità documentata: m |
| `maxElevation` | `number/double` | — | unità documentata: m |
| `avgElevation` | `number/double` | — | unità documentata: m |
| `avgDoubleCadence` | `number/double` | — | — |
| `maxDoubleCadence` | `number/double` | — | — |
| `isElevationCorrected` | `boolean` | — | — |
| `summarizedExerciseSets` | array di [SummarizedExerciseSet](#schema-summarizedexerciseset) | — | — |
| `maxDepth` | `number/double` | — | unità documentata: cm |
| `avgDepth` | `number/double` | — | unità documentata: cm |
| `surfaceInterval` | `number/double` | — | unità documentata: ms |
| `startN2` | `number/double` | — | — |
| `endN2` | `number/double` | — | — |
| `startCns` | `number/double` | — | — |
| `endCns` | `number/double` | — | — |
| `isDecoDive` | `boolean` | — | — |
| `summarizedDiveInfo` | allOf: [SummarizedDiveInfoDTO](#schema-summarizeddiveinfodto) | — | — |
| `diveCount` | `integer/int32` | — | — |
| `activityLikeAuthors` | array di [UserInfoDto](#schema-userinfodto) | — | — |
| `avgVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `maxVerticalSpeed` | `number/double` | — | unità documentata: m/s |
| `floorsClimbed` | `number/double` | — | — |
| `floorsDescended` | `number/double` | — | — |
| `manufacturer` | `string` | — | — |
| `diveNumber` | `integer/int64` | — | — |
| `locationName` | `string` | — | — |
| `bottomTime` | `number/double` | — | unità documentata: s |
| `lapCount` | `integer/int32` | — | — |
| `endLatitude` | `number/double` | — | unità documentata: gradi decimali |
| `endLongitude` | `number/double` | — | unità documentata: gradi decimali |
| `flow` | `number/double` | — | — |
| `grit` | `number/double` | — | — |
| `jumpCount` | `integer/int32` | — | — |
| `caloriesEstimated` | `number/double` | — | — |
| `caloriesConsumed` | `number/double` | — | — |
| `waterEstimated` | `number/double` | — | unità documentata: ml |
| `waterConsumed` | `number/double` | — | unità documentata: ml |
| `maxAvgPower_1` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_2` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_5` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_10` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_20` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_30` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_60` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_120` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_300` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_600` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_1200` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_1800` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_3600` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_7200` | `integer/int32` | — | unità documentata: W |
| `maxAvgPower_18000` | `integer/int32` | — | unità documentata: W |
| `excludeFromPowerCurveReports` | `boolean` | — | — |
| `totalSets` | `integer/int32` | — | — |
| `activeSets` | `integer/int32` | — | — |
| `totalReps` | `integer/int32` | — | — |
| `minRespirationRate` | `number/double` | — | — |
| `maxRespirationRate` | `number/double` | — | — |
| `avgRespirationRate` | `number/double` | — | — |
| `trainingEffectLabel` | `string` | — | — |
| `activityTrainingLoad` | `number/double` | — | — |
| `avgFlow` | `number/double` | — | — |
| `avgGrit` | `number/double` | — | — |
| `minActivityLapDuration` | `number/double` | — | unità documentata: s |
| `avgStress` | `number/double` | — | — |
| `startStress` | `number/double` | — | — |
| `endStress` | `number/double` | — | — |
| `differenceStress` | `number/double` | — | — |
| `maxStress` | `number/double` | — | — |
| `aerobicTrainingEffectMessage` | `string` | — | — |
| `anaerobicTrainingEffectMessage` | `string` | — | — |
| `splitSummaries` | array di [MinimalSplitSummaryDTO](#schema-minimalsplitsummarydto) | — | — |
| `isManualActivity` | `boolean` | — | — |
| `moderateIntensityMinutes` | `integer/int32` | — | unità documentata: min |
| `vigorousIntensityMinutes` | `integer/int32` | — | unità documentata: min |
| `maxBottomTime` | `number/double` | — | unità documentata: s |
| `hasSeedFirstbeatProfile` | `boolean` | — | — |
| `avgGradeAdjustedSpeed` | `number/double` | — | unità documentata: m/s |
| `avgWheelchairCadence` | `number/double` | — | — |
| `maxWheelchairCadence` | `number/double` | — | — |
| `avgJumpRopeCadence` | `number/double` | — | — |
| `maxJumpRopeCadence` | `number/double` | — | — |
| `gameName` | `string` | — | — |
| `differenceBodyBattery` | `integer/int32` | — | minimum=`-100`; maximum=`100` |
| `gameType` | `string` | — | enum=`["GENERIC_WIN_LOSS_RESULT","GENERIC_PLACEMENT_RESULT","SANDBOX","MATCH_PLAY","BATTLE_ROYALE"]` |
| `beginPackWeight` | `number/double` | — | — |
| `fastestSplit_1000` | `number/double` | — | unità documentata: s |
| `fastestSplit_1609` | `number/double` | — | unità documentata: s |
| `fastestSplit_5000` | `number/double` | — | unità documentata: s |
| `fastestSplit_10000` | `number/double` | — | unità documentata: s |
| `fastestSplit_21098` | `number/double` | — | unità documentata: s |
| `fastestSplit_42195` | `number/double` | — | unità documentata: s |
| `fastestSplit_40000` | `number/double` | — | unità documentata: s |
| `fastestSplit_100` | `number/double` | — | unità documentata: s |
| `fastestSplit_400` | `number/double` | — | unità documentata: s |
| `fastestSplit_750` | `number/double` | — | unità documentata: s |
| `fastestSplit_1500` | `number/double` | — | unità documentata: s |
| `fastestSplit_91` | `number/double` | — | unità documentata: s |
| `fastestSplit_457` | `number/double` | — | unità documentata: s |
| `fastestSplit_914` | `number/double` | — | unità documentata: s |
| `fastestSplit_1508` | `number/double` | — | unità documentata: s |
| `impactLoad` | `number/double` | — | unità documentata: m |
| `avgStepSpeedLoss` | `number/double` | — | unità documentata: cm |
| `avgStepSpeedLossPercent` | `number/double` | — | — |
| `hrTimeInZone_1` | `number/double` | — | — |
| `hrTimeInZone_2` | `number/double` | — | — |
| `hrTimeInZone_3` | `number/double` | — | — |
| `hrTimeInZone_4` | `number/double` | — | — |
| `hrTimeInZone_5` | `number/double` | — | — |
| `powerTimeInZone_1` | `number/double` | — | — |
| `powerTimeInZone_2` | `number/double` | — | — |
| `powerTimeInZone_3` | `number/double` | — | — |
| `powerTimeInZone_4` | `number/double` | — | — |
| `powerTimeInZone_5` | `number/double` | — | — |
| `powerTimeInZone_6` | `number/double` | — | — |
| `powerTimeInZone_7` | `number/double` | — | — |
| `longestPoolApneaInterval` | `number/double` | — | unità documentata: s |
| `avgForce` | `number/double` | — | — |
| `maxForce` | `number/double` | — | — |
| `normalizedForce` | `number/double` | — | — |
| `poolApneaBreathHoldDuration` | `number/double` | — | unità documentata: s |
| `deviceDisplayUnitsDTO` | allOf: [DeviceDisplayUnitsDTO](#schema-devicedisplayunitsdto) | — | — |
| `endTimeGMT` | `string` | — | pattern=`"^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$"` |
| `qualifyingDive` | `boolean` | — | — |
| `multiDayActivityUUIDs` | array di `string/uuid` | — | — |
| `activityUUID` | `string/uuid` | — | — |
| `carbonOffset` | `number/double` | — | — |
| `packWeightCalories` | `integer/int32` | — | unità documentata: kcal |
| `standingTime` | `number/double` | — | unità documentata: s |
| `seatedTime` | `number/double` | — | unità documentata: s |
| `maxStandingPower` | `number/double` | — | unità documentata: W |
| `maxSeatedPower` | `number/double` | — | unità documentata: W |
| `avgStandingPower` | `number/double` | — | unità documentata: W |
| `avgSeatedPower` | `number/double` | — | unità documentata: W |
| `parent` | `boolean` | — | — |
| `decoDive` | `boolean` | — | — |
| `elevationCorrected` | `boolean` | — | — |
| `pr` | `boolean` | — | — |
| `manualActivity` | `boolean` | — | — |
| `favorite` | `boolean` | — | — |
| `autoCalcCalories` | `boolean` | — | — |

</details>

<a id="schema-activitycommentdto"></a>

<details>
<summary>ActivityCommentDTO — 22 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `conversationCommentUuid` | `string` | — | — |
| `conversationCommentPk` | `integer/int64` | — | — |
| `conversationUuid` | `string` | — | — |
| `activityCommentPk` | `integer/int64` | — | — |
| `authorSocProfilePk` | `integer/int64` | — | — |
| `authorDisplayName` | `string` | — | — |
| `authorFullName` | `string` | — | — |
| `authorUserProfilePk` | `integer/int64` | — | — |
| `authorImageUrl` | `string` | — | — |
| `body` | `string` | — | — |
| `activityId` | `integer/int64` | — | — |
| `activityCommentLikeCount` | `integer/int32` | — | — |
| `requestorCanEdit` | `boolean` | — | — |
| `requestorCanDelete` | `boolean` | — | — |
| `authorPro` | `boolean` | — | — |
| `createDate` | `string/date-time` | — | — |
| `lastUpdatedDate` | `string/date-time` | — | — |
| `activityCommentLikedByUser` | `boolean` | — | — |
| `activityCommentLikeDisplayNames` | array di `string` | — | — |
| `activityCommentLikeFullNames` | array di `string` | — | — |
| `groupPk` | `integer/int64` | — | — |
| `activityCommentLikeAuthors` | array di [UserInfoDto](#schema-userinfodto) | — | — |

</details>

<a id="schema-summarizedexerciseset"></a>

<details>
<summary>SummarizedExerciseSet — 9 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `category` | `string` | — | — |
| `subCategory` | `string` | — | — |
| `reps` | `integer/int32` | — | — |
| `volume` | `integer/int32` | — | — |
| `duration` | `number/double` | — | unità documentata: ms |
| `sets` | `integer/int32` | — | — |
| `maxWeight` | `integer/int32` | — | — |
| `peakPower` | `number/double` | — | unità documentata: W |
| `concentricMeanVelocity` | `number/double` | — | unità documentata: cm |

</details>

<a id="schema-summarizeddiveinfodto"></a>

<details>
<summary>SummarizedDiveInfoDTO — 10 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `weight` | `number/double` | — | — |
| `weightUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `visibility` | `number/double` | — | — |
| `visibilityUnit` | allOf: [UnitDTO](#schema-unitdto) | — | — |
| `surfaceCondition` | `string` | — | — |
| `current` | `string` | — | — |
| `waterType` | `integer/int32` | — | — |
| `waterDensity` | `number/float` | — | unità documentata: kg |
| `summarizedDiveGases` | array di [SummarizedDiveGasDTO](#schema-summarizeddivegasdto) | — | — |
| `totalSurfaceTime` | `integer/int64` | — | unità documentata: s |

</details>

<a id="schema-summarizeddivegasdto"></a>

<details>
<summary>SummarizedDiveGasDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `heliumContent` | `integer/int32` | — | — |
| `oxygenContent` | `integer/int32` | — | — |
| `gasIndex` | `integer/int32` | — | — |
| `gasMode` | `integer/int32` | — | — |

</details>

<a id="schema-minimalsplitsummarydto"></a>

<details>
<summary>MinimalSplitSummaryDTO — 37 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `noOfSplits` | `integer/int32` | — | — |
| `maxGradeValue` | allOf: [GradeValueDTO](#schema-gradevaluedto) | — | — |
| `totalAscent` | `number/double` | — | unità documentata: m |
| `duration` | `number/double` | — | unità documentata: s |
| `splitType` | `string` | — | enum=`["PACE_PRO_SPLIT","ASCENT_SPLIT","DESCENT_SPLIT","INTERVAL_ACTIVE","INTERVAL_REST","INTERVAL_WARMUP","INTERVAL_COOLDOWN","INTERVAL_RECOVERY","INTERVAL_OTHER","CLIMB_ACTIVE","CLIMB_REST","SURF_ACTIVE","RUN_ACTIVE","RUN_REST","WORKOUT_ROUND","LIVE_EVENT_SPLIT","POWER_GUIDANCE_SPLIT","RWD_RUN","RWD_WALK","CLIMB_PRO_CYCLING_CLIMB","CLIMB_PRO_CYCLING_CLIMB_SECTION","WINDSURF_ACTIVE","RWD_STAND","TRANSITION","SWIM_STRAIGHTNESS","ROUND_ACTIVE","ROUND_REST","SKI_LIFT_SPLIT","SKI_RUN_SPLIT","OBSTACLE","CYCLING_GROUP_RIDE","DIVE","DIVE_SECTION","SURFACE_TYPE_UNPAVED","DYNAMIC_APNEA_DIVE","DYNAMIC_APNEA_STA","DYNAMIC_APNEA_REST","MARKER_MILE","MARKER_KILOMETER","MARKER_HALF_MARATHON","MARKER_MANUAL","SURFACE_TYPE_PAVED","TIMING_GATE","TIMING_RUN","VIRTUAL_ACTIVITY_SECTION","DOWNHILL_RUN","DOWNHILL_LIFT","SKI_RUN_SPLIT_SECTION","PROVISIONAL_END","TRAIL_DIFFICULTY_SECTION","SHOT_TIMER_SET","SHOT_TIMER_SHOT","DYNAMIC_APNEA_BREATHEUP","DYNAMIC_APNEA_SURFACE","MARKER_5K","PACK_WEIGHT","INTERVAL_WALK","DANCE_ACTIVE","DANCE_REST"]` |
| `numClimbSends` | `integer/int32` | — | — |
| `maxElevationGain` | `number/double` | — | unità documentata: m |
| `averageElevationGain` | `number/double` | — | unità documentata: m |
| `maxDistance` | `integer/int32` | — | unità documentata: m |
| `maxDistanceWithPrecision` | `number/double` | — | unità documentata: m |
| `distance` | `number/double` | — | unità documentata: m |
| `averageSpeed` | `number/double` | — | unità documentata: m/s |
| `maxSpeed` | `number/double` | — | unità documentata: m/s |
| `mode` | `string` | — | enum=`["ADVANCED","SIMPLE"]` |
| `numFalls` | `integer/int32` | — | — |
| `avgStress` | `number/double` | — | — |
| `avgStressWin` | `number/double` | — | — |
| `avgStressLoss` | `number/double` | — | — |
| `avgStressDraw` | `number/double` | — | — |
| `gamesWon` | `integer/int32` | — | — |
| `gamesNotWon` | `integer/int32` | — | — |
| `gamesAverageWon` | `number/double` | — | — |
| `elevationLoss` | `number/double` | — | unità documentata: m |
| `maxPackWeight` | `integer/int32` | — | — |
| `avgPackWeight` | `integer/int32` | — | — |
| `maxDuration` | `number/double` | — | unità documentata: s |
| `avgReactionTime` | `number/double` | — | unità documentata: s |
| `minReactionTime` | `number/double` | — | unità documentata: s |
| `avgDistanceToMaxSpeed` | `number/double` | — | unità documentata: m |
| `avgStepFrequency` | `number/double` | — | — |
| `maxStepFrequency` | `number/double` | — | — |
| `avgStepLength` | `number/double` | — | unità documentata: m |
| `verticalRatio` | `number/double` | — | — |
| `verticalOscillation` | `number/double` | — | unità documentata: cm |
| `avgGroundContactBalanceLeft` | `number/double` | — | — |
| `avgGroundContactTime` | `number/double` | — | unità documentata: ms |
| `avgStanceTimePercent` | `number/double` | — | — |

</details>

<a id="schema-heartratezonesdto"></a>

<details>
<summary>HeartRateZonesDTO — 11 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `trainingMethod` | `string` | — | enum=`["HR_MAX","LACTATE_THRESHOLD","HR_RESERVE","CUSTOM"]` |
| `restingHeartRateUsed` | `integer/int32` | — | — |
| `lactateThresholdHeartRateUsed` | `integer/int32` | — | — |
| `zone1Floor` | `integer/int32` | — | — |
| `zone2Floor` | `integer/int32` | — | — |
| `zone3Floor` | `integer/int32` | — | — |
| `zone4Floor` | `integer/int32` | — | — |
| `zone5Floor` | `integer/int32` | — | — |
| `maxHeartRateUsed` | `integer/int32` | — | — |
| `restingHrAutoUpdateUsed` | `boolean` | — | — |
| `sport` | `string` | — | enum=`["DEFAULT","RUNNING","CYCLING","SWIMMING","ROWING"]` |

</details>

<a id="schema-fitnessagedto"></a>

<details>
<summary>FitnessAgeDTO — 7 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `chronologicalAge` | `integer/int32` | — | — |
| `fitnessAge` | `number/double` | — | — |
| `achievableFitnessAge` | `number/double` | — | — |
| `previousFitnessAge` | `number/double` | — | — |
| `components` | mappa string → [FitnessAgeComponent](#schema-fitnessagecomponent) | — | — |
| `lastUpdated` | `string` | — | — |
| `invalidReason` | `string` | — | enum=`["USER_EMPTY_AGE","USER_UNDER_AGE","USER_OVER_AGE","USER_PREGNANT"]` |

</details>

<a id="schema-fitnessagecomponent"></a>

<details>
<summary>FitnessAgeComponent — 9 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `value` | `number` | — | — |
| `targetValue` | `number` | — | — |
| `improvementValue` | `number` | — | — |
| `potentialAge` | `number` | — | — |
| `priority` | `number` | — | — |
| `stale` | `boolean` | — | — |
| `staleInputs` | array di `string` | — | — |
| `lastMeasurementDate` | `string` | — | — |
| `numOfWeeksForIm` | `integer/int32` | — | — |

</details>

<a id="schema-usergoalsrangedto"></a>

<details>
<summary>UserGoalsRangeDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userGoals` | array di [UserGoalDTO](#schema-usergoaldto) | — | — |
| `userGoalRanges` | array di [UserGoalHighLowRangeDTO](#schema-usergoalhighlowrangedto) | — | — |

</details>

<a id="schema-usergoaldto"></a>

<details>
<summary>UserGoalDTO — 9 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userGoalCategory` | `string` | — | enum=`["MY_AUTO","LEADER_AUTO","MANUAL","GROUP","MYFITNESSPAL","PREGNANCY"]` |
| `userGoalType` | `string` | — | enum=`["WEIGHT_GRAMS"]` |
| `startDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `endDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `goalName` | `string` | — | — |
| `goalValue` | `number/double` | — | — |
| `updateDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `createDate` | allOf: [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `trackingPeriodType` | `string` | — | enum=`["SEVEN_DAYS","THIRTY_DAYS","ONE_MONTH","ANNUAL","DAILY","OPEN","PERIODIC"]` |

</details>

<a id="schema-connectdate"></a>

<details>
<summary>ConnectDate — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `date` | `string/date-time` | — | — |
| `localDate` | `string/date` | — | — |

</details>

<a id="schema-connecttimestamp"></a>

<details>
<summary>ConnectTimestamp — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `date` | `string/date-time` | — | — |
| `localDate` | `string/date` | — | — |

</details>

<a id="schema-usergoalhighlowrangedto"></a>

<details>
<summary>UserGoalHighLowRangeDTO — 8 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userGoalCategory` | `string` | — | enum=`["MY_AUTO","LEADER_AUTO","MANUAL","GROUP","MYFITNESSPAL","PREGNANCY"]` |
| `userGoalType` | `string` | — | enum=`["WEIGHT_GRAMS"]` |
| `startDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `endDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `lowWeightGoalInGrams` | `number/double` | — | — |
| `highWeightGoalInGrams` | `number/double` | — | — |
| `weekNum` | `integer/int32` | — | — |
| `trackingPeriodType` | `string` | — | enum=`["SEVEN_DAYS","THIRTY_DAYS","ONE_MONTH","ANNUAL","DAILY","OPEN","PERIODIC"]` |

</details>

<a id="schema-hrvchartdto"></a>

<details>
<summary>HrvChartDTO — 11 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfilePk` | `integer/int64` | — | — |
| `hrvSummary` | [HrvSummaryDTO](#schema-hrvsummarydto) | — | — |
| `hrvReadings` | array di [HrvReadingDTO](#schema-hrvreadingdto) | — | — |
| `startTimestampGMT` | `string` | Sì | pattern=`"2022-08-10T09:47:59\\.031"` |
| `endTimestampGMT` | `string` | Sì | pattern=`"2022-08-10T09:47:59\\.031"` |
| `startTimestampLocal` | `string` | Sì | pattern=`"2022-08-10T09:47:59\\.031"` |
| `endTimestampLocal` | `string` | Sì | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepStartTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepEndTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepStartTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepEndTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |

</details>

<a id="schema-hrvsummarydto"></a>

<details>
<summary>HrvSummaryDTO — 8 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `calendarDate` | `string` | — | pattern=`"2022-08-10"` |
| `weeklyAvg` | `integer/int32` | — | — |
| `lastNightAvg` | `integer/int32` | — | — |
| `lastNight5MinHigh` | `integer/int32` | — | — |
| `baseline` | [BaselineScoreDTO](#schema-baselinescoredto) | — | — |
| `status` | `string` | — | enum=`["NONE","POOR","LOW","UNBALANCED","BALANCED","INVALID"]` |
| `feedbackPhrase` | `string` | — | enum=`["NONE","ONBOARDING_1","ONBOARDING_2","HRV_POOR_1","HRV_POOR_2","HRV_POOR_3","HRV_POOR_4","HRV_POOR_5","HRV_POOR_6","HRV_POOR_7","HRV_POOR_8","HRV_LOW_1","HRV_LOW_2","HRV_LOW_3","HRV_LOW_4","HRV_LOW_5","HRV_LOW_6","HRV_LOW_7","HRV_UNBALANCED_1","HRV_UNBALANCED_2","HRV_UNBALANCED_3","HRV_UNBALANCED_4","HRV_UNBALANCED_5","HRV_UNBALANCED_6","HRV_UNBALANCED_7","HRV_UNBALANCED_8","HRV_UNBALANCED_9","HRV_UNBALANCED_10","HRV_UNBALANCED_11","HRV_UNBALANCED_12","HRV_BALANCED_1","HRV_BALANCED_2","HRV_BALANCED_3","HRV_BALANCED_4","HRV_BALANCED_5","HRV_BALANCED_6","HRV_BALANCED_7","HRV_BALANCED_8","INVALID"]` |
| `createTimeStamp` | `string` | Sì | pattern=`"2022-08-10T09:47:59\\.031"` |

</details>

<a id="schema-baselinescoredto"></a>

<details>
<summary>BaselineScoreDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `lowUpper` | `integer/int32` | — | — |
| `balancedLow` | `integer/int32` | — | — |
| `balancedUpper` | `integer/int32` | — | — |
| `markerValue` | `number/float` | — | — |

</details>

<a id="schema-hrvreadingdto"></a>

<details>
<summary>HrvReadingDTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `hrvValue` | `integer/int32` | — | — |
| `readingTimeGMT` | `string` | Sì | pattern=`"2022-08-10T09:47:59\\.031"` |
| `readingTimeLocal` | `string` | Sì | pattern=`"2022-08-10T09:47:59\\.031"` |

</details>

<a id="schema-hrvdailysummarydto"></a>

<details>
<summary>HrvDailySummaryDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `hrvSummaries` | array di [HrvSummaryDTO](#schema-hrvsummarydto) | — | — |
| `userProfilePk` | `integer/int64` | — | — |

</details>

<a id="schema-dailynutritionsummarydto"></a>

<details>
<summary>DailyNutritionSummaryDTO — 7 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `dailyNutritionContent` | [ThinNutritionContentDTO](#schema-thinnutritioncontentdto) | — | — |
| `dailyNutritionGoals` | [NutritionGoalsDTO](#schema-nutritiongoalsdto) | — | — |
| `dayEndTime` | [LocalTime](#schema-localtime) | — | — |
| `dayStartTime` | [LocalTime](#schema-localtime) | — | — |
| `loggedFoodsWithServingSizes` | array di [FoodDTO](#schema-fooddto) | — | — |
| `mealDate` | `string` | Sì | pattern=`"2022-08-10"` |
| `mealDetails` | array di [MealDetailsDTO](#schema-mealdetailsdto) | — | — |

</details>

<a id="schema-thinnutritioncontentdto"></a>

<details>
<summary>ThinNutritionContentDTO — 5 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `calories` | `integer/int32` | — | minimum=`0`; nullable=`true`; unità documentata: kcal |
| `caloriesPercentage` | `number/double` | — | minimum=`0` |
| `carbs` | `number/double` | — | minimum=`0`; nullable=`true` |
| `protein` | `number/double` | — | minimum=`0`; nullable=`true` |
| `fat` | `number/double` | — | minimum=`0`; nullable=`true` |

</details>

<a id="schema-nutritiongoalsdto"></a>

<details>
<summary>NutritionGoalsDTO — 8 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `adjustedCalories` | `integer/int32` | — | nullable=`true` |
| `adjustedCarbs` | `number/double` | — | nullable=`true` |
| `adjustedFat` | `number/double` | — | nullable=`true` |
| `adjustedProtein` | `number/double` | — | nullable=`true` |
| `calories` | `integer/int32` | Sì | — |
| `carbs` | `number/double` | Sì | — |
| `fat` | `number/double` | Sì | — |
| `protein` | `number/double` | Sì | — |

</details>

<a id="schema-localtime"></a>

<details>
<summary>LocalTime — 4 campi</summary>

Tipo radice: `object`.

Vincoli del modello: nullable=`true`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `hour` | `integer/int32` | — | — |
| `minute` | `integer/int32` | — | — |
| `nano` | `integer/int32` | — | — |
| `second` | `integer/int32` | — | — |

</details>

<a id="schema-fooddto"></a>

<details>
<summary>FoodDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `foodImages` | array di [FoodImageDTO](#schema-foodimagedto) | — | — |
| `foodMetaData` | [FoodMetadataDTO](#schema-foodmetadatadto) | Sì | — |
| `isFavorite` | `boolean` | — | — |
| `nutritionContents` | array di [NutritionContentDTO](#schema-nutritioncontentdto) | Sì | — |

</details>

<a id="schema-foodimagedto"></a>

<details>
<summary>FoodImageDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `imageType` | `string` | — | — |
| `imageUrl` | `string` | — | — |

</details>

<a id="schema-foodmetadatadto"></a>

<details>
<summary>FoodMetadataDTO — 10 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `brandName` | `string` | — | minLength=`1`; maxLength=`150` |
| `customFoodType` | `string` | — | enum=`["FOOD","RECIPE","MEAL"]` |
| `foodId` | `string` | — | — |
| `foodImageUrl` | `string` | — | deprecated=`true` |
| `foodName` | `string` | Sì | minLength=`1`; maxLength=`150` |
| `foodType` | `string` | — | enum=`["GENERIC","BRAND"]` |
| `imageUuid` | `string` | — | — |
| `languageCode` | `string` | Sì | — |
| `regionCode` | `string` | Sì | — |
| `source` | `string` | — | enum=`["GARMIN","FATSECRET"]` |

</details>

<a id="schema-nutritioncontentdto"></a>

<details>
<summary>NutritionContentDTO — 23 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `addedSugars` | `number/double` | — | minimum=`0`; nullable=`true` |
| `calcium` | `number/double` | — | minimum=`0`; nullable=`true` |
| `calories` | `integer/int32` | Sì | minimum=`0`; nullable=`true`; unità documentata: kcal |
| `carbs` | `number/double` | — | nullable=`true` |
| `cholesterol` | `number/double` | — | minimum=`0`; nullable=`true` |
| `fat` | `number/double` | — | nullable=`true` |
| `fiber` | `number/double` | — | minimum=`0`; nullable=`true` |
| `iron` | `number/double` | — | minimum=`0`; nullable=`true` |
| `monounsaturatedFat` | `number/double` | — | minimum=`0`; nullable=`true` |
| `numberOfUnits` | `number/double` | Sì | minimum=`0.001`; exclusiveMinimum=`false` |
| `polyunsaturatedFat` | `number/double` | — | minimum=`0`; nullable=`true` |
| `potassium` | `number/double` | — | minimum=`0`; nullable=`true` |
| `protein` | `number/double` | — | nullable=`true` |
| `saturatedFat` | `number/double` | — | minimum=`0`; nullable=`true` |
| `servingId` | `string` | — | nullable=`true` |
| `servingUnit` | `string` | Sì | minLength=`1`; maxLength=`100` |
| `sodium` | `number/double` | — | minimum=`0`; nullable=`true` |
| `sugar` | `number/double` | — | minimum=`0`; nullable=`true` |
| `transFat` | `number/double` | — | minimum=`0`; nullable=`true` |
| `unitHasServing` | `boolean` | — | nullable=`true` |
| `vitaminA` | `number/double` | — | minimum=`0`; nullable=`true` |
| `vitaminC` | `number/double` | — | minimum=`0`; nullable=`true` |
| `vitaminD` | `number/double` | — | minimum=`0`; nullable=`true` |

</details>

<a id="schema-mealdetailsdto"></a>

<details>
<summary>MealDetailsDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `loggedFoods` | array di [LoggedFoodDTO](#schema-loggedfooddto) | — | — |
| `meal` | [MealDTO](#schema-mealdto) | Sì | — |
| `mealNutritionContent` | [ThinNutritionContentDTO](#schema-thinnutritioncontentdto) | Sì | — |
| `mealNutritionGoals` | [NutritionGoalsDTO](#schema-nutritiongoalsdto) | — | — |

</details>

<a id="schema-loggedfooddto"></a>

<details>
<summary>LoggedFoodDTO — 16 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `customMealId` | `integer/int64` | — | — |
| `foodImages` | array di [FoodImageDTO](#schema-foodimagedto) | — | — |
| `foodInactive` | `boolean` | — | — |
| `foodMetaData` | [FoodMetadataDTO](#schema-foodmetadatadto) | — | — |
| `id` | `string` | — | pattern=`"^\\d+$"` |
| `isFavorite` | `boolean` | — | — |
| `logCategory` | `string` | — | enum=`["REGULAR_LOG","QUICK_ADD","IMAGE_RECOGNITION","BARCODE","UNKNOWN"]` |
| `logId` | `string` | — | — |
| `logSource` | `string` | — | — |
| `logTimestamp` | `string/date-time` | — | — |
| `mealDateTimeWithOffset` | `string/date-time` | — | — |
| `mealId` | `integer/int64` | — | — |
| `mealTime` | `string/time` | — | — |
| `nutritionContent` | [NutritionContentDTO](#schema-nutritioncontentdto) | Sì | — |
| `servingQty` | `number/double` | Sì | — |
| `type` | `string` | Sì | enum=`["FOOD","RECIPE","MEAL"]` |

</details>

<a id="schema-mealdto"></a>

<details>
<summary>MealDTO — 9 campi</summary>

Tipo radice: `object`.

Vincoli del modello: nullable=`true`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `defaultMealName` | `string` | — | readOnly=`true` |
| `displayOrder` | `integer/int32` | — | minimum=`0`; nullable=`true`; readOnly=`true` |
| `endTime` | [LocalTime](#schema-localtime) | — | — |
| `goals` | [NutritionGoalsDTO](#schema-nutritiongoalsdto) | — | — |
| `mealId` | `integer/int64` | — | nullable=`true` |
| `mealIndex` | `integer/int32` | — | minimum=`1`; maximum=`7` |
| `mealName` | `string` | Sì | — |
| `startTime` | [LocalTime](#schema-localtime) | — | — |
| `translated` | `boolean` | — | nullable=`true` |

</details>

<a id="schema-menstrualcyclesummarydto"></a>

<details>
<summary>MenstrualCycleSummaryDTO — 23 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `analysis` | allOf: [MenstrualCycleAnalysisDTO](#schema-menstrualcycleanalysisdto) | — | — |
| `currentPhase` | `integer/int32` | — | — |
| `cycleType` | `string` | — | — |
| `dayInCycle` | `integer/int32` | — | — |
| `daysUntilNextPhase` | `integer/int32` | — | — |
| `deliveryDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `dueDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `educationContentMod` | `integer/int32` | — | — |
| `endDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `feedbackPhrase` | `string` | — | — |
| `fertileWindowStart` | `integer/int32` | — | — |
| `isSkinTempMct` | `boolean` | — | — |
| `lengthOfCurrentPhase` | `integer/int32` | — | — |
| `lengthOfFertileWindow` | `integer/int32` | — | — |
| `lutealPhaseStart` | `integer/int32` | — | — |
| `numberOfWeek` | `integer/int32` | — | — |
| `overlapCycleList` | array di [OverlapCycle](#schema-overlapcycle) | — | — |
| `periodLength` | `integer/int32` | — | — |
| `predictedCycle` | `boolean` | — | — |
| `predictedCycleLength` | `integer/int32` | — | — |
| `predictedOvulationDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `pregnancyCycle` | `boolean` | — | — |
| `startDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |

</details>

<a id="schema-menstrualcycleanalysisdto"></a>

<details>
<summary>MenstrualCycleAnalysisDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `cycleTypeAnalysis` | allOf: [CycleTypeAnalysisDTO](#schema-cycletypeanalysisdto) | — | — |
| `perimenopauseDetected` | `boolean` | — | — |

</details>

<a id="schema-cycletypeanalysisdto"></a>

<details>
<summary>CycleTypeAnalysisDTO — 14 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `cycleLengthDeviationDays` | `integer/int32` | — | — |
| `cycleStartDate` | [ConnectDate](#schema-connectdate) | — | — |
| `cycleType` | `string` | — | — |
| `cycleVariability` | `integer/int32` | — | — |
| `cycleVariabilityClassifier` | `string` | — | — |
| `follicularLengthDeviationDays` | `integer/int32` | — | — |
| `hasAmenorrhea` | `boolean` | — | — |
| `isAtypical` | `boolean` | — | — |
| `lutealLengthDeviationDays` | `integer/int32` | — | — |
| `medianCycleLength` | `integer/int32` | — | — |
| `medianCycleLengthClassifier` | `string` | — | — |
| `periodLengthDeviationDays` | `integer/int32` | — | — |
| `prolongedPeriods` | `integer/int32` | — | — |
| `prolongedPeriodsClassifier` | `string` | — | — |

</details>

<a id="schema-overlapcycle"></a>

<details>
<summary>OverlapCycle — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `periodLength` | `integer/int32` | — | — |
| `startDate` | [ConnectDate](#schema-connectdate) | — | — |

</details>

<a id="schema-detailedmenstrualcycledaydto"></a>

<details>
<summary>DetailedMenstrualCycleDayDTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `dayLog` | allOf: [DailyMenstrualCycleLogDTO](#schema-dailymenstrualcyclelogdto) | — | — |
| `daySummary` | allOf: [MenstrualCycleSummaryDTO](#schema-menstrualcyclesummarydto) | — | — |
| `weightGoals` | allOf: [WeightGoalRangeDTO](#schema-weightgoalrangedto) | — | — |

</details>

<a id="schema-dailymenstrualcyclelogdto"></a>

<details>
<summary>DailyMenstrualCycleLogDTO — 14 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `babyMovements` | array di [BabyMovementDTO](#schema-babymovementdto) | — | — |
| `calendarDate` | [ConnectDate](#schema-connectdate) | — | — |
| `discharge` | array di `string` | — | — |
| `flow` | `string` | — | — |
| `hasBabyMovement` | `boolean` | — | — |
| `hasGlucoseLog` | `boolean` | — | — |
| `moods` | array di `string` | — | — |
| `notes` | `string` | — | — |
| `ovulationDay` | `boolean` | — | — |
| `reportTimestamp` | [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `sexDrive` | `string` | — | — |
| `sexualActivity` | `string` | — | — |
| `symptoms` | array di `string` | — | — |
| `userProfilePk` | `integer/int64` | — | — |

</details>

<a id="schema-babymovementdto"></a>

<details>
<summary>BabyMovementDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `count` | `integer/int32` | — | — |
| `duration` | `integer/int32` | — | unità documentata: s |
| `movementType` | `string` | — | — |
| `startTimestamp` | [ConnectTimestamp](#schema-connecttimestamp) | — | — |

</details>

<a id="schema-weightgoalrangedto"></a>

<details>
<summary>WeightGoalRangeDTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `highWeightGoalInGrams` | `number/double` | — | — |
| `lowWeightGoalInGrams` | `number/double` | — | — |
| `weekNum` | `integer/int32` | — | — |

</details>

<a id="schema-dailysleepdto"></a>

<details>
<summary>DailySleepDTO — 47 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `id` | `integer/int64` | — | — |
| `userProfilePK` | `integer/int64` | — | — |
| `calendarDate` | `string` | — | — |
| `sleepTimeSeconds` | `integer/int32` | — | unità documentata: s |
| `napTimeSeconds` | `integer/int32` | — | unità documentata: s |
| `sleepWindowConfirmed` | `boolean` | — | — |
| `sleepWindowConfirmationType` | `string` | — | — |
| `sleepStartTimestampGMT` | `string/date-time` | — | — |
| `sleepEndTimestampGMT` | `string/date-time` | — | — |
| `sleepStartTimestampLocal` | `string/date-time` | — | — |
| `sleepEndTimestampLocal` | `string/date-time` | — | — |
| `autoSleepStartTimestampGMT` | `string/date-time` | — | — |
| `autoSleepEndTimestampGMT` | `string/date-time` | — | — |
| `sleepQualityTypePK` | `string` | — | — |
| `sleepResultTypePK` | `string` | — | — |
| `unmeasurableSleepSeconds` | `integer/int32` | — | unità documentata: s |
| `deepSleepSeconds` | `integer/int32` | — | unità documentata: s |
| `lightSleepSeconds` | `integer/int32` | — | unità documentata: s |
| `remSleepSeconds` | `integer/int32` | — | unità documentata: s |
| `awakeSleepSeconds` | `integer/int32` | — | unità documentata: s |
| `deviceRemCapable` | `boolean` | — | — |
| `sleepFromDevice` | `boolean` | — | — |
| `averageSpO2Value` | `number/double` | — | — |
| `lowestSpO2Value` | `integer/int32` | — | — |
| `highestSpO2Value` | `integer/int32` | — | — |
| `numberOfEventsBelowThreshold` | `integer/int32` | — | — |
| `averageSpO2HRSleep` | `number/double` | — | — |
| `spo2Threshold` | `integer/int32` | — | — |
| `averageRespirationValue` | `number/double` | — | — |
| `lowestRespirationValue` | `number/float` | — | — |
| `highestRespirationValue` | `number/float` | — | — |
| `awakeCount` | `integer/int32` | — | — |
| `avgSleepStress` | `number/double` | — | — |
| `ageGroup` | `string` | — | enum=`["TEEN","YOUNG_ADULT","ADULT","SENIOR","UNDEFINED"]` |
| `avgHeartRate` | `number/double` | — | — |
| `sleepScoreFeedback` | `string` | — | enum=`["NONE","POSITIVE_HIGHLY_RECOVERING","POSITIVE_OPTIMAL_STRUCTURE","POSITIVE_LONG_AND_RECOVERING","POSITIVE_LONG_AND_DEEP","POSITIVE_LONG_AND_REFRESHING","POSITIVE_LONG_AND_CONTINUOUS","POSITIVE_LONG_AND_CALM","POSITIVE_RECOVERING","POSITIVE_DEEP","POSITIVE_REFRESHING","POSITIVE_CONTINUOUS","POSITIVE_CALM","POSITIVE_SHORT_BUT_RECOVERING","POSITIVE_SHORT_BUT_DEEP","POSITIVE_SHORT_BUT_REFRESHING","POSITIVE_SHORT_BUT_CONTINUOUS","POSITIVE_SHORT_BUT_CALM","NEGATIVE_LONG_BUT_NOT_RESTORATIVE","NEGATIVE_LONG_BUT_LIGHT","NEGATIVE_LONG_BUT_NOT_REFRESHING","NEGATIVE_LONG_BUT_DISCONTINUOUS","NEGATIVE_LONG_BUT_RESTLESS","NEGATIVE_LONG_BUT_POOR_QUALITY","NEGATIVE_NOT_RESTORATIVE","NEGATIVE_LIGHT","NEGATIVE_NOT_REFRESHING","NEGATIVE_DISCONTINUOUS","NEGATIVE_RESTLESS","NEGATIVE_POOR_STRUCTURE","NEGATIVE_SHORT_AND_NONRECOVERING","NEGATIVE_SHORT_AND_POOR_STRUCTURE","NEGATIVE_SHORT_AND_POOR_QUALITY","NEGATIVE_LONG_BUT_NOT_ENOUGH_REM","NEGATIVE_LONG_BUT_TOO_MUCH_REM","NEGATIVE_NOT_ENOUGH_REM","NEGATIVE_TOO_MUCH_REM","INVALID"]` |
| `sleepScoreInsight` | `string` | — | enum=`["NONE","POSITIVE_ACCLIMATIZATION_IN_PROGRESS","POSITIVE_STRESSFUL_DAY","POSITIVE_RESTFUL_DAY","POSITIVE_RESTFUL_EVENING","POSITIVE_EXERCISE","POSITIVE_DAILY_ACTIVITY","POSITIVE_LATE_BED_TIME","NEGATIVE_ACCLIMATIZATION_IN_PROGRESS","NEGATIVE_VERY_STRENUOUS_EXERCISE","NEGATIVE_LATE_STRENUOUS_EXERCISE","NEGATIVE_STRENUOUS_EXERCISE","NEGATIVE_LATE_EXERCISE","NEGATIVE_HIGHLY_STRESSFUL_DAY","NEGATIVE_STRESSFUL_DAY","NEGATIVE_INACTIVE_DAY","NEGATIVE_LATE_BED_TIME","INVALID"]` |
| `sleepScorePersonalizedInsight` | `string` | — | enum=`["NOT_AVAILABLE","EVENT_DAY_POS_EXCELLENT_SLEEP","EVENT_DAY_POS_GOOD_SLEEP","EVENT_DAY_POS_FAIR_SLEEP_GOOD_DURATION","EVENT_DAY_POS_FAIR_SLEEP_NOTGOOD_DURATION","EVENT_DAY_POS_POOR_SLEEP","EVENT_DAY_NEG_GOOD_SLEEP","EVENT_DAY_NEG_FAIR_SLEEP_GOOD_DURATION","EVENT_DAY_NEG_FAIR_SLEEP_NOTGOOD_DURATION","EVENT_DAY_NEG_POOR_SLEEP","AFTER_EVENT_DAY_POS_EXCELLENT_OR_GOOD_SLEEP","AFTER_EVENT_DAY_POS_FAIR_SLEEP_GOOD_DURATION","AFTER_EVENT_DAY_POS_FAIR_SLEEP_NOTGOOD_DURATION","AFTER_EVENT_DAY_POS_POOR_SLEEP","AFTER_EVENT_DAY_NEG_GOOD_SLEEP","AFTER_EVENT_DAY_NEG_FAIR_SLEEP_GOOD_DURATION","AFTER_EVENT_DAY_NEG_FAIR_SLEEP_NOTGOOD_DURATION","AFTER_EVENT_DAY_NEG_POOR_SLEEP","HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_STRENUOUS_CLOSE_BED","HARD_EXERCISE_POS_FAIR_SLEEP_HARD_TO_STRENUOUS_CLOSE_BED","HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_STRENUOUS_DURING_DAY","HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_HARD_TO_STRENUOUS_DURING_DAY_OUTDOOR","HARD_EXERCISE_POS_FAIR_SLEEP_HARD_TO_STRENUOUS_DURING_DAY_OUTDOOR","HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_HARD_CLOSE_BED","HARD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_HARD_DURING_DAY","HARD_EXERCISE_POS_FAIR_SLEEP_HARD_TO_STRENUOUS_DURING_DAY","HARD_EXERCISE_NEG_FAIR_OR_POOR_SLEEP_STRENUOUS","HARD_EXERCISE_NEG_FAIR_OR_POOR_SLEEP_HARD_CLOSE_BED","HARD_EXERCISE_NEG_FAIR_OR_POOR_SLEEP_HARD_DURING_DAY","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_RELAX_CLOSE_BED","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_ACTIVE_DAY","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_VIGOROUS_DURING_DAY_OUTDOOR","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_MODERATE_DURING_DAY_OUTDOOR","MOD_EXERCISE_POS_FAIR_SLEEP_MOD_TO_VIG_DURING_DAY_OUTDOOR","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_VIGOROUS_CLOSE_BED","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_MODERATE_CLOSE_BED","MOD_EXERCISE_POS_FAIR_SLEEP_MOD_TO_VIG_CLOSE_BED","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_VIGOROUS_DURING_DAY","MOD_EXERCISE_POS_EXCELLENT_OR_GOOD_SLEEP_MODERATE_DURING_DAY","MOD_EXERCISE_POS_FAIR_SLEEP_MOD_TO_VIG_DURING_DAY","MOD_EXERCISE_NEG_FAIR_SLEEP_VIGOROUS_CLOSE_BED","MOD_EXERCISE_NEG_POOR_SLEEP_VIGOROUS_CLOSE_BED","MOD_EXERCISE_NEG_FAIR_SLEEP_MODERATE_CLOSE_BED","MOD_EXERCISE_NEG_POOR_SLEEP_MODERATE_CLOSE_BED","MOD_EXERCISE_NEG_FAIR_OR_POOR_SLEEP_INACTIVITY","GENERAL_POS_EXCELLENT_OR_GOOD_SLEEP","GENERAL_POS_FAIR_OR_POOR_SLEEP","GENERAL_NEG_EXCELLENT_OR_GOOD_SLEEP","GENERAL_NEG_FAIR_OR_POOR_SLEEP","ALTITUDE_POS_EXCELLENT_OR_GOOD_SLEEP","ALTITUDE_POS_FAIR_SLEEP","ALTITUDE_NEG_GOOD_OR_FAIR_SLEEP","ALTITUDE_NEG_FAIR_SLEEP","ALTITUDE_NEG_POOR_SLEEP","JET_LAG_POS_EXCELLENT_SLEEP","JET_LAG_POS_GOOD_SLEEP","JET_LAG_NEG_GOOD_SLEEP_POOR_RECOVERY","JET_LAG_NEG_GOOD_SLEEP_UNBALANCED","JET_LAG_NEG_GOOD_SLEEP_RESTLESS_OR_INTERRUPTED","JET_LAG_POS_FAIR_SLEEP_GOOD_DURATION","JET_LAG_POS_FAIR_OR_POOR_SLEEP_NOTGOOD_DURATION","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_GOOD_DURATION_POOR_RECOVERY","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_GOOD_DURATION_UNBALANCED","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_GOOD_DURATION_RESTLESS_OR_INTERRUPTED","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_GOOD_DURATION_POOR_QUALITY","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_NOTGOOD_DURATION_POOR_RECOVERY","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_NOTGOOD_DURATION_UNBALANCED","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_NOTGOOD_DURATION_RESTLESS_OR_INTERRUPTED","JET_LAG_NEG_FAIR_OR_POOR_SLEEP_NOTGOOD_DURATION_POOR_QUALITY","NAPPING_NEG_GOOD_SLEEP_GOOD_DURATION_INTERRUPTED","NAPPING_NEG_GOOD_SLEEP_GOOD_DURATION_RESTLESS","NAPPING_NEG_FAIR_SLEEP_GOOD_DURATION_UNBALANCED","NAPPING_NEG_FAIR_SLEEP_GOOD_DURATION_INTERRUPTED","NAPPING_NEG_FAIR_SLEEP_GOOD_DURATION_RESTLESS","NAPPING_NEG_FAIR_SLEEP_GOOD_DURATION_POOR_QUALITY","NAPPING_NEG_FAIR_SLEEP_NOTGOOD_DURATION_UNBALANCED","NAPPING_NEG_FAIR_SLEEP_NOTGOOD_DURATION_INTERRUPTED","NAPPING_NEG_FAIR_SLEEP_NOTGOOD_DURATION_RESTLESS","NAPPING_NEG_FAIR_SLEEP_NOTGOOD_DURATION_POOR_QUALITY","NAPPING_POS_POOR_SLEEP_NOTGOOD_DURATION","NAPPING_NEG_POOR_SLEEP_UNBALANCED","NAPPING_NEG_POOR_SLEEP_DISTURBED","NAPPING_NEG_POOR_SLEEP_POOR_QUALITY","PREGNANCY_1TRIM_POS_GOOD_OR_WORSE_SLEEP_GOOD_DURATION","PREGNANCY_1TRIM_NEG_GOOD_OR_WORSE_SLEEP_POOR_RECOVERY","PREGNANCY_1TRIM_NEG_GOOD_OR_WORSE_SLEEP_LOW_DEEP","PREGNANCY_1TRIM_NEG_GOOD_OR_WORSE_SLEEP_INTERRUPTED","PREGNANCY_1TRIM_NEG_GOOD_OR_WORSE_SLEEP_RESTLESS","PREGNANCY_1TRIM_NEG_GOOD_OR_WORSE_SLEEP_GOOD_DURATION_POOR_QUALITY","PREGNANCY_1TRIM_NEG_GOOD_OR_WORSE_SLEEP_NOTGOOD_DURATION_POOR_QUALITY","PREGNANCY_2TRIM_POS_GOOD_OR_WORSE_SLEEP_GOOD_DURATION","PREGNANCY_2TRIM_NEG_GOOD_OR_WORSE_SLEEP_POOR_RECOVERY","PREGNANCY_2TRIM_NEG_GOOD_OR_WORSE_SLEEP_LOW_DEEP","PREGNANCY_2TRIM_NEG_GOOD_OR_WORSE_SLEEP_LOW_REM","PREGNANCY_2TRIM_NEG_GOOD_OR_WORSE_SLEEP_INTERRUPTED","PREGNANCY_2TRIM_NEG_GOOD_OR_WORSE_SLEEP_RESTLESS","PREGNANCY_2TRIM_NEG_GOOD_OR_WORSE_SLEEP_GOOD_DURATION_POOR_QUALITY","PREGNANCY_2TRIM_NEG_GOOD_OR_WORSE_SLEEP_NOTGOOD_DURATION_POOR_QUALITY","PREGNANCY_3TRIM_POS_GOOD_OR_WORSE_SLEEP_GOOD_DURATION","PREGNANCY_3TRIM_NEG_GOOD_OR_WORSE_SLEEP_POOR_RECOVERY","PREGNANCY_3TRIM_NEG_GOOD_OR_WORSE_SLEEP_LOW_DEEP","PREGNANCY_3TRIM_NEG_GOOD_OR_WORSE_SLEEP_LOW_REM","PREGNANCY_3TRIM_NEG_GOOD_OR_WORSE_SLEEP_INTERRUPTED","PREGNANCY_3TRIM_NEG_GOOD_OR_WORSE_SLEEP_RESTLESS","PREGNANCY_3TRIM_NEG_GOOD_OR_WORSE_SLEEP_GOOD_DURATION_POOR_QUALITY","PREGNANCY_3TRIM_NEG_GOOD_OR_WORSE_SLEEP_NOTGOOD_DURATION_POOR_QUALITY","PREGNANCY_POSTP_POS_EXCELLENT_OR_WORSE_SLEEP_GOOD_RECOVERY","PREGNANCY_POSTP_POS_GOOD_OR_WORSE_SLEEP_HIGH_DEEP","PREGNANCY_POSTP_POS_GOOD_OR_WORSE_SLEEP_HIGH_REM","PREGNANCY_POSTP_NEG_GOOD_OR_WORSE_SLEEP_POOR_RECOVERY","PREGNANCY_POSTP_NEG_GOOD_OR_WORSE_SLEEP_HIGH_INTERRUPTED","PREGNANCY_POSTP_NEG_GOOD_OR_WORSE_SLEEP_GOOD_DURATION_POOR_QUALITY","PREGNANCY_POSTP_NEG_GOOD_OR_WORSE_SLEEP_NOTGOOD_DURATION_POOR_QUALITY","RHYTHM_POS_EXCELLENT_SLEEP_EXCELLENT_TIMING","RHYTHM_POS_EXCELLENT_SLEEP_GOOD_TIMING","RHYTHM_POS_GOOD_SLEEP_EXCELLENT_TIMING","RHYTHM_POS_GOOD_SLEEP_GOOD_TIMING","RHYTHM_POS_FAIR_OR_POOR_SLEEP_EXCELLENT_TIMING","RHYTHM_POS_FAIR_OR_POOR_SLEEP_GOOD_TIMING","RHYTHM_NEG_GOOD_SLEEP_REALLY_LATE_TIMING","RHYTHM_NEG_FAIR_SLEEP_REALLY_LATE_TIMING","RHYTHM_NEG_FAIR_SLEEP_LATE_TIMING","RHYTHM_NEG_POOR_SLEEP_REALLY_LATE_TIMING","RHYTHM_NEG_POOR_SLEEP_LATE_TIMING","STRESS_POS_EXCELLENT_OR_GOOD_SLEEP_VERY_RESTFUL_DAY","STRESS_POS_EXCELLENT_OR_GOOD_SLEEP_RESTFUL_DAY","STRESS_POS_FAIR_OR_POOR_SLEEP_RESTFUL_DAY","STRESS_POS_EXCELLENT_OR_GOOD_SLEEP_RESTFUL_EVENING","STRESS_POS_FAIR_OR_POOR_SLEEP_RESTFUL_EVENING","STRESS_POS_EXCELLENT_OR_GOOD_SLEEP_VERY_STRESSFUL_DAY","STRESS_NEG_GOOD_OR_FAIR_SLEEP_VERY_STRESSFUL_DAY","STRESS_NEG_POOR_SLEEP_VERY_STRESSFUL_DAY","STRESS_NEG_FAIR_OR_POOR_SLEEP_STRESSFUL_DAY_POOR_HISTORY","STRESS_NEG_FAIR_OR_POOR_SLEEP_STRESSFUL_DAY_INACTIVE","STRESS_NEG_GOOD_OR_WORSE_SLEEP_STRESSFUL_DAY","STRESS_NEG_GOOD_OR_FAIR_SLEEP_STRESSFUL_EVENING","STRESS_NEG_POOR_SLEEP_STRESSFUL_EVENING","INVALID"]` |
| `sleepScores` | mappa string → [SleepScoreItem](#schema-sleepscoreitem) | — | — |
| `userNote` | `string` | — | — |
| `kidSleepNote` | `string` | — | — |
| `sleepVersion` | `integer/int32` | — | — |
| `sleepNeed` | allOf: [SleepNeedDTO](#schema-sleepneeddto) | — | — |
| `nextSleepNeed` | allOf: [SleepNeedDTO](#schema-sleepneeddto) | — | — |
| `dailyNapDTOS` | array di [DailyNapDTO](#schema-dailynapdto) | — | — |
| `breathingDisruptionSeverity` | `string` | — | — |
| `sleepAlignment` | allOf: [SleepAlignmentDto](#schema-sleepalignmentdto) | — | — |

</details>

<a id="schema-sleepscoreitem"></a>

<details>
<summary>SleepScoreItem — 6 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `value` | `integer/int32` | — | — |
| `qualifierKey` | `string` | — | — |
| `optimalStart` | `number/double` | — | — |
| `optimalEnd` | `number/double` | — | — |
| `idealStartInSeconds` | `number/double` | — | unità documentata: s |
| `idealEndInSeconds` | `number/double` | — | unità documentata: s |

</details>

<a id="schema-sleepneeddto"></a>

<details>
<summary>SleepNeedDTO — 15 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfilePk` | `integer/int64` | — | — |
| `calendarDate` | `string/date` | — | — |
| `deviceId` | `integer/int64` | — | — |
| `timestampGmt` | `string/date-time` | — | — |
| `baseline` | `integer/int32` | — | — |
| `actual` | `integer/int32` | — | — |
| `feedback` | `string` | — | — |
| `trainingFeedback` | `string` | — | — |
| `sleepHistoryAdjustment` | `string` | — | — |
| `hrvAdjustment` | `string` | — | — |
| `napAdjustment` | `string` | — | — |
| `displayedForTheDay` | `boolean` | — | — |
| `recommendedBedtimeStartMins` | `integer/int32` | — | unità documentata: minuti dalla mezzanotte |
| `recommendedBedtimeEndMins` | `integer/int32` | — | unità documentata: minuti dalla mezzanotte |
| `preferredActivityTracker` | `boolean` | — | — |

</details>

<a id="schema-dailynapdto"></a>

<details>
<summary>DailyNapDTO — 12 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfilePK` | `integer/int64` | — | — |
| `deviceId` | `integer/int64` | — | — |
| `calendarDate` | `string/date` | — | — |
| `napTimeSec` | `integer/int32` | — | — |
| `napStartTimestampGMT` | `string/date-time` | — | — |
| `napEndTimestampGMT` | `string/date-time` | — | — |
| `napFeedback` | `string` | — | — |
| `napSource` | `integer/int32` | — | — |
| `napStartTimeOffset` | `integer/int32` | — | unità documentata: min |
| `napEndTimeOffset` | `integer/int32` | — | unità documentata: min |
| `createTimestampGMT` | `string/date-time` | — | — |
| `updateTimestampGMT` | `string/date-time` | — | — |

</details>

<a id="schema-sleepalignmentdto"></a>

<details>
<summary>SleepAlignmentDto — 10 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userId` | `integer/int64` | — | — |
| `calendarDate` | `string/date` | — | — |
| `deviceId` | `integer/int64` | — | — |
| `isPreferredActivityTracker` | `boolean` | — | — |
| `sleepNeedBaselineMins` | `integer/int32` | — | unità documentata: min |
| `optimalSleepWindowStartMins` | `integer/int32` | — | unità documentata: minuti dalla mezzanotte |
| `optimalSleepWindowEndMins` | `integer/int32` | — | unità documentata: minuti dalla mezzanotte |
| `status` | `string` | — | — |
| `optimalSleepWindowMidpointMins` | `integer/int32` | — | unità documentata: minuti dalla mezzanotte |
| `lastSleepMidpointMins` | `integer/int32` | — | unità documentata: minuti dalla mezzanotte |

</details>

<a id="schema-usersettingsdto"></a>

<details>
<summary>UserSettingsDTO — 19 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `displayName` | `string` | — | — |
| `preferredLocale` | `string` | — | — |
| `measurementSystem` | `string` | — | — |
| `firstDayOfWeek` | allOf: [DayOfWeekDTO](#schema-dayofweekdto) | — | — |
| `numberFormat` | `string` | — | — |
| `timeFormat` | allOf: [UnitFormatDTO](#schema-unitformatdto) | — | — |
| `dateFormat` | allOf: [UnitFormatDTO](#schema-unitformatdto) | — | — |
| `powerFormat` | allOf: [UnitFormatDTO](#schema-unitformatdto) | — | — |
| `heartRateFormat` | allOf: [UnitFormatDTO](#schema-unitformatdto) | — | — |
| `timeZone` | `string` | — | — |
| `hydrationMeasurementUnit` | `string` | — | — |
| `hydrationContainers` | array di [HydrationContainer](#schema-hydrationcontainer) | — | — |
| `glucoseMeasurementUnit` | `string` | — | — |
| `golfDistanceUnit` | `string` | — | — |
| `golfElevationUnit` | `string` | — | — |
| `golfSpeedUnit` | `string` | — | — |
| `wheelchairModeEnabled` | `boolean` | — | — |
| `availableTrainingDays` | array di `string` | — | uniqueItems=`true`; items: enum=`["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]` |
| `preferredLongTrainingDays` | array di `string` | — | uniqueItems=`true`; items: enum=`["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]` |

</details>

<a id="schema-dayofweekdto"></a>

<details>
<summary>DayOfWeekDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `dayId` | `integer/int32` | — | — |
| `dayName` | `string` | — | — |
| `sortOrder` | `integer/int32` | — | — |
| `isPossibleFirstDay` | `boolean` | — | — |

</details>

<a id="schema-unitformatdto"></a>

<details>
<summary>UnitFormatDTO — 6 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `formatId` | `integer/int64` | — | — |
| `formatKey` | `string` | — | — |
| `minFraction` | `integer/int32` | — | — |
| `maxFraction` | `integer/int32` | — | — |
| `groupingUsed` | `boolean` | — | — |
| `displayFormat` | `string` | — | — |

</details>

<a id="schema-hydrationcontainer"></a>

<details>
<summary>HydrationContainer — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `name` | `string` | — | — |
| `volume` | `integer/int32` | — | — |
| `unit` | `string` | — | — |

</details>

<a id="schema-userdailyhydrationdto"></a>

<details>
<summary>UserDailyHydrationDTO — 7 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userId` | `integer/int64` | — | — |
| `calendarDate` | `string/date` | — | — |
| `valueInML` | `number/double` | — | unità documentata: ml |
| `goalInML` | `number/double` | — | unità documentata: ml |
| `lastEntryTimestampLocal` | `string/date-time` | — | — |
| `sweatLossInML` | `number/double` | — | unità documentata: ml |
| `activityIntakeInML` | `number/double` | — | unità documentata: ml |

</details>

<a id="schema-stepsdailystatdto"></a>

<details>
<summary>StepsDailyStatDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `calendarDate` | `string/date` | — | — |
| `totalSteps` | `integer/int32` | — | — |
| `totalDistance` | `integer/int32` | — | unità documentata: m |
| `stepGoal` | `integer/int32` | — | — |

</details>

<a id="schema-multivaluewellnesschartitemdto"></a>

<details>
<summary>MultiValueWellnessChartItemDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `calendarDate` | `string/date` | — | — |
| `values` | mappa string → `number` | — | — |

</details>

<a id="schema-userdailysummarydto"></a>

<details>
<summary>UserDailySummaryDto — 95 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfileId` | `integer/int64` | — | — |
| `displayName` | `string` | — | — |
| `totalKilocalories` | `number/double` | — | — |
| `activeKilocalories` | `number/double` | — | — |
| `bmrKilocalories` | `number/double` | — | — |
| `consumedKilocalories` | `number/double` | — | — |
| `remainingKilocalories` | `number/double` | — | — |
| `totalSteps` | `integer/int32` | — | — |
| `netCalorieGoal` | `integer/int32` | — | — |
| `totalDistanceMeters` | `integer/int32` | — | unità documentata: m |
| `wellnessDistanceMeters` | `integer/int32` | — | unità documentata: m |
| `userDailySummaryId` | `integer/int64` | — | — |
| `calendarDate` | `string/date` | — | — |
| `uuid` | `string` | — | — |
| `dailyStepGoal` | `integer/int32` | — | — |
| `dailyPushesGoal` | `integer/int32` | — | — |
| `totalPushDistance` | `integer/int32` | — | unità documentata: m |
| `totalPushes` | `integer/int32` | — | — |
| `wellnessStartTimeGmt` | `string/date-time` | — | — |
| `wellnessStartTimeLocal` | `string/date-time` | — | — |
| `wellnessEndTimeGmt` | `string/date-time` | — | — |
| `wellnessEndTimeLocal` | `string/date-time` | — | — |
| `durationInMilliseconds` | `integer/int64` | — | unità documentata: ms |
| `wellnessDescription` | `string` | — | — |
| `highlyActiveSeconds` | `integer/int32` | — | — |
| `activeSeconds` | `integer/int32` | — | — |
| `sedentarySeconds` | `integer/int32` | — | — |
| `sleepingSeconds` | `integer/int32` | — | — |
| `includesWellnessData` | `boolean` | — | — |
| `includesActivityData` | `boolean` | — | — |
| `includesCalorieConsumedData` | `boolean` | — | — |
| `moderateIntensityMinutes` | `integer/int32` | — | — |
| `vigorousIntensityMinutes` | `integer/int32` | — | — |
| `floorsAscendedInMeters` | `number/double` | — | unità documentata: m |
| `floorsDescendedInMeters` | `number/double` | — | unità documentata: m |
| `floorsAscended` | `number/double` | — | — |
| `floorsDescended` | `number/double` | — | — |
| `intensityMinutesGoal` | `integer/int32` | — | — |
| `userFloorsAscendedGoal` | `integer/int32` | — | — |
| `minHeartRate` | `integer/int32` | — | — |
| `maxHeartRate` | `integer/int32` | — | — |
| `restingHeartRate` | `integer/int32` | — | — |
| `lastSevenDaysAvgRestingHeartRate` | `integer/int32` | — | — |
| `source` | `string` | — | enum=`["GARMIN","FITBIT"]` |
| `averageStressLevel` | `integer/int32` | — | — |
| `maxStressLevel` | `integer/int32` | — | — |
| `stressDuration` | `integer/int32` | — | unità documentata: s |
| `restStressDuration` | `integer/int32` | — | unità documentata: s |
| `activityStressDuration` | `integer/int32` | — | unità documentata: s |
| `uncategorizedStressDuration` | `integer/int32` | — | unità documentata: s |
| `totalStressDuration` | `integer/int32` | — | unità documentata: s |
| `lowStressDuration` | `integer/int32` | — | unità documentata: s |
| `mediumStressDuration` | `integer/int32` | — | unità documentata: s |
| `highStressDuration` | `integer/int32` | — | unità documentata: s |
| `stressPercentage` | `number/double` | — | — |
| `restStressPercentage` | `number/double` | — | — |
| `activityStressPercentage` | `number/double` | — | — |
| `uncategorizedStressPercentage` | `number/double` | — | — |
| `lowStressPercentage` | `number/double` | — | — |
| `mediumStressPercentage` | `number/double` | — | — |
| `highStressPercentage` | `number/double` | — | — |
| `stressQualifier` | `string` | — | enum=`["CALM","BALANCED","STRESSFUL","VERY_STRESSFUL","CALM_AWAKE","BALANCED_AWAKE","STRESSFUL_AWAKE","VERY_STRESSFUL_AWAKE","UNKNOWN"]` |
| `measurableAwakeDuration` | `integer/int32` | — | unità documentata: s |
| `measurableAsleepDuration` | `integer/int32` | — | unità documentata: s |
| `lastSyncTimestampGMT` | `string/date-time` | — | — |
| `minAvgHeartRate` | `integer/int32` | — | — |
| `maxAvgHeartRate` | `integer/int32` | — | — |
| `bodyBatteryChargedValue` | `integer/int32` | — | — |
| `bodyBatteryDrainedValue` | `integer/int32` | — | — |
| `bodyBatteryHighestValue` | `integer/int32` | — | — |
| `bodyBatteryLowestValue` | `integer/int32` | — | — |
| `bodyBatteryMostRecentValue` | `integer/int32` | — | — |
| `bodyBatteryDuringSleep` | `integer/int32` | — | — |
| `bodyBatteryAtWakeTime` | `integer/int32` | — | — |
| `bodyBatteryVersion` | `number/double` | — | — |
| `abnormalHeartRateAlertsCount` | `integer/int32` | — | — |
| `averageSpo2` | `number/double` | — | — |
| `lowestSpo2` | `integer/int32` | — | — |
| `latestSpo2` | `integer/int32` | — | — |
| `latestSpo2ReadingTimeGmt` | `string/date-time` | — | — |
| `latestSpo2ReadingTimeLocal` | `string/date-time` | — | — |
| `averageMonitoringEnvironmentAltitude` | `number/double` | — | — |
| `bodyBatteryDynamicFeedbackEvent` | allOf: [BodyBatteryDynamicFeedbackEventDTO](#schema-bodybatterydynamicfeedbackeventdto) | — | — |
| `endOfDayBodyBatteryDynamicFeedbackEvent` | allOf: [BodyBatteryDynamicFeedbackEventDTO](#schema-bodybatterydynamicfeedbackeventdto) | — | — |
| `bodyBatteryActivityEventList` | array di [BodyBatteryActivityEventDTO](#schema-bodybatteryactivityeventdto) | — | — |
| `isJetLagDay` | `boolean` | — | — |
| `jetLagTripName` | `string` | — | — |
| `hydrationValueInML` | `number/double` | — | unità documentata: ml |
| `hydrationGoalInML` | `number/double` | — | unità documentata: ml |
| `avgWakingRespirationValue` | `number/double` | — | — |
| `highestRespirationValue` | `number/double` | — | — |
| `lowestRespirationValue` | `number/double` | — | — |
| `latestRespirationValue` | `number/double` | — | — |
| `latestRespirationTimeGMT` | `string/date-time` | — | — |
| `respirationAlgorithmVersion` | `integer/int32` | — | — |

</details>

<a id="schema-bodybatterydynamicfeedbackeventdto"></a>

<details>
<summary>BodyBatteryDynamicFeedbackEventDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `eventTimestampGmt` | `string/date-time` | — | — |
| `bodyBatteryLevel` | `string` | — | — |
| `feedbackShortType` | `string` | — | — |
| `feedbackLongType` | `string` | — | — |

</details>

<a id="schema-bodybatteryactivityeventdto"></a>

<details>
<summary>BodyBatteryActivityEventDTO — 7 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `eventType` | `string` | — | — |
| `eventStartTimeGmt` | `string/date-time` | — | — |
| `timezoneOffset` | `integer/int32` | — | — |
| `durationInMilliseconds` | `integer/int64` | — | — |
| `bodyBatteryImpact` | `integer/int32` | — | — |
| `feedbackType` | `string` | — | — |
| `shortFeedback` | `string` | — | — |

</details>

<a id="schema-apidocumentlistuserdailysummaryv2dto"></a>

<details>
<summary>ApiDocumentListUserDailySummaryV2DTO — 1 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `data` | array di [UserDailySummaryV2DTO](#schema-userdailysummaryv2dto) | — | — |

</details>

<a id="schema-userdailysummaryv2dto"></a>

<details>
<summary>UserDailySummaryV2DTO — 17 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `uuid` | `string/uuid` | — | — |
| `userProfilePk` | `integer/int64` | — | — |
| `calendarDate` | `string/date` | — | — |
| `source` | `string` | — | enum=`["garmin","fitbit"]` |
| `includesWellnessData` | `boolean` | — | — |
| `includesActivityData` | `boolean` | — | — |
| `wellnessChronology` | [WellnessChronologyV2DTO](#schema-wellnesschronologyv2dto) | — | — |
| `movement` | [MovementV2DTO](#schema-movementv2dto) | — | — |
| `calories` | [CaloriesV2DTO](#schema-caloriesv2dto) | — | — |
| `heartRate` | [HeartRateV2DTO](#schema-heartratev2dto) | — | — |
| `intensityMinutes` | [IntensityMinutesV2DTO](#schema-intensityminutesv2dto) | — | — |
| `stress` | [StressV2DTO](#schema-stressv2dto) | — | — |
| `bodyBattery` | [BodyBatteryV2DTO](#schema-bodybatteryv2dto) | — | — |
| `hydration` | [HydrationV2DTO](#schema-hydrationv2dto) | — | — |
| `respiration` | [RespirationV2DTO](#schema-respirationv2dto) | — | — |
| `pulseOx` | [PulseOxV2DTO](#schema-pulseoxv2dto) | — | — |
| `jetLag` | [JetLagV2DTO](#schema-jetlagv2dto) | — | — |

</details>

<a id="schema-wellnesschronologyv2dto"></a>

<details>
<summary>WellnessChronologyV2DTO — 5 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `startTimestampGmt` | `string/date-time` | — | — |
| `startTimestampLocal` | `string/date-time` | — | — |
| `endTimestampGmt` | `string/date-time` | — | — |
| `endTimestampLocal` | `string/date-time` | — | — |
| `totalDurationInMillis` | `integer/int32` | — | — |

</details>

<a id="schema-movementv2dto"></a>

<details>
<summary>MovementV2DTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `steps` | [MovementValueV2DTO](#schema-movementvaluev2dto) | — | — |
| `pushes` | [MovementValueV2DTO](#schema-movementvaluev2dto) | — | — |
| `floorsAscended` | [MovementValueV2DTO](#schema-movementvaluev2dto) | — | — |
| `floorsDescended` | [MovementValueV2DTO](#schema-movementvaluev2dto) | — | — |

</details>

<a id="schema-movementvaluev2dto"></a>

<details>
<summary>MovementValueV2DTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `goal` | `integer/int32` | — | — |
| `value` | `integer/int32` | — | — |
| `distanceInMeters` | `number/double` | — | unità documentata: m |

</details>

<a id="schema-caloriesv2dto"></a>

<details>
<summary>CaloriesV2DTO — 6 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `burnedResting` | `integer/int32` | — | — |
| `burnedActive` | `integer/int32` | — | — |
| `burnedTotal` | `integer/int32` | — | — |
| `consumedGoal` | `integer/int32` | — | — |
| `consumedValue` | `integer/int32` | — | — |
| `consumedRemaining` | `integer/int32` | — | — |

</details>

<a id="schema-heartratev2dto"></a>

<details>
<summary>HeartRateV2DTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `minValue` | `integer/int32` | — | — |
| `maxValue` | `integer/int32` | — | — |
| `restingValue` | `integer/int32` | — | — |
| `alertCount` | `integer/int32` | — | — |

</details>

<a id="schema-intensityminutesv2dto"></a>

<details>
<summary>IntensityMinutesV2DTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `goal` | `integer/int32` | — | — |
| `moderate` | `integer/int32` | — | — |
| `vigorous` | `integer/int32` | — | — |

</details>

<a id="schema-stressv2dto"></a>

<details>
<summary>StressV2DTO — 16 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `avgLevel` | `integer/int32` | — | — |
| `maxLevel` | `integer/int32` | — | — |
| `restProportion` | `number/double` | — | — |
| `activityProportion` | `number/double` | — | — |
| `uncategorizedProportion` | `number/double` | — | — |
| `lowStressProportion` | `number/double` | — | — |
| `mediumStressProportion` | `number/double` | — | — |
| `highStressProportion` | `number/double` | — | — |
| `qualifier` | `string` | — | enum=`["calm","balanced","stressful","very_stressful","calm_awake","balanced_awake","stressful_awake","very_stressful_awake","unknown"]` |
| `totalDurationInMillis` | `integer/int32` | — | — |
| `restDurationInMillis` | `integer/int32` | — | — |
| `activityDurationInMillis` | `integer/int32` | — | — |
| `uncategorizedDurationInMillis` | `integer/int32` | — | — |
| `lowStressDurationInMillis` | `integer/int32` | — | — |
| `mediumStressDurationInMillis` | `integer/int32` | — | — |
| `highStressDurationInMillis` | `integer/int32` | — | — |

</details>

<a id="schema-bodybatteryv2dto"></a>

<details>
<summary>BodyBatteryV2DTO — 10 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `minValue` | `integer/int32` | — | minimum=`5`; maximum=`100` |
| `maxValue` | `integer/int32` | — | minimum=`5`; maximum=`100` |
| `chargedValue` | `integer/int32` | — | minimum=`5`; maximum=`100` |
| `drainedValue` | `integer/int32` | — | minimum=`5`; maximum=`100` |
| `latestValue` | `integer/int32` | — | minimum=`5`; maximum=`100` |
| `endOfDayValue` | `integer/int32` | — | minimum=`5`; maximum=`100` |
| `featureVersion` | `string` | — | — |
| `dynamicFeedbackEvent` | [BodyBatteryDynamicFeedbackEventDTO](#schema-bodybatterydynamicfeedbackeventdto) | — | — |
| `endOfDayDynamicFeedbackEvent` | [BodyBatteryDynamicFeedbackEventDTO](#schema-bodybatterydynamicfeedbackeventdto) | — | — |
| `activityEvents` | array di [BodyBatteryActivityEventV2DTO](#schema-bodybatteryactivityeventv2dto) | — | — |

</details>

<a id="schema-bodybatteryactivityeventv2dto"></a>

<details>
<summary>BodyBatteryActivityEventV2DTO — 11 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `eventType` | `string` | — | — |
| `eventStartTimeGmt` | `string/date-time` | — | — |
| `eventStartTimeLocal` | `string/date-time` | — | — |
| `bodyBatteryImpact` | `integer/int32` | — | — |
| `feedbackType` | `string` | — | — |
| `shortFeedback` | `string` | — | — |
| `deviceId` | `integer/int64` | — | — |
| `activityName` | `string` | — | — |
| `activityType` | `string` | — | — |
| `activityId` | `integer/int64` | — | — |
| `durationInMillis` | `integer/int32` | — | — |

</details>

<a id="schema-hydrationv2dto"></a>

<details>
<summary>HydrationV2DTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `goalInMl` | `integer/int32` | — | — |
| `goalInFractionalMl` | `number/double` | — | — |
| `consumedInFractionalMl` | `number/double` | — | — |

</details>

<a id="schema-respirationv2dto"></a>

<details>
<summary>RespirationV2DTO — 6 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `avgValue` | `integer/int32` | — | — |
| `maxValue` | `integer/int32` | — | — |
| `minValue` | `integer/int32` | — | — |
| `latestValue` | `integer/int32` | — | — |
| `latestTimestampGmt` | `string/date-time` | — | — |
| `algorithmVersion` | `integer/int32` | — | — |

</details>

<a id="schema-pulseoxv2dto"></a>

<details>
<summary>PulseOxV2DTO — 6 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `avgValue` | `integer/int32` | — | minimum=`0`; maximum=`100` |
| `minValue` | `integer/int32` | — | minimum=`0`; maximum=`100` |
| `latestValue` | `integer/int32` | — | minimum=`0`; maximum=`100` |
| `latestTimestampGmt` | `string/date-time` | — | — |
| `latestTimestampLocal` | `string/date-time` | — | — |
| `avgAltitudeInMeters` | `number/double` | — | — |

</details>

<a id="schema-jetlagv2dto"></a>

<details>
<summary>JetLagV2DTO — 1 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `tripName` | `string` | — | — |

</details>

<a id="schema-dateweightdto"></a>

<details>
<summary>DateWeightDTO — 13 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `date` | `string/date-time` | — | — |
| `calendarDate` | `string` | — | pattern=`"2022-08-10"` |
| `weight` | `number/double` | — | unità documentata: kg |
| `bmi` | `number/double` | — | — |
| `bodyFat` | `number/double` | — | — |
| `bodyWater` | `number/double` | — | — |
| `boneMass` | `integer/int32` | — | — |
| `muscleMass` | `integer/int32` | — | — |
| `physiqueRating` | `integer/int32` | — | — |
| `visceralFat` | `integer/int32` | — | — |
| `metabolicAge` | `number/double` | — | — |
| `timestampGMT` | `string/date-time` | — | — |
| `weightDelta` | `number/double` | — | — |

</details>

<a id="schema-weightrangedto"></a>

<details>
<summary>WeightRangeDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `dailyWeightSummaries` | array di [DailyWeightSummary](#schema-dailyweightsummary) | — | — |
| `totalAverage` | allOf: [WeightAverageDTO](#schema-weightaveragedto) | — | — |
| `previousDateWeight` | allOf: [DateWeightDTO](#schema-dateweightdto) | — | — |
| `nextDateWeight` | allOf: [DateWeightDTO](#schema-dateweightdto) | — | — |

</details>

<a id="schema-dailyweightsummary"></a>

<details>
<summary>DailyWeightSummary — 6 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `summaryDate` | `string` | — | pattern=`"2022-08-10"` |
| `numOfWeightEntries` | `integer/int32` | — | — |
| `minWeight` | `number/double` | — | — |
| `maxWeight` | `number/double` | — | — |
| `latestWeight` | allOf: [DateWeightDTO](#schema-dateweightdto) | — | — |
| `allWeightMetrics` | array di [DateWeightDTO](#schema-dateweightdto) | — | — |

</details>

<a id="schema-weightaveragedto"></a>

<details>
<summary>WeightAverageDTO — 11 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `from` | `string/date-time` | — | — |
| `until` | `string/date-time` | — | — |
| `weight` | `number/double` | — | — |
| `bmi` | `number/double` | — | — |
| `bodyFat` | `number/double` | — | — |
| `bodyWater` | `number/double` | — | — |
| `boneMass` | `integer/int32` | — | — |
| `muscleMass` | `integer/int32` | — | — |
| `physiqueRating` | `integer/int32` | — | — |
| `visceralFat` | `integer/int32` | — | — |
| `metabolicAge` | `number/double` | — | — |

</details>

<a id="schema-bodybatterydailyreportdto"></a>

<details>
<summary>BodyBatteryDailyReportDTO — 12 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `date` | `string/date` | — | — |
| `charged` | `integer/int32` | — | — |
| `drained` | `integer/int32` | — | — |
| `startTimestampGMT` | `string/date-time` | — | — |
| `endTimestampGMT` | `string/date-time` | — | — |
| `startTimestampLocal` | `string/date-time` | — | — |
| `endTimestampLocal` | `string/date-time` | — | — |
| `bodyBatteryValuesArray` | array di array di object (campi non specificati) | — | — |
| `bodyBatteryValueDescriptorDTOList` | array di [BodyBatteryValueDescriptorDTO](#schema-bodybatteryvaluedescriptordto) | — | — |
| `bodyBatteryDynamicFeedbackEvent` | [BodyBatteryDynamicFeedbackEventDTO](#schema-bodybatterydynamicfeedbackeventdto) | — | — |
| `bodyBatteryActivityEvent` | array di [BodyBatteryActivityEventDTO](#schema-bodybatteryactivityeventdto) | — | — |
| `endOfDayBodyBatteryDynamicFeedbackEvent` | [BodyBatteryDynamicFeedbackEventDTO](#schema-bodybatterydynamicfeedbackeventdto) | — | — |

</details>

<a id="schema-bodybatteryvaluedescriptordto"></a>

<details>
<summary>BodyBatteryValueDescriptorDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `bodyBatteryValueDescriptorIndex` | `integer/int32` | — | — |
| `bodyBatteryValueDescriptorKey` | `string` | — | — |

</details>

<a id="schema-dailyspo2andacclimationdto"></a>

<details>
<summary>DailySpO2AndAcclimationDTO — 28 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfilePK` | `integer/int64` | — | — |
| `calendarDate` | `string` | — | pattern=`"2022-08-10"` |
| `startTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `endTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `startTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `endTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepStartTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepEndTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepStartTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `sleepEndTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `tomorrowSleepStartTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `tomorrowSleepEndTimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `tomorrowSleepStartTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `tomorrowSleepEndTimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `averageSpO2` | `number/double` | — | — |
| `lowestSpO2` | `integer/int32` | — | — |
| `lastSevenDaysAvgSpO2` | `number/double` | — | — |
| `latestSpO2` | `integer/int32` | — | — |
| `latestSpO2TimestampGMT` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `latestSpO2TimestampLocal` | `string` | — | pattern=`"2022-08-10T09:47:59\\.031"` |
| `avgSleepSpO2` | `number/double` | — | — |
| `avgTomorrowSleepSpO2` | `number/double` | — | — |
| `spO2SingleValuesDescriptorList` | array di [SPO2ValueDescriptorDTO](#schema-spo2valuedescriptordto) | — | — |
| `spO2SingleValues` | array di array di object (campi non specificati) | — | — |
| `spO2HourlyAveragesDescriptorList` | array di [SPO2AcclimationValueDescriptorDTO](#schema-spo2acclimationvaluedescriptordto) | — | — |
| `spO2HourlyAverages` | array di array di object (campi non specificati) | — | — |
| `monitoringEnvironmentValuesDescriptorList` | array di [MonitoringEnvironmentValueDescriptorDTO](#schema-monitoringenvironmentvaluedescriptordto) | — | — |
| `monitoringEnvironmentValues` | array di array di object (campi non specificati) | — | — |

</details>

<a id="schema-spo2valuedescriptordto"></a>

<details>
<summary>SPO2ValueDescriptorDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `spo2ValueDescriptorIndex` | `integer/int32` | — | — |
| `spo2ValueDescriptorKey` | `string` | — | — |

</details>

<a id="schema-spo2acclimationvaluedescriptordto"></a>

<details>
<summary>SPO2AcclimationValueDescriptorDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `spo2ValueDescIndex` | `integer/int32` | — | — |
| `spo2ValueDescKey` | `string` | — | — |

</details>

<a id="schema-monitoringenvironmentvaluedescriptordto"></a>

<details>
<summary>MonitoringEnvironmentValueDescriptorDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `monEnvValueDescIndex` | `integer/int32` | — | — |
| `monEnvValueDescKey` | `string` | — | — |

</details>

<a id="schema-dailyheartratedto"></a>

<details>
<summary>DailyHeartRateDTO — 15 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfilePK` | `integer/int64` | — | — |
| `calendarDate` | [ConnectDate](#schema-connectdate) | — | — |
| `startTimestampGMT` | [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `endTimestampGMT` | [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `startTimestampLocal` | [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `endTimestampLocal` | [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `maxHeartRate` | `integer/int32` | — | — |
| `minHeartRate` | `integer/int32` | — | — |
| `restingHeartRate` | `integer/int32` | — | — |
| `lastSevenDaysAvgRestingHeartRate` | `integer/int32` | — | — |
| `abnormalHrThresholdValue` | `integer/int32` | — | — |
| `lowAbnormalHrThresholdValue` | `integer/int32` | — | — |
| `abnormalHRValuesArray` | array di array di object (campi non specificati) | — | — |
| `heartRateValueDescriptors` | array di [HeartRateValueDescriptorDTO](#schema-heartratevaluedescriptordto) | — | — |
| `heartRateValues` | array di array di object (campi non specificati) | — | — |

</details>

<a id="schema-heartratevaluedescriptordto"></a>

<details>
<summary>HeartRateValueDescriptorDTO — 2 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `index` | `integer/int32` | — | — |
| `key` | `string` | — | — |

</details>

<a id="schema-wellnessactivitysummarydto"></a>

<details>
<summary>WellnessActivitySummaryDTO — 14 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `userProfilePk` | `integer/int64` | — | — |
| `activityUuid` | allOf: [GarminUUID](#schema-garminuuid) | — | — |
| `calendarDate` | allOf: [ConnectDate](#schema-connectdate) | — | — |
| `rulePK` | `integer/int64` | — | — |
| `activityName` | `string` | — | — |
| `notes` | `string` | — | — |
| `wellnessActivityType` | `string` | — | enum=`["UNKNOWN","HEALTH_MONITORING"]` |
| `startTimestampGMT` | allOf: [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `endTimestampGMT` | allOf: [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `startTimestampLocal` | allOf: [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `endTimestampLocal` | allOf: [ConnectTimestamp](#schema-connecttimestamp) | — | — |
| `summaryTypeDataList` | array di [SummaryTypeDataDTO](#schema-summarytypedatadto) | — | — |
| `timeInZoneList` | array di [TimeInZoneDTO](#schema-timeinzonedto) | — | — |
| `deviceMetaData` | allOf: [DeviceMetaDataDTO](#schema-devicemetadatadto) | — | — |

</details>

<a id="schema-summarytypedatadto"></a>

<details>
<summary>SummaryTypeDataDTO — 4 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `summaryType` | `string` | — | enum=`["HEART_RATE","WRIST_HEART_RATE","STRESS","RESPIRATION","SPO2","RMSSD_HRV","SDRR_HRV"]` |
| `minValue` | `number/double` | — | — |
| `maxValue` | `number/double` | — | — |
| `avgValue` | `number/double` | — | — |

</details>

<a id="schema-timeinzonedto"></a>

<details>
<summary>TimeInZoneDTO — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `zoneNumber` | `integer/int32` | — | — |
| `millisInZone` | `integer/int32` | — | unità documentata: ms |
| `zoneLowBoundary` | `integer/int32` | — | — |

</details>

<a id="schema-devicemetadatadto"></a>

<details>
<summary>DeviceMetaDataDTO — 5 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `deviceId` | `integer/int64` | — | — |
| `deviceTypeId` | `integer/int64` | — | — |
| `deviceVersionId` | `integer/int64` | — | — |
| `deviceVersion` | `string` | — | — |
| `deviceName` | `string` | — | — |

</details>

<a id="schema-garminuuid"></a>

<details>
<summary>GarminUUID — 3 campi</summary>

Tipo radice: `object`.

| Campo | Tipo / riferimento | Obbligatorio | Vincoli / unità documentate |
| --- | --- | --- | --- |
| `leastSignificantBits` | `integer/int64` | — | — |
| `mostSignificantBits` | `integer/int64` | — | — |
| `baseUUID` | `string/uuid` | — | — |

</details>

## Provenienza e limiti della verifica

Il catalogo è stato generato dai metadati tecnici dello schema pubblico,
non da supposizioni sui percorsi dei servizi. Le descrizioni progettuali
e le raccomandazioni sono state aggiunte dopo la lettura del codice locale.
La verifica copre il contratto documentato, non la disponibilità dei dati
per una chiave o un dispositivo specifico. Nessuna chiamata ai dati account
è stata eseguita durante questo studio.

[Bundle pubblico che incorpora lo schema verificato](https://developer.garmin.com/component---src-pages-gc-developer-program-personal-swagger-docs-js-178270c98d5ec74e74ef.js).

SHA-256 dello schema estratto, serializzato JSON con indentazione 2 e newline finale:

`b841f78f10952c334944dcc0ac4a345a65a3cca9cee5aa8529c7af21de8bd960`

La versione dichiarata `1.0.0` può non bastare a rilevare aggiornamenti:
prima dell’implementazione confrontare nuovamente operazioni e modelli.
