// chat.js — messaging (broadcasts via Signal)

const Chat = {
  history: [],
  onMessageCallback: null,

  send(message, myId, myName, broadcastFn) {
    const msg = {
      from: myId,
      name: myName,
      text: message,
      timestamp: Date.now()
    };
    this.history.push(msg);
    if (broadcastFn) broadcastFn({ type: 'chat', msg });
    if (this.onMessageCallback) this.onMessageCallback(msg);
  },

  onRemoteMessage(msg) {
    this.history.push(msg);
  },

  getHistory() {
    return [...this.history];
  },

  clear() {
    this.history = [];
  }
};

export default Chat;
