'use strict';

const {
  NfcAccessController,
  hardwareFinishValue,
  supportedConfigurationValue,
} = require('./lib/protocol');
const { StateStore } = require('./lib/store');

const { version: PLUGIN_VERSION } = require('./package.json');

const PLUGIN_NAME = 'homebridge-fake-homekey';
const PLATFORM_NAME = 'FakeHomeKey';

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, FakeHomeKeyPlatform);
};

class FakeHomeKeyPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config ?? {};
    this.api = api;

    api.on('didFinishLaunching', () => this.publish());
  }

  // Accessorio pubblicato come "external": non serve ricostruirlo dalla cache.
  configureAccessory() {}

  publish() {
    const { Service, Characteristic, Categories, uuid } = this.api.hap;
    const name = this.config.name || 'Home Key Lock';
    // Capped at 24h: setTimeout overflows its 32-bit limit (~24.8 days) and would fire immediately.
    const autoLockSeconds = Number.isFinite(this.config.autoLockSeconds)
      ? Math.min(Math.max(this.config.autoLockSeconds, 0), 86400)
      : 5;

    // --- stato persistente (chiave del lettore e credenziali dei dispositivi) ---
    const store = new StateStore(this.api.user.persistPath(), uuid.generate(name).slice(0, 8), this.log);
    if (this.config.resetState) {
      store.reset();
      this.log.warn('resetState is on: Home Key state cleared. Remember to turn this option off after the first restart.');
    }
    store.removeStale();
    const state = store.load();
    const controller = new NfcAccessController({
      state,
      log: this.log,
      onChange: () => store.save(state),
    });

    // --- accessorio ---
    const accessory = new this.api.platformAccessory(
      name,
      uuid.generate(`${PLUGIN_NAME}:${name}`),
      Categories.DOOR_LOCK,
    );

    const info = accessory.getService(Service.AccessoryInformation);
    info
      .setCharacteristic(Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(Characteristic.Model, 'Fake Home Key Lock')
      .setCharacteristic(Characteristic.SerialNumber, this.config.serialNumber || 'FHK-0001')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);
    info
      .getCharacteristic(Characteristic.HardwareFinish)
      .updateValue(hardwareFinishValue(this.config.finish).toString('base64'));

    // Lock Mechanism: serratura simulata, non pilota nulla.
    const lock = accessory.addService(Service.LockMechanism, name);
    let relockTimer;
    lock.getCharacteristic(Characteristic.LockCurrentState).updateValue(Characteristic.LockCurrentState.SECURED);
    lock.getCharacteristic(Characteristic.LockTargetState).updateValue(Characteristic.LockTargetState.SECURED);
    lock.getCharacteristic(Characteristic.LockTargetState).onSet((target) => {
      clearTimeout(relockTimer);
      const current =
        target === Characteristic.LockTargetState.SECURED
          ? Characteristic.LockCurrentState.SECURED
          : Characteristic.LockCurrentState.UNSECURED;
      lock.getCharacteristic(Characteristic.LockCurrentState).updateValue(current);
      this.log.info(`Simulated lock: ${current === Characteristic.LockCurrentState.SECURED ? 'locked' : 'unlocked'}`);
      if (current === Characteristic.LockCurrentState.UNSECURED && autoLockSeconds > 0) {
        relockTimer = setTimeout(() => {
          lock.getCharacteristic(Characteristic.LockTargetState).updateValue(Characteristic.LockTargetState.SECURED);
          lock.getCharacteristic(Characteristic.LockCurrentState).updateValue(Characteristic.LockCurrentState.SECURED);
          this.log.info('Simulated lock: automatically re-locked');
        }, autoLockSeconds * 1000);
      }
    });

    // Lock Management: presente sulle serrature reali, qui solo di facciata.
    const management = accessory.addService(Service.LockManagement);
    management.getCharacteristic(Characteristic.LockControlPoint).onSet(() => {});
    management.getCharacteristic(Characteristic.Version).updateValue('1.0');

    // NFC Access: qui avviene il provisioning della Home Key.
    const nfc = accessory.addService(Service.NFCAccess);
    nfc.getCharacteristic(Characteristic.ConfigurationState).updateValue(0);
    nfc
      .getCharacteristic(Characteristic.NFCAccessSupportedConfiguration)
      .updateValue(supportedConfigurationValue().toString('base64'));
    nfc.getCharacteristic(Characteristic.NFCAccessControlPoint).onSet((value) => {
      try {
        return controller.handleControlPoint(value);
      } catch (error) {
        this.log.error(`NFC Access error: ${error.message}`);
        throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    this.log.info(
      `Accessory "${name}" published. Add it in the Home app with the Homebridge bridge PIN ` +
        '(shown in the log and in the Homebridge UI).',
    );
    if (state.reader) {
      this.log.info(
        `Reader key already present (${state.reader.identifier}), ${state.endpoints.length} stored credential(s).`,
      );
    }
  }
}
