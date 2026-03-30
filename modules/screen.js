// screen.js — display capture + sharing

const Screen = {
  stream: null,
  viewers: new Map(),

  async share() {
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', frameRate: 15 },
      audio: true
    });
    this.stream.getVideoTracks()[0].onended = () => this.stop();
    return this.stream;
  },

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  },

  isSharing() {
    return this.stream !== null;
  },

  onRemoteScreen(peerId, stream) {
    this.viewers.set(peerId, stream);
  },

  removeRemoteScreen(peerId) {
    this.viewers.delete(peerId);
  }
};

export default Screen;
