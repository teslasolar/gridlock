// state.js — CRDT-based shared state via data channels

const State = {
  state: {},
  vector: {},
  channels: new Map(),
  listeners: new Set(),

  set(key, value, myId) {
    this.vector[myId] = (this.vector[myId] || 0) + 1;
    this.state[key] = { value, clock: { ...this.vector }, by: myId };
    this.broadcast({ type: 'state_update', key, value, clock: { ...this.vector } }, myId);
    this._notify(key, value);
  },

  get(key) {
    return this.state[key]?.value;
  },

  onUpdate(data) {
    const { key, value, clock } = data;
    const existing = this.state[key];
    if (!existing || this._clockGt(clock, existing.clock)) {
      this.state[key] = { value, clock, by: data.from };
      this.vector = this._clockMerge(this.vector, clock);
      this._notify(key, value);
    }
  },

  broadcast(data, myId) {
    data.from = myId;
    const json = JSON.stringify(data);
    this.channels.forEach(ch => {
      if (ch.readyState === 'open') ch.send(json);
    });
  },

  onChange(fn) { this.listeners.add(fn); },
  _notify(key, value) { this.listeners.forEach(fn => fn(key, value)); },

  _clockGt(a, b) {
    return Object.keys(a).some(k => (a[k] || 0) > (b[k] || 0));
  },

  _clockMerge(a, b) {
    const m = { ...a };
    Object.keys(b).forEach(k => m[k] = Math.max(m[k] || 0, b[k] || 0));
    return m;
  },

  registerChannel(peerId, channel) {
    this.channels.set(peerId, channel);
  },

  removeChannel(peerId) {
    this.channels.delete(peerId);
  },

  getFullState() {
    return { ...this.state };
  }
};

export default State;
