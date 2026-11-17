'use strict';

const { tlvEncode } = require('./protocol');

// Personal PIN codes (HomeKit Access Code service, 0x260).
//
// The Access Code Control Point (0x262) wire format is not officially documented. It comes from
// Home app traffic captured on iOS 18 and from the open source HomeKey-ESP32 implementation
// (rednblkx/HomeKey-ESP32, AccessCodeManager.cpp).
//
//   request   01 01 <op> [ 02 <len> <entry> ]...     entry: 01 <id>, 02 <PIN as ASCII digits>
//   response  01 01 <op> [ 03 <len> <fragment> ]...  fragments separated by 00 00
//   fragment  01 <id> | 02 <PIN> (if any) | 03 01 <flags> | 04 01 <status>
const Tag = { OPERATION: 1, REQUEST: 2, RESPONSE: 3, IDENTIFIER: 1, ACCESS_CODE: 2, FLAGS: 3, STATUS: 4 };
const Operation = { LIST: 1, READ: 2, ADD: 3, UPDATE: 4, REMOVE: 5 };
const Status = {
  SUCCESS: 0x00,
  EXCEEDED_MAX: 0x02,
  DUPLICATE: 0x04,
  TOO_SHORT: 0x05,
  TOO_LONG: 0x06,
  INVALID_CHAR: 0x07,
  INVALID_REQUEST: 0x08,
  DOES_NOT_EXIST: 0x09,
};

// Must match the value advertised in AccessCodeSupportedConfiguration (digits, 4-8, max 100).
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;
const MAX_CODES = 100;

/** Ordered [type, value] list: unlike tlvDecode it keeps repeated tags (one per request entry). */
function tlvItems(buffer) {
  const items = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const length = buffer[offset + 1];
    if (offset + 2 + length > buffer.length) throw new Error('TLV8 truncated');
    items.push([buffer[offset], buffer.subarray(offset + 2, offset + 2 + length)]);
    offset += 2 + length;
  }
  return items;
}

function idBuffer(id) {
  // One byte while it fits, little endian on two bytes beyond that.
  return id < 256 ? Buffer.from([id]) : Buffer.from([id & 0xff, id >> 8]);
}

function readId(value) {
  if (value === undefined || value.length === 0) return undefined;
  return value.length === 1 ? value[0] : value.readUInt16LE(0);
}

class AccessCodeController {
  /**
   * @param {object} options
   * @param {object} [options.log]
   * @param {Array<{id:number, code:string}>} [options.codes] stored list, mutated in place
   * @param {() => void} [options.onChange] called after every change of the list
   */
  constructor({ log = {}, codes = [], onChange = () => {} } = {}) {
    this.log = log;
    this.codes = codes;
    this.onChange = onChange;
    this.nextId = codes.reduce((max, c) => Math.max(max, c.id), 0) + 1;
  }

  handleControlPoint(base64Value) {
    const items = tlvItems(Buffer.from(base64Value, 'base64'));
    const opItem = items.find(([type]) => type === Tag.OPERATION);
    if (!opItem) return '';
    const operation = opItem[1][0];

    // Each request entry is a nested TLV.
    const entries = items.filter(([type]) => type === Tag.REQUEST).map(([, value]) => {
      const fields = Object.fromEntries(tlvItems(value));
      return { id: readId(fields[Tag.IDENTIFIER]), code: fields[Tag.ACCESS_CODE]?.toString('ascii') };
    });

    let fragments;
    switch (operation) {
      case Operation.LIST:
        fragments = this.codes.map((c) => this.#fragment(c, Status.SUCCESS));
        break;
      case Operation.READ:
        fragments = entries
          .filter((e) => e.id !== undefined)
          .map((e) => this.#lookup(e.id, (c) => this.#fragment(c, Status.SUCCESS)));
        break;
      case Operation.ADD:
        if (entries[0]?.code === undefined) return '';
        fragments = [this.#add(entries[0].code)];
        break;
      case Operation.UPDATE:
        if (entries[0]?.id === undefined || entries[0].code === undefined) return '';
        fragments = [this.#update(entries[0].id, entries[0].code)];
        break;
      case Operation.REMOVE:
        fragments = entries.map((e) => this.#remove(e.id));
        break;
      default:
        this.log.warn?.(`unhandled Access Code operation ${operation}`);
        return '';
    }
    return this.#encode(operation, fragments).toString('base64');
  }

  #encode(operation, fragments) {
    const entries = [[Tag.OPERATION, operation]];
    fragments.forEach((fragment, index) => {
      if (index > 0) entries.push([0, Buffer.alloc(0)]); // separator between fragments
      entries.push([Tag.RESPONSE, fragment]);
    });
    return tlvEncode(...entries);
  }

  #fragment({ id, code }, status) {
    const entries = [[Tag.IDENTIFIER, idBuffer(id)]];
    if (code) entries.push([Tag.ACCESS_CODE, Buffer.from(code, 'ascii')]);
    entries.push([Tag.FLAGS, 0], [Tag.STATUS, status]);
    return tlvEncode(...entries);
  }

  #lookup(id, found) {
    const code = this.codes.find((c) => c.id === id);
    return code ? found(code) : this.#fragment({ id }, Status.DOES_NOT_EXIST);
  }

  #validate(code, ignoreId) {
    if (code.length < MIN_LENGTH) return Status.TOO_SHORT;
    if (code.length > MAX_LENGTH) return Status.TOO_LONG;
    if (!/^\d+$/.test(code)) return Status.INVALID_CHAR;
    if (this.codes.some((c) => c.code === code && c.id !== ignoreId)) return Status.DUPLICATE;
    return Status.SUCCESS;
  }

  #add(code) {
    let status = this.#validate(code);
    if (status === Status.SUCCESS && this.codes.length >= MAX_CODES) status = Status.EXCEEDED_MAX;
    if (status !== Status.SUCCESS) return this.#fragment({ id: 0, code }, status);
    const entry = { id: this.nextId++, code };
    this.codes.push(entry);
    this.log.info?.(`access code added (${code.length} digits), ${this.codes.length} stored`);
    this.onChange();
    return this.#fragment(entry, Status.SUCCESS);
  }

  #update(id, code) {
    const entry = this.codes.find((c) => c.id === id);
    if (!entry) return this.#fragment({ id, code }, Status.DOES_NOT_EXIST);
    const status = this.#validate(code, id);
    if (status !== Status.SUCCESS) return this.#fragment({ id, code }, status);
    entry.code = code;
    this.log.info?.(`access code ${id} updated`);
    this.onChange();
    return this.#fragment(entry, Status.SUCCESS);
  }

  #remove(id) {
    if (id === undefined) return this.#fragment({ id: 0 }, Status.INVALID_REQUEST);
    const index = this.codes.findIndex((c) => c.id === id);
    if (index === -1) return this.#fragment({ id }, Status.DOES_NOT_EXIST);
    const [removed] = this.codes.splice(index, 1);
    this.log.info?.(`access code ${id} removed, ${this.codes.length} stored`);
    this.onChange();
    return this.#fragment(removed, Status.SUCCESS);
  }
}

module.exports = { AccessCodeController };
