'use strict';

/**
 * Lato HAP del protocollo Apple Home Key ("NFC Access").
 *
 * Basato sul lavoro di reverse engineering di @kupa22 (apple-homekey) e @kormax
 * (apple-home-key / apple-home-key-reader). Nessuna parte NFC: questo modulo si
 * limita a rispondere ai comandi TLV8 che l'iPhone scrive sulla caratteristica
 * "NFC Access Control Point" quando aggiunge la chiave al Wallet.
 *
 * Il modulo non dipende da Homebridge, quindi si puo' testare da solo.
 */

const crypto = require('node:crypto');

// --- TLV8 --------------------------------------------------------------

function tlvEncode(...entries) {
  const out = [];
  for (const [type, raw] of entries) {
    const data = typeof raw === 'number' ? Buffer.from([raw]) : Buffer.from(raw);
    if (data.length === 0) {
      out.push(Buffer.from([type, 0]));
      continue;
    }
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      out.push(Buffer.from([type, chunk.length]), chunk);
    }
  }
  return Buffer.concat(out);
}

function tlvDecode(buffer) {
  const result = {};
  let offset = 0;
  let previousType = -1;
  while (offset + 2 <= buffer.length) {
    const type = buffer[offset];
    const length = buffer[offset + 1];
    const start = offset + 2;
    if (start + length > buffer.length) {
      throw new Error('TLV8 truncated');
    }
    const value = buffer.subarray(start, start + length);
    // Valori piu' lunghi di 255 byte arrivano frammentati in voci consecutive dello stesso tipo.
    if (type === previousType && result[type]) {
      result[type] = Buffer.concat([result[type], value]);
    } else {
      result[type] = Buffer.from(value);
    }
    previousType = type;
    offset = start + length;
  }
  return result;
}

// --- Costanti ----------------------------------------------------------

const Operation = { GET: 1, ADD: 2, REMOVE: 3 };

const Tag = {
  OPERATION: 0x01,
  DEVICE_CREDENTIAL_REQUEST: 0x04,
  DEVICE_CREDENTIAL_RESPONSE: 0x05,
  READER_KEY_REQUEST: 0x06,
  READER_KEY_RESPONSE: 0x07,
};

const Status = {
  SUCCESS: 0,
  OUT_OF_RESOURCES: 1,
  DUPLICATE: 2,
  DOES_NOT_EXIST: 3,
  NOT_SUPPORTED: 4,
};

const KEY_TYPE_SECP256R1 = 2;
const READER_ID_PREFIX = Buffer.from('key-identifier', 'ascii');

// Colori della chiave nel Wallet (Hardware Finish, TLV tag 1, 4 byte).
const FINISH_COLORS = {
  tan: 0xced5da00,
  gold: 0xaad6ec00,
  silver: 0xe3e3e300,
  black: 0x00000000,
};

function hardwareFinishValue(finish) {
  const color = FINISH_COLORS[finish] ?? FINISH_COLORS.tan;
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(color >>> 0);
  return tlvEncode([1, bytes]);
}

/** Valore di "NFC Access Supported Configuration": numero di issuer key e di credenziali inattive. */
function supportedConfigurationValue(maxIssuers = 0x10, maxInactive = 0x10) {
  return tlvEncode([1, maxIssuers], [2, maxInactive]);
}

// --- Identificatori -----------------------------------------------------

/** SHA256("key-identifier" || readerPrivateKey), primi 8 byte. */
function readerIdentifier(readerPrivateKey) {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([READER_ID_PREFIX, readerPrivateKey]))
    .digest()
    .subarray(0, 8);
}

/** SHA1(0x04 || devicePublicKey), primi 6 byte. */
function deviceCredentialIdentifier(publicKey) {
  return crypto
    .createHash('sha1')
    .update(Buffer.concat([Buffer.from([0x04]), publicKey]))
    .digest()
    .subarray(0, 6);
}

// --- Controller ----------------------------------------------------------

/**
 * Stato persistito (tutto in esadecimale, serializzabile in JSON):
 * {
 *   reader: { privateKey, uniqueId, identifier } | null,
 *   endpoints: [{ id, publicKey, issuerId, active, addedAt }]
 * }
 */
function emptyState() {
  return { reader: null, endpoints: [] };
}

class NfcAccessController {
  /**
   * @param {object} options
   * @param {object} options.state          stato (vedi sopra), modificato in place
   * @param {() => void} options.onChange   chiamata dopo ogni modifica dello stato
   * @param {object} [options.log]          oggetto con info/warn/debug
   * @param {number} [options.maxEndpoints] limite di credenziali accettate
   */
  constructor({ state, onChange = () => {}, log = {}, maxEndpoints = 16 }) {
    this.state = state;
    this.onChange = onChange;
    this.log = {
      info: log.info?.bind(log) ?? (() => {}),
      warn: log.warn?.bind(log) ?? (() => {}),
      debug: log.debug?.bind(log) ?? (() => {}),
    };
    this.maxEndpoints = maxEndpoints;
  }

  /** Riceve il valore scritto (base64) e restituisce la risposta (base64). */
  handleControlPoint(base64Value) {
    const request = tlvDecode(Buffer.from(base64Value, 'base64'));
    const operation = request[Tag.OPERATION]?.[0];

    let response = Buffer.alloc(0);
    if (request[Tag.READER_KEY_REQUEST] !== undefined) {
      response = this.#readerKey(operation, tlvDecode(request[Tag.READER_KEY_REQUEST]));
    } else if (request[Tag.DEVICE_CREDENTIAL_REQUEST] !== undefined) {
      response = this.#deviceCredential(operation, tlvDecode(request[Tag.DEVICE_CREDENTIAL_REQUEST]));
    } else {
      this.log.warn(`Unrecognized NFC Access request (operation ${operation})`);
    }
    return response.toString('base64');
  }

  #readerKey(operation, sub) {
    const reader = this.state.reader;

    if (operation === Operation.GET) {
      this.log.debug('NFC Access: get reader key');
      return reader
        ? tlvEncode([Tag.READER_KEY_RESPONSE, tlvEncode([1, Buffer.from(reader.identifier, 'hex')])])
        : Buffer.alloc(0);
    }

    if (operation === Operation.ADD) {
      const keyType = sub[1]?.[0];
      const privateKey = sub[2];
      const uniqueId = sub[3];
      if (keyType !== KEY_TYPE_SECP256R1 || !privateKey || privateKey.length !== 32) {
        return this.#readerStatus(Status.NOT_SUPPORTED);
      }
      const identifier = readerIdentifier(privateKey).toString('hex');
      if (reader && reader.identifier === identifier) {
        return this.#readerStatus(Status.DUPLICATE);
      }
      this.state.reader = {
        privateKey: privateKey.toString('hex'),
        uniqueId: (uniqueId ?? Buffer.alloc(8)).toString('hex'),
        identifier,
      };
      this.log.info(`NFC Access: reader key configured (identifier ${identifier})`);
      this.onChange();
      return this.#readerStatus(Status.SUCCESS);
    }

    if (operation === Operation.REMOVE) {
      const keyId = sub[4]?.toString('hex');
      if (!reader || (keyId && keyId !== reader.identifier)) {
        return this.#readerStatus(Status.DOES_NOT_EXIST);
      }
      // Senza reader key le credenziali dei dispositivi non servono piu'.
      this.state.reader = null;
      this.state.endpoints = [];
      this.log.info('NFC Access: reader key removed');
      this.onChange();
      return this.#readerStatus(Status.SUCCESS);
    }

    this.log.warn(`NFC Access: unknown reader key operation (${operation})`);
    return Buffer.alloc(0);
  }

  #deviceCredential(operation, sub) {
    if (operation === Operation.ADD) {
      const keyType = sub[1]?.[0];
      const publicKey = sub[2];
      const issuerId = sub[3];
      const active = (sub[4]?.[0] ?? 1) === 1;
      if (keyType !== KEY_TYPE_SECP256R1 || !publicKey || publicKey.length !== 64 || !issuerId) {
        return this.#credentialStatus(Status.NOT_SUPPORTED, issuerId);
      }
      const id = deviceCredentialIdentifier(publicKey).toString('hex');
      if (this.state.endpoints.some((e) => e.id === id)) {
        return this.#credentialStatus(Status.DUPLICATE, issuerId);
      }
      if (this.state.endpoints.length >= this.maxEndpoints) {
        return this.#credentialStatus(Status.OUT_OF_RESOURCES, issuerId);
      }
      this.state.endpoints.push({
        id,
        publicKey: publicKey.toString('hex'),
        issuerId: issuerId.toString('hex'),
        active,
        addedAt: new Date().toISOString(),
      });
      this.log.info(`NFC Access: device credential added (${id}, issuer ${issuerId.toString('hex')})`);
      this.onChange();
      return this.#credentialStatus(Status.SUCCESS, issuerId);
    }

    if (operation === Operation.REMOVE) {
      // Il formato esatto del tag 5 non e' documentato: accetto id (6 byte) o chiave pubblica.
      const wanted = sub[5]?.toString('hex');
      const index = wanted
        ? this.state.endpoints.findIndex((e) => e.id === wanted || e.publicKey === wanted)
        : -1;
      if (index < 0) {
        return this.#credentialStatus(Status.DOES_NOT_EXIST);
      }
      const [removed] = this.state.endpoints.splice(index, 1);
      this.log.info(`NFC Access: device credential removed (${removed.id})`);
      this.onChange();
      return this.#credentialStatus(Status.SUCCESS);
    }

    if (operation === Operation.GET) {
      this.log.debug('NFC Access: get device credential (undocumented)');
      return Buffer.alloc(0);
    }

    this.log.warn(`NFC Access: unknown device credential operation (${operation})`);
    return Buffer.alloc(0);
  }

  #readerStatus(status) {
    return tlvEncode([Tag.READER_KEY_RESPONSE, tlvEncode([2, status])]);
  }

  #credentialStatus(status, issuerId) {
    const inner = issuerId ? tlvEncode([2, issuerId], [3, status]) : tlvEncode([3, status]);
    return tlvEncode([Tag.DEVICE_CREDENTIAL_RESPONSE, inner]);
  }
}

module.exports = {
  Operation,
  Tag,
  Status,
  FINISH_COLORS,
  tlvEncode,
  tlvDecode,
  hardwareFinishValue,
  supportedConfigurationValue,
  readerIdentifier,
  deviceCredentialIdentifier,
  emptyState,
  NfcAccessController,
};
