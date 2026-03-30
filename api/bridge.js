// bridge.js — HTTP → WebRTC mesh bridge
// Runs as a Node.js server that bridges HTTP API calls into the P2P mesh

const http = require('http');
const { Peer } = require('peerjs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3838;
const rooms = new Map(); // roomHash → { peer, connections, chat, files }

function hashRoom(room) {
  return crypto.createHash('sha256').update(room).digest('hex').slice(0, 16);
}

function getOrCreateRoom(room) {
  const h = hashRoom(room);
  if (!rooms.has(h)) {
    const peerId = `gl-bridge-${h.slice(0, 8)}`;
    const peer = new Peer(peerId);
    rooms.set(h, { peer, peerId, connections: new Map(), chat: [], files: [], state: {} });

    peer.on('open', () => {
      console.log(`[bridge] room ${room} bridge peer: ${peerId}`);
    });

    peer.on('connection', (conn) => {
      const r = rooms.get(h);
      conn.on('data', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'chat') r.chat.push(msg.msg);
          if (msg.type === 'file_shared') r.files.push(msg.entry);
          if (msg.type === 'announce') r.connections.set(msg.peerId, { name: msg.name });
        } catch (e) {}
      });
      conn.on('close', () => r.connections.delete(conn.peer));
    });
  }
  return rooms.get(h);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parts = req.url.split('/').filter(Boolean);
  // /room/:name/chat | /room/:name/files | /room/:name/state | /room/:name/peers
  if (parts[0] !== 'room' || !parts[1]) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const roomName = decodeURIComponent(parts[1]);
  const action = parts[2];
  const room = getOrCreateRoom(roomName);

  switch (action) {
    case 'chat':
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const msg = { from: 'api', name: body.name || 'API', text: body.message, timestamp: Date.now() };
        room.chat.push(msg);
        room.connections.forEach((_, peerId) => {
          // Would send via PeerJS data connection
        });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, msg }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(room.chat.slice(-50)));
      }
      break;
    case 'peers':
      res.writeHead(200);
      res.end(JSON.stringify([...room.connections.entries()].map(([id, info]) => ({ id, ...info }))));
      break;
    case 'files':
      res.writeHead(200);
      res.end(JSON.stringify(room.files));
      break;
    case 'state':
      res.writeHead(200);
      res.end(JSON.stringify(room.state));
      break;
    default:
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'unknown action' }));
  }
});

server.listen(PORT, () => console.log(`[GRIDLOCK bridge] http://localhost:${PORT}`));
