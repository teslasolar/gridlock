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

// --- MQTT Provider (IoT / Industrial / Message Broker) ---
// Connects to any MQTT broker (Mosquitto, HiveMQ, EMQX, AWS IoT, etc.)
// Topics: gridlock/{room}/messages, /files, /state/{key}, /peers
class MQTTProvider extends BaseProvider {
  constructor() { super('mqtt'); }

  async init(config) {
    // config: { brokerUrl, username?, password?, clientId?, qos? }
    // Uses MQTT.js from CDN (browser-compatible via WebSocket)
    const mqtt = await import('https://esm.run/mqtt');
    this.qos = config.qos ?? 1;
    this.prefix = config.prefix || 'gridlock';
    this.messages = [];
    this.files = [];
    this.stateCache = {};
    this.peersCache = [];

    const opts = {};
    if (config.username) opts.username = config.username;
    if (config.password) opts.password = config.password;
    if (config.clientId) opts.clientId = config.clientId;
    else opts.clientId = `gridlock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(config.brokerUrl, opts);
      this.client.on('connect', () => {
        this.ready = true;
        resolve();
      });
      this.client.on('error', (e) => reject(e));
      this.client.on('message', (topic, payload) => {
        this._onMessage(topic, JSON.parse(payload.toString()));
      });
    });
  }

  _topic(room, sub) { return `${this.prefix}/${room}/${sub}`; }

  _subscribe(room) {
    ['messages', 'files', 'state/+', 'peers'].forEach(sub => {
      this.client.subscribe(this._topic(room, sub), { qos: this.qos });
    });
  }

  _onMessage(topic, data) {
    const parts = topic.split('/');
    const sub = parts.slice(2).join('/');
    if (sub === 'messages') this.messages.push(data);
    else if (sub === 'files') this.files.push(data);
    else if (sub.startsWith('state/')) this.stateCache[parts[3]] = data;
    else if (sub === 'peers') this.peersCache.push(data);
  }

  async saveMessage(room, msg) {
    this._subscribe(room);
    this.client.publish(this._topic(room, 'messages'), JSON.stringify(msg), { qos: this.qos });
  }

  async getMessages(room, n = 50) {
    this._subscribe(room);
    return this.messages.slice(-n);
  }

  async saveFile(room, entry) {
    this.client.publish(this._topic(room, 'files'), JSON.stringify(entry), { qos: this.qos, retain: true });
  }

  async getFiles(room) { return [...this.files]; }

  async saveState(room, key, value) {
    this.client.publish(this._topic(room, `state/${key}`), JSON.stringify(value), { qos: this.qos, retain: true });
  }

  async getState(room, key) { return this.stateCache[key] ?? null; }
  async getFullState(room) { return { ...this.stateCache }; }

  async savePeer(room, peer) {
    this.client.publish(this._topic(room, 'peers'), JSON.stringify(peer), { qos: this.qos });
  }

  async getPeers(room) { return [...this.peersCache]; }

  async destroy() {
    this.client?.end();
    this.ready = false;
  }
}

// --- OPC-UA Provider (Industrial Automation / SCADA) ---
// Connects to OPC-UA servers via a REST gateway (e.g., node-opcua-webapi, Prosys, Unified Automation)
// Maps GRIDLOCK data to OPC-UA nodes: Objects/Gridlock/{Room}/Messages, Files, State, Peers
class OPCUAProvider extends BaseProvider {
  constructor() { super('opcua'); }

  async init(config) {
    // config: { gatewayUrl, endpointUrl?, username?, password?, namespace? }
    // gatewayUrl: HTTP REST bridge to OPC-UA server
    this.gateway = config.gatewayUrl.replace(/\/$/, '');
    this.namespace = config.namespace || 'gridlock';
    this.headers = { 'Content-Type': 'application/json' };
    if (config.username && config.password) {
      this.headers['Authorization'] = 'Basic ' + btoa(`${config.username}:${config.password}`);
    }
    // Test connection
    const res = await fetch(`${this.gateway}/status`, { headers: this.headers });
    if (!res.ok) throw new Error(`OPC-UA gateway returned ${res.status}`);
    this.ready = true;
  }

  _nodePath(room, sub) {
    return `Objects/${this.namespace}/${encodeURIComponent(room)}/${sub}`;
  }

  async _read(room, sub) {
    const res = await fetch(`${this.gateway}/read/${this._nodePath(room, sub)}`, {
      headers: this.headers
    });
    if (!res.ok) return null;
    return res.json();
  }

  async _write(room, sub, value) {
    await fetch(`${this.gateway}/write/${this._nodePath(room, sub)}`, {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({ value })
    });
  }

  async saveMessage(room, msg) { return this._write(room, 'Messages', msg); }
  async getMessages(room, n = 50) { return (await this._read(room, 'Messages')) || []; }
  async saveFile(room, entry) { return this._write(room, 'Files', entry); }
  async getFiles(room) { return (await this._read(room, 'Files')) || []; }
  async saveState(room, key, value) { return this._write(room, `State/${key}`, value); }
  async getState(room, key) { return this._read(room, `State/${key}`); }
  async getFullState(room) { return (await this._read(room, 'State')) || {}; }
  async savePeer(room, peer) { return this._write(room, 'Peers', peer); }
  async getPeers(room) { return (await this._read(room, 'Peers')) || []; }
  async destroy() { this.ready = false; }
}

// --- AMQP Provider (RabbitMQ / Message Queues) ---
// Connects via RabbitMQ Management HTTP API or any AMQP-over-HTTP bridge.
// Exchanges: gridlock.{room}, queues: messages, files, state, peers
class AMQPProvider extends BaseProvider {
  constructor() { super('amqp'); }

  async init(config) {
    // config: { managementUrl, username, password, vhost? }
    // managementUrl: RabbitMQ HTTP API (e.g., http://localhost:15672/api)
    this.base = config.managementUrl.replace(/\/$/, '');
    this.vhost = encodeURIComponent(config.vhost || '/');
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(`${config.username}:${config.password}`)
    };
    // Test connection
    const res = await fetch(`${this.base}/overview`, { headers: this.headers });
    if (!res.ok) throw new Error(`AMQP management returned ${res.status}`);
    this.ready = true;
  }

  async _publish(room, routingKey, payload) {
    await fetch(`${this.base}/exchanges/${this.vhost}/gridlock.${room}/publish`, {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({
        routing_key: routingKey,
        payload: JSON.stringify(payload),
        payload_encoding: 'string',
        properties: { content_type: 'application/json' }
      })
    });
  }

  async _get(room, queue, count = 50) {
    const res = await fetch(`${this.base}/queues/${this.vhost}/gridlock.${room}.${queue}/get`, {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({ count, ackmode: 'ack_requeue_true', encoding: 'auto' })
    });
    if (!res.ok) return [];
    const msgs = await res.json();
    return msgs.map(m => { try { return JSON.parse(m.payload); } catch { return m.payload; } });
  }

  async saveMessage(room, msg) { return this._publish(room, 'messages', msg); }
  async getMessages(room, n = 50) { return this._get(room, 'messages', n); }
  async saveFile(room, entry) { return this._publish(room, 'files', entry); }
  async getFiles(room) { return this._get(room, 'files'); }
  async saveState(room, key, value) { return this._publish(room, `state.${key}`, { key, value }); }
  async getState(room, key) { const msgs = await this._get(room, `state.${key}`, 1); return msgs[0]?.value ?? null; }
  async getFullState(room) { const msgs = await this._get(room, 'state', 100); const s = {}; msgs.forEach(m => { if (m.key) s[m.key] = m.value; }); return s; }
  async savePeer(room, peer) { return this._publish(room, 'peers', peer); }
  async getPeers(room) { return this._get(room, 'peers'); }
  async destroy() { this.ready = false; }
}

// --- GraphQL Provider (Any GraphQL Backend) ---
// Works with Hasura, AppSync, custom GraphQL servers, etc.
class GraphQLProvider extends BaseProvider {
  constructor() { super('graphql'); }

  async init(config) {
    // config: { endpoint, headers?, wsEndpoint? }
    this.endpoint = config.endpoint;
    this.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
    // Test with introspection
    const res = await this._query('{ __typename }');
    if (!res) throw new Error('GraphQL endpoint unreachable');
    this.ready = true;
  }

  async _query(query, variables = {}) {
    const res = await fetch(this.endpoint, {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  }

  async _mutate(mutation, variables = {}) {
    return this._query(mutation, variables);
  }

  async saveMessage(room, msg) {
    return this._mutate(`mutation($room: String!, $msg: jsonb!) {
      insert_gridlock_messages_one(object: { room: $room, data: $msg }) { id }
    }`, { room, msg });
  }

  async getMessages(room, n = 50) {
    const data = await this._query(`query($room: String!, $n: Int!) {
      gridlock_messages(where: { room: { _eq: $room } }, order_by: { created_at: desc }, limit: $n) { data }
    }`, { room, n });
    return (data?.gridlock_messages || []).map(r => r.data).reverse();
  }

  async saveFile(room, entry) {
    return this._mutate(`mutation($room: String!, $entry: jsonb!) {
      insert_gridlock_files_one(object: { room: $room, data: $entry }) { id }
    }`, { room, entry });
  }

  async getFiles(room) {
    const data = await this._query(`query($room: String!) {
      gridlock_files(where: { room: { _eq: $room } }) { data }
    }`, { room });
    return (data?.gridlock_files || []).map(r => r.data);
  }

  async saveState(room, key, value) {
    return this._mutate(`mutation($room: String!, $key: String!, $value: jsonb!) {
      insert_gridlock_state_one(object: { room: $room, key: $key, value: $value },
        on_conflict: { constraint: gridlock_state_pkey, update_columns: [value] }) { key }
    }`, { room, key, value });
  }

  async getState(room, key) {
    const data = await this._query(`query($room: String!, $key: String!) {
      gridlock_state_by_pk(room: $room, key: $key) { value }
    }`, { room, key });
    return data?.gridlock_state_by_pk?.value ?? null;
  }

  async getFullState(room) {
    const data = await this._query(`query($room: String!) {
      gridlock_state(where: { room: { _eq: $room } }) { key, value }
    }`, { room });
    const s = {};
    (data?.gridlock_state || []).forEach(r => { s[r.key] = r.value; });
    return s;
  }

  async savePeer(room, peer) {
    return this._mutate(`mutation($room: String!, $peer: jsonb!) {
      insert_gridlock_peers_one(object: { room: $room, data: $peer },
        on_conflict: { constraint: gridlock_peers_pkey, update_columns: [data] }) { room }
    }`, { room, peer });
  }

  async getPeers(room) {
    const data = await this._query(`query($room: String!) {
      gridlock_peers(where: { room: { _eq: $room } }) { data }
    }`, { room });
    return (data?.gridlock_peers || []).map(r => r.data);
  }

  async destroy() { this.ready = false; }
}

// --- Redis Provider (Pub/Sub + Persistence via HTTP bridge) ---
// Connects to Redis via a REST bridge (e.g., webdis, redis-rest, Upstash Redis)
// Keys: gridlock:{room}:messages (list), :files (list), :state:{key} (string), :peers (set)
class RedisProvider extends BaseProvider {
  constructor() { super('redis'); }

  async init(config) {
    // config: { url, token?, password? }
    // url: Upstash REST URL, Webdis URL, or custom Redis HTTP bridge
    this.url = config.url.replace(/\/$/, '');
    this.headers = {};
    if (config.token) this.headers['Authorization'] = `Bearer ${config.token}`;
    else if (config.password) this.headers['Authorization'] = `Basic ${btoa(':' + config.password)}`;
    // Test
    const res = await this._cmd('PING');
    if (!res) throw new Error('Redis unreachable');
    this.ready = true;
  }

  async _cmd(...args) {
    const res = await fetch(`${this.url}/${args.join('/')}`, { headers: this.headers });
    if (!res.ok) return null;
    return res.json();
  }

  async _cmdPost(cmd, ...args) {
    const res = await fetch(this.url, {
      method: 'POST', headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify([cmd, ...args])
    });
    if (!res.ok) return null;
    return res.json();
  }

  _key(room, sub) { return `gridlock:${room}:${sub}`; }

  async saveMessage(room, msg) {
    await this._cmdPost('RPUSH', this._key(room, 'messages'), JSON.stringify(msg));
    await this._cmdPost('LTRIM', this._key(room, 'messages'), '-1000', '-1');
  }

  async getMessages(room, n = 50) {
    const data = await this._cmd('LRANGE', this._key(room, 'messages'), `-${n}`, '-1');
    const list = data?.LRANGE || data?.result || [];
    return list.map(s => { try { return JSON.parse(s); } catch { return s; } });
  }

  async saveFile(room, entry) {
    await this._cmdPost('RPUSH', this._key(room, 'files'), JSON.stringify(entry));
  }

  async getFiles(room) {
    const data = await this._cmd('LRANGE', this._key(room, 'files'), '0', '-1');
    const list = data?.LRANGE || data?.result || [];
    return list.map(s => { try { return JSON.parse(s); } catch { return s; } });
  }

  async saveState(room, key, value) {
    await this._cmdPost('SET', this._key(room, `state:${key}`), JSON.stringify(value));
  }

  async getState(room, key) {
    const data = await this._cmd('GET', this._key(room, `state:${key}`));
    const val = data?.GET ?? data?.result;
    try { return JSON.parse(val); } catch { return val; }
  }

  async getFullState(room) {
    const keys = await this._cmd('KEYS', this._key(room, 'state:*'));
    const keyList = keys?.KEYS || keys?.result || [];
    const state = {};
    for (const k of keyList) {
      const short = k.split(':').pop();
      state[short] = await this.getState(room, short);
    }
    return state;
  }

  async savePeer(room, peer) {
    await this._cmdPost('HSET', this._key(room, 'peers'), peer.id, JSON.stringify(peer));
  }

  async getPeers(room) {
    const data = await this._cmd('HVALS', this._key(room, 'peers'));
    const list = data?.HVALS || data?.result || [];
    return list.map(s => { try { return JSON.parse(s); } catch { return s; } });
  }

  async destroy() { this.ready = false; }
}

// --- Raw TCP/UDP Provider (via WebSocket bridge) ---
// For custom binary/text protocols over TCP or UDP.
// Requires a WebSocket-to-TCP/UDP bridge on your network.
class RawSocketProvider extends BaseProvider {
  constructor() { super('socket'); }

  async init(config) {
    // config: { bridgeUrl, protocol?: 'tcp'|'udp', host, port, encoding?: 'json'|'line'|'raw' }
    this.encoding = config.encoding || 'json';
    this.buffer = [];
    this.pending = new Map();
    this.msgId = 0;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(config.bridgeUrl);
      this.ws.onopen = () => {
        // Tell bridge to connect to target
        this.ws.send(JSON.stringify({
          action: 'connect',
          protocol: config.protocol || 'tcp',
          host: config.host,
          port: config.port
        }));
        this.ready = true;
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg._id && this.pending.has(msg._id)) {
            this.pending.get(msg._id)(msg.data);
            this.pending.delete(msg._id);
          } else {
            this.buffer.push(msg);
          }
        } catch {
          this.buffer.push(e.data);
        }
      };
    });
  }

  _send(action, params) {
    return new Promise((resolve) => {
      const _id = ++this.msgId;
      this.pending.set(_id, resolve);
      this.ws.send(JSON.stringify({ _id, action, ...params }));
      setTimeout(() => { if (this.pending.has(_id)) { this.pending.delete(_id); resolve(null); } }, 5000);
    });
  }

  async saveMessage(room, msg) { return this._send('write', { channel: `${room}/messages`, data: msg }); }
  async getMessages(room, n = 50) { return (await this._send('read', { channel: `${room}/messages`, n })) || []; }
  async saveFile(room, entry) { return this._send('write', { channel: `${room}/files`, data: entry }); }
  async getFiles(room) { return (await this._send('read', { channel: `${room}/files` })) || []; }
  async saveState(room, key, value) { return this._send('write', { channel: `${room}/state/${key}`, data: value }); }
  async getState(room, key) { return this._send('read', { channel: `${room}/state/${key}` }); }
  async getFullState(room) { return (await this._send('read', { channel: `${room}/state` })) || {}; }
  async savePeer(room, peer) { return this._send('write', { channel: `${room}/peers`, data: peer }); }
  async getPeers(room) { return (await this._send('read', { channel: `${room}/peers` })) || []; }

  async destroy() {
    this.ws?.close();
    this.ready = false;
  }
}

// --- Provider Registry ---
const Providers = {
  _registry: {
    supabase: SupabaseProvider,
    firebase: FirebaseProvider,
    rest: RestProvider,
    websocket: WebSocketProvider,
    ignition: IgnitionProvider,
    mqtt: MQTTProvider,
    opcua: OPCUAProvider,
    amqp: AMQPProvider,
    graphql: GraphQLProvider,
    redis: RedisProvider,
    socket: RawSocketProvider,
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
