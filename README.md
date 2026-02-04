# Fiches Recettes

App per creare e stampare fiche tecniche con ingredienti, procedura e food cost.  
Include una libreria fiches, gestione fornitori con listini prezzi e calcolo costi automatico.

## Funzionalità
- Editor fiche con anteprima A4 pronta per stampa
- Import/export JSON e export PDF
- Autosalvataggio locale
- Libreria fiches su DB
- Fornitori e listini prezzi
- Collegamento ingrediente ↔ prodotto fornitore
- Calcolo costo per ingrediente e food cost per porzione

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

## Variabili DB (opzionale)
Il backend legge queste variabili d’ambiente:
```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=fiches
```

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
