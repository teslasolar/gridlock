// screen.js — display capture + sharing

import State from './state.js';

const Screen = {
  stream: null,
  viewers: new Map(),
  myId: null,

  async share(myId) {
    this.myId = myId;
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', frameRate: 15 },
      audio: true
    });
    this.stream.getVideoTracks()[0].onended = () => this.stop();
    State.broadcast({ type: 'screen_start', peerId: myId }, myId);
    return this.stream;
  },

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.myId) {
      State.broadcast({ type: 'screen_stop', peerId: this.myId }, this.myId);
    }
  },

  isSharing() {
    return this.stream !== null;
  },

  attachToPeer(pc) {
    this.stream?.getTracks().forEach(t => pc.addTrack(t, this.stream));
  },

  onRemoteScreen(peerId, stream) {
    this.viewers.set(peerId, stream);
  },

  removeRemoteScreen(peerId) {
    this.viewers.delete(peerId);
  },

  async thumbnail(stream) {
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    canvas.getContext('2d').drawImage(video, 0, 0, 160, 90);
    return canvas.toDataURL('image/jpeg', 0.5);
  }
};

export default Screen;
