'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { emptyState } = require('./protocol');

/**
 * Salva lo stato Home Key (contiene la chiave privata del lettore) in un file JSON
 * con permessi 0600 dentro la cartella persist di Homebridge.
 */
class StateStore {
  constructor(directory, name, log = {}) {
    this.file = path.join(directory, `homebridge-fake-homekey.${name}.json`);
    this.log = log;
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        reader: parsed.reader ?? null,
        endpoints: Array.isArray(parsed.endpoints) ? parsed.endpoints : [],
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // File illeggibile o corrotto: si riparte da zero invece di bloccare il plugin.
        this.log.warn?.(`Home Key state unreadable (${error.message}): starting from an empty state.`);
      }
      return emptyState();
    }
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Removes state files left behind by a previous accessory name (they hold a reader key). */
  removeStale() {
    const dir = path.dirname(this.file);
    const current = path.basename(this.file);
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === current || entry === `${current}.tmp`) continue;
      if (!/^homebridge-fake-homekey\..+\.json(\.tmp)?$/.test(entry)) continue;
      try {
        fs.rmSync(path.join(dir, entry), { force: true });
        this.log.info?.(`Removed stale Home Key state file ${entry} (accessory was renamed).`);
      } catch (error) {
        this.log.warn?.(`Could not remove stale state file ${entry}: ${error.message}`);
      }
    }
  }

  reset() {
    fs.rmSync(this.file, { force: true });
  }
}

module.exports = { StateStore };
