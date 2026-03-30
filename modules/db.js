// db.js — IndexedDB wrapper for local persistence

const DB = {
  db: null,
  DB_NAME: 'gridlock',
  VERSION: 1,
  STORES: ['chatHistory', 'fileIndex', 'stateSnapshots', 'llmCache', 'peerProfiles', 'roomBookmarks'],

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        this.STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          }
        });
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },

  async put(store, data) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAll(store) {
    const tx = this.db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async clear(store) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async exportAll() {
    const dump = {};
    for (const store of this.STORES) {
      dump[store] = await this.getAll(store);
    }
    return JSON.stringify(dump, null, 2);
  },

  async deleteAll() {
    for (const store of this.STORES) {
      await this.clear(store);
    }
  }
};

export default DB;
