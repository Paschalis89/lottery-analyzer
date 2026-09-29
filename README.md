# Win for Life Classico Lab v0.2.0

Applicazione locale Docker per analizzare Win for Life Classico e tenere separati:

1. **dati storici ufficiali**;
2. **portafogli teorici/ottimizzati**;
3. **giocate realmente effettuate**;
4. **spesa, payout registrati, bankroll e ROI personale**.

Il progetto non considera le giocate passate come informazione predittiva: se le estrazioni sono indipendenti, il fatto di aver giocato una combinazione non modifica la sua probabilità futura. Lo storico personale serve invece a misurare in modo corretto la performance reale del metodo.

## Avvio

Requisiti: Docker + Docker Compose.

```bash
unzip winforlife-classico-analyzer-v2.zip
cd winforlife-classico-analyzer-v2
chmod +x scripts/*.sh
./scripts/start.sh
```

`start.sh` esegue volutamente:

```bash
docker compose build --no-cache
docker compose up -d
```

Dashboard:

```text
http://localhost:8080
```

Log:

```bash
docker compose logs -f winforlife-analyzer
```

Stop:

```bash
./scripts/stop.sh
```

## Database personale

Tutto viene salvato localmente in:

```text
data/winforlife.sqlite
```

Il database contiene:

- profilo personale;
- bankroll iniziale;
- budget mensile;
- estrazioni storiche;
- stato dello scraper;
- portafogli;
- combinazioni dei portafogli;
- giocate effettive;
- risultati abbinati;
- payout inseriti manualmente.

`docker compose down` non elimina il database perché `./data` è montata come volume locale.

## Fix del bug concorsi tra anni

La versione precedente usava soltanto il numero del concorso come chiave. Poiché la numerazione può ripartire nei diversi anni, questo poteva far considerare come duplicati concorsi di anni diversi.

Questa versione usa vincoli distinti su:

```text
data + numero concorso
```

e su:

```text
data + ora estrazione
```

Quindi, per esempio, `#1` del 2025 e `#1` del 2026 sono due estrazioni diverse.

La dashboard mostra anche il conteggio per anno, così è immediato verificare se il dataset si ferma prematuramente.

## Migrazione dalla v0.1

Se copi nella nuova cartella `data/` il vecchio file:

```text
draws.ndjson
```

al primo avvio verrà importato automaticamente nel nuovo SQLite.

Il vecchio `scrape-days.json` viene volutamente ignorato: dopo il bug di deduplicazione è più sicuro ricontrollare i giorni invece di considerarli già acquisiti.

## Scraper

Archivio usato:

```text
https://www.winforlife.it/archivio-estrazioni-classico/YYYY/mese/giorno
```

Comportamento:

- una richiesta per giorno;
- delay configurabile;
- retry limitati per `429/5xx`;
- nessun bypass di login/CAPTCHA/rate limit;
- cache dello stato in SQLite;
- una pagina che restituisce `0` estrazioni viene marcata `warning_empty`, non `ok`;
- le date in warning vengono quindi ricontrollate in un successivo import normale.

## Portfolio optimizer

Win for Life Classico ha:

```text
C(20,10) = 184.756
```

possibili esiti dei 10 numeri principali.

Per questo il software può misurare **esattamente** la coverage del portfolio finale senza Monte Carlo.

Modalità:

- `1e`: esito coperto quando almeno una combinazione realizza 7/8/9/10 sui numeri principali;
- `2e`: vengono considerate anche le categorie simmetriche 0/1/2/3.

L'optimizer è euristico e non garantisce di trovare il portfolio globalmente migliore. La percentuale finale mostrata, invece, viene sempre ricalcolata esattamente sui 184.756 esiti.

## Range di spesa

La sezione **Range di spesa e coverage** genera una serie di portafogli per differenti budget.

Esempio:

```text
2 €   -> 1 combinazione in modalità 2 €
10 €  -> 5 combinazioni
20 €  -> 10 combinazioni
...
```

Per ogni riga vengono mostrati:

- costo per estrazione;
- numero combinazioni;
- coverage esatta;
- numero di esiti ancora scoperti;
- presenza o meno del 100%.

### Cosa significa 100%

Se una riga riporta:

```text
Coverage = 100%
Esiti scoperti = 0
```

significa che **quel portfolio specifico**, per qualunque dei 184.756 possibili esiti dei 10 numeri principali, ha almeno una combinazione che rientra nelle categorie considerate per la modalità selezionata.

Non significa:

- utile economico garantito;
- recupero della spesa garantito;
- jackpot garantito;
- minimo budget matematico dimostrato.

Il planner è euristico. Se trova il 100%, quella coverage è verificata esattamente. Se non trova il 100%, non prova che non esista un portfolio migliore allo stesso costo.

## Profilo, bankroll e budget mensile

Puoi salvare:

- nome profilo;
- bankroll iniziale;
- budget mensile;
- modalità predefinita.

La dashboard calcola:

- spesa del mese;
- budget residuo;
- payout registrati;
- ROI mensile;
- ROI totale;
- giocate vincenti sulle giocate già abbinate;
- bankroll stimato = bankroll iniziale - spese + payout registrati.

## Portafoglio iniziale e mensile

Un portfolio può essere marcato come:

- `INITIAL`: portfolio di riferimento iniziale;
- `MONTHLY`: portfolio associato a un mese `YYYY-MM`;
- `CUSTOM`: portfolio libero.

Per ogni portfolio salvi:

- combinazioni;
- Numerone;
- modalità;
- coverage esatta;
- seed e iterazioni, se generato dall'optimizer;
- numero di estrazioni su cui prevedi di usarlo.

Da questo vengono calcolati:

```text
costo pianificato = costo singola combinazione × numero combinazioni × draw pianificati
```

oltre a:

```text
P(almeno un draw coperto nel periodo) = 1 - (1 - p)^n
```

con `p` coverage per singola estrazione e `n` numero di estrazioni pianificate.

Questa è una probabilità di almeno una categoria coperta, non una previsione monetaria.

## Salvare le combinazioni realmente giocate

Dopo aver salvato un portfolio, nella sezione **Portafogli salvati** inserisci:

- data estrazione;
- ora estrazione;

poi premi:

```text
Registra come giocato
```

Il programma crea una riga `plays` per ogni combinazione del portfolio e ne registra il costo.

È possibile anche aggiungere una singola giocata manuale.

## Abbinamento risultati

Quando l'estrazione corrispondente è presente nello storico locale, premi:

```text
Abbina risultati
```

Il sistema calcola per ogni giocata:

- numeri indovinati;
- Numerone sì/no;
- categoria tecnica (`10+N`, `8`, `3`, `NO_PRIZE`, ecc.);
- stato `SETTLED`.

Il payout in euro va inserito manualmente dalla tabella Giocate. In questo modo le statistiche economiche non dipendono da una tabella premi hardcoded che potrebbe diventare obsoleta.

## Portfolio manuale

Formato:

```text
1 2 3 4 5 6 7 8 9 10 | 4
11 12 13 14 15 16 17 18 19 20 | 17
```

La parte dopo `|` è il Numerone.

Quando salvi, il server ricalcola autonomamente la coverage esatta; non si fida di percentuali inviate dal browser.

## Test

Senza Docker, con Node 22.5+:

```bash
NODE_OPTIONS=--no-warnings npm test
```

I test verificano tra le altre cose:

- universo = 184.756;
- probabilità esatta di una singola combinazione;
- planner coverage;
- parser archivio;
- deduplicazione corretta tra anni;
- salvataggio portfolio;
- registrazione giocata;
- settlement automatico.

## Backup

Per fare backup basta copiare:

```text
data/winforlife.sqlite
```

A container fermo:

```bash
./scripts/stop.sh
cp data/winforlife.sqlite data/winforlife-backup.sqlite
```

## Nota matematica

Le giocate personali hanno valore statistico per rispondere a domande come:

- quanto ho speso realmente?;
- quante estrazioni ho giocato?;
- quante volte il portfolio ha prodotto almeno una categoria vincente?;
- qual è stato il ROI osservato?;
- quanto differisce il risultato reale dalla coverage teorica?;
- qual è la varianza mese per mese?;

Non vanno invece usate come se modificassero le probabilità future di un'estrazione indipendente.
