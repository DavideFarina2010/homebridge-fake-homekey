# homebridge-fake-homekey

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

English: [README.md](README.md)

Serratura finta per Homebridge che espone il servizio HomeKit **NFC Access**, così l'app Casa può aggiungere una **Home Key** al Wallet senza nessuna serratura né lettore NFC.

## Cosa fa (e cosa no)

- Pubblica una serratura (Lock Mechanism + Lock Management + NFC Access, più Access Code se abilitato) come accessorio esterno, cioè con un abbinamento HomeKit suo, separato dal bridge.
- Risponde ai comandi TLV8 che l'iPhone scrive su "NFC Access Control Point": riceve la chiave del lettore e le credenziali dei dispositivi, le salva e risponde come una serratura vera.
- Facoltativamente (`accessCodes`) permette all'app Casa di salvare **codici PIN personali** per la serratura. Vengono solo memorizzati: senza tastierino non aprono niente.
- **Non c'è la parte NFC.** Avvicinare l'iPhone a qualcosa non farà niente: la chiave compare nel Wallet e basta. Per un lettore vero serve un progetto come HomeKey-ESP32.
- La serratura non pilota hardware. Aprire o chiudere dall'app Casa cambia solo lo stato simulato (con richiusura automatica opzionale).

## Stato di verifica

- **Testato e funzionante**: la Home Key viene aggiunta al Wallet dell'iPhone tramite l'app Casa.
- **Codici PIN personali** (iOS 18+): l'aggiunta di un PIN dall'app Casa viene accettata e l'app lo rilegge. Rimozione e modifica sono implementate dallo stesso protocollo ma non ancora verificate su un iPhone vero.
- Coperti dai test automatici: logica TLV, valori di esempio della documentazione di kupa22, round-trip su HAP-NodeJS 2.3 (write-response), avvio dentro Homebridge 2.5.
- Il protocollo è ricostruito da reverse engineering e alcuni dettagli non sono documentati (formato della rimozione di una credenziale, significato di "Configuration State", operazione "get" delle credenziali). Se l'app Casa non propone la Home Key, guarda il log di Homebridge con `-D`: ogni richiesta NFC Access viene registrata.

## Installazione

Serve Homebridge 1.8+ o 2.x (Node 20.15+).

```bash
npm install -g homebridge-fake-homekey
```

Oppure dall'interfaccia di Homebridge, cercando "Fake Home Key". Per installare da sorgente: `git clone https://github.com/DavideFarina2010/homebridge-fake-homekey` e `npm install -g ./homebridge-fake-homekey`.

Poi aggiungi alla config di Homebridge (o usa l'interfaccia web, il plugin ha uno schema):

```json
{
  "platforms": [
    {
      "platform": "FakeHomeKey",
      "name": "Porta Finta",
      "finish": "tan",
      "autoLockSeconds": 5
    }
  ]
}
```

| Opzione | Significato |
| --- | --- |
| `name` | Nome dell'accessorio in Casa |
| `finish` | Colore della chiave nel Wallet: `tan`, `gold`, `silver`, `black` |
| `autoLockSeconds` | Richiusura automatica simulata, `0` = mai |
| `serialNumber` | Numero di serie mostrato in Casa |
| `accessCodes` | Abilita i codici PIN personali nell'app Casa (spento di default, vedi sotto) |
| `resetState` | Cancella chiave del lettore e credenziali salvate (da usare per un solo avvio) |

## Abbinamento

1. Riavvia Homebridge. Nel log compare "Accessorio ... pubblicato" con il codice QR.
2. Nell'app Casa: Aggiungi accessorio, inquadra il QR (il PIN è quello del bridge Homebridge).
3. Dalle impostazioni della serratura nell'app Casa dovrebbe comparire l'opzione per aggiungere la chiave al Wallet.

Requisiti lato Apple: iPhone XS o successivo, hub Casa (HomePod o Apple TV) configurato, iOS aggiornato.

## Codici PIN personali

Metti `"accessCodes": true` e riavvia Homebridge. La serratura espone allora il servizio HomeKit **Access Code** (da 4 a 8 cifre, fino a 100 codici), che l'app Casa (iOS 18+) usa per "Sblocca con un codice di accesso personale" e per i codici degli ospiti.

- I codici sono nel file di stato del plugin e sopravvivono ai riavvii. `resetState` li cancella.
- **Non servono a niente di concreto**: non c'è un tastierino e non c'è nulla da aprire.
- Il protocollo Access Code non è documentato ufficialmente. È ricostruito dal traffico dell'app Casa e dal progetto open source [HomeKey-ESP32](https://github.com/rednblkx/HomeKey-ESP32). Se l'app Casa mostra un errore, apri una issue.
- Se la serratura era già abbinata prima di abilitare l'opzione, l'app Casa può impiegare un po' (o un riavvio dell'app) per accorgersi del nuovo servizio.

## Rifare tutto da capo

1. Rimuovi la serratura dall'app Casa e la chiave dal Wallet.
2. Metti `"resetState": true`, riavvia Homebridge, poi rimetti `false`.

## Sicurezza

Lo stato è in `<cartella persist di Homebridge>/homebridge-fake-homekey.*.json` (permessi 0600) e contiene la chiave privata del lettore e, se abilitati, i codici PIN. Non condividerlo e non incollarlo nei log pubblici. Il plugin non scrive mai chiavi o PIN nei log.

## Test

```bash
npm install
npm test
```

## Crediti

Il protocollo è documentato dal lavoro di [@kupa22](https://github.com/kupa22/apple-homekey) e [@kormax](https://github.com/kormax/apple-home-key). Il formato Access Code deve molto a [HomeKey-ESP32](https://github.com/rednblkx/HomeKey-ESP32). Progetto non affiliato né approvato da Apple. "Home Key" e "Wallet" sono marchi di Apple Inc.

## Licenza

[MIT](LICENSE)
