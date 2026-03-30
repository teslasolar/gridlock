// chat.js — data channel messaging

const Chat = {
  history: [],
  channels: new Map(),
  onMessageCallback: null,

  send(message, myId, myName) {
    const msg = {
      from: myId,
      name: myName,
      text: message,
      timestamp: Date.now()
    };
    this.history.push(msg);
    this.channels.forEach(ch => {
      if (ch.readyState === 'open') {
        ch.send(JSON.stringify({ type: 'chat', msg }));
      }
    });
    if (this.onMessageCallback) this.onMessageCallback(msg);
  },

  onMessage(peerId, data) {
    const parsed = JSON.parse(data);
    if (parsed.type === 'chat') {
      this.history.push(parsed.msg);
      if (this.onMessageCallback) this.onMessageCallback(parsed.msg);
    }
    return parsed;
  },

  registerChannel(peerId, channel) {
    this.channels.set(peerId, channel);
  },

  removeChannel(peerId) {
    this.channels.delete(peerId);
  },

  getHistory() {
    return [...this.history];
  }
};

export default Chat;
