// camera.js — video capture + toggle

const Camera = {
  stream: null,

  async init(facingMode = 'user') {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode }
    });
    return this.stream;
  },

  toggle() {
    const track = this.stream?.getVideoTracks()[0];
    if (track) track.enabled = !track.enabled;
    return track?.enabled ?? false;
  },

  isOn() {
    const track = this.stream?.getVideoTracks()[0];
    return track ? track.enabled : false;
  },

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  },

  attachToPeer(pc) {
    this.stream?.getTracks().forEach(t => pc.addTrack(t, this.stream));
  }
};

export default Camera;
