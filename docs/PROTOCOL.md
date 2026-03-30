# GRIDLOCK Protocol

## Overview

GRIDLOCK is a zero-server P2P collaboration protocol. Every browser is a node. The network is the users.

## Architecture

- **Signaling**: PeerJS Cloud (free) for initial WebRTC handshake
- **Transport**: WebRTC peer connections (full mesh, ≤12 peers)
- **Data**: WebRTC DataChannels for chat, state, file metadata
- **Media**: WebRTC MediaStreams for voice, camera, screen
- **Files**: WebTorrent for P2P file distribution
- **AI**: WebLLM for in-browser inference
- **Storage**: IndexedDB for local persistence

## Connection Flow

1. User opens page, enters name + room
2. PeerID generated from name + room hash + random suffix
3. Connect to PeerJS signaling server
4. Discover peers via lobby peer pattern
5. Establish WebRTC connections to all peers (full mesh)
6. Open data channels: chat, state, files
7. Exchange media streams: voice, camera, screen
8. All subsequent communication is peer-to-peer

## Data Channels

| Channel | Purpose |
|---------|---------|
| Default | Chat messages, announcements, file metadata |
| State   | CRDT-based shared state with vector clocks |

## Message Types

- `announce` — peer joining, includes name and peerId
- `chat` — text message with sender info and timestamp
- `file_shared` — WebTorrent magnet URI + file metadata
- `state_update` — CRDT state change with vector clock
- `screen_start` / `screen_stop` — screen share events

## State Synchronization

Uses last-writer-wins with vector clocks for conflict resolution.
Each state update includes the full vector clock.
On receive, merge clocks and accept if incoming clock dominates.

## Constraints

- Zero servers (GitHub Pages serves static files only)
- Zero cost (all infrastructure is free)
- Zero accounts (room name is the only credential)
- All data client-side (IndexedDB, never uploaded)
- Full mesh topology (every peer connects to every other)
