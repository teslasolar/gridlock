// signal.js — WebTorrent tracker signaling
// Uses wss://tracker.openwebtorrent.com for reliable global peer discovery.
// The tracker only sees room hashes and peer IDs — never message content.

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
  onPeerConnect: null,    // (peerId, dataChannel)
  onPeerDisconnect: null, // (peerId)
  onStatus: null,         // (status: 'connecting'|'connected'|'error'|'disconnected')

  // Generate 20-byte peer ID (WebTorrent compatible)
  generatePeerId(name) {
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return `-GL0001-${rand}`;
  },

  // Room name → SHA-1 info_hash (hex)
  async roomToHash(room) {
    const data = new TextEncoder().encode('gridlock:' + room);
    const hash = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // Generate WebRTC offers upfront
  async _generateOffers(count) {
    const offers = [];
    for (let i = 0; i < count; i++) {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      const dc = pc.createDataChannel('mesh', { ordered: true });
      const offerId = crypto.randomUUID();

      // Wait for ICE gathering to complete
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

  // Set up handlers for a peer connection
  _setupPeerHandlers(pc, dc, peerId) {
    dc.onopen = () => {
      console.log('[signal] data channel open:', peerId.slice(0, 12));
      this.peers.set(peerId, { pc, dc });
      if (this.onPeerConnect) this.onPeerConnect(peerId, dc);
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

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.log('[signal] ICE state:', pc.iceConnectionState, peerId.slice(0, 12));
        pc.close();
        this.peers.delete(peerId);
        if (this.onPeerDisconnect) this.onPeerDisconnect(peerId);
      }
    };
  },

  // Handle incoming offer from tracker
  async _handleOffer(msg) {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const remotePeerId = msg.peer_id;

    pc.ondatachannel = (e) => {
      const dc = e.channel;
      this._setupPeerHandlers(pc, dc, remotePeerId);
    };

    await pc.setRemoteDescription(msg.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Wait for ICE gathering
    await new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') resolve();
      else pc.onicecandidate = e => { if (!e.candidate) resolve(); };
    });

    // Send answer back via tracker
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

  // Handle answer to our offer
  async _handleAnswer(msg) {
    const pending = this.pendingOffers.get(msg.offer_id);
    if (!pending) return;
    await pending.pc.setRemoteDescription(msg.answer);
    console.log('[signal] got answer for offer:', msg.offer_id.slice(0, 8));
  },

  // Re-announce to pick up new peers
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

          // Tracker tells us when to re-announce
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
        // Auto-reconnect
        if (this.active) {
          console.log('[signal] reconnecting in', RECONNECT_DELAY, 'ms');
          setTimeout(() => {
            if (this.active) this.join(this.room, '').catch(() => {});
          }, RECONNECT_DELAY);
        }
      };
    });
  },

  // Broadcast to all connected peers
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

  // Send to specific peer
  sendTo(peerId, data) {
    const peer = this.peers.get(peerId);
    if (peer?.dc.readyState === 'open') {
      peer.dc.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    }
    return false;
  },

  // Get connected peer count
  peerCount() {
    return this.peers.size;
  },

  // Cleanup everything
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
      this.ws.onclose = null; // prevent auto-reconnect
      this.ws.close();
      this.ws = null;
    }
  }
};

export default Signal;
