# GRIDLOCK Wire Protocol

## Signaling Layer (WebTorrent Tracker)

### Tracker Connection
```
URL: wss://tracker.openwebtorrent.com
Protocol: WebTorrent tracker protocol (BEP 15 over WebSocket)
```

### Room → info_hash
```
info_hash = SHA-1("gridlock:" + room_name)
Example: SHA-1("gridlock:lobby") → "a3f2c8..."
```

### Announce (join room)
```json
{
  "action": "announce",
  "info_hash": "<40-char hex>",
  "peer_id": "<20-byte id>",
  "numwant": 10,
  "uploaded": 0,
  "downloaded": 0,
  "left": 1,
  "offers": [
    {
      "offer_id": "<uuid>",
      "offer": { "type": "offer", "sdp": "<SDP>" }
    }
  ]
}
```

### Answer (respond to offer)
```json
{
  "action": "announce",
  "info_hash": "<40-char hex>",
  "peer_id": "<my id>",
  "to_peer_id": "<remote id>",
  "answer": { "type": "answer", "sdp": "<SDP>" },
  "offer_id": "<uuid>"
}
```

### Re-announce
Tracker returns `interval` field. Client re-announces after that many seconds
to discover peers who joined after the initial announce.

## Data Channel Layer

### Channel Setup
```
Name: "mesh"
Ordered: true
Reliable: true (default)
```

### Message Format
All messages are JSON strings.

### Message Types

#### announce
First message sent on new data channel. Identifies the peer.
```json
{
  "type": "announce",
  "senderId": "-GL0001-a3f2c8...",
  "name": "cool-fox-42"
}
```

#### chat
Text message to the room.
```json
{
  "type": "chat",
  "msg": {
    "from": "<peerId>",
    "name": "cool-fox-42",
    "text": "hello world",
    "timestamp": 1711756800000
  }
}
```

#### media_add
Share a URL to the media grid.
```json
{
  "type": "media_add",
  "item": {
    "id": "media-1711756800000-x3k2",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "type": "youtube",
    "embedId": "dQw4w9WgXcQ",
    "addedBy": "cool-fox-42",
    "timestamp": 1711756800000
  }
}
```

Supported media types:
| type | detection | embed method |
|------|-----------|-------------|
| youtube | youtube.com/watch, youtu.be | iframe embed player |
| image | .png/.jpg/.gif/.webp/.svg | img tag |
| video | .mp4/.webm/.mov | video tag |
| audio | .mp3/.wav/.ogg | audio tag |
| twitch | twitch.tv/channel | iframe player |
| spotify | open.spotify.com | iframe embed |
| soundcloud | soundcloud.com | iframe widget |
| iframe | any other URL | sandboxed iframe |

#### media_remove
Remove a URL from the media grid.
```json
{
  "type": "media_remove",
  "id": "media-1711756800000-x3k2"
}
```

#### file_shared
Announce a WebTorrent-seeded file.
```json
{
  "type": "file_shared",
  "entry": {
    "name": "presentation.pdf",
    "size": 2048576,
    "magnetURI": "magnet:?xt=urn:btih:...",
    "infoHash": "a3f2c8...",
    "sharedBy": "<peerId>",
    "timestamp": 1711756800000
  }
}
```

#### state_update
CRDT shared state change.
```json
{
  "type": "state_update",
  "key": "currentSong",
  "value": "https://...",
  "clock": { "<peerId>": 3, "<peerId2>": 1 },
  "from": "<peerId>"
}
```
Conflict resolution: last-writer-wins with vector clocks.
Accept update if any component of incoming clock > existing clock.

#### screen_start / screen_stop
```json
{ "type": "screen_start", "peerId": "<peerId>" }
{ "type": "screen_stop", "peerId": "<peerId>" }
```

## Media Layer (WebRTC)

### Voice
```
Codec: Opus (browser default)
Channels: mono
Echo cancellation: enabled
Noise suppression: enabled
```

### Camera
```
Resolution: 320x240 (default)
Codec: VP8/VP9 (browser negotiated)
```

### Screen Share
```
Resolution: native display resolution
Frame rate: 15fps max
Cursor: always visible
System audio: captured if available
```

## File Layer (WebTorrent)

```
Protocol: BitTorrent over WebRTC (WebTorrent)
Discovery: Magnet URI shared via data channel
Seeding: Browser seeds while tab is open
Leeching: Browser downloads from all available seeders
Persistence: None — files exist only while seeders are online
```

## Storage Layer (IndexedDB)

```
Database: "gridlock"
Stores:
  chatHistory      → { id, from, name, text, timestamp }
  fileIndex        → { id, name, size, magnetURI, infoHash, sharedBy }
  stateSnapshots   → { id, state, timestamp }
  llmCache         → { id, prompt, response }
  peerProfiles     → { id, name, lastSeen }
  roomBookmarks    → { id, room, name }
```

## Security

```
Transport:     DTLS (WebRTC built-in)
Signaling:     WSS (TLS to tracker)
Static assets: HTTPS (GitHub Pages)
iframes:       sandbox="allow-scripts allow-same-origin allow-popups"
Data at rest:  Unencrypted IndexedDB (user's machine)
```
