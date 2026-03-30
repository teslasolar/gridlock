// ui.js — DOM rendering + event wiring

import Files from './files.js';
import LLM from './llm.js';
import Providers from './providers.js';
import Media from './media.js';

console.log('[gridlock] ui.js loaded');

const UI = {
  peers: new Map(),
  onJoin: null,
  onLeave: null,

  init() {
    console.log('[gridlock] UI.init()');
    this._cacheElements();
    this._bindEvents();
    console.log('[gridlock] UI ready, elements cached, events bound');
  },

  _cacheElements() {
    this.el = {
      connDot: document.getElementById('conn-dot'),
      joinScreen: document.getElementById('join-screen'),
      mainUI: document.getElementById('main-ui'),
      inputName: document.getElementById('input-name'),
      btnJoin: document.getElementById('btn-join'),
      btnLeave: document.getElementById('btn-leave'),
      roomLabel: document.getElementById('room-label'),
      nameLabel: document.getElementById('name-label'),
      peerCount: document.getElementById('peer-count'),
      peersList: document.getElementById('peers-list'),
      filesList: document.getElementById('files-list'),
      fileInput: document.getElementById('file-input'),
      chatMessages: document.getElementById('chat-messages'),
      chatInput: document.getElementById('chat-input'),
      btnMic: document.getElementById('btn-mic'),
      btnCam: document.getElementById('btn-cam'),
      btnScreen: document.getElementById('btn-screen'),
      screenView: document.getElementById('screen-view'),
      screenVideo: document.getElementById('screen-video'),
      screenLabel: document.getElementById('screen-label'),
      galleryView: document.getElementById('gallery-view'),
      cameraGrid: document.getElementById('camera-grid'),
      llmStatus: document.getElementById('llm-status'),
      btnLlmLoad: document.getElementById('btn-llm-load'),
      llmInputArea: document.getElementById('llm-input-area'),
      llmInput: document.getElementById('llm-input'),
      btnLlmAsk: document.getElementById('btn-llm-ask'),
      viewTabs: document.querySelectorAll('.view-tab'),
      viewPanels: document.querySelectorAll('.view-panel'),
      mediaGrid: document.getElementById('media-grid'),
      mediaInput: document.getElementById('media-input'),
      btnMediaAdd: document.getElementById('btn-media-add'),
      noScreenMsg: document.getElementById('no-screen-msg'),
      bridgeStatus: document.getElementById('bridge-status'),
      bridgeRepo: document.getElementById('bridge-repo'),
      bridgeIssue: document.getElementById('bridge-issue'),
      bridgeToken: document.getElementById('bridge-token'),
      bridgeConfigArea: document.getElementById('bridge-config-area'),
      btnBridgeConnect: document.getElementById('btn-bridge-connect'),
      btnBridgeDisconnect: document.getElementById('btn-bridge-disconnect'),
      providerStatus: document.getElementById('provider-status'),
      providerSelect: document.getElementById('provider-select'),
      providerConfigArea: document.getElementById('provider-config-area'),
      providerConfig: document.getElementById('provider-config'),
      btnProviderConnect: document.getElementById('btn-provider-connect'),
      btnProviderDisconnect: document.getElementById('btn-provider-disconnect'),
    };
    // Log any missing elements
    for (const [k, v] of Object.entries(this.el)) {
      if (!v) console.warn(`[gridlock] missing element: #${k}`);
    }
  },

  _bindEvents() {
    this.el.btnJoin.addEventListener('click', () => {
      const name = this.el.inputName.value.trim();
      console.log('[gridlock] JOIN clicked, name:', name, 'onJoin:', !!this.onJoin);
      if (name && this.onJoin) {
        this.onJoin(name);
      } else if (!name) {
        console.warn('[gridlock] no name entered');
      } else if (!this.onJoin) {
        console.error('[gridlock] onJoin callback not set');
      }
    });

    this.el.inputName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        console.log('[gridlock] Enter pressed in name input');
        e.preventDefault();
        this.el.btnJoin.click();
      }
    });

    this.el.btnLeave.addEventListener('click', () => {
      console.log('[gridlock] LEAVE clicked');
      if (this.onLeave) this.onLeave();
    });

    this.el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.el.chatInput.value.trim();
        if (text && this._onChatSend) {
          console.log('[gridlock] chat send:', text.slice(0, 30));
          this._onChatSend(text);
          this.el.chatInput.value = '';
        } else if (!this._onChatSend) {
          console.warn('[gridlock] chat send callback not set yet');
        }
      }
    });

    this.el.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && this._onFileShare) this._onFileShare(file);
    });

    // Bridge UI
    this.el.btnBridgeConnect.addEventListener('click', () => {
      const repoStr = this.el.bridgeRepo.value.trim();
      const issueNum = parseInt(this.el.bridgeIssue.value.trim(), 10);
      const token = this.el.bridgeToken.value.trim() || null;
      if (!repoStr || !issueNum) return;
      const [owner, repo] = repoStr.split('/');
      if (owner && repo && this._onBridgeConnect) {
        this._onBridgeConnect(owner, repo, issueNum, token);
      }
    });
    this.el.btnBridgeDisconnect.addEventListener('click', () => {
      if (this._onBridgeDisconnect) this._onBridgeDisconnect();
    });

    // View tabs (GRID / CAMS / SCREEN)
    this.el.viewTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        this.el.viewTabs.forEach(t => t.classList.toggle('active', t === tab));
        this.el.viewPanels.forEach(p => p.classList.toggle('active', p.id === `${view}-view` || p.id === `${view}s-view`));
      });
    });

    // Media grid — share URL
    this.el.btnMediaAdd.addEventListener('click', () => {
      const url = this.el.mediaInput.value.trim();
      if (url && this._onMediaAdd) {
        this._onMediaAdd(url);
        this.el.mediaInput.value = '';
      }
    });
    this.el.mediaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.el.btnMediaAdd.click();
      }
    });
    // Also detect URLs pasted into chat
    this.el.mediaInput.addEventListener('paste', (e) => {
      // Auto-submit after short delay so paste value is available
      setTimeout(() => {
        const val = this.el.mediaInput.value.trim();
        if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
          // Don't auto-submit, just highlight the SHARE button
          this.el.btnMediaAdd.style.background = 'var(--green)';
          setTimeout(() => { this.el.btnMediaAdd.style.background = ''; }, 1500);
        }
      }, 100);
    });

    this.el.btnLlmLoad.addEventListener('click', () => this._loadLLM());
    this.el.btnLlmAsk.addEventListener('click', () => this._askLLM());
    this.el.llmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._askLLM();
    });

    // Provider UI
    this.el.providerSelect.addEventListener('change', () => {
      const val = this.el.providerSelect.value;
      this.el.providerConfigArea.hidden = !val;
      if (val) {
        const templates = {
          supabase: '{\n  "url": "https://xxx.supabase.co",\n  "anonKey": "your-anon-key"\n}',
          firebase: '{\n  "apiKey": "...",\n  "authDomain": "xxx.firebaseapp.com",\n  "projectId": "xxx"\n}',
          rest: '{\n  "baseUrl": "https://your-api.com",\n  "headers": { "Authorization": "Bearer ..." }\n}',
          graphql: '{\n  "endpoint": "https://your-api.com/graphql",\n  "headers": { "x-hasura-admin-secret": "..." }\n}',
          websocket: '{\n  "url": "wss://your-server.com/ws"\n}',
          redis: '{\n  "url": "https://your-redis.upstash.io",\n  "token": "your-upstash-token"\n}',
          mqtt: '{\n  "brokerUrl": "wss://broker.hivemq.com:8884/mqtt",\n  "username": "optional",\n  "password": "optional"\n}',
          opcua: '{\n  "gatewayUrl": "http://localhost:4840/api",\n  "namespace": "gridlock"\n}',
          amqp: '{\n  "managementUrl": "http://localhost:15672/api",\n  "username": "guest",\n  "password": "guest"\n}',
          ignition: '{\n  "baseUrl": "https://ignition-host:8088",\n  "project": "gridlock",\n  "apiKey": "optional"\n}',
          socket: '{\n  "bridgeUrl": "ws://localhost:9090",\n  "protocol": "tcp",\n  "host": "127.0.0.1",\n  "port": 5000\n}',
          custom: '{\n  "your": "config here"\n}'
        };
        this.el.providerConfig.value = templates[val] || '{}';
      }
    });
    this.el.btnProviderConnect.addEventListener('click', () => {
      const name = this.el.providerSelect.value;
      if (!name) return;
      try {
        const config = JSON.parse(this.el.providerConfig.value);
        if (this._onProviderConnect) this._onProviderConnect(name, config);
      } catch (e) {
        this.appendSystemMsg('invalid config JSON');
      }
    });
    this.el.btnProviderDisconnect.addEventListener('click', () => {
      if (this._onProviderDisconnect) this._onProviderDisconnect();
    });
  },

  showMain(roomName, myName) {
    console.log('[gridlock] showMain, room:', roomName, 'name:', myName);
    this.el.joinScreen.hidden = true;
    this.el.mainUI.hidden = false;
    this.el.roomLabel.textContent = `GRIDLOCK — ${roomName}`;
    if (myName && this.el.nameLabel) {
      this.el.nameLabel.textContent = myName;
    }
  },

  showJoin() {
    console.log('[gridlock] showJoin');
    this.el.joinScreen.hidden = false;
    this.el.mainUI.hidden = true;
    this.peers.clear();
    this.el.peersList.innerHTML = '';
    this.el.cameraGrid.innerHTML = '';
    this.el.chatMessages.innerHTML = '';
    this.updatePeerCount();
  },

  addPeer(peerId, name) {
    this.peers.set(peerId, { name, speaking: false, sharing: false });
    this._renderPeers();
  },

  removePeer(peerId) {
    this.peers.delete(peerId);
    const vid = document.getElementById(`cam-${peerId}`);
    if (vid) vid.remove();
    this._renderPeers();
  },

  _renderPeers() {
    this.el.peersList.innerHTML = '';
    this.peers.forEach((info, id) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'peer-dot' + (info.speaking ? ' speaking' : '');
      dot.id = `dot-${id}`;
      li.appendChild(dot);
      li.appendChild(document.createTextNode(` ${info.name}`));
      if (info.sharing) {
        li.appendChild(document.createTextNode(' [scr]'));
      }
      this.el.peersList.appendChild(li);
    });
    this.updatePeerCount();
  },

  setSpeaking(peerId, isSpeaking) {
    const peer = this.peers.get(peerId);
    if (peer) peer.speaking = isSpeaking;
    const dot = document.getElementById(`dot-${peerId}`);
    if (dot) dot.className = 'peer-dot' + (isSpeaking ? ' speaking' : '');
  },

  updatePeerCount() {
    this.el.peerCount.textContent = `${this.peers.size + 1} peers`;
  },

  setConnectionStatus(status) {
    const dot = this.el.connDot;
    if (!dot) return;
    dot.className = 'conn-dot';
    if (status === 'connecting' || status === 'disconnected') dot.classList.add('connecting');
    else if (status === 'connected') dot.classList.add('connected');
    else if (status === 'error') dot.classList.add('error');
  },

  appendChat(msg) {
    const div = document.createElement('div');
    div.className = msg.bridge ? 'chat-msg bridge' : 'chat-msg';
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const prefix = msg.bridge ? '[gh] ' : '';

    // Linkify URLs in text
    const escaped = this._esc(msg.text);
    const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener" class="chat-link">${url}</a>`;
    });

    div.innerHTML = `${prefix}<span class="name">${this._esc(msg.name)}</span>: <span class="text">${linked}</span><span class="time">${time}</span>`;

    // If message contains a URL, add a "pin to grid" button
    const urlMatch = msg.text.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      const pin = document.createElement('button');
      pin.className = 'chat-pin';
      pin.textContent = '[+grid]';
      pin.title = 'Add to media grid';
      pin.addEventListener('click', () => {
        if (this._onMediaAdd) this._onMediaAdd(urlMatch[1]);
        pin.remove();
      });
      div.appendChild(pin);
    }

    this.el.chatMessages.appendChild(div);
    this.el.chatMessages.scrollTop = this.el.chatMessages.scrollHeight;
  },

  appendSystemMsg(text) {
    console.log('[gridlock]', text);
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = text;
    this.el.chatMessages.appendChild(div);
    this.el.chatMessages.scrollTop = this.el.chatMessages.scrollHeight;
  },

  setProviderStatus(name, connected) {
    this.el.providerStatus.textContent = connected ? `${name} connected` : 'none';
    this.el.providerStatus.className = connected ? 'connected' : '';
    this.el.btnProviderDisconnect.hidden = !connected;
    this.el.providerConfigArea.hidden = connected;
    this.el.providerSelect.disabled = connected;
  },

  setBridgeStatus(active) {
    this.el.bridgeStatus.textContent = active ? 'polling...' : 'off';
    this.el.bridgeStatus.className = active ? 'active' : '';
    this.el.btnBridgeDisconnect.hidden = !active;
    this.el.bridgeConfigArea.hidden = active;
  },

  // Media grid rendering
  renderMediaGrid(items) {
    this.el.mediaGrid.innerHTML = '';
    items.forEach(item => {
      const cell = Media.render(item);
      // Wire close button
      cell.querySelector('.media-close').addEventListener('click', () => {
        if (this._onMediaRemove) this._onMediaRemove(item.id);
      });
      this.el.mediaGrid.appendChild(cell);
    });
  },

  showScreen(peerId, stream) {
    // Switch to screen tab
    this.el.viewTabs.forEach(t => t.classList.toggle('active', t.dataset.view === 'screen'));
    this.el.viewPanels.forEach(p => p.classList.toggle('active', p.id === 'screen-view'));
    this.el.screenVideo.srcObject = stream;
    this.el.screenVideo.hidden = false;
    this.el.noScreenMsg.hidden = true;
    const peer = this.peers.get(peerId);
    this.el.screenLabel.textContent = `${peer?.name || peerId}'s screen`;
  },

  hideScreen() {
    this.el.screenVideo.srcObject = null;
    this.el.screenVideo.hidden = true;
    this.el.noScreenMsg.hidden = false;
    this.el.screenLabel.textContent = '';
    // Switch back to grid tab
    this.el.viewTabs.forEach(t => t.classList.toggle('active', t.dataset.view === 'media'));
    this.el.viewPanels.forEach(p => p.classList.toggle('active', p.id === 'media-view'));
  },

  addCameraStream(peerId, stream, name) {
    let video = document.getElementById(`cam-${peerId}`);
    if (!video) {
      video = document.createElement('video');
      video.id = `cam-${peerId}`;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = peerId === 'local';
      video.title = name || peerId;
      this.el.cameraGrid.appendChild(video);
    }
    video.srcObject = stream;
  },

  updateFileList(index) {
    this.el.filesList.innerHTML = '';
    index.forEach(entry => {
      const li = document.createElement('li');
      li.innerHTML = `<span style="cursor:pointer;color:var(--accent)" data-magnet="${this._esc(entry.magnetURI)}">${this._esc(entry.name)}</span> <span style="color:var(--dim);font-size:0.65rem">${Files.formatSize(entry.size)}</span>`;
      li.querySelector('span').onclick = () => this._onFileDownload(entry);
      this.el.filesList.appendChild(li);
    });
  },

  setMicActive(active) { this.el.btnMic.classList.toggle('active', active); },
  setCamActive(active) { this.el.btnCam.classList.toggle('active', active); },
  setScreenActive(active) { this.el.btnScreen.classList.toggle('active', active); },

  async _loadLLM() {
    this.el.llmStatus.textContent = 'loading model...';
    this.el.btnLlmLoad.disabled = true;
    try {
      await LLM.init((progress) => {
        this.el.llmStatus.textContent = progress.text || `${Math.round((progress.progress || 0) * 100)}%`;
      });
      this.el.llmStatus.textContent = 'ready';
      this.el.llmInputArea.hidden = false;
      this.el.btnLlmLoad.hidden = true;
    } catch (err) {
      this.el.llmStatus.textContent = 'failed: ' + err.message;
      this.el.btnLlmLoad.disabled = false;
    }
  },

  async _askLLM() {
    const prompt = this.el.llmInput.value.trim();
    if (!prompt) return;
    this.el.llmInput.value = '';
    this.appendSystemMsg(`[AI query] ${prompt}`);
    const reply = await LLM.query(prompt);
    this.appendSystemMsg(`[AI] ${reply}`);
  },

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  },

  // Callbacks — set by peer.js during join()
  _onChatSend: null,
  _onFileShare: null,
  _onFileDownload: null,
  _onProviderConnect: null,
  _onProviderDisconnect: null,
  _onBridgeConnect: null,
  _onBridgeDisconnect: null,
  _onMediaAdd: null,
  _onMediaRemove: null,
};

export default UI;
