# Stato attuale di Fiches Recettes

Ultimo aggiornamento: 7 ottobre 2026  
Branch di riferimento: `main`  

Questo documento e la fotografia operativa del progetto. Descrive cio che e realmente disponibile oggi, come sono protetti i dati esistenti e quali parti restano da sviluppare. Non sostituisce il runbook tecnico o i contratti di integrazione.

## Sintesi

Fiches Recettes e attualmente un'applicazione web multi-tenant in produzione. Permette di creare e gestire fiches tecniche, categorie, fornitori, prodotti e food cost, mantenendo separati i dati di ogni organizzazione.

La migrazione multi-tenant ha conservato le fiches storiche del campeggio nella sua organizzazione dedicata. Le nuove registrazioni creano invece una nuova organizzazione isolata e non danno accesso ai dati storici.

Frontend pubblico: <https://fiches-recettes.netlify.app>  
Frontend: Netlify  
Backend e PostgreSQL: Railway

## Funzioni operative

- Landing page pubblica con accesso, iscrizione su invito e accesso storico ChefSide.
- Account personali con password derivata tramite `scrypt` e sessione firmata temporanea.
- Creazione di una nuova organizzazione isolata al momento dell'iscrizione.
- Editor delle fiches con ingredienti, procedimento, categorie, conservazione e informazioni HACCP.
- Libreria delle fiches con ricerca, modifica, duplicazione, eliminazione ed export.
- Anteprima A4, stampa, export PDF e import/export JSON.
- Gestione di fornitori, cataloghi prodotto, codici fornitore, unita di misura e prezzi.
- Collegamento degli ingredienti ai prodotti fornitore e calcolo del food cost, con indicazione discreta dei costi parziali.
- Importazione CSV dei listini con aggiornamento non distruttivo.
- Tutorial guidato al primo accesso personale, checklist persistente e centro assistenza trilingue.
- Integrazione server-to-server con CookOps tramite token di servizio separato.

## Organizzazioni e dati

La produzione contiene l'organizzazione storica del campeggio e organizzazioni di prova separate. I conteggi e gli identificativi operativi non vengono pubblicati in questo repository. Prima di migrazioni o eliminazioni devono essere controllati direttamente sul database e confrontati con un backup recente.

## Modalita di accesso

### Account personale

L'utente accede con identificativo e password. Il token di sessione contiene utente, tenant e ruolo, scade dopo il periodo configurato ed e conservato dal browser in `sessionStorage`.

### Nuova organizzazione

Quando le iscrizioni sono abilitate, il codice d'invito permette di creare un tenant nuovo con:

- un account `owner`;
- la relativa membership;
- 20 categorie iniziali;
- nessun accesso alle fiches delle altre organizzazioni.

Il codice attuale e un segreto globale e riutilizzabile. Non e ancora un invito nominativo o monouso.

### Accesso storico ChefSide

La modalita storica con password applicativa apre esclusivamente il tenant configurato tramite `DEFAULT_TENANT_*`. E mantenuta per consentire al campeggio di continuare a lavorare senza modificare o spostare le fiches esistenti.

## Architettura e isolamento

- Il frontend e sviluppato in React, Vite e TypeScript.
- Il backend e un servizio Node.js/Express.
- I dati sono memorizzati in PostgreSQL su Railway.
- Fiches, categorie, fornitori e prodotti fornitore possiedono un `tenant_id`.
- Il tenant viene ricavato dalla sessione firmata o dal token di servizio, mai da un parametro scelto dal browser.
- Letture e scritture applicative sono filtrate per tenant.
- La migrazione dei dati storici e transazionale, quindi non puo assegnare solo una parte dei dati in caso di errore.
- CookOps usa `FICHES_SERVICE_TOKEN`; gli utenti umani non condividono questo segreto.

## Sicurezza attuale

- In produzione il server rifiuta di avviarsi se mancano i segreti obbligatori.
- Lo sviluppo senza autenticazione richiede l'opzione esplicita `AUTH_DISABLED=true`.
- Le password personali non sono conservate in chiaro.
- La password storica non viene inclusa nel bundle frontend e non viene salvata dal browser.
- Le sessioni personali vengono revocate immediatamente se l'utente e disattivato o perde la membership nel tenant.
- L'accesso storico puo essere disattivato separatamente tramite `LEGACY_LOGIN_ENABLED`.
- Il reset del database non e registrato normalmente; richiede l'abilitazione esplicita e un secondo token.
- CORS limita le origini frontend autorizzate.
- Il login e protetto da rate limiting in memoria, adeguato all'attuale singola istanza Railway.

Il rate limiting dovra essere trasferito a uno storage condiviso, come Redis, prima di usare piu istanze backend.

## Backup e verifiche

I backup Railway vengono salvati localmente in `backups/` e non sono versionati. Il nome e la data dell'ultimo file devono essere verificati sul computer operativo prima di ogni intervento sui dati.

Comandi principali:

```powershell
npm run backup:railway
npm run db:counts
npm run test:server
npm run lint
npm run build
```

Stato dell'ultima verifica completa:

- 12 test server superati.
- ESLint senza errori o warning.
- Build TypeScript/Vite completata.
- Rimane soltanto l'avviso Vite sulla dimensione del bundle, non bloccante.

## Limiti noti e prossimi sviluppi

- Inviti nominativi, monouso e con scadenza per aggiungere utenti a un tenant esistente.
- Pannello di amministrazione per membri, ruoli e organizzazione.
- Migrazione degli utenti del campeggio dall'accesso storico ad account personali.
- Recupero password e verifica dell'indirizzo email.
- Registro di audit per operazioni sensibili.
- Rate limiting condiviso prima della scalabilita orizzontale.
- Separazione del bundle frontend per ridurre il caricamento iniziale.
- Strategia definitiva per foto e documenti su object storage.
- Funzioni commerciali SaaS, fatturazione e gestione abbonamenti.
- Ulteriore sviluppo del supporto operativo e dell'assistente AI.

## Documentazione collegata

- [`00_PRODUCT_SCOPE.md`](00_PRODUCT_SCOPE.md): perimetro funzionale del prodotto.
- [`01_OPERATIONS_RUNBOOK.md`](01_OPERATIONS_RUNBOOK.md): procedure operative e manutenzione.
- [`02_DATA_MODEL_AND_CONTRACTS.md`](02_DATA_MODEL_AND_CONTRACTS.md): modello dati e semantica dei campi.
- [`03_ROADMAP.md`](03_ROADMAP.md): roadmap storica, da riallineare allo stato multi-tenant.
- [`COOKOPS_INTEGRATION_CONTRACT.md`](COOKOPS_INTEGRATION_CONTRACT.md): contratto di integrazione con CookOps.

