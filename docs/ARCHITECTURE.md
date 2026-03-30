# GRIDLOCK Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────┐
│                    GRIDLOCK PLATFORM                      │
│                                                          │
│  Zero-server global P2P collaboration                    │
│  Browser = Node = Server = Client                        │
│  WebRTC data + media, WebTorrent files, WebLLM AI        │
└──────────────────────────────────────────────────────────┘

HOSTING:       GitHub Pages (static, $0)
SIGNALING:     WebTorrent tracker (wss://tracker.openwebtorrent.com)
TRANSPORT:     WebRTC (DTLS-encrypted peer connections)
FILE XFER:     WebTorrent (BitTorrent in the browser)
AI:            WebLLM (quantized LLM on local GPU)
STORAGE:       IndexedDB (client-side, never uploaded)
COST:          $0/mo forever
```

## Network Topology

```
              WebTorrent Tracker
            (signaling only, free)
           ┌────────┴────────┐
           │  SDP exchange   │
           │  (offer/answer) │
           └──┬──────────┬───┘
              │          │
              ▼          ▼
    ┌─────────────┐  ┌─────────────┐
    │  BROWSER A  │◄═╤═►│  BROWSER B  │
    │             │  │  │             │
    │ voice       │  │  │ voice       │
    │ camera      │  │  │ camera      │
    │ screen      │  │  │ screen      │
    │ chat (DC)   │  │  │ chat (DC)   │
    │ state (DC)  │  │  │ state (DC)  │
    │ media (DC)  │  │  │ media (DC)  │
    │ files (WT)  │  │  │ files (WT)  │
    │ LLM (local) │  │  │ LLM (local) │
    └──────┬──────┘  │  └──────┬──────┘
           │         │         │
           ▼         │         ▼
    ┌─────────────┐  │  ┌─────────────┐
    │  BROWSER C  │◄═╧═►│  BROWSER D  │
    └─────────────┘     └─────────────┘

    Full mesh: every node connects to every other node
    After signaling: ZERO server involvement
    Tracker only sees: "peer X wants to join room Y"
    Tracker never sees: messages, files, screens, voices
```

## Signaling Protocol

```
ROOM DISCOVERY (WebTorrent Tracker):

1. Room name → SHA-1 hash → 20-byte info_hash
   "lobby" → sha1("gridlock:lobby") → "a3f2..."

2. Browser connects to tracker via WebSocket:
   wss://tracker.openwebtorrent.com

3. Browser generates N WebRTC offers upfront:
   - Create RTCPeerConnection
   - Create DataChannel "mesh"
   - Generate SDP offer
   - Wait for ICE gathering complete
   - Package: { offer_id, offer: { type, sdp } }

4. Send announce to tracker:
   {
     action: "announce",
     info_hash: "<room hash>",
     peer_id: "<my id>",
     numwant: 10,
     offers: [<N offers>]
   }

5. Tracker relays offers to other peers in same info_hash

6. Remote peer receives offer → creates answer:
   - setRemoteDescription(offer)
   - createAnswer()
   - Send answer back via tracker

7. Original peer receives answer:
   - setRemoteDescription(answer)
   - DataChannel opens → direct P2P link established

8. Re-announce periodically (tracker sends interval)
   Picks up new peers who joined after us

POST-SIGNALING: All communication is peer-to-peer
Tracker is no longer involved
```

## Data Channel Protocol

```
CHANNEL: "mesh" (reliable, ordered)

MESSAGE FORMAT: JSON

TYPES:
┌─────────────┬──────────────────────────────────────────┐
│ type        │ payload                                  │
├─────────────┼──────────────────────────────────────────┤
│ announce    │ { senderId, name, emoji }                │
│ chat        │ { senderId, text, timestamp }            │
│ media_add   │ { item: { id, url, type, addedBy, ... }}│
│ media_remove│ { id }                                   │
│ file_shared │ { entry: { name, size, magnetURI, ... }} │
│ state_update│ { key, value, clock, from }              │
│ screen_start│ { peerId }                               │
│ screen_stop │ { peerId }                               │
│ ping        │ { senderId, timestamp }                  │
│ pong        │ { senderId, timestamp }                  │
└─────────────┴──────────────────────────────────────────┘

STATE SYNC: CRDT with vector clocks (last-writer-wins)
CONFLICT: merge clocks, accept if incoming > existing
```

## Module Architecture

```
index.html (shell)
    │
    └── peer.js (orchestrator)
            │
            ├── signal.js ──── WebTorrent tracker signaling
            │                  Offer generation
            │                  Answer handling
            │                  Reconnection logic
            │
            ├── voice.js ───── getUserMedia (audio)
            │                  Echo cancellation + noise suppression
            │                  Voice activity detection (VAD)
            │                  RTCPeerConnection media tracks
            │
            ├── camera.js ──── getUserMedia (video)
            │                  Toggle on/off
            │                  Facing mode switch
            │
            ├── screen.js ──── getDisplayMedia
            │                  Stream to peers
            │                  Auto-stop on track end
            │
            ├── chat.js ────── DataChannel messaging
            │                  Message history
            │                  URL detection in messages
            │
            ├── media.js ───── Shared URL grid
            │                  YouTube / image / audio / video embed
            │                  Twitch / Spotify / SoundCloud
            │                  Generic iframe (sandboxed)
            │
            ├── files.js ───── WebTorrent seed/leech
            │                  Magnet URI distribution
            │                  File index sync
            │
            ├── state.js ───── CRDT shared state
            │                  Vector clock conflict resolution
            │                  Key-value store
            │
            ├── llm.js ────── WebLLM (Phi-3 / Llama)
            │                  In-browser inference
            │                  Chat summarization
            │                  Code review
            │
            ├── bridge.js ──── GitHub Issue chat relay
            │                  HTTP polling fallback
            │                  Agent communication
            │
            ├── providers.js ─ Pluggable DB backends
            │                  Supabase / Firebase / REST
            │                  WebSocket / Ignition / Custom
            │
            ├── db.js ──────── IndexedDB persistence
            │                  Chat history, file index
            │                  Model cache, peer profiles
            │
            └── ui.js ──────── DOM rendering
                               View tabs (Grid/Cams/Screen)
                               Peer list, file list
                               Chat panel, media bar
```

## Security Model

```
ENCRYPTION:    DTLS (WebRTC built-in, end-to-end per connection)
AUTH:          Room name = shared secret (hash becomes info_hash)
IDENTITY:     Random peer ID per session (no persistent identity)
DATA:          Never touches a server (except signaling metadata)
STORAGE:       IndexedDB on user's machine only
FILES:         WebTorrent (encrypted in transit, cleartext at rest)
IFRAMES:       Sandboxed (allow-scripts allow-same-origin)

WHAT THE TRACKER SEES:
  - Your IP address
  - The room hash (cannot reverse to room name)
  - Your peer ID (random, not persistent)
  - That you're looking for peers

WHAT THE TRACKER NEVER SEES:
  - Chat messages
  - Shared files
  - Screen content
  - Voice/video streams
  - Shared state
  - Media grid URLs
  - Anything after signaling completes

WHAT GITHUB PAGES SEES:
  - Initial page load (standard HTTP logs)
  - Nothing else (all JS runs client-side)
```

## Connection Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│   LOAD   │────►│  SIGNAL  │────►│  MESH    │
│          │     │          │     │          │
│ HTML+JS  │     │ Tracker  │     │ WebRTC   │
│ from CDN │     │ connect  │     │ data +   │
│          │     │ exchange │     │ media    │
│          │     │ offers   │     │          │
└──────────┘     └──────────┘     └──────────┘
                                       │
                 ┌─────────────────────┤
                 │                     │
            ┌────▼─────┐        ┌─────▼────┐
            │ PERIODIC  │        │  ACTIVE  │
            │ REANNOUNCE│        │  SESSION │
            │           │        │          │
            │ Pick up   │        │ Chat     │
            │ new peers │        │ Voice    │
            │ who joined│        │ Screen   │
            │ later     │        │ Files    │
            └───────────┘        │ Media    │
                                 │ State    │
                                 └──────────┘

RECONNECTION:
  Tracker disconnect → auto-reconnect after 5s
  Peer disconnect → remove from mesh, UI updates
  Room switch → cleanup all connections → rejoin new room
```

## View System

```
┌─────────────────────────────────────────────────────┐
│ GRIDLOCK — lobby    claude    3 peers    [room] [GO]│
├──────────┬───────────────────────────┬──────────────┤
│ SIDEBAR  │  [GRID] [CAMS] [SCREEN]  │ CHAT         │
│          │                           │              │
│ PEERS    │  ┌─────────┐ ┌─────────┐ │ user1: hey   │
│ ● alice  │  │ YouTube │ │ Image   │ │ user2: sup   │
│ ● bob    │  │ embed   │ │ embed   │ │              │
│ ● claude │  │         │ │         │ │ user1: check │
│          │  └─────────┘ └─────────┘ │ this out     │
│ FILES    │  ┌─────────┐ ┌─────────┐ │ https://...  │
│ spec.md  │  │ Twitch  │ │ Webpage │ │  [+grid]     │
│ demo.js  │  │ stream  │ │ iframe  │ │              │
│          │  │         │ │         │ │              │
│ BRIDGE   │  └─────────┘ └─────────┘ │              │
│ polling  │                           │              │
│          │  [paste URL...] [SHARE]   │              │
│ LLM      ├───────────────────────────┤ [msg] [MIC] │
│ ready    │                           │ [CAM] [SCR] │
└──────────┴───────────────────────────┴──────────────┘

GRID VIEW:  Responsive grid of embedded media
            YouTube, images, audio, video, iframes
            Anyone can add/remove. Synced to all peers.

CAMS VIEW:  Gallery of all camera streams
            Auto-grid layout

SCREEN VIEW: Focused screen share
             Auto-switches when someone shares
```

## File Structure

```
gridlock/
├── index.html              App shell, CDN imports, layout
├── style.css               Dark theme, grid layout, responsive
│
├── modules/
│   ├── peer.js             Main orchestrator, join/leave/switch
│   ├── signal.js           WebTorrent tracker signaling
│   ├── voice.js            Mic capture, VAD, mute/unmute
│   ├── camera.js           Video capture, toggle, facing mode
│   ├── screen.js           Display capture, share/stop
│   ├── chat.js             DataChannel text messaging
│   ├── media.js            Shared URL grid, embed detection
│   ├── files.js            WebTorrent file sharing
│   ├── state.js            CRDT shared state, vector clocks
│   ├── llm.js              WebLLM in-browser AI
│   ├── bridge.js           GitHub Issue chat relay
│   ├── providers.js        Pluggable DB backends
│   ├── db.js               IndexedDB persistence
│   └── ui.js               DOM rendering, events
│
├── cli/
│   ├── gridlock.js         Node.js CLI client
│   ├── gridlock-bot.js     Terminal bot (WebRTC polyfill)
│   └── package.json
│
├── mcp/
│   ├── server.py           FastMCP tools for AI agents
│   └── requirements.txt
│
├── api/
│   └── bridge.js           HTTP → WebRTC bridge server
│
└── docs/
    ├── ARCHITECTURE.md     This document
    ├── PROTOCOL.md         Wire protocol specification
    ├── PROVIDERS.md        Database provider setup guides
    └── SETUP.md            Room setup & deployment guide
```

## Constraints (Non-Negotiable)

```
ZERO servers      GitHub Pages is static hosting, not a server
ZERO cost         All infrastructure is free-tier or community
ZERO accounts     Room name is the only credential
ZERO tracking     No analytics, no telemetry, no cookies
100% client-side  All computation happens in the browser
100% encrypted    DTLS for WebRTC, HTTPS for static assets
100% deletable    Clear browser data = complete erasure

If any constraint becomes non-zero, the project has failed.
```
