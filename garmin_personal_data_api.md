# Garmin Connect Personal API — dati personali e pianificazione in Express

Verifica delle fonti: **22 ottobre 2026**. Specifica consultata: OpenAPI **3.0.1**, API **1.0.0**, **26 endpoint GET**, **109 schemi dati**.

## 1. Obiettivo e perimetro dell'applicazione

L'applicazione Express legge da Garmin Connect le attività svolte e i dati fisiologici disponibili, li conserva e li usa per presentare andamento, recupero e contesto degli allenamenti. **Il piano di allenamento appartiene esclusivamente all'applicazione: non viene inviato al Fenix, né pubblicato nel calendario Garmin Connect.**

La Personal API è adatta a questo utilizzo personale. Garmin la distingue dalle integrazioni Business per applicazioni rivolte a più utenti. L'accesso avviene tramite richieste dell'applicazione ai server Garmin, in modalità **pull**. Il flusso è quindi:

```text
Fenix 8 → sincronizzazione con Garmin Connect → Personal API
                                                   ↓ lettura
                                             Backend Express
                                                   ↓
                                   Archivio locale + analisi dei dati
                                                   ↓
                         Dashboard React con Nivo + piano di allenamento dell'app
```

La specifica Personal consultata espone soltanto letture. Sono sufficienti per importare dati, creare un calendario interno, confrontare programma ed esecuzione e sviluppare suggerimenti spiegabili. Non documenta una connessione diretta o in tempo reale al Fenix. Il dato disponibile dipende da ciò che è già arrivato a Garmin Connect. [Fonti: panoramica del programma][overview], [FAQ Personal][faq], [Swagger][swagger].

### Cosa è realizzabile

| Funzione dell'app | Supporto e provenienza |
| --- | --- |
| Dashboard di sonno, HRV, frequenza cardiaca, stress, Body Battery, SpO₂ e respirazione | Lettura degli endpoint e dei campi descritti sotto, quando presenti nell'account |
| Storico e dettaglio delle attività svolte | Ricerca attività, riepiloghi, dettagli, split e file originali |
| Calendario, obiettivi, sessioni future e modifiche al programma | Dati gestiti esclusivamente nel database dell'app |
| Confronto tra sessione pianificata ed eseguita | Collegamento locale tra sessione dell'app e `activityId` Garmin |
| Suggerimenti su recupero e organizzazione delle sessioni | Logica propria dell'app, con motivazioni e qualità del dato visibili |
| Training Readiness, Training Status e Recovery Time Garmin | Non esposti come metriche dedicate nella specifica consultata; non assumerli disponibili |

**Copertura del dispositivo e copertura dell'API sono due cose diverse.** Un dato visibile sul Fenix 8 o in Garmin Connect non è automaticamente esposto dalla Personal API. Un campo previsto dallo schema, inoltre, può essere assente per una certa attività, data, configurazione o sorgente.

## 2. Fonti e grado di verifica

Questa documentazione combina:

1. La [specifica Swagger ufficiale][swagger], recuperata dal JSON OpenAPI incorporato nella pagina, per endpoint, query, risposte, campi e limiti degli intervalli.
2. Le [istruzioni di accesso][personal] e le [FAQ Garmin][faq], per chiave e durata dei token.
3. Il [repository Python ufficiale][repo], verificato al commit [`ac111a0ff8e37dfbc24c616fcc27691520c7278b`][commit], per il comportamento concreto del client di esempio.

Le proposte di architettura, sincronizzazione e analisi sono **scelte progettuali per questa applicazione**, non garanzie o raccomandazioni fisiologiche Garmin.

Non sono state effettuate chiamate autenticate all'account personale. Le forme delle risposte riportate derivano dagli schemi pubblicati; il backend di autenticazione è stato verificato con credenziali e risposte simulate. La disponibilità effettiva dei dati del proprio Fenix 8 resta da verificare con richieste autenticate.

## 3. Autenticazione

### 3.1 Base URL e creazione della chiave

```text
https://personal.connectapi.garmin.com
```

La chiave si crea dalla [pagina Personal API di Garmin Connect][keys], dopo l'accesso al proprio account e l'accettazione delle condizioni. Viene mostrata una sola volta. Le scadenze selezionabili indicate nelle FAQ sono 30, 90, 180 giorni o un anno. Eliminare la chiave invalida anche i token di accesso associati. [Fonti: istruzioni Garmin][personal], [FAQ][faq].

### 3.2 Ottenere il token

```http
POST /personalapitoken-service/personal-api/personal-api-key/token
Host: personal.connectapi.garmin.com
Authorization: ApiKey <CHIAVE_PERSONALE>
Accept: */*
```

Il client ufficiale invia la richiesta **senza corpo** e tratta la risposta come **testo contenente il JWT**, usando `response.text.strip()`. Non si deve presumere una risposta OAuth JSON con proprietà `access_token`, `expires_in` o `refresh_token`. [Fonti: istruzioni Garmin][personal], [implementazione dell'autenticatore][auth].

Esempio, con chiave già presente nell'ambiente della shell:

```bash
curl --request POST \
  'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token' \
  --header "Authorization: ApiKey ${GARMIN_PERSONAL_API_KEY}"
```

La risposta è una credenziale: non salvarla nei log dell'app o in file versionati.

### 3.3 Leggere i dati

```http
GET /userprofile-service/userprofile/settings
Host: personal.connectapi.garmin.com
Authorization: Bearer <TOKEN_DI_ACCESSO>
Accept: application/json
```

Il token dura **24 ore oppure fino alla scadenza della chiave, se precedente**. Non sono previsti refresh token: per rinnovarlo si ripete la richiesta con la chiave personale. Il nome `refresh-token` della CLI indica proprio una nuova emissione, non un OAuth refresh grant. [Fonte: FAQ][faq].

Il client Python conserva il token su disco, lo associa a una fingerprint di chiave e base URL e lo riutilizza soltanto se ha più di un'ora di validità residua. Legge `exp` dal JWT senza verificarne la firma. La decodifica serve alla gestione della scadenza, non ad autenticare utenti dell'app. Una risposta `401` non produce un rinnovo e un tentativo automatici nel client Python. [Fonte: codice dell'autenticatore][auth].

Per Express conviene adottare una cache server e un'unica richiesta di rinnovo condivisa tra chiamate concorrenti. Dopo un `401`, rinnovare e ripetere la lettura al massimo una volta; se il problema persiste, richiedere la verifica della chiave. Il browser non deve ricevere chiave o bearer token.

**Nota sulla specifica:** nel JSON OpenAPI consultato non sono dichiarati `securitySchemes` e l'endpoint di emissione token non compare tra i 26 endpoint dati. L'autenticazione è documentata separatamente da Garmin e dal client ufficiale: l'assenza del requisito nel JSON non significa accesso anonimo.

## 4. Convenzioni, intervalli e risposte

### Date e unità

- Le date di calendario usano `YYYY-MM-DD`. Per le query per giorno usare il calendario locale dell'utente; il profilo espone `timeZone`.
- Gli intervalli dichiarati inclusivi comprendono entrambi gli estremi. Il client Python descrive così i propri wrapper per gli intervalli. Dove il testo OpenAPI non precisa la semantica, verificarla sui dati e deduplicare per data/ID.
- Molti timestamp `GMT` sono stringhe senza `Z` o offset. Non passarli indiscriminatamente al parser come se fossero orari locali; interpretare il significato documentato dal campo.
- I timestamp del sonno hanno una discrepanza da verificare: lo schema li tipizza come stringhe `date-time`, ma alcune descrizioni parlano di millisecondi. Conservare il valore originale e validare il formato realmente restituito.
- Non esiste un'unica unità per tutte le durate. Sonno e molte metriche di attività usano secondi; i riepiloghi V2 e i tempi nelle zone delle wellness activity usano millisecondi.
- Le unità del profilo sono preferenze di visualizzazione. Le conversioni vanno fatte sui valori e sulle unità dell'endpoint, senza dedurle dalla preferenza dell'utente.

### Limiti documentati per singola richiesta

| Endpoint/intervallo | Massimo esplicitato nello Swagger |
| --- | --- |
| Stress giornaliero | 28 giorni |
| Passi giornalieri | 28 giorni |
| Idratazione giornaliera | 31 giorni |
| Riepiloghi del sonno | 31 giorni |
| Report Body Battery | 31 giorni |
| Riepiloghi giornalieri V2 | 1 anno |
| Altri intervalli | Non indicato nella specifica consultata |

Questi sono limiti della **finestra interrogabile**, non una garanzia sulla profondità dello storico disponibile. Una finestra di 28 giorni compresa tra due date inclusive ha `endDate = startDate + 27 giorni`. Per gli endpoint senza limite pubblicato, partire da finestre contenute e verificare il comportamento. [Fonte: Swagger][swagger].

### Assenza di dati e contratto

Le risposte possono essere oggetti, array o contenitori con array annidati. HRV prevede anche `204 No Content`; la ricerca attività e la lettura dei workout associati possono restituire `[]`. Non uniformare queste forme a un array senza un adattatore esplicito. Numerosi campi degli schemi non sono marcati come obbligatori.

Un dato assente non equivale a zero, a riposo o a recupero completato. Conservare uno stato come `available`, `no_data`, `not_synced`, `error` o `unknown`; non assegnare una causa precisa quando l'API non la fornisce.

## 5. Catalogo completo dei 26 endpoint dati

Tutti i percorsi sono relativi alla base URL. Tutte le operazioni di questa sezione usano **GET + Bearer token**. `Tipo[]` indica un array; i nomi dei tipi sono quelli degli schemi OpenAPI. I parametri tra parentesi graffe sono parametri obbligatori del percorso; nelle colonne query sono elencati i parametri aggiuntivi. Le query di data non sempre risultano formalmente obbligatorie nello Swagger: nell'applicazione è preferibile passarle esplicitamente. [Fonte del catalogo: Swagger ufficiale][swagger].

### 5.1 Attività svolte, workout associati e download

| # | Percorso | Query | Risposta e utilizzo |
| --- | --- | --- | --- |
| 1 | `/activitylist-service/activities/search/activities` | Filtri e paginazione della sezione 6 | `SummarizedActivityDTO[]`: elenco delle attività concluse e metriche disponibili |
| 2 | `/activity-service/activity/{activityId}` | Nessuna | `ActivitySummaryDTO`: metadati, `summaryDTO`, split e informazioni dell'attività |
| 3 | `/activity-service/activity/{activityId}/workouts` | Nessuna | `ActivityWorkoutDTO[]`: workout svolti durante quell'attività; `[]` se non associati |
| 4 | `/download-service/files/activity/{activityId}` | Nessuna | File originale in un archivio ZIP; risposta binaria, non JSON |

`activityId` è `integer/int64`. Nella logica Node può essere mantenuto come stringa decimale per evitare conversioni non sicure di identificatori molto grandi. Il client Python valida gli ID per il download come interi positivi.

Il download dichiara `application/x-zip-compressed` e una risposta `default`, senza schema binario dettagliato né elenco completo degli errori. Il client ufficiale restituisce i byte ZIP senza estrarli. Il programma descrive i dati attività anche in formato FIT: controllare il contenuto dell'archivio prima di scegliere un parser. Per una risposta Axios usare `responseType: 'arraybuffer'`. [Fonti: Swagger][swagger], [client Python][client], [panoramica][overview].

**Il percorso `/workouts` non legge il piano futuro dell'app e non serve a crearlo.** Può aiutare a ricostruire la struttura di un allenamento già eseguito; il piano interno deve poter funzionare anche senza questa informazione.

### 5.2 Riepiloghi, movimento, stress e idratazione

| # | Percorso | Query | Risposta e note |
| --- | --- | --- | --- |
| 5 | `/usersummary-service/usersummary/daily` | `calendarDate` | `UserDailySummaryDto`: riepilogo di un giorno con proprietà piatte |
| 6 | `/usersummary-service/v2/dailysummaries` | `startDate`, `endDate` | `ApiDocumentListUserDailySummaryV2DTO`: oggetto `{ data: UserDailySummaryV2DTO[] }`; massimo 1 anno |
| 7 | `/usersummary-service/stats/stress/daily/{startDate}/{endDate}` | Nessuna | `MultiValueWellnessChartItemDTO[]`; massimo 28 giorni |
| 8 | `/usersummary-service/stats/steps/daily/{startDate}/{endDate}` | Nessuna | `StepsDailyStatDTO[]`; massimo 28 giorni |
| 9 | `/usersummary-service/stats/hydration/daily/{startDate}/{endDate}` | Nessuna | `UserDailyHydrationDTO[]`; massimo 31 giorni |

V1 e V2 hanno strutture e semantiche diverse: non sostituire l'uno con l'altro cambiando soltanto l'URL. Lo stress di questo endpoint è una statistica giornaliera, non una serie intragiornaliera completa. Idratazione e alimentazione dipendono dai dati effettivamente registrati o presenti nell'account, non costituiscono misurazioni dirette dell'acqua bevuta o del cibo da parte dell'orologio.

### 5.3 Sonno e HRV

| # | Percorso | Query | Risposta e note |
| --- | --- | --- | --- |
| 10 | `/sleep-service/sleep/dailySleep` | `date` | `DailySleepDTO`: durata, fasi, punteggi e altri indicatori del sonno |
| 11 | `/sleep-service/sleep/dailySleepSummariesByDate` | `startDate`, `endDate` | `DailySleepDTO[]`; massimo 31 giorni |
| 12 | `/hrv-service/hrv/{calendarDate}` | Nessuna | `HrvChartDTO` con `hrvSummary` e `hrvReadings`; `204` se non ci sono dati |
| 13 | `/hrv-service/hrv/daily/{fromDate}/{toDate}` | Nessuna | `HrvDailySummaryDTO` con `hrvSummaries`; possibile `204` |

La data del sonno è il `calendarDate` associato da Garmin alla notte. Non riassegnarla automaticamente alla data di inizio della finestra notturna. I riepiloghi di intervallo e quelli di dettaglio usano lo stesso tipo nello Swagger, ma la presenza effettiva di ciascun campo va verificata.

### 5.4 Frequenza cardiaca, Body Battery, SpO₂ e wellness activity

| # | Percorso | Query | Risposta e note |
| --- | --- | --- | --- |
| 14 | `/wellness-service/wellness/dailyHeartRate` | `date` | `DailyHeartRateDTO`: valori giornalieri e letture con descrittori |
| 15 | `/wellness-service/wellness/bodyBattery/reports/daily` | `startDate`, `endDate`, `chunks` | `BodyBatteryDailyReportDTO[]`; massimo 31 giorni |
| 16 | `/wellness-service/wellness/daily/spo2acclimation/{calendarDate}` | Nessuna | `DailySpO2AndAcclimationDTO`: SpO₂, medie e dati relativi all'ambiente di monitoraggio |
| 17 | `/wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}` | Nessuna | `WellnessActivitySummaryDTO[]`; estremi esplicitamente inclusivi |

`chunks` è un intero: indica in quanti intervalli viene suddivisa la giornata; la risposta contiene i minimi e massimi Body Battery di ciascun intervallo. Lo Swagger non ne indica default o limiti numerici: ometterlo inizialmente evita di inventare un campionamento garantito.

Le wellness activity includono il tipo `HEALTH_MONITORING`. Le metriche sono elencate in `summaryTypeDataList`, con tipi quali `HEART_RATE`, `WRIST_HEART_RATE`, `STRESS`, `RESPIRATION`, `SPO2`, `RMSSD_HRV`, `SDRR_HRV`. Sono utili per eventuali rilevazioni di benessere disponibili nell'account; non rappresentano necessariamente un flusso continuo di questi segnali.

### 5.5 Profilo, zone cardiache e Fitness Age

| # | Percorso | Query | Risposta e note |
| --- | --- | --- | --- |
| 18 | `/userprofile-service/userprofile/settings` | Nessuna | `UserSettingsDTO`: impostazioni, fuso, unità e preferenze dei giorni di allenamento |
| 19 | `/biometric-service/heartRateZones/v2` | `generateDefaults`, booleano, default `true` | `HeartRateZonesDTO[]`: configurazioni per sport; il parametro controlla la generazione di zone predefinite se mancanti |
| 20 | `/fitnessage-service/fitnessage/v2/{calendarDate}` | `fullHistoryScan`, booleano, default `true` | `FitnessAgeDTO[]`: informazioni più recenti disponibili alla data richiesta |

Con `fullHistoryScan=false`, Fitness Age considera soltanto gli ultimi 28 giorni rispetto alla data target. Non è necessariamente una misurazione calcolata proprio quel giorno: verificare `lastUpdated` e `invalidReason`.

Il profilo contiene anche `availableTrainingDays` e `preferredLongTrainingDays`. L'app può importarli come preferenze iniziali; i giorni e le sessioni del piano restano configurazioni locali e non vengono scritti su Garmin. Per richiedere soltanto le zone già configurate si può specificare `generateDefaults=false`; l'effettiva assenza di effetti persistenti del valore `true` non è precisata nel contratto.

### 5.6 Peso, composizione corporea, obiettivi e alimentazione

| # | Percorso | Query | Risposta e note |
| --- | --- | --- | --- |
| 21 | `/weight-service/weight/all/{startDate}/{endDate}` | Nessuna | `DateWeightDTO[]`: tutte le rilevazioni dell'intervallo |
| 22 | `/weight-service/weight/range/{startDate}/{endDate}` | `includeAll`, booleano, default `false` | `WeightRangeDTO`: riepiloghi, media dell'intervallo e rilevazioni adiacenti |
| 23 | `/goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}` | Nessuna | `UserGoalsRangeDTO`: obiettivi e intervalli di peso dell'utente |
| 24 | `/nutrition-service/food/logs/{date}` | `includeGoals=true`, `includeNutrition=true`, `includeMedia=true`, `mealId` facoltativo | `DailyNutritionSummaryDTO`: obiettivi, nutrienti ed eventuale dettaglio dei pasti |

Per il peso le date sono esplicitamente inclusive e riferite al calendario locale. Con `includeAll=true` si richiedono tutte le rilevazioni di ogni giorno, mentre il default include soltanto l'ultima. `previousDateWeight` e `nextDateWeight` servono da contesto ai grafici e possono essere **fuori dall'intervallo**: non includerli automaticamente nelle aggregazioni richieste.

In `DateWeightDTO`, `weight` è documentato in **chilogrammi**. Non applicare conversioni derivate da altri endpoint o librerie Garmin. Per massa muscolare, massa ossea e altri campi senza unità esplicita nel relativo schema, verificare la risposta prima della normalizzazione. Questi dati possono provenire da bilance, registrazioni manuali o altre sorgenti dell'account: non attribuirli al Fenix senza evidenza.

Per l'alimentazione, `mealId` è un identificatore intero. Non assegnare ID ai pasti sulla base dell'esempio Swagger. Il default `includeMedia=true` può aumentare il contenuto restituito: per la dashboard si può richiedere `includeMedia=false`.

### 5.7 Salute mestruale

| # | Percorso | Query | Risposta |
| --- | --- | --- | --- |
| 25 | `/periodichealth-service/menstrualcycle/summary/{calendarDate}` | Nessuna | `MenstrualCycleSummaryDTO` |
| 26 | `/periodichealth-service/menstrualcycle/dayview/{calendarDate}` | `todayDate`, `reducedResponse=false`, `skipbm=false`, `includeAnalysis=false` | `DetailedMenstrualCycleDayDTO` |

`todayDate` fornisce la data attuale dal punto di vista del chiamante per previsioni e calcoli. `reducedResponse=true` richiede un payload ridotto; `skipbm=true` esclude i dati dei movimenti fetali; `includeAnalysis=true` include analisi del ciclo. Includere questi dati soltanto se pertinenti al proprio utilizzo dell'app.

## 6. Ricerca attività: paginazione e tutti i filtri

Endpoint:

```http
GET /activitylist-service/activities/search/activities
```

| Parametro | Tipo e default | Significato |
| --- | --- | --- |
| `start` | Intero, `0` | Offset a partire da zero, non numero di pagina |
| `limit` | Intero, `99` nello Swagger | Massimo di risultati richiesti; il wrapper Python usa invece `20` |
| `favorite` | Intero, `-1` | `1`: preferiti; `0`: non preferiti; `-1`: nessun filtro |
| `sortOrder` | Stringa, `desc` | `asc` o `desc`, senza distinzione maiuscole/minuscole |
| `excludeChildren` | Booleano, `true` | Esclude le attività figlie, per esempio frazioni multisport |
| `sortBy` | Stringa; default descritto `startLocal` | Campo di ordinamento; esempi: `name`, `distance`, `duration` |
| `search` | Stringa | Ricerca in nome e descrizione |
| `activityType` | Stringa | Tipo padre, ad esempio `running` o `cycling` |
| `activitySubType` | Stringa | Sottotipo, ad esempio `trail_running` o `road_cycling` |
| `eventType` | Stringa | Classificazione, per esempio `race`, `training`, `recreation`, `fitness`, `specialEvent`, `uncategorized` |
| `minDistance`, `maxDistance` | Interi | Distanza in metri; estremi inclusivi |
| `minDuration`, `maxDuration` | Interi | Durata timer in secondi; estremi inclusivi |
| `minElevation`, `maxElevation` | Interi | Dislivello positivo totale in metri; estremi inclusivi |
| `startDate`, `endDate` | Stringhe data | Date inclusive rispetto all'inizio locale dell'attività |
| `upperLatitude`, `rightLongitude`, `lowerLatitude`, `leftLongitude` | Numeri | Bounding box dei punti iniziali; fornire tutte e quattro le coordinate |
| `lowerMaxDepth`, `upperMaxDepth` | Interi | Limiti inclusivi della profondità massima delle immersioni, in centimetri |
| `decoDive` | Booleano | Filtra immersioni con/senza decompressione; omettere per non filtrare |
| `minElapsedDuration`, `maxElapsedDuration` | Interi | Tempo trascorso totale, pause incluse, in secondi |
| `minBottomTime`, `maxBottomTime` | Interi | Tempo di fondo delle immersioni, in secondi |
| `minAvgPower` | Intero | Potenza media minima in watt |
| `excludedActivitySubType` | Array di stringhe | Ripetere il parametro per escludere più sottotipi |
| `requiredField` | Array di stringhe | Ripetere il parametro: tutti i campi indicati devono avere valore non nullo |

Esempio:

```http
GET /activitylist-service/activities/search/activities?start=0&limit=50&startDate=2026-10-01&endDate=2026-10-22&activityType=running&activitySubType=trail_running&sortOrder=desc
```

Per gli array usare parametri ripetuti, ad esempio `requiredField=averageHR&requiredField=activityTrainingLoad`. Nello Swagger non è pubblicato un massimo di `limit`: il default `99` non va interpretato come limite massimo contrattuale.

Il risultato è un array di attività, senza un totale dichiarato. Come strategia applicativa, procedere aumentando l'offset del numero di elementi ricevuti fino a una pagina vuota, deduplicare per `activityId` e imporre un limite operativo al numero di pagine. L'archivio Garmin può cambiare durante la lettura: una nuova attività può spostare gli offset.

Un tipo padre usato come sottotipo, un sottotipo usato come padre o una combinazione incoerente producono `400`. La bounding box ha anche vincoli su latitudine, longitudine ed estensione: lo Swagger menziona una distanza massima ma non ne pubblica il valore. Per il multisport, scegliere esplicitamente se importare le frazioni ed evitare di sommare contemporaneamente padre e figli nei totali. [Fonte: Swagger][swagger].

## 7. Campi da usare nella dashboard e nelle analisi

Questa sezione seleziona i campi più utili al progetto; non riproduce tutte le proprietà dei 109 schemi. I nomi e la posizione dei campi seguono lo [Swagger][swagger]. Gli utilizzi proposti sono logica dell'app.

### 7.1 Recupero, sonno e segnali giornalieri

| Area | Campi e struttura | Uso nell'app e attenzione |
| --- | --- | --- |
| HRV notturna | `hrvSummary.lastNightAvg`, `weeklyAvg`, `lastNight5MinHigh`, `status`, `baseline.balancedLow`, `baseline.balancedUpper` | Mostrare notte, andamento settimanale e intervallo personale Garmin; lo schema non esplicita unità/statistica di ogni valore HRV: verificarle prima di etichettare il dato come RMSSD o confrontarlo con altre sorgenti |
| Stato HRV | `NONE`, `POOR`, `LOW`, `UNBALANCED`, `BALANCED`, `INVALID` | Conservare la classificazione originale; `NONE` e `INVALID` non indicano recupero favorevole |
| Letture HRV | `hrvReadings[].hrvValue`, `readingTimeGMT`, `readingTimeLocal` | Visualizzare i campioni pubblicati senza presumere intervalli di campionamento fissi |
| Sonno | `sleepTimeSeconds`, `napTimeSeconds`, `deepSleepSeconds`, `lightSleepSeconds`, `remSleepSeconds`, `awakeSleepSeconds` | Durata e composizione; il totale del sonno esclude i sonnellini, disponibili separatamente |
| Qualità del sonno | `sleepScores`, `sleepScoreFeedback`, `sleepScoreInsight`, `sleepScorePersonalizedInsight` | `sleepScores` è una mappa di `SleepScoreItem`, con `value` e `qualifierKey`; le chiavi della mappa non sono enumerate nel contratto |
| Bisogno di sonno | `sleepNeed`, `nextSleepNeed`, `dailyNapDTOS` | Contesto del sonno attuale e successivo; unità di `baseline` e `actual` non esplicitate nello schema: non sottrarle direttamente a secondi/minuti |
| Frequenza cardiaca a riposo | `DailyHeartRateDTO.restingHeartRate`, `lastSevenDaysAvgRestingHeartRate` | Confronto con il proprio andamento, usando lo stesso tipo di dato nel tempo |
| FC nel riepilogo V2 | `heartRate.restingValue`, `minValue`, `maxValue` | `restingValue` può usare il minimo assoluto come fallback; `minValue`/`maxValue` possono essere medie su 2 minuti. Non equipararli automaticamente ai campi degli altri endpoint |
| Stress | V2: `stress.avgLevel`, `maxLevel`, `highStressDurationInMillis`; endpoint statistiche: `values.overallStressLevel` e durate per categoria | Lo stress V2 ha scala Garmin 0–100; le durate dell'endpoint statistiche sono in secondi, quelle V2 in millisecondi |
| Body Battery | V2: `bodyBattery.minValue`, `maxValue`, `latestValue`, `chargedValue`, `drainedValue`, `endOfDayValue` | `endOfDayValue` è l'ultimo valore prima del sonno, non necessariamente quello a mezzanotte; il tipo V2 descrive una scala 5–100 |
| Body Battery al risveglio | V1: `bodyBatteryAtWakeTime`, `bodyBatteryDuringSleep` | Contesto del recupero notturno, quando presente; non confonderlo con il valore più recente del giorno |
| SpO₂ | `averageSpO2`, `lowestSpO2`, `latestSpO2`, `avgSleepSpO2`; V2: `pulseOx.avgValue`, `minValue` | Grafici e confronto fra periodi omogenei, mostrando presenza e copertura delle rilevazioni |
| Respirazione | V2: `respiration.avgValue`, `minValue`, `maxValue`; sonno: `averageRespirationValue` | Il tipo V2 documenta atti/minuto. Distinguere misura giornaliera e notturna; non è pubblicato un endpoint dedicato alla serie continua della respirazione |
| Wellness activity | `summaryTypeDataList[].summaryType`, `minValue`, `maxValue`, `avgValue` | Mostrare rilevazioni puntuali di benessere, incluse RMSSD/SDRR quando effettivamente presenti |

### 7.2 Attività e adattamento del programma

L'elenco delle attività restituisce molte metriche direttamente in `SummarizedActivityDTO`. Il dettaglio restituisce invece numerose misure dentro `summaryDTO` e usa in alcuni casi nomi diversi.

| Informazione | Elenco attività | Dettaglio `summaryDTO` |
| --- | --- | --- |
| Volume e durata | `distance`, `duration`, `elapsedDuration`, `movingDuration` | Stessi nomi |
| Frequenza cardiaca | `averageHR`, `maxHR` | `averageHR`, `maxHR`, `minHR` |
| Training Effect aerobico | `aerobicTrainingEffect` | `trainingEffect` |
| Training Effect anaerobico | `anaerobicTrainingEffect` | `anaerobicTrainingEffect` |
| Carico della singola attività | `activityTrainingLoad` | `activityTrainingLoad` |
| Classificazione dell'effetto | `trainingEffectLabel`, `aerobicTrainingEffectMessage`, `anaerobicTrainingEffectMessage` | Stessi nomi |
| TSS e intensità | `trainingStressScore`, `intensityFactor` | Stessi nomi |
| VO₂ max associato all'attività | `vO2MaxValue` | Non presumere una proprietà equivalente nel dettaglio |
| Potenza | `avgPower`, `normPower`, `maxFtp` | `averagePower`, `normalizedPower`, `functionalThresholdPower` |
| Soglia cardiaca | `lactateThresholdBpm` | `lactateThresholdHeartRate` |
| Velocità alla soglia | `getlactateThresholdSpeed`, documentata in cm/ms | `lactateThresholdSpeed`, documentata in m/s |
| Tempo nelle zone FC | `hrTimeInZone_1` … `hrTimeInZone_5`, in secondi | Non assumere gli stessi campi nel dettaglio |
| Stamina dell'attività | Non presumere campi equivalenti | `beginPotentialStamina`, `endPotentialStamina`, `minAvailableStamina` |
| Sensazioni e sforzo | Verificare le proprietà disponibili | `directWorkoutFeel`, `directWorkoutRpe`, `perceivedWorkoutEffort` |

Usare un adattatore che mantenga anche nome, unità e sorgente del campo originale. Per la velocità alla soglia non scegliere un fattore di conversione comune senza gestire la differenza dichiarata tra i due schemi e verificarla sui payload.

`activityTrainingLoad` è il carico di una singola attività: non equivale al Training Status o al carico acuto complessivo Garmin. `recoveryHeartRate` è una frequenza cardiaca di recupero in BPM, **non** il numero di ore di Recovery Time. VO₂ max, TSS, soglie, potenza e stamina non sono garantiti per tutte le attività.

La presenza di `summaryDTO`, split e metriche aggregate non garantisce una serie completa secondo per secondo o una traccia GPS nel JSON. Per analisi approfondite valutare il file originale scaricabile, dopo averne verificato contenuto e formato.

### 7.3 Zone cardiache

`HeartRateZonesDTO` distingue `sport` (`DEFAULT`, `RUNNING`, `CYCLING`, `SWIMMING`, `ROWING`) e `trainingMethod` (`HR_MAX`, `LACTATE_THRESHOLD`, `HR_RESERVE`, `CUSTOM`). Espone `zone1Floor` … `zone5Floor`, `maxHeartRateUsed`, `restingHeartRateUsed` e `lactateThresholdHeartRateUsed`.

Usare le zone dello sport pertinente e conservarne uno storico locale: la configurazione attuale non è necessariamente quella valida durante un'attività passata. Le zone aiutano a descrivere l'esecuzione e a definire obiettivi del piano interno.

### 7.4 Dati che non vanno promessi

La specifica consultata non espone endpoint dedicati a Training Readiness, Training Status, Recovery Time, Hill Score, Endurance Score, ECG o pressione arteriosa. Non documenta neppure una serie generica di temperatura cutanea; un flag relativo alla temperatura nel contesto del ciclo mestruale non dimostra la disponibilità delle misurazioni.

Non creare URL per analogia con API Garmin interne o librerie non ufficiali. Un eventuale indicatore di recupero calcolato dall'app deve essere denominato e spiegato come **stima dell'app**, senza presentarlo come punteggio Garmin.

## 8. Backend Express e libreria condivisa implementati

Il backend di base è ora implementato in `app.js`, con configurazione in `libs/config.js`, client condiviso in `libs/garmin.js` e route di autenticazione in `routes/garmin-auth.js`. Ogni modulo deve usare `getGarminClient(profileId)` per ottenere l’istanza condivisa di quello specifico profilo, con cache del token separata. Le istruzioni complete sono nel [README del progetto](README.md).

Nome, cognome, sport principale (corsa, bici, nuoto, palestra, HIIT) e chiave API personale si gestiscono nel popup **Profili e Garmin**. Le chiavi sono cifrate nel database locale; `.env` contiene soltanto impostazioni dell’installazione. La configurazione precedente viene migrata al profilo iniziale, da completare, e la chiave viene rimossa da `.env` dopo il salvataggio. Le sessioni del piano sono separate per profilo. Avvio:

```bash
npm start
```

Il server ascolta per default su `http://127.0.0.1:3000` e mette a disposizione:

| Metodo e percorso | Funzione |
| --- | --- |
| `GET /health` | Stato del processo; non chiama Garmin |
| `GET /api/profiles` | Elenco dei profili senza credenziali |
| `POST /api/profiles` | Crea un profilo locale |
| `PATCH /api/profiles/:id` | Aggiorna dati e chiave del profilo |
| `GET /api/garmin/auth/status` | Stato locale della configurazione e della cache |
| `POST /api/garmin/auth/ensure` | Ottiene, riusa o rinnova il token e restituisce soltanto metadati |

Le richieste per autenticazione e sessioni usano `X-Profile-Id` per indicare il profilo. Chiave salvata e token non sono restituiti attraverso HTTP. In modifica, `apiKey` omessa o vuota conserva la chiave e `null` la rimuove; una sostituzione invalida soltanto la cache di quel profilo. `configured` indica la presenza della chiave, mentre `valid` indica che il token in cache non è scaduto secondo l'orologio locale; non sono una verifica remota della mancata revoca.

Per i futuri moduli backend:

```javascript
const { getGarminClient } = require('./libs/garmin');

async function readDailyHrv(profileId, calendarDate) {
  return getGarminClient(profileId).get(
    `/hrv-service/hrv/${calendarDate}`,
  );
}
```

Questo è un esempio d'uso interno: l'app non pubblica ancora endpoint per HRV, attività o altre misure. I moduli che accettano date dall'interfaccia dovranno validarle prima di usarle.

Il client mantiene una cache in memoria e rinnova il token alla prima richiesta utile quando entra nel margine preventivo, di default 60 secondi, oppure è scaduto. Per token brevi il margine è ridotto al massimo al 10% della validità residua all'emissione. Le chiamate concorrenti condividono un'unica emissione. Dopo un `401` di una lettura, ottiene un nuovo token e ripete la lettura una sola volta; ulteriori rifiuti diventano errori espliciti. Gli errori del client HTTP vengono tradotti senza esporre header, credenziali o corpo originale della risposta.

Il rinnovo non usa timer in background né refresh token. Dopo il riavvio si ottiene un nuovo bearer token dalla chiave personale. Il database locale `db/garmintrainer.sqlite` salva profili, chiavi personali cifrate e sessioni del piano; non contiene ancora misure Garmin importate. Il file `db/garmintrainer.sqlite.key` protegge le credenziali e deve essere incluso in un backup riservato per consentirne il ripristino. I profili sono spazi locali selezionabili, senza login individuale. La decodifica di `exp` è usata esclusivamente per la gestione della scadenza del token ricevuto via HTTPS.

La verifica locale comprende test di autenticazione, API, persistenza SQLite, migrazione e isolamento tra profili, oltre a una prova Express tramite simulazione Postman del percorso emissione → lettura rifiutata → nuova emissione → lettura riuscita. Nessuna richiesta di test usa l'account Garmin reale.

## 9. Architettura proposta: dati Garmin e piano interno

### 9.1 Responsabilità

| Componente | Responsabilità |
| --- | --- |
| Client Garmin | Autenticazione, letture da percorsi prestabiliti, timeout e gestione degli errori |
| Sincronizzazione | Finestre temporali, paginazione, aggiornamento dei dati già importati e avanzamento per dataset |
| Archivio | Payload originali, dati normalizzati, unità, sorgenti e storico degli aggiornamenti |
| Analisi | Indicatori descrittivi, qualità del dato, confronti personali e spiegazioni |
| Pianificazione | Sessioni future, struttura, obiettivi, revisioni e consuntivi, tutti locali |
| API Express | Risorse della dashboard e del piano; nessun proxy generico verso URL scelti dal browser |
| Frontend React con Nivo | Grafici interattivi sui dati normalizzati ricevuti da Express, unità e stati di disponibilità visibili |

### 9.2 Modello dati minimo

Le tabelle seguenti sono una proposta per l'app; i nomi non appartengono all'API Garmin.

| Entità | Contenuto principale |
| --- | --- |
| `garmin_raw_payloads` | Dataset, data/ID risorsa, payload originale, `fetchedAt`, eventuale versione/hash |
| `daily_metrics` | `calendarDate`, metrica, valore, unità, sorgente/campo originale, disponibilità e copertura nota |
| `activities` | `activityId` univoco, sport, inizio locale e UTC, volume, durata e metriche normalizzate |
| `activity_details` | Dettaglio, split, workout eseguito ed eventuale riferimento al file originale |
| `training_plans` | Obiettivo, periodo, versione del programma e preferenze dell'utente |
| `planned_sessions` | Giorno locale, sport, obiettivi, durata/distanza previste, intensità e note; nessun ID di pubblicazione Garmin |
| `planned_session_steps` | Riscaldamento, blocchi, ripetizioni e recuperi definiti nello schema interno dell'app |
| `session_activity_links` | Associazioni tra sessioni pianificate e attività Garmin, metodo e conferma dell'abbinamento |
| `session_reviews` | Esito, RPE percepito, sensazioni, note e motivazione delle modifiche al programma |
| `insights` | Evidenze usate, confronto, copertura dei dati, versione della regola e testo mostrato |
| `sync_state` | Avanzamento, tentativi, errori e ultima sincronizzazione riuscita per dataset |

Usare una relazione esplicita per gli abbinamenti: una sessione può essere registrata in più attività, e una lunga attività può coprire più blocchi pianificati. Uno stato locale della sessione può essere `planned`, `completed`, `partial`, `skipped` o `rescheduled`. La semplice presenza di un'attività nello stesso giorno non deve marcarla automaticamente come completata.

La proposta di abbinamento può considerare data locale, sport, distanza, durata e fascia oraria, mantenendo la possibilità di correzione manuale. Per modifiche al programma suggerite dagli insight, conservare la versione precedente e lasciare all'utente la decisione di applicarle.

### 9.3 API interne possibili

Questi percorsi descrivono l'architettura prevista dell'app, non endpoint Garmin. Le route attualmente implementate e i loro parametri effettivi sono elencati nel [README](README.md); le altre restano proposte:

| Metodo e percorso | Funzione |
| --- | --- |
| `GET /api/dashboard?date=YYYY-MM-DD` | Stato del giorno, freschezza e copertura dei dataset |
| `GET /api/metrics?from=...&to=...` | Serie normalizzate e confronti fra periodi |
| `GET /api/activities?from=...&to=...` | Attività già importate |
| `GET /api/plans/current` | Piano interno attivo |
| `POST /api/plans` | Creazione di un piano locale |
| `POST /api/plans/:id/sessions` | Inserimento di una sessione nel calendario dell'app |
| `PATCH /api/sessions/:id` | Modifica o riprogrammazione locale |
| `POST /api/sessions/:id/activity-links` | Conferma di un collegamento al consuntivo Garmin |
| `GET /api/insights?date=YYYY-MM-DD` | Osservazioni con evidenze e dati mancanti |
| `POST /api/sync` | Avvio di un'importazione, con limiti di concorrenza |

Le operazioni di scrittura di questa tabella riguardano esclusivamente il database dell'app. Non richiedono una Training API né l'invio del piano al dispositivo.

## 10. Sincronizzazione e gestione operativa

### Importazione iniziale proposta

1. Verificare l'accesso con le impostazioni del profilo e acquisire il fuso utente.
2. Importare le zone cardiache e le preferenze utili, distinguendole dalle preferenze locali del piano.
3. Importare i riepiloghi V2 su un periodo iniziale contenuto, per esempio 90 giorni; è una scelta progettuale, non un limite Garmin.
4. Importare sonno, HRV, stress, passi e Body Battery rispettando le finestre per endpoint. Il dettaglio per giorno va richiesto soltanto dove serve.
5. Importare le attività con paginazione; approfondire dettagli e file originali su richiesta o per analisi specifiche.
6. Registrare disponibilità e anomalie prima di abilitare indicatori che dipendono da quei dati.

### Aggiornamenti successivi

La dashboard dovrebbe leggere soprattutto l'archivio dell'app. All'apertura può proporre o avviare un aggiornamento controllato; eventuali esecuzioni periodiche sono una scelta di implementazione. La Personal API non documenta webhook nella specifica consultata e il programma Personal indica consegna pull. [Fonte: panoramica][overview].

Rileggere oggi e alcuni giorni precedenti come finestra di sovrapposizione, perché sincronizzazioni tardive e modifiche possono cambiare i dati. Conservare avanzamenti separati: un errore nel sonno non deve segnare come fallita anche l'importazione delle attività.

Usare inserimenti/aggiornamenti idempotenti per data, dataset e `activityId`. Dopo una modifica della fonte, ricalcolare gli indicatori derivati interessati. Per le attività cancellate, una ricerca incrementale da sola non garantisce la rimozione dall'archivio: prevedere una riconciliazione periodica degli intervalli già importati.

Mostrare almeno `lastSuccessfulSyncAt`, `fetchedAt` e, se presente, il timestamp dell'ultima osservazione. Questi tempi descrivono eventi diversi: aver scaricato il riepilogo alle 12:00 non garantisce dati dell'orologio aggiornati alle 12:00.

### Errori e recupero

| Caso | Comportamento dell'app proposto |
| --- | --- |
| `200` con campi mancanti o array vuoto | Registrare il risultato senza inventare misure o completamenti del piano |
| `204` HRV | Registrare `no_data`, senza tentare di decodificare JSON |
| `400` | Controllare date, intervalli, ID e filtri; non ripetere la stessa richiesta invariata |
| `401` | Ottenere un nuovo token e ripetere una sola volta; poi segnalare errore di accesso |
| `403` | Segnalare accesso non consentito alla risorsa; il rinnovo continuo non risolve il problema |
| `404` dell'attività | Gestire ID inesistente o dato non più presente; non cancellare automaticamente il piano locale |
| `429`, se restituito | Rispettare `Retry-After` se presente, altrimenti applicare attesa crescente con limite ai tentativi |
| `5xx` o problema di rete | Retry limitati per le letture, attesa crescente e mantenimento dei dati precedenti con indicazione di mancato aggiornamento |

`400`, `401`, `403`, `404` e `500` sono elencati per diversi endpoint, ma non uniformemente per tutti. Lo Swagger non definisce un formato di errore JSON comune. La gestione di `429`, dei problemi di rete e dei retry è una misura applicativa: **non sono pubblicati limiti numerici di chiamata** nelle fonti consultate. Non ricavare quote o frequenze consentite dal solo fatto che una richiesta riesca.

## 11. Insight per organizzare il piano dell'app

Il primo obiettivo è fornire osservazioni contestualizzate e verificabili, usando confronti personali. Non occorre costruire subito un unico punteggio: una vista delle evidenze riduce l'ambiguità e permette di capire perché una sessione potrebbe essere riprogrammata.

| Osservazione possibile | Dati necessari | Relazione con il piano interno |
| --- | --- | --- |
| HRV recente diversa dall'intervallo personale | HRV notturna, media settimanale, baseline e stato Garmin | Evidenziare il contesto della prossima sessione, senza trasformare da sola la misura in una decisione |
| Riposo notturno diverso dalle proprie abitudini | Durata, sonnellini, qualità del sonno e storico disponibile | Proporre una revisione della sessione con motivazione e conferma dell'utente |
| FC a riposo diversa dal proprio andamento | Dati omogenei di frequenza a riposo e copertura sufficiente | Mostrare il cambiamento insieme a sonno, carico e note soggettive |
| Recupero energetico notturno variabile | Body Battery al risveglio, ricarica e dati del sonno | Contestualizzare la scelta fra sessioni già previste nel piano |
| Volume o intensità recenti cambiati | Durata, distanza, zone, sport, carico della singola attività | Confrontare le settimane e controllare la distribuzione locale delle sessioni |
| Sessione eseguita diversamente dal programma | Obiettivi locali, attività collegata, zone e sensazioni | Quantificare lo scostamento e aggiornare il consuntivo senza riscrivere la fonte Garmin |
| Dati insufficienti per valutare il giorno | Copertura dei dataset, errori e timestamp disponibili | Mostrare l'incertezza e conservare il programma, senza dedurre recupero da valori mancanti |

Le regole devono dichiarare periodo di confronto, numero di osservazioni valide e fonti utilizzate. Per esempio, un cambiamento descrittivo può confrontare la mediana dell'ultimo periodo con la mediana di un periodo precedente, indicando la copertura di entrambi. La lunghezza dei periodi e le eventuali soglie sono parametri da validare; non sono prescrizioni Garmin.

Non sommare indiscriminatamente `trainingStressScore`, `activityTrainingLoad`, Training Effect e minuti nelle zone come se avessero la stessa unità. Le somme locali del carico e i trend dell'app devono mantenere il proprio nome e non essere presentati come replica del Training Status Garmin.

Per i dati fisiologici mostrare osservazioni e limiti della misura, evitando diagnosi o conclusioni cliniche. Gli insight servono all'organizzazione personale dell'attività, con un ruolo esplicito delle sensazioni e delle scelte dell'utente.

## 12. Prima versione consigliata e verifiche da completare

### Prima versione

1. Collegamento Garmin e importazione di riepiloghi giornalieri, sonno, HRV e attività.
2. Dashboard React con grafici Nivo, serie storiche, unità corrette, dati mancanti e ultima sincronizzazione.
3. Calendario locale con sessioni, obiettivi, note e revisioni del programma.
4. Abbinamento modificabile tra sessioni pianificate e attività svolte.
5. Insight descrittivi con evidenze e proposte di modifica del piano da confermare nell'app.

### Verifiche con l'account reale prima di affidarsi alle analisi

- Confermare token testuale e scadenza, poi una lettura del profilo.
- Confrontare alcuni giorni con Garmin Connect: uno completo, uno senza attività e uno con dati assenti o incompleti.
- Verificare forme JSON, chiavi di `sleepScores`, timestamp del sonno, unità HRV e valori di bisogno di sonno.
- Controllare il comportamento di `204`/array vuoti e i descrittori delle serie cardiache, Body Battery e SpO₂. Le matrici vanno lette tramite indice/chiave dei descrittori, senza fissare arbitrariamente le colonne.
- Confrontare elenco e dettaglio di una corsa; verificare metriche e unità, soprattutto velocità alla soglia, durata e potenza.
- Controllare confini di intervallo, paginazione e attività multisport; verificare uno scenario a cavallo del cambio d'ora nel fuso utente.
- Provare un aggiornamento ripetuto per escludere duplicazioni; una modifica del dato importato deve aggiornare gli insight senza alterare il piano originale.
- Verificare che un fallimento Garmin lasci consultabili calendario e piano locali e che non esponga credenziali nei log o nelle risposte al browser.

### Questioni non definite dalle fonti consultate

Quote numeriche, massimo di `limit`, granularità garantita delle serie, disponibilità storica per ogni dataset, accessibilità effettiva di ogni metrica del Fenix 8, unità dei campi non esplicitate e disponibilità di funzionalità dipendenti dall'account richiedono verifica ulteriore. La presenza del campo nello schema è una possibilità del contratto, non la conferma di una misura nel proprio account.

## 13. Ruolo del repository Python ufficiale

Il repository è un riferimento utile anche sviluppando in JavaScript: mostra il protocollo HTTP, le query, il trattamento delle risposte vuote e il download binario. Non è necessario eseguire Python all'interno dell'app Express.

Due letture presenti nello Swagger non hanno un wrapper dedicato nel client al commit verificato: `/usersummary-service/usersummary/daily` e `/weight-service/weight/all/{startDate}/{endDate}`. Viceversa, non tutti i filtri Swagger sono esposti dagli argomenti dei wrapper: per esempio, la ricerca Python offre soltanto un sottoinsieme delle query documentate. Il metodo generico `get(path, params=...)` permette di usare gli altri GET supportati.

Il client richiede Python 3.12 o successivo ed è distribuito con licenza Apache-2.0. I test del repository usano simulazioni HTTP e non provano la disponibilità di dati nell'account personale. [Fonti: repository][repo], [client][client], [configurazione del pacchetto][pyproject].

## 14. Grafici dei dati Garmin con Nivo

La libreria scelta per i grafici è **Nivo**, basata su React e D3. Nel progetto sono installati `@nivo/core`, `@nivo/line`, `@nivo/bar` e `@nivo/calendar` alla versione **0.99.0**, insieme a **React e React DOM 19.3.1**. Le dipendenze sono dichiarate in `package.json` e le versioni risolte sono registrate in `package-lock.json`. [Fonti: sito Nivo][nivo], [repository e installazione][nivo-repo].

La dashboard React è ora implementata in `frontend/`, con configurazione Vite in `vite.config.mjs`. `npm run dev` avvia frontend e backend; `npm run build` genera la build servita da Express con `npm start`. La pagina visualizza inizialmente gli stati senza dati e offre un'anteprima Nivo dichiaratamente dimostrativa. L'importazione delle misure Garmin rimane da implementare. Gli esempi di questa sezione spiegano il contratto dei grafici e non sono letture dell'account personale.

### 14.1 Moduli e visualizzazioni previste

| Pacchetto | Componente | Dati da visualizzare |
| --- | --- | --- |
| `@nivo/core` | Funzioni e componenti condivisi | Base comune, tema e supporto dei grafici |
| `@nivo/line` | `ResponsiveLine` | Andamento di HRV, FC a riposo, Body Battery, stress, SpO₂ e respirazione, con un grafico e un'unità per metrica |
| `@nivo/bar` | `ResponsiveBar` | Durata e fasi del sonno, minuti nelle zone cardiache, volume per sport e confronto pianificato/eseguito |
| `@nivo/calendar` | `ResponsiveCalendar` | Riepilogo annuale dei minuti di attività o di una singola metrica giornaliera |

Il calendario Nivo sintetizza **un valore per giorno**. L'editor delle sessioni, la riprogrammazione e i dettagli del piano sono componenti dell'app e continuano a usare il database locale. [Fonti: Line][nivo-line], [Bar][nivo-bar], [Calendar][nivo-calendar].

### 14.2 Percorso dei dati e formati

```text
API Garmin → sincronizzazione Express → archivio e normalizzazione
                                                    ↓ API dell'app
                                           frontend React → Nivo
```

Express espone date, valori, unità e disponibilità; il frontend li adatta al formato del grafico. Le credenziali Garmin rimangono nel backend. Il grafico deve distinguere caricamento, errore, dati assenti e dati disponibili.

Nivo Line usa serie con `id` e punti `{ x, y }`; `y: null` interrompe la linea. Nivo Bar usa righe con una chiave di categoria e proprietà numeriche; Calendar usa elementi `{ day: 'YYYY-MM-DD', value: numero }`. I dati mancanti non devono essere convertiti in zero. [Fonti: Line][nivo-line], [Bar][nivo-bar], [tipi Calendar][nivo-calendar-types].

### 14.3 Esempio di componente React per la FC a riposo

Il componente riceve campioni già normalizzati dal backend, con data locale, valore in BPM e stato di disponibilità. Il backend deve includere anche le date senza rilevazioni, con valore `null`, per rendere visibili le interruzioni della serie.

```jsx
import { ResponsiveLine } from '@nivo/line';

export function DailyRestingHeartRateChart({ samples = [] }) {
  const points = [...samples]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((sample) => ({
      x: sample.date,
      y: sample.status === 'available' && Number.isFinite(sample.value)
        ? sample.value
        : null,
    }));

  if (!points.some((point) => point.y !== null)) {
    return <p role="status">Nessun dato di frequenza cardiaca a riposo disponibile.</p>;
  }

  return (
    <div style={{ height: 320, width: '100%' }}>
      <ResponsiveLine
        data={[{ id: 'FC a riposo', data: points }]}
        margin={{ top: 20, right: 24, bottom: 55, left: 65 }}
        xScale={{ type: 'time', format: '%Y-%m-%d', precision: 'day', useUTC: true }}
        xFormat="time:%d/%m"
        yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false }}
        yFormat={(value) => `${value} bpm`}
        axisBottom={{ format: '%d/%m', tickValues: 'every 7 days' }}
        axisLeft={{ legend: 'bpm', legendPosition: 'middle', legendOffset: -45 }}
        curve="linear"
        enableGridX={false}
        pointSize={5}
        useMesh
        animate={false}
        role="img"
        ariaLabel="Andamento della frequenza cardiaca a riposo in battiti al minuto"
      />
    </div>
  );
}
```

Esempio di campioni **dimostrativi**, non recuperati dall'account:

```json
[
  { "date": "2026-10-19", "value": 54, "status": "available" },
  { "date": "2026-10-20", "value": null, "status": "no_data" },
  { "date": "2026-10-21", "value": 56, "status": "available" }
]
```

Il contenitore ha un'altezza esplicita, necessaria perché il componente responsive abbia uno spazio in cui disegnare. La scala UTC qui serve a posizionare uniformemente **date di calendario già normalizzate**; per le letture intragiornaliere occorre invece usare gli istanti corretti e formattarli nel fuso dell'utente.

### 14.4 Regole di rappresentazione

- Mostrare la stessa metrica e la stessa unità su ogni asse: HRV e frequenza cardiaca richiedono scale e pannelli distinti.
- Per dati giornalieri includere i giorni mancanti con `null`. Per serie intragiornaliere individuare prima i vuoti di copertura: non interpolare automaticamente lunghi periodi senza letture.
- Ordinare le osservazioni per data/istante e deduplicarle dopo la normalizzazione. Per periodi lunghi ridurre le etichette degli assi e aggregare i dati in modo dichiarato.
- Mostrare nei tooltip valore, unità, data e sorgente; riportare accanto al grafico periodo e ultima sincronizzazione.
- Usare barre affiancate per pianificato/eseguito, confrontando la medesima grandezza e gestendo separatamente le sessioni senza abbinamento confermato.
- Nel calendario annuale distinguere un giorno importato senza attività, valore `0`, da un giorno di cui mancano i dati, senza valore. Impostare un colore riconoscibile per le celle vuote.
- Accompagnare i grafici con riepiloghi testuali o una tabella consultabile e mantenere colori coerenti per metrica; il colore da solo non deve comunicare disponibilità o stato.

### 14.5 Verifiche effettuate sull'installazione

Sono stati verificati la risoluzione delle dipendenze e il rendering SVG di `Line`, `Bar` e `Calendar` con React DOM Server e dati dimostrativi; il grafico a linee è stato verificato anche con una data senza valore. La dashboard è stata inoltre compilata con Vite e verificata nel browser su desktop e mobile: anteprima, cambio metrica e periodo, collegamento al backend, creazione e persistenza delle sessioni locali. Il controllo delle dipendenze durante l'installazione non ha rilevato vulnerabilità. Nessun test ha usato l'account Garmin reale.

## Fonti ufficiali

- [Garmin Personal API — Swagger][swagger]
- [Garmin Personal API — accesso e ottenimento token][personal]
- [Garmin Personal API — FAQ][faq]
- [Garmin Connect Developer Program — panoramica][overview]
- [Garmin Connect — gestione chiavi personali][keys]
- [Repository Garmin del client Python][repo]
- [Versione del repository verificata][commit]
- [Autenticatore Python al commit verificato][auth]
- [Client Python al commit verificato][client]
- [Configurazione del pacchetto al commit verificato][pyproject]
- [Nivo — sito e componenti][nivo]
- [Nivo — repository e installazione][nivo-repo]
- [Nivo — grafici a linee][nivo-line]
- [Nivo — grafici a barre][nivo-bar]
- [Nivo — calendario][nivo-calendar]
- [Nivo — tipi dei dati Calendar][nivo-calendar-types]

[swagger]: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
[personal]: https://developer.garmin.com/gc-developer-program/personal/personal-api/
[faq]: https://developer.garmin.com/gc-developer-program/personal/personal-faq/
[overview]: https://developer.garmin.com/gc-developer-program/overview/
[keys]: https://connect.garmin.com/app/settings/personalApiToken
[repo]: https://github.com/garmin/connect-personal-api-python
[commit]: https://github.com/garmin/connect-personal-api-python/tree/ac111a0ff8e37dfbc24c616fcc27691520c7278b
[auth]: https://github.com/garmin/connect-personal-api-python/blob/ac111a0ff8e37dfbc24c616fcc27691520c7278b/src/garmin_personal_api/auth.py
[client]: https://github.com/garmin/connect-personal-api-python/blob/ac111a0ff8e37dfbc24c616fcc27691520c7278b/src/garmin_personal_api/client.py
[pyproject]: https://github.com/garmin/connect-personal-api-python/blob/ac111a0ff8e37dfbc24c616fcc27691520c7278b/pyproject.toml
[nivo]: https://nivo.rocks/
[nivo-repo]: https://github.com/plouc/nivo
[nivo-line]: https://nivo.rocks/line/
[nivo-bar]: https://nivo.rocks/bar/
[nivo-calendar]: https://nivo.rocks/calendar/
[nivo-calendar-types]: https://github.com/plouc/nivo/blob/v0.99.0/packages/calendar/src/types.ts
