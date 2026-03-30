// files.js — WebTorrent-based P2P file sharing

import State from './state.js';

const Files = {
  client: null,
  index: [],

  init() {
    if (typeof WebTorrent !== 'undefined') {
      this.client = new WebTorrent();
    }
  },

  async share(file, myId) {
    if (!this.client) return null;
    return new Promise((resolve) => {
      this.client.seed(file, (torrent) => {
        const entry = {
          name: file.name,
          size: file.size,
          magnetURI: torrent.magnetURI,
          infoHash: torrent.infoHash,
          sharedBy: myId,
          timestamp: Date.now()
        };
        this.index.push(entry);
        State.broadcast({ type: 'file_shared', entry }, myId);
        resolve(entry);
      });
    });
  },

  async download(magnetURI) {
    if (!this.client) return null;
    return new Promise((resolve, reject) => {
      this.client.add(magnetURI, (torrent) => {
        const file = torrent.files[0];
        file.getBlob((err, blob) => {
          if (err) return reject(err);
          resolve(blob);
        });
      });
    });
  },

  onFileShared(entry) {
    const exists = this.index.some(e => e.infoHash === entry.infoHash);
    if (!exists) {
      this.index.push(entry);
    }
  },

  getIndex() {
    return [...this.index];
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
};

export default Files;
