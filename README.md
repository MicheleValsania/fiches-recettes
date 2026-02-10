# Fiches Recettes

App per creare e stampare fiche tecniche con ingredienti, procedura e food cost.  
Include una libreria fiches, gestione fornitori con listini prezzi e calcolo costi automatico.

## Funzionalità
- Editor fiche con anteprima A4 pronta per stampa
- Import/export JSON e export PDF
- Autosalvataggio locale
- Libreria fiches su DB (con ricerca per titolo)
- Fornitori e listini prezzi (con ricerca fornitori)
- Scheda Prodotti con elenco completo (nome, fornitore, prezzo, unita) e ricerca
- Ricerca prodotti nel listino del singolo fornitore
- Collegamento ingrediente ??? prodotto fornitore
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
Salva i backup in `backups/` in formato `.dump` e mantiene gli ultimi 7 file.

### Backup automatico ogni giorno alle 08:00 e 20:00 (Windows Task Scheduler)
Esegui questi comandi una volta (adatta il percorso se il progetto è altrove):
```powershell
schtasks /Create /SC DAILY /ST 08:00 /TN "Fiches Backup 08" /TR "powershell -ExecutionPolicy Bypass -File C:\Users\user\fiches-recettes\scripts\backup.ps1"
schtasks /Create /SC DAILY /ST 20:00 /TN "Fiches Backup 20" /TR "powershell -ExecutionPolicy Bypass -File C:\Users\user\fiches-recettes\scripts\backup.ps1"
```

Note:
- Docker Desktop deve essere avviato per eseguire il backup.
- Per cambiare retention/frequenza, modifica `scripts/backup.ps1`.

## Variabili DB (opzionale)
Il backend legge queste variabili d’ambiente:
```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=fiches
```

## Setup multi-utente (Postgres + server)
Questa modalita richiede un po' di competenza tecnica. In sintesi:

1. Metti Postgres su un server o VM accessibile in rete (non su localhost).
2. Avvia il backend su una macchina raggiungibile dai client.
3. Configura le variabili d'ambiente del backend:
```
PGHOST=ip_o_host_del_server
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=fiches
PORT=3001
```
4. Consenti l'accesso di rete al backend (firewall) e aggiungi autenticazione se serve.
5. Dal client, imposta l'API base (se necessario) verso l'indirizzo del backend.

Nota: con l'assetto attuale l'app e il DB sono locali su `localhost`, quindi single-user.

## Reset DB (per test)
Endpoint backend:
```
POST /api/reset
```

PowerShell:
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/reset
```

## Flusso prezzi (fornitori ↔ fiche)
- Inserisci fornitore e prodotto in fiche: il prodotto viene creato/aggiornato nel listino.
- Inserisci o modifica prezzo/unità nella fiche: scrive nel listino.
- Il prezzo viene sempre letto dal listino per il calcolo del costo.

## Import listini CSV (fornitori + prodotti)
Nella sezione **Fornitori** usa il bottone **Importa CSV** per caricare uno o piÃ¹ file CSV.
Colonne richieste: `FOURNISSEUR`, `DESIGNATION`, `UNITE`, `PRIX UNIT HT`.
- I duplicati dello stesso fornitore vengono sovrascritti con l'ultimo caricato.
- Prodotti uguali con fornitori diversi vengono mantenuti.
- Case-insensitive automatico (es. `ATS` -> `ats`).
- Per somiglianze (es. `tropézienne` vs `les halles tropezienne`) viene chiesta conferma e puoi applicare la scelta a tutto l'import.

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

## Struttura progetto
```
server/            # backend Express + Postgres
src/
  components/      # UI
  utils/           # db, suppliers, costing
  types/           # tipi TS
```

## Note
- L’app usa Postgres locale (Docker) per salvare fiches e listini.
- Per funzionare correttamente, assicurati che il backend sia avviato su `localhost:3001`.

## Changelog (2026-02-06)
- Nuova scheda Prodotti con elenco completo e ricerca.
- Ricerca in libreria fiches, fornitori e prodotti.
- Migliorie toolbar: comandi fiche solo in editor e menu principale sempre visibile.
- Import listini CSV multipli con parsing intelligente (fornitore, prodotto, unità, prezzo).
- Deduplica automatica case-insensitive + alert per nomi simili con scelta “applica a tutti”.
- Rinomina fornitori e prodotti con propagazione alle fiche.
- Eliminazione fornitori con pulizia riferimenti nelle fiche.
- Script di avvio automatico e backup DB programmato.
