#!/usr/bin/env node
// gridlock CLI — terminal node in the mesh

const { Peer } = require('peerjs');
const readline = require('readline');

const args = process.argv.slice(2);
const cmd = args[0];

const usage = `
GRIDLOCK CLI — terminal node in the P2P mesh

Usage:
  gridlock join <room> --name <name>    Join a room
  gridlock chat <room> "<message>"      Send a message
  gridlock peers <room>                 List peers
  gridlock help                         Show this help
`;

if (!cmd || cmd === 'help') {
  console.log(usage);
  process.exit(0);
}

async function hashRoom(room) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(room).digest('hex').slice(0, 16);
}

async function joinRoom(room, name) {
  const roomHash = await hashRoom(room);
  const peerId = `gl-cli-${name.slice(0, 6)}-${Math.random().toString(36).slice(2, 6)}`;

  console.log(`[GRIDLOCK] joining room: ${room}`);
  console.log(`[GRIDLOCK] peer id: ${peerId}`);

  const peer = new Peer(peerId);
  const connections = new Map();

  peer.on('open', () => {
    console.log(`[GRIDLOCK] connected. listening for peers...`);

    // Try to find lobby
    const lobbyId = `gl-lobby-${roomHash}`;
    const conn = peer.connect(lobbyId, { metadata: { name, room: roomHash } });

    conn.on('open', () => {
      conn.send(JSON.stringify({ type: 'announce', peerId, name }));
    });

    conn.on('data', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'peers') {
        msg.peers.forEach(p => {
          if (p.peerId !== peerId) console.log(`  peer: ${p.name} (${p.peerId})`);
        });
      }
      if (msg.type === 'chat') {
        console.log(`[${msg.msg.name}] ${msg.msg.text}`);
      }
    });
  });

  peer.on('connection', (conn) => {
    conn.on('data', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat') {
          console.log(`[${msg.msg.name}] ${msg.msg.text}`);
        } else if (msg.type === 'announce') {
          console.log(`[GRIDLOCK] ${msg.name} joined`);
          connections.set(msg.peerId, conn);
        }
      } catch (e) {}
    });
  });

  // Interactive chat
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const msg = {
      type: 'chat',
      msg: { from: peerId, name, text: line.trim(), timestamp: Date.now() }
    };
    connections.forEach(conn => {
      if (conn.open) conn.send(JSON.stringify(msg));
    });
    console.log(`[${name}] ${line.trim()}`);
  });

  rl.on('close', () => {
    peer.destroy();
    process.exit(0);
  });
}

(async () => {
  switch (cmd) {
    case 'join': {
      const room = args[1];
      const nameIdx = args.indexOf('--name');
      const name = nameIdx >= 0 ? args[nameIdx + 1] : 'cli-user';
      if (!room) { console.log('Usage: gridlock join <room> --name <name>'); process.exit(1); }
      await joinRoom(room, name);
      break;
    }
    default:
      console.log(usage);
      process.exit(1);
  }
})();
