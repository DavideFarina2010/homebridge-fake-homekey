# Changelog

## 0.1.4

- Delete leftover state files (with the reader key) when the accessory is renamed.
- Cap `autoLockSeconds` at 86400 to avoid Node's 32-bit timer overflow.
- Translate the last Italian error message.
- Add the Verified by Homebridge badge.

## 0.1.3

- Add `supports-hap` keyword.
- Fix config schema: `required` is now an array at object level.

## 0.1.2

- CI now tests Node 22, 24 and 26.

## 0.1.1

- English README (Italian moved to `README.it.md`), English log messages and config schema.
- Corrupted state file no longer blocks startup.
- Firmware revision follows the package version.

## 0.1.0

- Prima versione: serratura simulata con servizio NFC Access, provisioning della Home Key nel Wallet tramite l'app Casa.
- Stato persistente (chiave del lettore e credenziali) con permessi 0600.
- Schema di configurazione per l'interfaccia di Homebridge.
