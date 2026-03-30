// state.js — CRDT shared state (broadcasts via Signal)

const State = {
  state: {},
  vector: {},
  broadcastFn: null, // set by peer.js to Signal.broadcast
  listeners: new Set(),

  init(broadcastFn) {
    this.broadcastFn = broadcastFn;
  },

  set(key, value, myId) {
    this.vector[myId] = (this.vector[myId] || 0) + 1;
    this.state[key] = { value, clock: { ...this.vector }, by: myId };
    if (this.broadcastFn) {
      this.broadcastFn({ type: 'state_update', key, value, clock: { ...this.vector }, from: myId });
    }
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

  getFullState() {
    return { ...this.state };
  },

  clear() {
    this.state = {};
    this.vector = {};
  }
};

export default State;
