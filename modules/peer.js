// peer.js — WebRTC mesh management (main orchestrator)

import UI from './ui.js';
import Voice from './voice.js';
import Camera from './camera.js';
import Screen from './screen.js';
import Chat from './chat.js';
import Files from './files.js';
import State from './state.js';
import DB from './db.js';

const ME = { id: null, name: null, room: null, peer: null };
const connections = new Map(); // peerId → { pc, dataChannel }

async function hashRoom(room) {
  const buf = new TextEncoder().encode(room);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function generatePeerId(name, room) {
  // Deterministic-ish but with random suffix to allow multiple tabs
  const base = `gl-${room.slice(0, 6)}-${name.slice(0, 6)}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${base}-${rand}`;
}

async function join(name, room) {
  ME.name = name;
  ME.room = room;

  await DB.init();
  Files.init();

  const roomHash = await hashRoom(room);
  ME.id = generatePeerId(name, roomHash);

  // Connect to PeerJS signaling
  ME.peer = new Peer(ME.id, {
    debug: 0,
  });

  ME.peer.on('open', (id) => {
    ME.id = id;
    UI.showMain(room);
    UI.appendSystemMsg(`connected as ${name} (${id.slice(0, 12)}...)`);

    // Announce to room via PeerJS discovery
    // We use a room-specific "lobby" peer to discover others
    discoverPeers(roomHash);
  });

  ME.peer.on('connection', (conn) => {
    handleIncomingConnection(conn);
  });

  ME.peer.on('call', (call) => {
    // Answer with our streams
    const streams = [];
    if (Voice.stream) streams.push(Voice.stream);
    if (Camera.stream) streams.push(Camera.stream);
    if (Screen.stream) streams.push(Screen.stream);

    call.answer(Voice.stream || new MediaStream());
    call.on('stream', (remoteStream) => {
      handleRemoteStream(call.peer, remoteStream);
    });
  });

  ME.peer.on('error', (err) => {
    UI.appendSystemMsg(`error: ${err.type}`);
  });

  // Wire up UI callbacks
  UI._onChatSend = (text) => {
    Chat.send(text, ME.id, ME.name);
  };

  UI._onFileShare = async (file) => {
    UI.appendSystemMsg(`sharing: ${file.name}...`);
    const entry = await Files.share(file, ME.id);
    if (entry) {
      UI.updateFileList(Files.getIndex());
      UI.appendSystemMsg(`shared: ${file.name}`);
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

  // Mic button
  document.getElementById('btn-mic').onclick = async () => {
    if (!Voice.stream) {
      try {
        await Voice.init();
        Voice.unmute();
        UI.setMicActive(true);
        UI.appendSystemMsg('mic on');
        // Add audio to existing connections
        connections.forEach(({ pc }) => Voice.attachToPeer(pc));
      } catch (e) {
        UI.appendSystemMsg('mic access denied');
      }
    } else {
      if (Voice.isMuted()) {
        Voice.unmute();
        UI.setMicActive(true);
      } else {
        Voice.mute();
        UI.setMicActive(false);
      }
    }
  };

  // Camera button
  document.getElementById('btn-cam').onclick = async () => {
    if (!Camera.stream) {
      try {
        await Camera.init();
        UI.setCamActive(true);
        UI.addCameraStream('local', Camera.stream, ME.name);
        connections.forEach(({ pc }) => Camera.attachToPeer(pc));
      } catch (e) {
        UI.appendSystemMsg('camera access denied');
      }
    } else {
      const on = Camera.toggle();
      UI.setCamActive(on);
    }
  };

  // Screen share button
  document.getElementById('btn-screen').onclick = async () => {
    if (!Screen.isSharing()) {
      try {
        await Screen.share(ME.id);
        UI.setScreenActive(true);
        UI.appendSystemMsg('screen sharing started');
        connections.forEach(({ pc }) => Screen.attachToPeer(pc));
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

  // Chat message callback
  Chat.onMessageCallback = (msg) => {
    UI.appendChat(msg);
    DB.put('chatHistory', { ...msg, id: `${msg.timestamp}-${msg.from}` }).catch(() => {});
  };
}

function discoverPeers(roomHash) {
  // Use a lobby peer ID pattern to find room members
  // Each peer registers with a known prefix
  const lobbyId = `gl-lobby-${roomHash}`;

  // Try connecting to the lobby coordinator
  const conn = ME.peer.connect(lobbyId, { metadata: { name: ME.name, room: roomHash } });

  conn.on('open', () => {
    conn.send(JSON.stringify({ type: 'announce', peerId: ME.id, name: ME.name }));
  });

  conn.on('data', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'peers') {
      msg.peers.forEach(p => {
        if (p.peerId !== ME.id && !connections.has(p.peerId)) {
          connectToPeer(p.peerId, p.name);
        }
      });
    }
  });

  conn.on('error', () => {
    // No lobby exists yet — we become the lobby
    becomeLobby(roomHash);
  });

  // Also become lobby as backup (multiple lobbies merge)
  setTimeout(() => becomeLobby(roomHash), 2000);
}

const knownPeers = new Map();

function becomeLobby(roomHash) {
  knownPeers.set(ME.id, { peerId: ME.id, name: ME.name });

  ME.peer.on('connection', (conn) => {
    conn.on('data', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'announce') {
          knownPeers.set(msg.peerId, { peerId: msg.peerId, name: msg.name });
          // Send back known peers
          conn.send(JSON.stringify({ type: 'peers', peers: [...knownPeers.values()] }));
          // Connect to this new peer
          if (msg.peerId !== ME.id && !connections.has(msg.peerId)) {
            connectToPeer(msg.peerId, msg.name);
          }
        }
      } catch (e) {
        // Not a lobby message, handle as data channel
        handleDataMessage(conn.peer, data);
      }
    });
  });
}

function connectToPeer(peerId, name) {
  if (connections.has(peerId)) return;

  const conn = ME.peer.connect(peerId, {
    metadata: { name: ME.name, room: ME.room },
    reliable: true
  });

  conn.on('open', () => {
    setupDataConnection(peerId, conn, name);

    // Send announce
    conn.send(JSON.stringify({ type: 'announce', peerId: ME.id, name: ME.name }));

    // Call with media
    if (Voice.stream || Camera.stream) {
      const stream = new MediaStream();
      if (Voice.stream) Voice.stream.getTracks().forEach(t => stream.addTrack(t));
      if (Camera.stream) Camera.stream.getTracks().forEach(t => stream.addTrack(t));
      const call = ME.peer.call(peerId, stream);
      call.on('stream', (remoteStream) => handleRemoteStream(peerId, remoteStream));
    }
  });

  conn.on('error', (err) => {
    console.warn(`Connection to ${peerId} failed:`, err);
  });
}

function handleIncomingConnection(conn) {
  conn.on('open', () => {
    const name = conn.metadata?.name || conn.peer.slice(0, 12);
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
        UI._renderPeers?.();
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
    }
  } catch (e) {
    // Ignore non-JSON messages
  }
}

function handleRemoteStream(peerId, stream) {
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();

  if (audioTracks.length > 0) {
    Voice.onRemoteStream(peerId, stream);
    Voice.detectSpeaking(stream, (speaking) => {
      UI.setSpeaking(peerId, speaking);
    });
  }

  if (videoTracks.length > 0) {
    const name = connections.get(peerId)?.name || peerId;
    // Check if it's a screen share (usually higher resolution)
    const settings = videoTracks[0].getSettings();
    if (settings.width > 640 || settings.displaySurface) {
      Screen.onRemoteScreen(peerId, stream);
      UI.showScreen(peerId, stream);
    } else {
      UI.addCameraStream(peerId, stream, name);
    }
  }
}

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

function leave() {
  connections.forEach(({ conn }) => conn.close());
  connections.clear();
  knownPeers.clear();
  Voice.stop();
  Camera.stop();
  Screen.stop();
  ME.peer?.destroy();
  ME.peer = null;
  UI.showJoin();
}

// Initialize UI and wire up join/leave
UI.init();
UI.onJoin = join;
UI.onLeave = leave;

// Restore name from localStorage
const savedName = localStorage.getItem('gridlock-name');
if (savedName) document.getElementById('input-name').value = savedName;

// Save name on join
const origJoin = UI.onJoin;
UI.onJoin = (name, room) => {
  localStorage.setItem('gridlock-name', name);
  origJoin(name, room);
};
