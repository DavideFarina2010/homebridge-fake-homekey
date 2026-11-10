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
    const autoLockSeconds = Number.isFinite(this.config.autoLockSeconds) ? this.config.autoLockSeconds : 5;

    // --- stato persistente (chiave del lettore e credenziali dei dispositivi) ---
    const store = new StateStore(this.api.user.persistPath(), uuid.generate(name).slice(0, 8), this.log);
    if (this.config.resetState) {
      store.reset();
      this.log.warn('resetState attivo: stato Home Key cancellato. Ricorda di rimuovere questa opzione dopo il primo avvio.');
    }
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
      this.log.info(`Serratura simulata: ${current === Characteristic.LockCurrentState.SECURED ? 'chiusa' : 'aperta'}`);
      if (current === Characteristic.LockCurrentState.UNSECURED && autoLockSeconds > 0) {
        relockTimer = setTimeout(() => {
          lock.getCharacteristic(Characteristic.LockTargetState).updateValue(Characteristic.LockTargetState.SECURED);
          lock.getCharacteristic(Characteristic.LockCurrentState).updateValue(Characteristic.LockCurrentState.SECURED);
          this.log.info('Serratura simulata: richiusa automaticamente');
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
        this.log.error(`Errore nella gestione di NFC Access: ${error.message}`);
        throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    this.log.info(
      `Accessorio "${name}" pubblicato. Aggiungilo nell'app Casa con il PIN del bridge Homebridge ` +
        '(compare nel log e nell\'interfaccia di Homebridge).',
    );
    if (state.reader) {
      this.log.info(
        `Reader key gia' presente (${state.reader.identifier}), ${state.endpoints.length} credenziale/i salvata/e.`,
      );
    }
  }
}
