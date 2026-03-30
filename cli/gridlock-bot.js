#!/usr/bin/env node
// gridlock-bot.js — CLI bot that joins the mesh and chats

// Polyfill browser globals for Node.js (PeerJS needs them)
const polyfill = require('node-datachannel/polyfill');
const WebSocket = require('ws');
globalThis.WebSocket = WebSocket;
globalThis.RTCPeerConnection = polyfill.RTCPeerConnection;
globalThis.RTCSessionDescription = polyfill.RTCSessionDescription;
globalThis.RTCIceCandidate = polyfill.RTCIceCandidate;
globalThis.RTCDataChannelEvent = polyfill.RTCDataChannelEvent;
globalThis.MediaStream = class MediaStream { constructor() { this._tracks = []; } getTracks() { return this._tracks; } getAudioTracks() { return []; } getVideoTracks() { return []; } addTrack(t) { this._tracks.push(t); } };
globalThis.navigator = globalThis.navigator || {};
globalThis.navigator.mediaDevices = globalThis.navigator.mediaDevices || {};
// Blob polyfill if needed
if (typeof Blob === 'undefined') { globalThis.Blob = require('buffer').Blob; }

const crypto = require('crypto');

function hashRoom(room) {
  return crypto.createHash('sha256').update(room).digest('hex').slice(0, 16);
}

async function main() {
  const { Peer } = require('peerjs');

  const room = 'lobby';
  const name = 'claude-bot';
  const roomHash = hashRoom(room);
  const peerId = `gl-${roomHash.slice(0, 6)}-claude-${Math.random().toString(36).slice(2, 6)}`;

  console.log(`[bot] joining room: ${room}`);
  console.log(`[bot] room hash: ${roomHash}`);
  console.log(`[bot] peer id: ${peerId}`);

  const peer = new Peer(peerId, { debug: 2 });
  const connections = new Map();

  peer.on('open', (id) => {
    console.log(`[bot] connected to PeerJS signaling, id: ${id}`);
    console.log(`[bot] waiting for browser peers...`);

    // Try to find the lobby coordinator
    const lobbyId = `gl-lobby-${roomHash}`;
    console.log(`[bot] trying lobby peer: ${lobbyId}`);
    const conn = peer.connect(lobbyId, { metadata: { name, room: roomHash }, reliable: true });

    conn.on('open', () => {
      console.log(`[bot] connected to lobby!`);
      conn.send(JSON.stringify({ type: 'announce', peerId: id, name }));
    });

    conn.on('data', (data) => {
      try {
        const msg = JSON.parse(data);
        console.log(`[bot] lobby data:`, JSON.stringify(msg).slice(0, 200));
        if (msg.type === 'peers') {
          msg.peers.forEach(p => {
            if (p.peerId !== id && !connections.has(p.peerId)) {
              console.log(`[bot] found peer: ${p.name} (${p.peerId})`);
              connectToPeer(peer, id, p.peerId, p.name, connections);
            }
          });
        }
      } catch (e) {
        console.log(`[bot] lobby raw:`, String(data).slice(0, 200));
      }
    });

    conn.on('error', (err) => {
      console.log(`[bot] lobby connection error:`, err.type || err.message || err);
      console.log(`[bot] becoming lobby ourselves...`);
    });
  });

  peer.on('connection', (conn) => {
    console.log(`[bot] incoming connection from: ${conn.peer}`);
    conn.on('open', () => {
      const peerName = conn.metadata?.name || conn.peer.slice(0, 12);
      console.log(`[bot] data channel open with: ${peerName}`);
      connections.set(conn.peer, { conn, name: peerName });

      conn.send(JSON.stringify({ type: 'announce', peerId: peer.id, name }));

      // Send a greeting
      const chatMsg = {
        type: 'chat',
        msg: {
          from: peer.id,
          name: name,
          text: 'hey! claude-bot connected from the terminal. the mesh works.',
          timestamp: Date.now()
        }
      };
      conn.send(JSON.stringify(chatMsg));
      console.log(`[bot] sent greeting to ${peerName}`);
    });

    conn.on('data', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat') {
          console.log(`[chat] ${msg.msg.name}: ${msg.msg.text}`);
        } else if (msg.type === 'announce') {
          console.log(`[bot] peer announced: ${msg.name}`);
          connections.set(conn.peer, { conn, name: msg.name });
        } else {
          console.log(`[bot] msg type=${msg.type}`, JSON.stringify(msg).slice(0, 100));
        }
      } catch (e) {
        console.log(`[bot] raw data:`, String(data).slice(0, 200));
      }
    });

    conn.on('close', () => {
      console.log(`[bot] peer disconnected: ${conn.peer}`);
      connections.delete(conn.peer);
    });
  });

  peer.on('error', (err) => {
    console.error(`[bot] PeerJS error:`, err.type, err.message);
  });

  peer.on('disconnected', () => {
    console.log(`[bot] disconnected from signaling, reconnecting...`);
    peer.reconnect();
  });

  // Send periodic messages to stay alive and prove we're connected
  setInterval(() => {
    if (connections.size > 0) {
      const chatMsg = {
        type: 'chat',
        msg: {
          from: peer.id,
          name: name,
          text: `still here. ${connections.size} peer(s) connected. ${new Date().toLocaleTimeString()}`,
          timestamp: Date.now()
        }
      };
      connections.forEach(({ conn }) => {
        if (conn.open) conn.send(JSON.stringify(chatMsg));
      });
      console.log(`[bot] heartbeat sent to ${connections.size} peer(s)`);
    }
  }, 30000);

  // Read stdin for manual messages
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const chatMsg = {
      type: 'chat',
      msg: { from: peer.id, name, text: line.trim(), timestamp: Date.now() }
    };
    let sent = 0;
    connections.forEach(({ conn }) => {
      if (conn.open) { conn.send(JSON.stringify(chatMsg)); sent++; }
    });
    console.log(`[bot] sent to ${sent} peer(s): ${line.trim()}`);
  });
}

function connectToPeer(peer, myId, peerId, peerName, connections) {
  console.log(`[bot] initiating connection to: ${peerName} (${peerId})`);
  const conn = peer.connect(peerId, {
    metadata: { name: 'claude-bot', room: 'lobby' },
    reliable: true
  });

  conn.on('open', () => {
    console.log(`[bot] connected to ${peerName}!`);
    connections.set(peerId, { conn, name: peerName });
    conn.send(JSON.stringify({ type: 'announce', peerId: myId, name: 'claude-bot' }));

    const chatMsg = {
      type: 'chat',
      msg: {
        from: myId,
        name: 'claude-bot',
        text: 'connected! claude-bot here from the CLI.',
        timestamp: Date.now()
      }
    };
    conn.send(JSON.stringify(chatMsg));
  });

  conn.on('data', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'chat') {
        console.log(`[chat] ${msg.msg.name}: ${msg.msg.text}`);
      } else if (msg.type === 'announce') {
        console.log(`[bot] ${msg.name} announced`);
      } else {
        console.log(`[bot] ${peerName} sent: type=${msg.type}`);
      }
    } catch (e) {
      console.log(`[bot] raw from ${peerName}:`, String(data).slice(0, 200));
    }
  });

  conn.on('close', () => {
    console.log(`[bot] ${peerName} disconnected`);
    connections.delete(peerId);
  });

  conn.on('error', (err) => {
    console.warn(`[bot] connection to ${peerName} failed:`, err.type || err);
  });
}

main().catch(err => {
  console.error('[bot] fatal:', err);
  process.exit(1);
});
