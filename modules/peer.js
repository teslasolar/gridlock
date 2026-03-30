// peer.js — WebRTC mesh management (main orchestrator)

import UI from './ui.js';
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
const ME = { id: null, name: null, room: null, peer: null };
const connections = new Map();
const knownPeers = new Map();

// --- Utilities ---

async function hashRoom(room) {
  const buf = new TextEncoder().encode(room);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function generatePeerId(name, roomHash) {
  const base = `gl-${roomHash.slice(0, 6)}-${name.slice(0, 6)}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${base}-${rand}`;
}

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

  try {
    await DB.init();
    console.log('[gridlock] DB initialized');
  } catch (e) {
    console.warn('[gridlock] DB init failed (non-fatal):', e.message);
  }

  Files.init();

  const roomHash = await hashRoom(room);
  ME.id = generatePeerId(name, roomHash);
  console.log('[gridlock] generated peerId:', ME.id);

  // Show main UI immediately (don't wait for PeerJS)
  UI.showMain(room, name);
  UI.appendSystemMsg(`joining ${room} as ${name}...`);

  // Wire up UI callbacks right away so chat/buttons work
  wireCallbacks();

  // Connect to PeerJS signaling
  console.log('[gridlock] connecting to PeerJS...');
  ME.peer = new Peer(ME.id, { debug: 0 });

  ME.peer.on('open', (id) => {
    ME.id = id;
    console.log('[gridlock] PeerJS open, id:', id);
    UI.appendSystemMsg(`connected (${id.slice(0, 12)}...)`);
    discoverPeers(roomHash);
  });

  ME.peer.on('connection', (conn) => {
    console.log('[gridlock] incoming connection from:', conn.peer);
    handleIncomingConnection(conn);
  });

  ME.peer.on('call', (call) => {
    console.log('[gridlock] incoming call from:', call.peer);
    call.answer(Voice.stream || new MediaStream());
    call.on('stream', (remoteStream) => {
      handleRemoteStream(call.peer, remoteStream);
    });
  });

  ME.peer.on('error', (err) => {
    console.error('[gridlock] PeerJS error:', err.type, err.message);
    UI.appendSystemMsg(`peer error: ${err.type}`);
  });

  ME.peer.on('disconnected', () => {
    console.warn('[gridlock] PeerJS disconnected, attempting reconnect...');
    UI.appendSystemMsg('disconnected, reconnecting...');
    ME.peer.reconnect();
  });
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

  // Chat message callback (both sent + received)
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
        connections.forEach(({ conn }) => {
          // Audio needs a media call, not data channel
        });
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
      // Don't echo back messages we posted ourselves
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

  // Media grid — share URLs with the room
  UI._onMediaAdd = (url) => {
    const item = Media.add(url, ME.name);
    if (item) {
      console.log('[gridlock] sharing media:', item.type, url.slice(0, 60));
      // Broadcast to all peers
      const data = JSON.stringify({ type: 'media_add', item });
      connections.forEach(({ conn }) => {
        if (conn.open) conn.send(data);
      });
      UI.appendSystemMsg(`shared: ${item.type} — ${url.slice(0, 50)}`);
    } else {
      UI.appendSystemMsg('invalid URL');
    }
  };

  UI._onMediaRemove = (id) => {
    Media.remove(id);
    const data = JSON.stringify({ type: 'media_remove', id });
    connections.forEach(({ conn }) => {
      if (conn.open) conn.send(data);
    });
  };

  // Render media grid when items change
  Media.onUpdate = (items) => UI.renderMediaGrid(items);
}

// --- Peer Discovery ---

function discoverPeers(roomHash) {
  const lobbyId = `gl-lobby-${roomHash}`;
  console.log('[gridlock] discovering peers, lobby:', lobbyId);

  const conn = ME.peer.connect(lobbyId, { metadata: { name: ME.name, room: roomHash } });

  conn.on('open', () => {
    console.log('[gridlock] connected to lobby peer');
    conn.send(JSON.stringify({ type: 'announce', peerId: ME.id, name: ME.name }));
  });

  conn.on('data', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'peers') {
      console.log('[gridlock] received peer list:', msg.peers.length, 'peers');
      msg.peers.forEach(p => {
        if (p.peerId !== ME.id && !connections.has(p.peerId)) {
          connectToPeer(p.peerId, p.name);
        }
      });
    }
  });

  conn.on('error', () => {
    console.log('[gridlock] no lobby found, becoming lobby');
    becomeLobby(roomHash);
  });

  // Also become lobby as backup
  setTimeout(() => becomeLobby(roomHash), 2000);
}

function becomeLobby(roomHash) {
  knownPeers.set(ME.id, { peerId: ME.id, name: ME.name });

  ME.peer.on('connection', (conn) => {
    conn.on('data', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'announce') {
          console.log('[gridlock] lobby: peer announced:', msg.name);
          knownPeers.set(msg.peerId, { peerId: msg.peerId, name: msg.name });
          conn.send(JSON.stringify({ type: 'peers', peers: [...knownPeers.values()] }));
          if (msg.peerId !== ME.id && !connections.has(msg.peerId)) {
            connectToPeer(msg.peerId, msg.name);
          }
        }
      } catch (e) {
        handleDataMessage(conn.peer, data);
      }
    });
  });
}

// --- Peer Connections ---

function connectToPeer(peerId, name) {
  if (connections.has(peerId)) return;
  console.log('[gridlock] connecting to peer:', name, peerId);

  const conn = ME.peer.connect(peerId, {
    metadata: { name: ME.name, room: ME.room },
    reliable: true
  });

  conn.on('open', () => {
    console.log('[gridlock] data channel open to:', name);
    setupDataConnection(peerId, conn, name);
    conn.send(JSON.stringify({ type: 'announce', peerId: ME.id, name: ME.name }));

    if (Voice.stream || Camera.stream) {
      const stream = new MediaStream();
      if (Voice.stream) Voice.stream.getTracks().forEach(t => stream.addTrack(t));
      if (Camera.stream) Camera.stream.getTracks().forEach(t => stream.addTrack(t));
      const call = ME.peer.call(peerId, stream);
      call.on('stream', (remoteStream) => handleRemoteStream(peerId, remoteStream));
    }
  });

  conn.on('error', (err) => {
    console.warn('[gridlock] connection to', peerId, 'failed:', err);
  });
}

function handleIncomingConnection(conn) {
  conn.on('open', () => {
    const name = conn.metadata?.name || conn.peer.slice(0, 12);
    console.log('[gridlock] incoming data channel from:', name);
    setupDataConnection(conn.peer, conn, name);
    conn.send(JSON.stringify({ type: 'announce', peerId: ME.id, name: ME.name }));
  });
}

function setupDataConnection(peerId, conn, name) {
  connections.set(peerId, { conn, name });
  UI.addPeer(peerId, name || peerId);
  UI.appendSystemMsg(`${name || peerId} joined`);
  Chat.registerChannel(peerId, conn);
  State.registerChannel(peerId, conn);
  conn.on('data', (data) => handleDataMessage(peerId, data));
  conn.on('close', () => handlePeerLeave(peerId));
  conn.on('error', () => handlePeerLeave(peerId));
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
        const connInfo = connections.get(peerId);
        if (connInfo && msg.name) {
          connInfo.name = msg.name;
          UI.addPeer(peerId, msg.name);
        }
        knownPeers.set(msg.peerId, { peerId: msg.peerId, name: msg.name });
        if (msg.peerId !== ME.id && !connections.has(msg.peerId)) {
          connectToPeer(msg.peerId, msg.name);
        }
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

// --- Media Streams ---

function handleRemoteStream(peerId, stream) {
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();

  if (audioTracks.length > 0) {
    Voice.onRemoteStream(peerId, stream);
    Voice.detectSpeaking(stream, (speaking) => UI.setSpeaking(peerId, speaking));
  }

  if (videoTracks.length > 0) {
    const name = connections.get(peerId)?.name || peerId;
    const settings = videoTracks[0].getSettings();
    if (settings.width > 640 || settings.displaySurface) {
      Screen.onRemoteScreen(peerId, stream);
      UI.showScreen(peerId, stream);
    } else {
      UI.addCameraStream(peerId, stream, name);
    }
  }
}

// --- Leave / Switch ---

function handlePeerLeave(peerId) {
  const info = connections.get(peerId);
  const name = info?.name || peerId;
  connections.delete(peerId);
  Voice.removeRemoteStream(peerId);
  Screen.removeRemoteScreen(peerId);
  Chat.removeChannel(peerId);
  State.removeChannel(peerId);
  knownPeers.delete(peerId);
  UI.removePeer(peerId);
  UI.appendSystemMsg(`${name} left`);
}

function cleanupRoom() {
  connections.forEach(({ conn }) => conn.close());
  connections.clear();
  knownPeers.clear();
  Voice.stop();
  Camera.stop();
  Screen.stop();
  Bridge.stop();
  Media.clear();
  Chat.history = [];
  Chat.channels.clear();
  State.channels.clear();
  State.state = {};
  State.vector = {};
  ME.peer?.destroy();
  ME.peer = null;
}

async function switchRoom(newRoom) {
  console.log('[gridlock] switching room to:', newRoom);
  cleanupRoom();

  UI.peers.clear();
  document.getElementById('peers-list').innerHTML = '';
  document.getElementById('camera-grid').innerHTML = '';
  document.getElementById('chat-messages').innerHTML = '';
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

// Set up onJoin BEFORE checking saved name
UI.onJoin = async (name) => {
  console.log('[gridlock] onJoin fired, name:', name);
  localStorage.setItem('gridlock-name', name);
  await join(name, GLOBAL_ROOM);
};

UI.onLeave = () => {
  console.log('[gridlock] onLeave → switching to lobby');
  switchRoom(GLOBAL_ROOM);
};

// Room switcher in header
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
    if (e.key === 'Enter') {
      e.preventDefault();
      switchBtn.click();
    }
  });
} else {
  console.warn('[gridlock] room switcher elements not found');
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
  document.getElementById('join-screen').hidden = false;
  const nameInput = document.getElementById('input-name');
  nameInput.value = generateAnonName();
  nameInput.select();
  nameInput.focus();
}
