# homebridge-fake-homekey

[![npm](https://img.shields.io/npm/v/homebridge-fake-homekey)](https://www.npmjs.com/package/homebridge-fake-homekey)
[![license](https://img.shields.io/npm/l/homebridge-fake-homekey)](LICENSE)

Italiano: [README.it.md](README.it.md)

A fake lock for Homebridge that exposes the HomeKit **NFC Access** service, so the Home app can add an **Apple Home Key** to Wallet with no lock and no NFC reader.

## What it does (and what it doesn't)

- Publishes a lock (Lock Mechanism + Lock Management + NFC Access) as an external accessory, i.e. with its own HomeKit pairing, separate from the bridge.
- Answers the TLV8 commands the iPhone writes to the "NFC Access Control Point": it receives the reader key and the device credentials, stores them and replies like a real lock.
- **There is no NFC part.** Holding the iPhone near something does nothing: the key shows up in Wallet and that's it. For a real reader you need a project such as HomeKey-ESP32.
- The lock does not drive any hardware. Locking or unlocking from the Home app only changes a simulated state (with optional automatic re-lock).

## Verification status

- **Tested and working**: the Home Key is added to the iPhone's Wallet through the Home app.
- Covered by automated tests: TLV logic, example values from kupa22's documentation, HAP-NodeJS 2.3 round-trip (write-response), startup inside Homebridge 2.5.
- The protocol is reverse-engineered and some details are undocumented (format of credential removal, meaning of "Configuration State", the credential "get" operation). If the Home app doesn't offer the Home Key, run Homebridge with `-D`: every NFC Access request is logged.

## Installation

Requires Homebridge 1.8+ or 2.x (Node 20.15+).

```bash
npm install -g homebridge-fake-homekey
```

Or search for "Fake Home Key" in the Homebridge UI. To install from source: `git clone https://github.com/DavideFarina2010/homebridge-fake-homekey` then `npm install -g ./homebridge-fake-homekey`.

Then add to your Homebridge config (or use the web UI, the plugin ships a schema):

```json
{
  "platforms": [
    {
      "platform": "FakeHomeKey",
      "name": "Fake Door",
      "finish": "tan",
      "autoLockSeconds": 5
    }
  ]
}
```

| Option | Meaning |
| --- | --- |
| `name` | Accessory name in the Home app |
| `finish` | Key color in Wallet: `tan`, `gold`, `silver`, `black` |
| `autoLockSeconds` | Simulated automatic re-lock, `0` = never |
| `serialNumber` | Serial number shown in the Home app |
| `resetState` | Clears the reader key and stored credentials (use for a single restart) |

## Pairing

1. Restart Homebridge. The log shows "Accessory ... published" with the QR code.
2. In the Home app: Add Accessory, scan the QR code (the PIN is the Homebridge bridge PIN).
3. In the lock's settings in the Home app, the option to add the key to Wallet should appear.

Apple requirements: iPhone XS or later, a configured home hub (HomePod or Apple TV), up-to-date iOS.

## Starting over

1. Remove the lock from the Home app and the key from Wallet.
2. Set `"resetState": true`, restart Homebridge, then set it back to `false`.

## Security

State is stored in `<Homebridge persist folder>/homebridge-fake-homekey.*.json` (permissions 0600) and contains the reader's private key. Don't share it or paste it in public logs. The plugin never writes keys to the logs.

## Tests

```bash
npm install
npm test
```

## Credits

The protocol is documented by the work of [@kupa22](https://github.com/kupa22/apple-homekey) and [@kormax](https://github.com/kormax/apple-home-key). Not affiliated with or endorsed by Apple. "Home Key" and "Wallet" are trademarks of Apple Inc.

## License

[MIT](LICENSE)
