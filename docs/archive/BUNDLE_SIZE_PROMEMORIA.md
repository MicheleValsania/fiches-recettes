# Promemoria Bundle Size

Data: 2026-02-13

## Stato attuale

- La build passa (`npm run build` OK).
- Vite mostra un warning sui chunk grandi:
  - `dist/assets/index-DyanUl5c.js` ~833.78 kB (gzip ~249.03 kB).
- Il warning non blocca build o runtime, ma indica possibile miglioramento performance sul primo caricamento.

## Decisione corrente

- Non intervenire ora sul bundle splitting.
- Rimandare ottimizzazione per ridurre rischio regressioni in questa fase.

## Prossimi passi (quando si decide di intervenire)

1. Spostare `html2canvas` e `jspdf` in import dinamici (lazy load) nel flusso export PDF.
2. Valutare separazione del flusso PDF ZIP in chunk dedicato.
3. Verificare dopo ogni modifica:
   - build
   - export PDF singolo
   - export PDF ZIP

