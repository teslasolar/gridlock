// providers.js — pluggable database provider templates
// Connect GRIDLOCK to your own backend: Supabase, Firebase,
// Postgres, MongoDB, Ignition Gateway, or anything custom.
// All providers implement the same interface.
// Data sovereignty: YOU choose where YOUR data goes.

// --- Provider Interface ---
// Every provider must implement:
//   init(config)          → connect to the backend
//   saveMessage(room, msg) → persist a chat message
//   getMessages(room, n)  → fetch last n messages
//   saveFile(room, entry) → persist file metadata
//   getFiles(room)        → fetch file index
//   saveState(room, k, v) → persist a state key
//   getState(room, k)     → fetch a state key
//   getFullState(room)    → fetch all state for a room
//   savePeer(room, peer)  → record peer presence
//   getPeers(room)        → list known peers
//   destroy()             → disconnect / cleanup

class BaseProvider {
  constructor(name) { this.name = name; this.ready = false; }
  async init(config) { throw new Error('init() not implemented'); }
  async saveMessage(room, msg) { throw new Error('not implemented'); }
  async getMessages(room, n = 50) { throw new Error('not implemented'); }
  async saveFile(room, entry) { throw new Error('not implemented'); }
  async getFiles(room) { throw new Error('not implemented'); }
  async saveState(room, key, value) { throw new Error('not implemented'); }
  async getState(room, key) { throw new Error('not implemented'); }
  async getFullState(room) { throw new Error('not implemented'); }
  async savePeer(room, peer) { throw new Error('not implemented'); }
  async getPeers(room) { throw new Error('not implemented'); }
  async destroy() { this.ready = false; }
}

// --- Supabase ---
class SupabaseProvider extends BaseProvider {
  constructor() { super('supabase'); }

  async init(config) {
    // config: { url, anonKey, schema? }
    const { createClient } = await import('https://esm.run/@supabase/supabase-js');
    this.client = createClient(config.url, config.anonKey, {
      db: { schema: config.schema || 'public' }
    });
    this.ready = true;
  }

  async saveMessage(room, msg) {
    await this.client.from('gridlock_messages').insert({
      room, sender: msg.from, sender_name: msg.name,
      text: msg.text, created_at: new Date(msg.timestamp).toISOString()
    });
  }

  async getMessages(room, n = 50) {
    const { data } = await this.client.from('gridlock_messages')
      .select('*').eq('room', room)
      .order('created_at', { ascending: false }).limit(n);
    return (data || []).reverse().map(r => ({
      from: r.sender, name: r.sender_name,
      text: r.text, timestamp: new Date(r.created_at).getTime()
    }));
  }

  async saveFile(room, entry) {
    await this.client.from('gridlock_files').insert({
      room, name: entry.name, size: entry.size,
      magnet_uri: entry.magnetURI, info_hash: entry.infoHash,
      shared_by: entry.sharedBy, created_at: new Date(entry.timestamp).toISOString()
    });
  }

  async getFiles(room) {
    const { data } = await this.client.from('gridlock_files')
      .select('*').eq('room', room).order('created_at', { ascending: true });
    return (data || []).map(r => ({
      name: r.name, size: r.size, magnetURI: r.magnet_uri,
      infoHash: r.info_hash, sharedBy: r.shared_by,
      timestamp: new Date(r.created_at).getTime()
    }));
  }

  async saveState(room, key, value) {
    await this.client.from('gridlock_state').upsert(
      { room, key, value: JSON.stringify(value) },
      { onConflict: 'room,key' }
    );
  }

  async getState(room, key) {
    const { data } = await this.client.from('gridlock_state')
      .select('value').eq('room', room).eq('key', key).single();
    return data ? JSON.parse(data.value) : null;
  }

  async getFullState(room) {
    const { data } = await this.client.from('gridlock_state')
      .select('key, value').eq('room', room);
    const state = {};
    (data || []).forEach(r => { state[r.key] = JSON.parse(r.value); });
    return state;
  }

  async savePeer(room, peer) {
    await this.client.from('gridlock_peers').upsert(
      { room, peer_id: peer.id, name: peer.name, last_seen: new Date().toISOString() },
      { onConflict: 'room,peer_id' }
    );
  }

  async getPeers(room) {
    const { data } = await this.client.from('gridlock_peers')
      .select('*').eq('room', room);
    return (data || []).map(r => ({ id: r.peer_id, name: r.name, lastSeen: r.last_seen }));
  }

  async destroy() {
    this.client = null;
    this.ready = false;
  }
}

// --- Firebase (Firestore) ---
class FirebaseProvider extends BaseProvider {
  constructor() { super('firebase'); }

  async init(config) {
    // config: { apiKey, authDomain, projectId, ...firebaseConfig }
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js');
    const { getFirestore, collection, doc, setDoc, getDocs, query, orderBy, limit, deleteDoc }
      = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js');
    this.app = initializeApp(config);
    this.db = getFirestore(this.app);
    this.fs = { collection, doc, setDoc, getDocs, query, orderBy, limit, deleteDoc };
    this.ready = true;
  }

  _col(room, sub) {
    return this.fs.collection(this.db, 'gridlock_rooms', room, sub);
  }

  async saveMessage(room, msg) {
    const id = `${msg.timestamp}-${msg.from}`;
    await this.fs.setDoc(this.fs.doc(this._col(room, 'messages'), id), {
      sender: msg.from, name: msg.name, text: msg.text, timestamp: msg.timestamp
    });
  }

  async getMessages(room, n = 50) {
    const q = this.fs.query(this._col(room, 'messages'),
      this.fs.orderBy('timestamp', 'desc'), this.fs.limit(n));
    const snap = await this.fs.getDocs(q);
    return snap.docs.map(d => d.data()).reverse();
  }

  async saveFile(room, entry) {
    await this.fs.setDoc(this.fs.doc(this._col(room, 'files'), entry.infoHash), entry);
  }

  async getFiles(room) {
    const snap = await this.fs.getDocs(this._col(room, 'files'));
    return snap.docs.map(d => d.data());
  }

  async saveState(room, key, value) {
    await this.fs.setDoc(this.fs.doc(this._col(room, 'state'), key), { value: JSON.stringify(value) });
  }

  async getState(room, key) {
    const snap = await this.fs.getDocs(this._col(room, 'state'));
    const found = snap.docs.find(d => d.id === key);
    return found ? JSON.parse(found.data().value) : null;
  }

  async getFullState(room) {
    const snap = await this.fs.getDocs(this._col(room, 'state'));
    const state = {};
    snap.docs.forEach(d => { state[d.id] = JSON.parse(d.data().value); });
    return state;
  }

  async savePeer(room, peer) {
    await this.fs.setDoc(this.fs.doc(this._col(room, 'peers'), peer.id), {
      name: peer.name, lastSeen: Date.now()
    });
  }

  async getPeers(room) {
    const snap = await this.fs.getDocs(this._col(room, 'peers'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async destroy() {
    this.app = null;
    this.db = null;
    this.ready = false;
  }
}

// --- REST API (generic — works with any HTTP backend) ---
class RestProvider extends BaseProvider {
  constructor() { super('rest'); }

  async init(config) {
    // config: { baseUrl, headers? }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
    this.ready = true;
  }

  async _fetch(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method, headers: this.headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`REST ${method} ${path}: ${res.status}`);
    return res.json().catch(() => null);
  }

  async saveMessage(room, msg) { return this._fetch('POST', `/rooms/${room}/messages`, msg); }
  async getMessages(room, n = 50) { return this._fetch('GET', `/rooms/${room}/messages?limit=${n}`); }
  async saveFile(room, entry) { return this._fetch('POST', `/rooms/${room}/files`, entry); }
  async getFiles(room) { return this._fetch('GET', `/rooms/${room}/files`); }
  async saveState(room, key, value) { return this._fetch('PUT', `/rooms/${room}/state/${key}`, { value }); }
  async getState(room, key) { return this._fetch('GET', `/rooms/${room}/state/${key}`); }
  async getFullState(room) { return this._fetch('GET', `/rooms/${room}/state`); }
  async savePeer(room, peer) { return this._fetch('POST', `/rooms/${room}/peers`, peer); }
  async getPeers(room) { return this._fetch('GET', `/rooms/${room}/peers`); }
  async destroy() { this.ready = false; }
}

// --- WebSocket (real-time custom backend) ---
class WebSocketProvider extends BaseProvider {
  constructor() { super('websocket'); }

  async init(config) {
    // config: { url, protocols? }
    this.pending = new Map();
    this.msgId = 0;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(config.url, config.protocols);
      this.ws.onopen = () => { this.ready = true; resolve(); };
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg._id && this.pending.has(msg._id)) {
          this.pending.get(msg._id)(msg.data);
          this.pending.delete(msg._id);
        }
      };
    });
  }

  _send(action, params) {
    return new Promise((resolve) => {
      const _id = ++this.msgId;
      this.pending.set(_id, resolve);
      this.ws.send(JSON.stringify({ _id, action, ...params }));
      // Timeout fallback
      setTimeout(() => { if (this.pending.has(_id)) { this.pending.delete(_id); resolve(null); } }, 5000);
    });
  }

  async saveMessage(room, msg) { return this._send('saveMessage', { room, msg }); }
  async getMessages(room, n = 50) { return this._send('getMessages', { room, n }); }
  async saveFile(room, entry) { return this._send('saveFile', { room, entry }); }
  async getFiles(room) { return this._send('getFiles', { room }); }
  async saveState(room, key, value) { return this._send('saveState', { room, key, value }); }
  async getState(room, key) { return this._send('getState', { room, key }); }
  async getFullState(room) { return this._send('getFullState', { room }); }
  async savePeer(room, peer) { return this._send('savePeer', { room, peer }); }
  async getPeers(room) { return this._send('getPeers', { room }); }

  async destroy() {
    this.ws?.close();
    this.ready = false;
  }
}

// --- Ignition Gateway (Inductive Automation SCADA) ---
class IgnitionProvider extends BaseProvider {
  constructor() { super('ignition'); }

  async init(config) {
    // config: { baseUrl, apiKey?, project?, tagProvider? }
    // Ignition's Web Dev module exposes REST endpoints
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.project = config.project || 'gridlock';
    this.headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) this.headers['Authorization'] = `Bearer ${config.apiKey}`;
    this.tagProvider = config.tagProvider || 'default';
    this.ready = true;
  }

  async _api(method, endpoint, body) {
    const res = await fetch(`${this.baseUrl}/system/webdev/${this.project}/${endpoint}`, {
      method, headers: this.headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`Ignition ${method} ${endpoint}: ${res.status}`);
    return res.json().catch(() => null);
  }

  async saveMessage(room, msg) { return this._api('POST', `gridlock/messages/${room}`, msg); }
  async getMessages(room, n = 50) { return this._api('GET', `gridlock/messages/${room}?limit=${n}`); }
  async saveFile(room, entry) { return this._api('POST', `gridlock/files/${room}`, entry); }
  async getFiles(room) { return this._api('GET', `gridlock/files/${room}`); }
  async saveState(room, key, value) { return this._api('PUT', `gridlock/state/${room}/${key}`, { value }); }
  async getState(room, key) { return this._api('GET', `gridlock/state/${room}/${key}`); }
  async getFullState(room) { return this._api('GET', `gridlock/state/${room}`); }
  async savePeer(room, peer) { return this._api('POST', `gridlock/peers/${room}`, peer); }
  async getPeers(room) { return this._api('GET', `gridlock/peers/${room}`); }
  async destroy() { this.ready = false; }
}

// --- Custom Provider Template ---
// Copy this and implement your own backend.
class CustomProvider extends BaseProvider {
  constructor() { super('custom'); }

  async init(config) {
    // config: whatever your backend needs
    // Connect to your database / API / service here
    this.config = config;
    this.ready = true;
  }

  async saveMessage(room, msg) { /* your implementation */ }
  async getMessages(room, n = 50) { return []; }
  async saveFile(room, entry) { /* your implementation */ }
  async getFiles(room) { return []; }
  async saveState(room, key, value) { /* your implementation */ }
  async getState(room, key) { return null; }
  async getFullState(room) { return {}; }
  async savePeer(room, peer) { /* your implementation */ }
  async getPeers(room) { return []; }
  async destroy() { this.ready = false; }
}

// --- Provider Registry ---
const Providers = {
  _registry: {
    supabase: SupabaseProvider,
    firebase: FirebaseProvider,
    rest: RestProvider,
    websocket: WebSocketProvider,
    ignition: IgnitionProvider,
    custom: CustomProvider,
  },

  _active: null,

  register(name, ProviderClass) {
    this._registry[name] = ProviderClass;
  },

  list() {
    return Object.keys(this._registry);
  },

  async connect(name, config) {
    const Cls = this._registry[name];
    if (!Cls) throw new Error(`Unknown provider: ${name}. Available: ${this.list().join(', ')}`);
    if (this._active) await this._active.destroy();
    this._active = new Cls();
    await this._active.init(config);
    return this._active;
  },

  async disconnect() {
    if (this._active) {
      await this._active.destroy();
      this._active = null;
    }
  },

  get() {
    return this._active;
  },

  isConnected() {
    return this._active?.ready === true;
  }
};

export { BaseProvider, Providers };
export default Providers;
