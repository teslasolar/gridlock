# GRIDLOCK

**Global Real-time Interlinked Development · Lockstep Operation Console Kit**

P2P everything. Zero servers. Zero cost. Browser IS the server.

## What It Replaces

| Tool | Cost | GRIDLOCK |
|------|------|----------|
| Zoom | $13/mo/host | WebRTC P2P (free) |
| Slack | $7/mo/user | DataChannel chat (free) |
| Google Meet | $6/mo/user | WebRTC media (free) |
| Dropbox | $10/mo/user | WebTorrent P2P (free) |
| AI Assistant | $20/mo | WebLLM in-browser (free) |

**Total cost: $0. Total servers: 0.**

## Features

- **Voice chat** — WebRTC peer-to-peer with echo cancellation + VAD
- **Screen sharing** — getDisplayMedia streamed to all peers
- **Camera** — video grid, toggle on/off
- **Text chat** — WebRTC data channels, instant delivery
- **File sharing** — WebTorrent, files are torrented between peers
- **Shared state** — CRDT with vector clocks, conflict-free sync
- **In-browser AI** — WebLLM runs a quantized LLM on your GPU
- **Local storage** — IndexedDB, your data never leaves your machine

## Quick Start

1. Open `index.html` in a browser (or deploy to GitHub Pages)
2. Enter your name and a room name
3. Share the room name with your people
4. That's it. You're connected.

## Architecture

```
Full mesh WebRTC topology (≤12 peers)
Every node connects to every other node
No central server routes anything
Signaling via PeerJS Cloud (free)
After handshake: zero server involvement
```

## File Structure

```
gridlock/
├── index.html          — app shell
├── style.css           — dark theme UI
├── modules/
│   ├── peer.js         — WebRTC mesh orchestrator
│   ├── voice.js        — mic + VAD
│   ├── camera.js       — video capture
│   ├── screen.js       — screen sharing
│   ├── chat.js         — text messaging
│   ├── files.js        — WebTorrent file sharing
│   ├── state.js        — CRDT shared state
│   ├── llm.js          — WebLLM integration
│   ├── ui.js           — DOM rendering
│   └── db.js           — IndexedDB persistence
├── cli/                — Node.js CLI client
├── mcp/                — MCP server (AI tools)
├── api/                — HTTP→WebRTC bridge
└── docs/               — protocol docs
```

## The Deal

- No accounts. Room name is the password.
- No cloud. Data lives in your browser.
- No cost. Everything is free infrastructure.
- If you clear browser data, it's gone. That's the feature.
