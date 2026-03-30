// peer.js — main orchestrator
// Uses WebTorrent tracker signaling (signal.js) for global P2P.

import UI from './ui.js';
import Signal from './signal.js';
import Voice from './voice.js';
import Camera from './camera.js';
import Screen from './screen.js';
import Chat from './chat.js';
import Files from './files.js';
import State from './state.js';
import DB from './db.js';
import Providers from './providers.js';
import Bridge from './bridge.js';
import Media from './media.js';

console.log('[gridlock] peer.js loaded');

const GLOBAL_ROOM = 'lobby';
const ME = { id: null, name: null, room: null };

// --- Utilities ---

function generateAnonName() {
  const adj = ['swift','bright','calm','dark','keen','bold','warm','cool','wild','free'];
  const noun = ['fox','owl','elk','ray','bee','ant','cat','bat','jay','ram'];
  return adj[Math.floor(Math.random() * adj.length)] + '-' + noun[Math.floor(Math.random() * noun.length)] + '-' + Math.floor(Math.random() * 100);
}

// --- Join Room ---

async function join(name, room) {
  console.log('[gridlock] join() called, name:', name, 'room:', room);
  ME.name = name;
  ME.room = room;

  try { await DB.init(); } catch (e) { console.warn('[gridlock] DB init failed:', e.message); }
  Files.init();

  // Show main UI immediately
  UI.showMain(room, name);
  UI.appendSystemMsg(`joining ${room} as ${name}...`);

  // Wire callbacks before connecting
  wireCallbacks();

  // Signal callbacks
  Signal.onPeerConnect = (peerId, dc) => {
    console.log('[gridlock] peer connected:', peerId.slice(0, 12));
    setupPeerChannel(peerId, dc);
    // Send our identity
    dc.send(JSON.stringify({ type: 'announce', senderId: ME.id, name: ME.name }));
    // Send our current media grid
    Media.items.forEach(item => {
      dc.send(JSON.stringify({ type: 'media_add', item }));
    });
  };

  Signal.onPeerDisconnect = (peerId) => {
    console.log('[gridlock] peer disconnected:', peerId.slice(0, 12));
    handlePeerLeave(peerId);
  };

  Signal.onStatus = (status) => {
    console.log('[gridlock] signal status:', status);
    switch (status) {
      case 'connecting':
        UI.appendSystemMsg('connecting to tracker...');
        break;
      case 'connected':
        UI.appendSystemMsg('connected to tracker. discovering peers...');
        break;
      case 'error':
        UI.appendSystemMsg('tracker connection failed');
        break;
      case 'disconnected':
        UI.appendSystemMsg('tracker disconnected, reconnecting...');
        break;
    }
  };

  // Connect via WebTorrent tracker
  try {
    ME.id = await Signal.join(room, name);
    console.log('[gridlock] signal joined, id:', ME.id);
    UI.appendSystemMsg(`connected (${ME.id.slice(0, 12)})`);
  } catch (err) {
    console.error('[gridlock] signal join failed:', err);
    UI.appendSystemMsg(`connection failed: ${err.message}`);
  }
}

// --- Set up a data channel with a peer ---

function setupPeerChannel(peerId, dc) {
  UI.addPeer(peerId, peerId.slice(0, 12));
  Chat.registerChannel(peerId, dc);
  State.registerChannel(peerId, dc);

  dc.addEventListener('message', (e) => handleDataMessage(peerId, e.data));
}

// --- Wire UI Callbacks ---

function wireCallbacks() {
  console.log('[gridlock] wiring callbacks');

  UI._onChatSend = (text) => {
    console.log('[gridlock] sending chat:', text.slice(0, 30));
    Chat.send(text, ME.id, ME.name);
    // Also relay to bridge if active
    if (Bridge.active && Bridge.token) {
      Bridge.post(text, ME.name).catch(() => {});
    }
  };

  UI._onFileShare = async (file) => {
    UI.appendSystemMsg(`sharing: ${file.name}...`);
    const entry = await Files.share(file, ME.id);
    if (entry) {
      UI.updateFileList(Files.getIndex());
      UI.appendSystemMsg(`shared: ${file.name}`);
      Signal.broadcast({ type: 'file_shared', entry });
      const p = Providers.get();
      if (p?.ready) p.saveFile(ME.room, entry).catch(() => {});
    }
  };

  UI._onFileDownload = async (entry) => {
    UI.appendSystemMsg(`downloading: ${entry.name}...`);
    try {
      const blob = await Files.download(entry.magnetURI);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
      UI.appendSystemMsg(`downloaded: ${entry.name}`);
    } catch (err) {
      UI.appendSystemMsg(`download failed: ${err.message}`);
    }
  };

  // Chat message callback (sent messages)
  Chat.onMessageCallback = (msg) => {
    UI.appendChat(msg);
    DB.put('chatHistory', { ...msg, id: `${msg.timestamp}-${msg.from}` }).catch(() => {});
    const p = Providers.get();
    if (p?.ready) p.saveMessage(ME.room, msg).catch(() => {});
  };

  // Mic
  document.getElementById('btn-mic').onclick = async () => {
    if (!Voice.stream) {
      try {
        await Voice.init();
        Voice.unmute();
        UI.setMicActive(true);
        UI.appendSystemMsg('mic on');
      } catch (e) {
        UI.appendSystemMsg('mic access denied');
      }
    } else {
      if (Voice.isMuted()) { Voice.unmute(); UI.setMicActive(true); }
      else { Voice.mute(); UI.setMicActive(false); }
    }
  };

  // Camera
  document.getElementById('btn-cam').onclick = async () => {
    if (!Camera.stream) {
      try {
        await Camera.init();
        UI.setCamActive(true);
        UI.addCameraStream('local', Camera.stream, ME.name);
      } catch (e) {
        UI.appendSystemMsg('camera access denied');
      }
    } else {
      const on = Camera.toggle();
      UI.setCamActive(on);
    }
  };

  // Screen share
  document.getElementById('btn-screen').onclick = async () => {
    if (!Screen.isSharing()) {
      try {
        await Screen.share(ME.id);
        UI.setScreenActive(true);
        UI.appendSystemMsg('screen sharing started');
        Signal.broadcast({ type: 'screen_start', peerId: ME.id });
      } catch (e) {
        UI.appendSystemMsg('screen share cancelled');
      }
    } else {
      Screen.stop();
      UI.setScreenActive(false);
      UI.hideScreen();
      UI.appendSystemMsg('screen sharing stopped');
    }
  };

  // Provider
  UI._onProviderConnect = async (providerName, config) => {
    try {
      await Providers.connect(providerName, config);
      UI.appendSystemMsg(`connected to ${providerName}`);
      UI.setProviderStatus(providerName, true);
      const p = Providers.get();
      const msgs = await p.getMessages(ME.room, 100).catch(() => []);
      if (msgs?.length) {
        UI.appendSystemMsg(`loaded ${msgs.length} messages from ${providerName}`);
        msgs.forEach(m => UI.appendChat(m));
      }
      const files = await p.getFiles(ME.room).catch(() => []);
      if (files?.length) {
        files.forEach(f => Files.onFileShared(f));
        UI.updateFileList(Files.getIndex());
      }
      p.savePeer(ME.room, { id: ME.id, name: ME.name }).catch(() => {});
    } catch (err) {
      UI.appendSystemMsg(`provider error: ${err.message}`);
      UI.setProviderStatus(null, false);
    }
  };

  UI._onProviderDisconnect = async () => {
    const name = Providers.get()?.name;
    await Providers.disconnect();
    UI.appendSystemMsg(`disconnected from ${name || 'provider'}`);
    UI.setProviderStatus(null, false);
  };

  // Bridge (GitHub Issue chat relay)
  UI._onBridgeConnect = (owner, repo, issueNumber, token) => {
    Bridge.stop();
    Bridge.onMessage = (msg) => {
      if (msg.text.includes('(via GRIDLOCK)')) return;
      UI.appendChat(msg);
    };
    Bridge.start(owner, repo, issueNumber, token || null);
    UI.appendSystemMsg(`bridge active: ${owner}/${repo}#${issueNumber} (polling every 5s)`);
    UI.setBridgeStatus(true);
  };

  UI._onBridgeDisconnect = () => {
    Bridge.stop();
    UI.appendSystemMsg('bridge disconnected');
    UI.setBridgeStatus(false);
  };

  // Media grid
  UI._onMediaAdd = (url) => {
    const item = Media.add(url, ME.name);
    if (item) {
      console.log('[gridlock] sharing media:', item.type, url.slice(0, 60));
      Signal.broadcast({ type: 'media_add', item });
      UI.appendSystemMsg(`shared: ${item.type} — ${url.slice(0, 50)}`);
    } else {
      UI.appendSystemMsg('invalid URL');
    }
  };

  UI._onMediaRemove = (id) => {
    Media.remove(id);
    Signal.broadcast({ type: 'media_remove', id });
  };

  Media.onUpdate = (items) => UI.renderMediaGrid(items);
}

// --- Data Messages ---

function handleDataMessage(peerId, data) {
  try {
    const msg = typeof data === 'string' ? JSON.parse(data) : data;
    switch (msg.type) {
      case 'chat':
        Chat.history.push(msg.msg);
        UI.appendChat(msg.msg);
        break;
      case 'file_shared':
        Files.onFileShared(msg.entry);
        UI.updateFileList(Files.getIndex());
        UI.appendSystemMsg(`${msg.entry.sharedBy} shared: ${msg.entry.name}`);
        break;
      case 'state_update':
        State.onUpdate(msg);
        break;
      case 'screen_start': {
        const peer = UI.peers.get(msg.peerId);
        if (peer) peer.sharing = true;
        UI._renderPeers();
        break;
      }
      case 'screen_stop':
        UI.hideScreen();
        break;
      case 'announce': {
        const name = msg.name || peerId.slice(0, 12);
        console.log('[gridlock] peer announced:', name);
        UI.addPeer(peerId, name);
        UI.appendSystemMsg(`${name} joined`);
        break;
      }
      case 'media_add':
        Media.onRemoteAdd(msg.item);
        UI.appendSystemMsg(`${msg.item.addedBy} shared: ${msg.item.type}`);
        break;
      case 'media_remove':
        Media.remove(msg.id);
        break;
    }
  } catch (e) {
    // Non-JSON message, ignore
  }
}

// --- Leave / Switch ---

function handlePeerLeave(peerId) {
  const peerInfo = UI.peers.get(peerId);
  const name = peerInfo?.name || peerId.slice(0, 12);
  Voice.removeRemoteStream(peerId);
  Screen.removeRemoteScreen(peerId);
  Chat.removeChannel(peerId);
  State.removeChannel(peerId);
  UI.removePeer(peerId);
  UI.appendSystemMsg(`${name} left`);
}

function cleanupRoom() {
  Signal.cleanup();
  Bridge.stop();
  Media.clear();
  Voice.stop();
  Camera.stop();
  Screen.stop();
  Chat.history = [];
  Chat.channels.clear();
  State.channels.clear();
  State.state = {};
  State.vector = {};
}

async function switchRoom(newRoom) {
  console.log('[gridlock] switching room to:', newRoom);
  cleanupRoom();

  UI.peers.clear();
  document.getElementById('peers-list').innerHTML = '';
  document.getElementById('camera-grid').innerHTML = '';
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('media-grid').innerHTML = '';
  UI.hideScreen();
  UI.setMicActive(false);
  UI.setCamActive(false);
  UI.setScreenActive(false);
  UI.updatePeerCount();

  await join(ME.name, newRoom);
}

// ============================================================
// BOOT SEQUENCE
// ============================================================

console.log('[gridlock] booting...');
UI.init();

UI.onJoin = async (name) => {
  console.log('[gridlock] onJoin fired, name:', name);
  localStorage.setItem('gridlock-name', name);
  await join(name, GLOBAL_ROOM);
};

UI.onLeave = () => {
  console.log('[gridlock] onLeave → switching to lobby');
  switchRoom(GLOBAL_ROOM);
};

// Room switcher
const switchBtn = document.getElementById('btn-switch-room');
const roomInput = document.getElementById('input-room');

if (switchBtn && roomInput) {
  switchBtn.addEventListener('click', () => {
    const room = roomInput.value.trim();
    console.log('[gridlock] switch room clicked, room:', room);
    if (room && room !== ME.room) {
      switchRoom(room);
      roomInput.value = '';
    }
  });
  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); switchBtn.click(); }
  });
}

// Auto-join or show name prompt
const savedName = localStorage.getItem('gridlock-name');
console.log('[gridlock] saved name:', savedName);

if (savedName) {
  console.log('[gridlock] auto-joining lobby as:', savedName);
  document.getElementById('join-screen').hidden = true;
  join(savedName, GLOBAL_ROOM);
} else {
  console.log('[gridlock] no saved name, showing join screen');
  const nameInput = document.getElementById('input-name');
  nameInput.value = generateAnonName();
  nameInput.select();
  nameInput.focus();
}
