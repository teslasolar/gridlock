// voice.js — mic capture + voice activity detection

const Voice = {
  stream: null,
  peers: new Map(),

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    return this.stream;
  },

  mute() {
    this.stream?.getAudioTracks().forEach(t => t.enabled = false);
  },

  unmute() {
    this.stream?.getAudioTracks().forEach(t => t.enabled = true);
  },

  isMuted() {
    const track = this.stream?.getAudioTracks()[0];
    return track ? !track.enabled : true;
  },

  attachToPeer(pc) {
    this.stream?.getTracks().forEach(t => pc.addTrack(t, this.stream));
  },

  onRemoteStream(peerId, stream) {
    const audio = new Audio();
    audio.srcObject = stream;
    audio.play().catch(() => {});
    this.peers.set(peerId, audio);
  },

  removeRemoteStream(peerId) {
    const audio = this.peers.get(peerId);
    if (audio) {
      audio.srcObject = null;
      this.peers.delete(peerId);
    }
  },

  detectSpeaking(stream, callback) {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
      analyser.getByteFrequencyData(data);
      const vol = data.reduce((a, b) => a + b, 0) / data.length;
      callback(vol > 15);
      requestAnimationFrame(check);
    };
    check();
    return ctx;
  },

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.peers.forEach(a => { a.srcObject = null; });
    this.peers.clear();
  }
};

export default Voice;
