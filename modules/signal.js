// signal.js — WebTorrent tracker signaling + media transport
// Uses wss://tracker.openwebtorrent.com for reliable global peer discovery.
// Exposes RTCPeerConnection for media track attachment (voice/camera/screen).

const TRACKER_URL = 'wss://tracker.openwebtorrent.com';
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
const NUM_OFFERS = 5;
const RECONNECT_DELAY = 5000;

const Signal = {
  ws: null,
  infoHash: null,
  myId: null,
  room: null,
  peers: new Map(),          // peerId → { pc, dc }
  pendingOffers: new Map(),  // offerId → { pc, dc }
  reannounceTimer: null,
  active: false,

  // Callbacks — set by peer.js
  onPeerConnect: null,    // (peerId, dataChannel, peerConnection)
  onPeerDisconnect: null, // (peerId)
  onRemoteTrack: null,    // (peerId, track, streams)
  onStatus: null,         // (status)

  generatePeerId(name) {
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return `-GL0001-${rand}`;
  },

  async roomToHash(room) {
    const data = new TextEncoder().encode('gridlock:' + room);
    const hash = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async _generateOffers(count) {
    const offers = [];
    for (let i = 0; i < count; i++) {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      const dc = pc.createDataChannel('mesh', { ordered: true });
      const offerId = crypto.randomUUID();

      await new Promise(resolve => {
        pc.onicecandidate = e => { if (!e.candidate) resolve(); };
        pc.createOffer().then(o => pc.setLocalDescription(o));
      });

      offers.push({
        offer_id: offerId,
        offer: { type: 'offer', sdp: pc.localDescription.sdp }
      });

      this.pendingOffers.set(offerId, { pc, dc });
      this._setupPeerHandlers(pc, dc, offerId);
    }
    return offers;
  },

  _setupPeerHandlers(pc, dc, peerId) {
    dc.onopen = () => {
      console.log('[signal] data channel open:', peerId.slice(0, 12));
      this.peers.set(peerId, { pc, dc });
      // Pass pc so peer.js can attach media tracks
      if (this.onPeerConnect) this.onPeerConnect(peerId, dc, pc);
    };

    dc.onclose = () => {
      console.log('[signal] data channel closed:', peerId.slice(0, 12));
      this.peers.delete(peerId);
      this.pendingOffers.delete(peerId);
      if (this.onPeerDisconnect) this.onPeerDisconnect(peerId);
    };

    dc.onerror = (e) => {
      console.warn('[signal] data channel error:', peerId.slice(0, 12), e);
    };

    // Remote media tracks (voice, camera, screen)
    pc.ontrack = (e) => {
      console.log('[signal] remote track received:', e.track.kind, 'from', peerId.slice(0, 12));
      if (this.onRemoteTrack) this.onRemoteTrack(peerId, e.track, e.streams);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.log('[signal] ICE state:', pc.iceConnectionState, peerId.slice(0, 12));
        pc.close();
        this.peers.delete(peerId);
        if (this.onPeerDisconnect) this.onPeerDisconnect(peerId);
      }
    };
  },

  async _handleOffer(msg) {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const remotePeerId = msg.peer_id;

    pc.ondatachannel = (e) => {
      const dc = e.channel;
      this._setupPeerHandlers(pc, dc, remotePeerId);
    };

    // Also set up ontrack for incoming offers
    pc.ontrack = (e) => {
      console.log('[signal] remote track from offer:', e.track.kind, 'from', remotePeerId.slice(0, 12));
      if (this.onRemoteTrack) this.onRemoteTrack(remotePeerId, e.track, e.streams);
    };

    await pc.setRemoteDescription(msg.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') resolve();
      else pc.onicecandidate = e => { if (!e.candidate) resolve(); };
    });

    this.ws.send(JSON.stringify({
      action: 'announce',
      info_hash: this.infoHash,
      peer_id: this.myId,
      to_peer_id: remotePeerId,
      answer: { type: 'answer', sdp: pc.localDescription.sdp },
      offer_id: msg.offer_id
    }));

    console.log('[signal] answered offer from:', remotePeerId.slice(0, 12));
  },

  async _handleAnswer(msg) {
    const pending = this.pendingOffers.get(msg.offer_id);
    if (!pending) return;
    await pending.pc.setRemoteDescription(msg.answer);
    console.log('[signal] got answer for offer:', msg.offer_id.slice(0, 8));
  },

  async _reannounce() {
    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    console.log('[signal] re-announcing...');
    const offers = await this._generateOffers(NUM_OFFERS);
    this.ws.send(JSON.stringify({
      action: 'announce',
      info_hash: this.infoHash,
      peer_id: this.myId,
      numwant: 10,
      offers
    }));
  },

  // --- Public API ---

  async join(room, name) {
    this.cleanup();
    this.active = true;
    this.room = room;
    this.myId = this.generatePeerId(name);
    this.infoHash = await this.roomToHash(room);

    console.log('[signal] joining room:', room, 'hash:', this.infoHash.slice(0, 12), 'id:', this.myId);
    if (this.onStatus) this.onStatus('connecting');

    const offers = await this._generateOffers(NUM_OFFERS);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(TRACKER_URL);

      this.ws.onopen = () => {
        console.log('[signal] tracker connected');
        if (this.onStatus) this.onStatus('connected');

        this.ws.send(JSON.stringify({
          action: 'announce',
          info_hash: this.infoHash,
          peer_id: this.myId,
          numwant: 10,
          uploaded: 0,
          downloaded: 0,
          left: 1,
          offers
        }));

        resolve(this.myId);
      };

      this.ws.onmessage = async (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.offer && msg.peer_id !== this.myId) {
            await this._handleOffer(msg);
          }
          if (msg.answer && msg.offer_id) {
            await this._handleAnswer(msg);
          }
          if (msg.interval) {
            if (this.reannounceTimer) clearTimeout(this.reannounceTimer);
            this.reannounceTimer = setTimeout(() => this._reannounce(), msg.interval * 1000);
          }
        } catch (err) {
          console.error('[signal] tracker message error:', err);
        }
      };

      this.ws.onerror = () => {
        console.error('[signal] tracker error');
        if (this.onStatus) this.onStatus('error');
        reject(new Error('Tracker connection failed'));
      };

      this.ws.onclose = () => {
        console.log('[signal] tracker disconnected');
        if (this.onStatus) this.onStatus('disconnected');
        if (this.active) {
          setTimeout(() => {
            if (this.active) this.join(this.room, '').catch(() => {});
          }, RECONNECT_DELAY);
        }
      };
    });
  },

  // Broadcast data to all peers via data channel
  broadcast(data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    let sent = 0;
    this.peers.forEach(({ dc }) => {
      if (dc.readyState === 'open') {
        dc.send(json);
        sent++;
      }
    });
    return sent;
  },

  // Add a media track to all existing peer connections
  addTrackToAll(track, stream) {
    this.peers.forEach(({ pc }, peerId) => {
      try {
        pc.addTrack(track, stream);
        console.log('[signal] added', track.kind, 'track to', peerId.slice(0, 12));
      } catch (e) {
        console.warn('[signal] failed to add track to', peerId.slice(0, 12), e.message);
      }
    });
  },

  // Remove a media track from all peer connections
  removeTrackFromAll(track) {
    this.peers.forEach(({ pc }, peerId) => {
      const sender = pc.getSenders().find(s => s.track === track);
      if (sender) {
        try {
          pc.removeTrack(sender);
          console.log('[signal] removed', track.kind, 'track from', peerId.slice(0, 12));
        } catch (e) {
          console.warn('[signal] failed to remove track from', peerId.slice(0, 12));
        }
      }
    });
  },

  // Add a media track to a specific peer connection
  addTrackToPeer(peerId, track, stream) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try { peer.pc.addTrack(track, stream); } catch (e) { /* already added */ }
    }
  },

  peerCount() {
    return this.peers.size;
  },

  cleanup() {
    this.active = false;
    if (this.reannounceTimer) {
      clearTimeout(this.reannounceTimer);
      this.reannounceTimer = null;
    }
    this.peers.forEach(({ pc }) => pc.close());
    this.peers.clear();
    this.pendingOffers.forEach(({ pc }) => pc.close());
    this.pendingOffers.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
};

export default Signal;
