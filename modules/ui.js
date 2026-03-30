// ui.js — DOM rendering + event wiring

import Chat from './chat.js';
import Files from './files.js';
import Screen from './screen.js';
import LLM from './llm.js';
import DB from './db.js';

const UI = {
  peers: new Map(),
  onJoin: null,
  onLeave: null,

  init() {
    this._cacheElements();
    this._bindEvents();
  },

  _cacheElements() {
    this.el = {
      joinScreen: document.getElementById('join-screen'),
      mainUI: document.getElementById('main-ui'),
      inputName: document.getElementById('input-name'),
      inputRoom: document.getElementById('input-room'),
      btnJoin: document.getElementById('btn-join'),
      btnLeave: document.getElementById('btn-leave'),
      roomLabel: document.getElementById('room-label'),
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
    };
  },

  _bindEvents() {
    this.el.btnJoin.onclick = () => {
      const name = this.el.inputName.value.trim();
      const room = this.el.inputRoom.value.trim();
      if (name && room && this.onJoin) this.onJoin(name, room);
    };
    this.el.inputRoom.onkeydown = (e) => {
      if (e.key === 'Enter') this.el.btnJoin.click();
    };
    this.el.inputName.onkeydown = (e) => {
      if (e.key === 'Enter') this.el.inputRoom.focus();
    };
    this.el.btnLeave.onclick = () => { if (this.onLeave) this.onLeave(); };

    this.el.chatInput.onkeydown = (e) => {
      if (e.key === 'Enter' && this.el.chatInput.value.trim()) {
        this._onChatSend(this.el.chatInput.value.trim());
        this.el.chatInput.value = '';
      }
    };

    this.el.fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file && this._onFileShare) this._onFileShare(file);
    };

    this.el.btnLlmLoad.onclick = () => this._loadLLM();
    this.el.btnLlmAsk.onclick = () => this._askLLM();
    this.el.llmInput.onkeydown = (e) => {
      if (e.key === 'Enter') this._askLLM();
    };
  },

  showMain(roomName) {
    this.el.joinScreen.hidden = true;
    this.el.mainUI.hidden = false;
    this.el.roomLabel.textContent = `GRIDLOCK - ${roomName}`;
  },

  showJoin() {
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
        const badge = document.createTextNode(' [scr]');
        li.appendChild(badge);
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

  appendChat(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<span class="name">${this._esc(msg.name)}</span>: <span class="text">${this._esc(msg.text)}</span><span class="time">${time}</span>`;
    this.el.chatMessages.appendChild(div);
    this.el.chatMessages.scrollTop = this.el.chatMessages.scrollHeight;
  },

  appendSystemMsg(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = text;
    this.el.chatMessages.appendChild(div);
    this.el.chatMessages.scrollTop = this.el.chatMessages.scrollHeight;
  },

  showScreen(peerId, stream) {
    this.el.screenView.hidden = false;
    this.el.galleryView.hidden = true;
    this.el.screenVideo.srcObject = stream;
    const peer = this.peers.get(peerId);
    this.el.screenLabel.textContent = `${peer?.name || peerId}'s screen`;
  },

  hideScreen() {
    this.el.screenView.hidden = true;
    this.el.galleryView.hidden = false;
    this.el.screenVideo.srcObject = null;
    this.el.screenLabel.textContent = '';
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

  setMicActive(active) {
    this.el.btnMic.classList.toggle('active', active);
  },

  setCamActive(active) {
    this.el.btnCam.classList.toggle('active', active);
  },

  setScreenActive(active) {
    this.el.btnScreen.classList.toggle('active', active);
  },

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

  // Callbacks set by peer.js
  _onChatSend: null,
  _onFileShare: null,
  _onFileDownload: null,
};

export default UI;
