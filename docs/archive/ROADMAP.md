# Roadmap Tecnica (offline-first) - Fiches Recettes

## Contesto
- Prodotto in uso reale per la ristorazione (camping, ~3M fatturato annuo ristorazione).
- Priorità: stabilità, zero interruzioni, miglioramenti progressivi.

## Obiettivi
1. Stabilizzare l’app attuale (Postgres + backend + frontend) senza blocchi operativi.
2. Preparare una versione desktop installabile (offline) per Windows.
3. Valutare migrazione a SQLite e packaging Mac quando pronta.
4. Eventuale evoluzione verso multi-utente/cloud.

---

## Fase 1 — Stabilità immediata (1–2 settimane)
**Focus:** eliminare bug critici, migliorare flussi chiave.
- Import CSV stabile (fornitori/prodotti).
- Rinominare/eliminare fornitori e prodotti senza perdere riferimenti.
- Backup automatici verificati.
- Pulizia UI (layout più funzionale).

**Criteri di uscita:**
- Nessun blocco operativo per almeno 7 giorni consecutivi.
- Import CSV riuscito su tutti i fogli previsti.
- Backup automatico funzionante e verificato.

---

## Fase 2 — Desktop Windows (beta)
**Focus:** rendere l’app installabile senza competenze tecniche.
- Packaging desktop (Electron o Tauri).
- DB locale: **SQLite** (file locale, backup semplice).
- Installer Windows (eseguibile).

**Criteri di uscita:**
- Installazione “one-click”.
- Nessun requisito tecnico per l’utente.
- Dati salvati localmente e backup testato.

---

## Fase 3 — Consolidamento & Mac
**Focus:** rendere il prodotto multipiattaforma.
- Build Mac (eventuale firma Apple).
- Documentazione utente semplificata.
- Flusso aggiornamenti (manuale o auto-update).

---

## Fase 4 — Evoluzione futura (opzionale)
**Solo se serve multi-utente o accesso remoto.**
- Migrazione a DB condiviso (Postgres cloud o server interno).
- Autenticazione utenti.
- Sincronizzazione tra sedi/dispositivi.

---

## Scelta DB (recap rapido)
**SQLite**
- Pro: semplice, offline, nessuna installazione.
- Contro: meno adatto a multi-utente.

**Postgres**
- Pro: scalabile, multi-utente.
- Contro: più complesso da distribuire offline.

---

## Prossimi passi suggeriti
1. Finalizzare la stabilità (bugfix + flussi import/fornitori).
2. Decidere momento “giusto” per passaggio a SQLite.
3. Preparare prototipo desktop Windows.

## Integrazione Pennylane (sviluppo futuro)
**Obiettivo:** import periodico di fatture fornitori (solo ingredienti) da Pennylane verso l’app.

### Prerequisiti
- Token Company API (v2) con permessi in lettura.
- Definire una regola di filtro "ingredienti" (categoria contabile, fornitori o tag).

### Flusso previsto (periodico)
1. Job schedulato (giornaliero/settimanale).
2. Chiamata API Pennylane per *supplier invoices* con filtri.
3. Import incrementale (solo nuove o modificate).
4. Mapping fornitori/prodotti verso listino locale.

### Opzioni di scelta (da offrire in UI)
- Selezione **categoria** (es. “Ingredienti”).
- Selezione **fornitori** inclusi.
- Frequenza: giornaliero / settimanale / manuale.
- Modalità import: **solo nuove** / **tutte** (con sovrascrittura).

### Note operative
- Per ora le categorie ingredienti sono presenti su un altro ristorante: serve mappatura coerente.
- Elenco fornitori ingredienti è abbastanza stabile: utile per filtro iniziale.

