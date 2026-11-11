# homebridge-fake-homekey

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

English: [README.md](README.md)

Serratura finta per Homebridge che espone il servizio HomeKit **NFC Access**, così l'app Casa può aggiungere una **Home Key** al Wallet senza nessuna serratura né lettore NFC.

## Cosa fa (e cosa no)

- Pubblica una serratura (Lock Mechanism + Lock Management + NFC Access) come accessorio esterno, cioè con un abbinamento HomeKit suo, separato dal bridge.
- Risponde ai comandi TLV8 che l'iPhone scrive su "NFC Access Control Point": riceve la chiave del lettore e le credenziali dei dispositivi, le salva e risponde come una serratura vera.
- **Non c'è la parte NFC.** Avvicinare l'iPhone a qualcosa non farà niente: la chiave compare nel Wallet e basta. Per un lettore vero serve un progetto come HomeKey-ESP32.
- La serratura non pilota hardware. Aprire o chiudere dall'app Casa cambia solo lo stato simulato (con richiusura automatica opzionale).

## Stato di verifica

- **Testato e funzionante**: la Home Key viene aggiunta al Wallet dell'iPhone tramite l'app Casa.
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
| `resetState` | Cancella chiave del lettore e credenziali salvate (da usare per un solo avvio) |

## Abbinamento

1. Riavvia Homebridge. Nel log compare "Accessorio ... pubblicato" con il codice QR.
2. Nell'app Casa: Aggiungi accessorio, inquadra il QR (il PIN è quello del bridge Homebridge).
3. Dalle impostazioni della serratura nell'app Casa dovrebbe comparire l'opzione per aggiungere la chiave al Wallet.

Requisiti lato Apple: iPhone XS o successivo, hub Casa (HomePod o Apple TV) configurato, iOS aggiornato.

## Rifare tutto da capo

1. Rimuovi la serratura dall'app Casa e la chiave dal Wallet.
2. Metti `"resetState": true`, riavvia Homebridge, poi rimetti `false`.

## Sicurezza

Lo stato è in `<cartella persist di Homebridge>/homebridge-fake-homekey.*.json` (permessi 0600) e contiene la chiave privata del lettore. Non condividerlo e non incollarlo nei log pubblici. Il plugin non scrive mai le chiavi nei log.

## Test

```bash
npm install
npm test
```

## Crediti

Il protocollo è documentato dal lavoro di [@kupa22](https://github.com/kupa22/apple-homekey) e [@kormax](https://github.com/kormax/apple-home-key). Progetto non affiliato né approvato da Apple. "Home Key" e "Wallet" sono marchi di Apple Inc.

## Licenza

[MIT](LICENSE)
