# Battaglia Navale P2P — PWA prototipo

PWA statica per giocare a Battaglia Navale tra due telefoni usando WebRTC DataChannel.

Non usa Firebase, database o backend di gioco. Il collegamento iniziale avviene con due codici:

1. Host crea partita e copia il codice offerta.
2. Guest incolla l'offerta e genera il codice risposta.
3. Host incolla la risposta.
4. Il canale P2P si apre e le mosse passano automaticamente.

## Come provarla velocemente

### Opzione consigliata: GitHub Pages

1. Crea un repository GitHub.
2. Carica tutti i file di questa cartella nella root del repository.
3. Vai in `Settings > Pages`.
4. Source: `Deploy from a branch`.
5. Branch: `main`, folder `/root`.
6. Apri l'URL GitHub Pages da entrambi i telefoni.

GitHub Pages serve la PWA in HTTPS, condizione importante per WebRTC/PWA su mobile.

### Opzione locale

Da questa cartella:

```bash
python3 -m http.server 8080
```

Poi apri `http://localhost:8080` sul computer. Per provarla su due telefoni è meglio GitHub Pages, perché molti browser mobile limitano le funzioni PWA/WebRTC su HTTP non sicuro.

## Flusso di gioco

1. Telefono A: `Crea partita`.
2. Telefono A: copia/condividi `Offerta WebRTC`.
3. Telefono B: `Unisciti`, incolla l'offerta, genera risposta.
4. Telefono B: copia/condividi la risposta.
5. Telefono A: incolla risposta e completa collegamento.
6. Entrambi posizionano la flotta o usano `Auto-piazza`.
7. Entrambi premono `Conferma flotta`.
8. L'host inizia.

## Limiti noti del prototipo

- Se si ricarica la pagina, la connessione WebRTC va rifatta.
- Alcune reti mobili/NAT restrittivi possono bloccare la connessione diretta.
- Per maggiore affidabilità servirebbe un server TURN o un piccolo signaling server.
- Non c'è anti-cheat forte: ogni giocatore conserva la propria flotta localmente.
- La lettura/invio automatico di WhatsApp/SMS non è disponibile da PWA pura.

## File principali

- `index.html`: struttura UI.
- `styles.css`: stile mobile-first.
- `app.js`: logica WebRTC + gioco.
- `manifest.webmanifest`: installabilità PWA.
- `sw.js`: cache base offline.
