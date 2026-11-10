'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  NfcAccessController,
  emptyState,
  tlvEncode,
  tlvDecode,
  hardwareFinishValue,
  supportedConfigurationValue,
  readerIdentifier,
  deviceCredentialIdentifier,
} = require('../lib/protocol');

const hex = (b) => Buffer.from(b, 'base64').toString('hex');
const b64 = (hexString) => Buffer.from(hexString, 'hex').toString('base64');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function makeController(maxEndpoints) {
  const state = emptyState();
  let changes = 0;
  const controller = new NfcAccessController({ state, onChange: () => changes++, maxEndpoints });
  return { controller, state, changes: () => changes };
}

(async () => {
  // Valori d'esempio presi dalla documentazione di kupa22/apple-homekey.
  await test('valori statici identici agli esempi documentati', () => {
    assert.equal(hardwareFinishValue('tan').toString('hex'), '0104ced5da00');
    assert.equal(hardwareFinishValue('gold').toString('hex'), '0104aad6ec00');
    assert.equal(supportedConfigurationValue().toString('hex'), '010110020110');
  });

  await test('TLV8: frammentazione oltre 255 byte', () => {
    const big = crypto.randomBytes(600);
    const decoded = tlvDecode(tlvEncode([9, big], [1, 7]));
    assert.ok(decoded[9].equals(big));
    assert.equal(decoded[1][0], 7);
  });

  await test('get reader key senza chiave configurata -> risposta vuota', () => {
    const { controller } = makeController();
    assert.equal(controller.handleControlPoint(b64('010101' + '0600')), '');
  });

  await test('add reader key -> status success (07 03 02 01 00)', () => {
    const { controller, state, changes } = makeController();
    const priv = crypto.randomBytes(32);
    const request = Buffer.concat([
      tlvEncode([1, 2]),
      tlvEncode([6, tlvEncode([1, 2], [2, priv], [3, Buffer.from('a1b2c3d4e5f6a7b8', 'hex')])]),
    ]);
    assert.equal(hex(controller.handleControlPoint(request.toString('base64'))), '07030201' + '00');
    assert.equal(state.reader.identifier, readerIdentifier(priv).toString('hex'));
    assert.equal(changes(), 1);

    // Stessa chiave di nuovo -> duplicate
    assert.equal(hex(controller.handleControlPoint(request.toString('base64'))), '07030201' + '02');

    // get ora restituisce l'identificatore (07 0a 01 08 <id>)
    const got = hex(controller.handleControlPoint(b64('010101' + '0600')));
    assert.equal(got, '070a0108' + state.reader.identifier);
  });

  await test('add device credential -> 05 0d 02 08 <issuer> 03 01 00', () => {
    const { controller, state } = makeController();
    const pub = crypto.randomBytes(64);
    const issuer = Buffer.from('12ab34cd56ef0815', 'hex');
    const request = Buffer.concat([
      tlvEncode([1, 2]),
      tlvEncode([4, tlvEncode([1, 2], [2, pub], [3, issuer], [4, 1])]),
    ]);
    const response = hex(controller.handleControlPoint(request.toString('base64')));
    assert.equal(response, '050d0208' + issuer.toString('hex') + '030100');
    assert.equal(state.endpoints.length, 1);
    assert.equal(state.endpoints[0].id, deviceCredentialIdentifier(pub).toString('hex'));

    // duplicato
    const dup = hex(controller.handleControlPoint(request.toString('base64')));
    assert.equal(dup, '050d0208' + issuer.toString('hex') + '030102');
  });

  await test('limite di credenziali -> out of resources', () => {
    const { controller } = makeController(1);
    const add = () =>
      controller.handleControlPoint(
        Buffer.concat([
          tlvEncode([1, 2]),
          tlvEncode([4, tlvEncode([1, 2], [2, crypto.randomBytes(64)], [3, crypto.randomBytes(8)], [4, 1])]),
        ]).toString('base64'),
      );
    assert.ok(hex(add()).endsWith('030100'));
    assert.ok(hex(add()).endsWith('030101'));
  });

  await test('chiavi non supportate -> status 4, nessuna modifica', () => {
    const { controller, state } = makeController();
    const request = Buffer.concat([
      tlvEncode([1, 2]),
      tlvEncode([6, tlvEncode([1, 1], [2, crypto.randomBytes(32)])]),
    ]);
    assert.equal(hex(controller.handleControlPoint(request.toString('base64'))), '07030201' + '04');
    assert.equal(state.reader, null);
  });

  await test('remove device credential e remove reader key', () => {
    const { controller, state } = makeController();
    const priv = crypto.randomBytes(32);
    controller.handleControlPoint(
      Buffer.concat([tlvEncode([1, 2]), tlvEncode([6, tlvEncode([1, 2], [2, priv], [3, crypto.randomBytes(8)])])]).toString('base64'),
    );
    const pub = crypto.randomBytes(64);
    controller.handleControlPoint(
      Buffer.concat([tlvEncode([1, 2]), tlvEncode([4, tlvEncode([1, 2], [2, pub], [3, crypto.randomBytes(8)], [4, 1])])]).toString('base64'),
    );
    const id = deviceCredentialIdentifier(pub);
    const removeCred = Buffer.concat([tlvEncode([1, 3]), tlvEncode([4, tlvEncode([5, id])])]);
    assert.equal(hex(controller.handleControlPoint(removeCred.toString('base64'))), '0503030100');
    assert.equal(state.endpoints.length, 0);
    assert.equal(hex(controller.handleControlPoint(removeCred.toString('base64'))), '0503030103');

    const removeReader = Buffer.concat([tlvEncode([1, 3]), tlvEncode([6, tlvEncode([4, readerIdentifier(priv)])])]);
    assert.equal(hex(controller.handleControlPoint(removeReader.toString('base64'))), '07030201' + '00');
    assert.equal(state.reader, null);
  });

  // Verifica del collegamento reale con HAP-NodeJS: il valore restituito dall'handler
  // deve tornare al controller come write-response della caratteristica TLV8.
  await test('write-response end-to-end con HAP-NodeJS', async () => {
    const hap = require('@homebridge/hap-nodejs');
    const { controller } = makeController();
    const characteristic = new hap.Characteristic.NFCAccessControlPoint();
    characteristic.onSet((value) => controller.handleControlPoint(value));

    const priv = crypto.randomBytes(32);
    const request = Buffer.concat([
      tlvEncode([1, 2]),
      tlvEncode([6, tlvEncode([1, 2], [2, priv], [3, crypto.randomBytes(8)])]),
    ]);
    const response = await characteristic.handleSetRequest(request.toString('base64'), undefined);
    assert.equal(hex(response), '07030201' + '00');

    // Risposta vuota (get senza reader key) dev'essere accettata dal tipo TLV8.
    const fresh = makeController().controller;
    const c2 = new hap.Characteristic.NFCAccessControlPoint();
    c2.onSet((value) => fresh.handleControlPoint(value));
    const empty = await c2.handleSetRequest(b64('010101' + '0600'), undefined);
    assert.equal(empty, '');
  });

  console.log(`\n${passed} test superati`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
