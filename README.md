# Fiches Recettes

App per creare e stampare fiche tecniche con ingredienti, procedura e food cost.  
Include una libreria fiches, gestione fornitori con listini prezzi e calcolo costi automatico.

> **Stato del progetto:** consulta [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) per la fotografia verificata della produzione, dei tenant, dei backup e degli sviluppi ancora mancanti.

## Funzionalità 
- Editor fiche con anteprima A4 pronta per stampa
- Import/export JSON e export PDF
- Autosalvataggio locale
- Libreria fiches su DB (con ricerca per titolo)
- Fornitori e listini prezzi (con ricerca fornitori)
- Scheda Prodotti con elenco completo (nome, fornitore, prezzo, unita) e ricerca
- Ricerca prodotti nel listino del singolo fornitore
- Listino fornitore con campi estesi: codice fornitore, prezzo origine (+ unita origine), prezzo unita (+ unita)
- Export PDF ordine fornitore stampabile (codice, nome, residuo, nuova quantita da ordinare)
- Collegamento ingrediente-prodotto fornitore
- Calcolo costo per ingrediente e food cost per porzione

## Ricerca
- Libreria fiches: ricerca per titolo
- Fornitori: ricerca per nome fornitore
- Prodotti: ricerca per nome prodotto o fornitore

## Stack
- Frontend: React + Vite + TypeScript
- Backend: Node + Express
- DB: PostgreSQL (via Docker)

## Avvio rapido

### 1) Avvia PostgreSQL con Docker
```bash
docker run --name fiche-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fiches -p 5432:5432 -d postgres:16
```

### 2) Installa dipendenze
```bash
npm install
```

### 3) Avvia backend e frontend
```bash
npm run dev:server
npm run dev
```

Oppure in un solo comando:
```bash
npm run dev:all
```

### Avvio automatico (Docker + app)
```bash
npm run dev:full
```
Questo script:
- Verifica che Docker Desktop sia avviato
- Crea (se manca) e avvia il container Postgres
- Avvia backend + frontend

Dopo ogni riavvio del PC devi riaprire Docker Desktop, poi puoi usare `npm run dev:full`.

## Backup automatico DB

### Backup manuale
```bash
npm run backup:db
```
Salva i backup in `backups/` in formato `.dump`, conserva i backup degli ultimi 7 giorni e applica un cap di sicurezza sui file mantenuti.
Scrive anche un log in `backups/backup.log`.

### Backup automatico ogni giorno alle 08:00 e 20:00 (Windows Task Scheduler)
Esegui questi comandi una volta (adatta il percorso se il progetto è altrove):
```powershell
schtasks /Create /F /SC DAILY /ST 08:00 /TN "Fiches Backup 08" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\chefside\fiches-recettes\scripts\backup.ps1"
schtasks /Create /F /SC DAILY /ST 20:00 /TN "Fiches Backup 20" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\user\chefside\fiches-recettes\scripts\backup.ps1"
```

Note:
- Docker Desktop deve essere avviato per eseguire il backup.
- Per cambiare retention/frequenza, modifica i parametri `KeepDays` e `Keep` in `scripts/backup.ps1`.

## Variabili DB (opzionale)
Il backend legge queste variabili d'ambiente:
```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=fiches
```

## Setup multi-utente

La produzione e gia multi-tenant: frontend su Netlify, backend e PostgreSQL su Railway. Ogni account personale opera nel tenant indicato dalla sessione firmata; le nuove iscrizioni creano un'organizzazione isolata. L'accesso storico ChefSide resta associato ai dati del campeggio.

Per configurazione, modalita di accesso, stato dei dati e limiti ancora presenti, consulta [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md). Per l'esercizio quotidiano e il ripristino usa [`docs/01_OPERATIONS_RUNBOOK.md`](docs/01_OPERATIONS_RUNBOOK.md).

## Reset DB (per test)
Il reset e disabilitato per impostazione predefinita e la route non viene registrata. Per abilitarlo temporaneamente servono entrambe le variabili server `ALLOW_DB_RESET=true` e `DB_RESET_TOKEN`.

Endpoint backend:
```
POST /api/reset
```

PowerShell:
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/reset
```

Con protezione attiva, aggiungi gli header `Authorization: Bearer <session-token>` e `X-Reset-Token: <DB_RESET_TOKEN>`. Non abilitare il reset in produzione durante il normale utilizzo.

## Autenticazione API

In produzione il backend richiede:

- `LEGACY_LOGIN_ENABLED`: mantiene disponibile l'accesso storico ChefSide; impostare `false` solo dopo la migrazione agli account personali.
- `APP_PASSWORD`: password dell'accesso storico, richiesta soltanto quando `LEGACY_LOGIN_ENABLED` e attivo; non viene inclusa nel bundle frontend.
- `AUTH_TOKEN_SECRET`: segreto casuale usato per firmare sessioni temporanee (8 ore per impostazione predefinita).
- `FICHES_SERVICE_TOKEN`: segreto separato per le richieste server-to-server provenienti da CookOps.
- `CORS_ALLOWED_ORIGINS`: origini frontend autorizzate, separate da virgola.
- `DEFAULT_TENANT_ID`, `DEFAULT_TENANT_SLUG`, `DEFAULT_TENANT_NAME`: identita stabile dell'organizzazione associata ai dati storici.

Il browser conserva soltanto il token temporaneo in `sessionStorage`; la password non viene salvata. Il server rifiuta sempre di avviarsi senza i segreti obbligatori. Per lo sviluppo locale senza autenticazione bisogna impostare esplicitamente `AUTH_DISABLED=true`.

Il rate limiting del login e conservato in memoria ed e adeguato all'attuale singola istanza Railway. Prima di aumentare il numero di repliche va spostato su uno storage condiviso, per esempio Redis.

CookOps deve usare lo stesso valore del token di servizio nella propria variabile `FICHES_API_SERVICE_TOKEN`.

## Isolamento multi-tenant

Il database associa fiches, categorie, fornitori e prodotti fornitore a un `tenant_id`. Al primo avvio della versione multi-tenant, la migrazione crea il tenant configurato e assegna a quel tenant tutti i dati storici privi di organizzazione. L'operazione avviene in una transazione: in caso di errore non viene applicata parzialmente.

Il tenant delle richieste viene ricavato dalla sessione firmata o dal token di servizio; non viene accettato dal payload o dai parametri inviati dal browser. Le route applicative filtrano letture e scritture per tenant. I valori `DEFAULT_TENANT_*` devono rimanere invariati dopo la prima migrazione per non creare una seconda organizzazione involontaria.

Gli utenti personali sono registrati in `app_users` e collegati alle organizzazioni tramite `tenant_memberships`. Le password personali sono derivate con `scrypt` e sale casuale; il database non conserva la password originale. La sessione firmata contiene utente, tenant e ruolo. A ogni richiesta personale il server verifica che l'utente sia ancora attivo e membro di quel tenant, e applica il ruolo corrente registrato nel database.

La landing pubblica offre accesso personale e creazione di una nuova organizzazione. Le iscrizioni restano protette da invito:

- `REGISTRATION_ENABLED=true` abilita l'endpoint di registrazione.
- `REGISTRATION_INVITE_CODE` definisce il codice richiesto per creare un'organizzazione e deve essere trattato come un segreto server.
- La registrazione crea in una sola transazione tenant, utente owner, membership e categorie iniziali.

L'accesso ChefSide storico rimane disponibile dalla pagina di login e continua ad aprire esclusivamente il tenant configurato con `DEFAULT_TENANT_*`. Questo permette di migrare gradualmente gli utenti del campeggio verso account personali senza modificare le fiches esistenti. Quando la migrazione sara completa, `LEGACY_LOGIN_ENABLED=false` rimuovera il relativo accesso senza disattivare l'autenticazione personale.

## Tutorial e primo accesso

Gli account personali ricevono al primo accesso una visita guidata in cinque passaggi: nuova fiche, compilazione, fornitori, salvataggio ed export. La checklist viene aggiornata da azioni realmente eseguite e salvata in `user_onboarding_progress`, separatamente per utente e tenant.

Il pulsante **Guida** resta disponibile per riaprire la checklist, ripetere la visita e consultare il centro assistenza trilingue. L'accesso storico ChefSide non avvia automaticamente il tour e conserva localmente l'eventuale avanzamento, perché non corrisponde ancora a un utente personale.

## Flusso prezzi (fornitori <-> fiche)
- Inserisci fornitore e prodotto in fiche: il prodotto viene creato/aggiornato nel listino.
- Il listino supporta anche prezzo origine e unita origine per riferimento acquisti.
- Inserisci o modifica prezzo/unità nella fiche: scrive nel listino.
- Il prezzo viene sempre letto dal listino per il calcolo del costo.

## Import listini CSV (fornitori + prodotti)
Nella sezione **Fornitori** usa il bottone **Importa CSV** per caricare uno o più file CSV.
Colonne minime richieste: `FOURNISSEUR`, `DESIGNATION`.
Colonne supportate (opzionali): `CODE FOURNISSEUR`, `PRIX ORIGINE`, `UNITE ORIGINE`, `UNITE`, `PRIX UNIT HT`.
- Le celle vuote nel CSV non cancellano i dati esistenti in listino (merge non distruttivo).
- I duplicati dello stesso fornitore vengono sovrascritti con l'ultimo caricato.
- Prodotti uguali con fornitori diversi vengono mantenuti.
- Case-insensitive automatico (es. `ATS` -> `ats`).
- Per somiglianze (es. `tropézienne` vs `les halles tropezienne`) viene chiesta conferma e puoi applicare la scelta a tutto l'import.

## Workflow pratico: IA -> CSV -> fiches tecniche
Questa prassi e' utile se costruisci o rivedi ricette in ChatGPT/Claude e vuoi importare rapidamente i prodotti nel listino.

1. Raccogli in IA ingredienti, fornitore e codici prodotto.
2. Chiedi all'IA un CSV con intestazioni esatte:
   `FOURNISSEUR,DESIGNATION,CODE FOURNISSEUR,PRIX ORIGINE,UNITE ORIGINE,UNITE,PRIX UNIT HT`
3. Importa il CSV in **Fornitori**.
4. Apri il dettaglio fornitore e fai solo le rifiniture necessarie (nomi, unita, prezzi, codici).
5. Compila/aggiorna la fiche: il food cost usera' sempre `PRIX UNIT HT` + `UNITE` (prezzo operativo).

Note operative:
- Se aggiorni solo il listino origine, puoi valorizzare `PRIX ORIGINE` e lasciare vuoto `PRIX UNIT HT`.
- Le celle vuote non cancellano i valori gia' presenti.
- Se vuoi bloccare il costo operativo corrente, evita di inviare `PRIX UNIT HT` per quei prodotti.

Prompt suggerito per IA:
```text
Genera un CSV valido con separatore virgola e una riga header.
Usa esattamente queste colonne:
FOURNISSEUR,DESIGNATION,CODE FOURNISSEUR,PRIX ORIGINE,UNITE ORIGINE,UNITE,PRIX UNIT HT
Regole:
- Nessun testo extra prima o dopo il CSV.
- Usa il punto come separatore decimale.
- Lascia vuoto il campo se il dato non è disponibile.
- Non inventare codici prodotto.
```

Alternative utili:
- Modalita "solo anagrafica": importa solo `FOURNISSEUR` + `DESIGNATION` (+ opzionale `CODE FOURNISSEUR`), poi completi i prezzi in app.
- Modalita "solo aggiornamento prezzi": esporti dal tuo processo IA solo righe con prodotti esistenti e prezzi da aggiornare.
- Modalita "batch per fornitore": un CSV per fornitore riduce conflitti e rende piu' semplice il controllo finale.
- Per preparare nuove fiches con IA: crea una fiche vuota in app, fai `Export JSON` e usa quel file come modello da far completare all'IA.

## Modifica fornitori/prodotti
- Puoi rinominare il fornitore dal dettaglio listino.
- Puoi rinominare i prodotti direttamente nella lista.
- Le modifiche vengono propagate alle fiche.

## Eliminazione fornitore
- Nella lista fornitori puoi eliminare un fornitore e il suo listino.
- Le fiche vengono aggiornate rimuovendo i riferimenti al fornitore eliminato.

## Scripts utili
```bash
npm run dev         # frontend
npm run dev:server  # backend
npm run dev:all     # entrambi
npm run build
npm run preview
```

## Import fiches JSON (safe UTF-8)
Per importare envelope JSON da terminale senza corrompere accenti/caratteri speciali:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-fiches-envelope.ps1 -Path "C:\path\to\fiches.json"
```

Note:
- Lo script legge il file in UTF-8 strict.
- Lo script invia payload come bytes UTF-8 (`charset=utf-8`) verso `/api/fiches`.
- Se trova testo sospetto blocca l'import (override con `-AllowSuspectText`).

## Struttura progetto
```
server/            # backend Express + Postgres
src/
  components/      # UI
  utils/           # db, suppliers, costing
  types/           # tipi TS
```

## Note
- In sviluppo locale l'app usa PostgreSQL tramite Docker per salvare fiches e listini.
- Per funzionare correttamente, assicurati che il backend sia avviato su `localhost:3001`.

## Changelog (2026-02-06)
- Nuova scheda Prodotti con elenco completo e ricerca.
- Ricerca in libreria fiches, fornitori e prodotti.
- Migliorie toolbar: comandi fiche solo in editor e menu principale sempre visibile.
- Import listini CSV multipli con parsing intelligente (fornitore, prodotto, unità, prezzo).
- Deduplica automatica case-insensitive + alert per nomi simili con scelta â€œapplica a tuttiâ€.
- Rinomina fornitori e prodotti con propagazione alle fiche.
- Eliminazione fornitori con pulizia riferimenti nelle fiche.
- Script di avvio automatico e backup DB programmato.

## Aggiornamenti (2026-02-13)
- Export massivo in PDF ZIP: puoi esportare tutte le fiches in un archivio unico.
- Nuova sezione Attrezzatura nell'editor fiche.
- Build TypeScript ripulita: errori bloccanti risolti.
- i18n runtime con switch lingua IT/FR/EN e persistenza preferenza in localStorage.

## Aggiornamenti (2026-02-17)
- Listino fornitore esteso con codice prodotto fornitore e doppio prezzo (origine + unita operativa).
- Aggiunta unita dedicata al prezzo origine nel listino fornitore.
- Nuovo export PDF ordine dal dettaglio fornitore con colonne stampabili per residuo e nuova quantita da ordinare.
- Migliorata la paginazione PDF con margini di sicurezza su tutte le pagine (ridotti tagli a fondo pagina su ordini e fiches).

## Nota operativa
- L'app è in uso quotidiano reale (fornitori, prodotti, decine di fiches tecniche).
- Questo uso continuo copre smoke test pratici su editor, libreria, listini e flussi di export/import.

## Documentazione
La documentazione strutturata e aggiornata è in `docs/`:
- `docs/README.md`
- `docs/00_PRODUCT_SCOPE.md`
- `docs/01_OPERATIONS_RUNBOOK.md`
- `docs/02_DATA_MODEL_AND_CONTRACTS.md`
- `docs/03_ROADMAP.md`

I documenti storici sono in `docs/archive/`.




