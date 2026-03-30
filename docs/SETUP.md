# GRIDLOCK Setup Guide

## Quick Start (30 seconds)

1. Open https://teslasolar.github.io/gridlock/
2. Pick a name (or keep the generated one)
3. You're in the global lobby. Done.

## Rooms

### Global Lobby
Everyone lands here by default. Open to all. The town square.

### Private Rooms
Type a room name in the header bar → click GO.
Room name = password. Only people who know the name can join.

```
Good room names:       Bad room names:
  guild-standup          meeting
  tesla-solar-eng        test
  alex-kelly-1on1        room1
  hackathon-2026-q1
```

### Room Architecture
```
Room name: "guild-standup"
    ↓
SHA-1("gridlock:guild-standup")
    ↓
info_hash: "a3f2c8..." (20 bytes)
    ↓
WebTorrent tracker groups peers by info_hash
    ↓
All peers with same info_hash discover each other
    ↓
WebRTC connections established (full mesh)
    ↓
Room is live. No server knows the room name.
```

## Features

### Chat
Type in the chat bar, hit Enter. Messages go to all peers via WebRTC data channels.
URLs in messages are auto-linked. Click `[+grid]` to pin a URL to the media grid.

### Media Grid (GRID tab)
Paste any URL in the media bar at the bottom of the main view.
Auto-detects and embeds:
- **YouTube** — embed player, no ads
- **Images** — png, jpg, gif, webp, svg
- **Video** — mp4, webm (direct file)
- **Audio** — mp3, wav, ogg
- **Twitch** — live stream embed
- **Spotify** — track/album/playlist embed
- **SoundCloud** — track embed
- **Any URL** — sandboxed iframe

Everyone in the room sees the same grid. Anyone can close any cell.

### Voice (MIC button)
Click MIC to enable microphone. Audio streams via WebRTC to all peers.
Echo cancellation and noise suppression enabled by default.
Voice activity detection highlights who's speaking in the peer list.

### Camera (CAM button)
Click CAM to enable camera. Video appears in the CAMS tab.
320x240 by default. All peers see all cameras in a grid layout.

### Screen Share (SCR button)
Click SCR to share your screen. Auto-switches everyone to SCREEN tab.
15fps, includes cursor. System audio captured if browser supports it.
Click SCR again to stop sharing.

### File Sharing
Click `[share file]` in the sidebar. Select any file.
File is seeded via WebTorrent. Magnet URI shared with all peers.
Click a file name to download via WebTorrent P2P.

**Important:** Files only exist while seeders are online.
When all seeders leave, files are gone. That's the feature.

### In-Browser AI (LLM)
Click `Load AI` to download a quantized model into your browser.
First load: downloads ~2-4GB model (cached in IndexedDB after).
Subsequent loads: instant from cache.

Requires WebGPU (Chrome 113+, Edge 113+).
Model runs entirely in your browser. No API key. No data leaves.

### Chat Bridge
Connect to a GitHub Issue as a chat relay.
Useful for agents/bots/CI that can't do WebRTC.

1. In the CHAT BRIDGE panel, set repo and issue number
2. Click connect
3. Comments on the issue appear in chat (polled every 5s)
4. With a GitHub token, chat messages post back to the issue

### Database Providers
Optional external persistence. See [PROVIDERS.md](PROVIDERS.md).

## Deployment

### GitHub Pages (recommended, $0)
```bash
# Fork the repo
# Enable GitHub Pages in Settings → Pages → main branch
# Your instance: https://yourusername.github.io/gridlock/
```

### Self-hosted (any static server)
```bash
# Just serve the files. Any HTTP server works.
npx serve .
# or
python -m http.server 8080
# or
nginx, apache, caddy, whatever
```

No build step. No bundler. No dependencies to install.
The HTML file loads PeerJS and WebTorrent from CDN.

### Custom Domain
Point your domain to the GitHub Pages or static server.
Add CNAME file. That's it.

## Scaling

```
1-6 peers:    Optimal. Full mesh, low overhead.
7-12 peers:   Works well. Mesh gets denser.
13-20 peers:  Functional. CPU/bandwidth increases.
20+ peers:    Consider splitting into multiple rooms.

BOTTLENECK: Each peer connects to every other peer.
  6 peers  = 15 connections
  12 peers = 66 connections
  20 peers = 190 connections

For large groups: use multiple rooms + bridge between them.
```

## Troubleshooting

### "No peers found"
- Room names are case-sensitive. Make sure everyone uses the exact same name.
- WebRTC may be blocked by corporate firewalls. Try a different network.
- Check browser console for `[signal]` logs.

### Voice/camera not working
- Browser must grant permission. Check the address bar for blocked permissions.
- HTTPS required for getUserMedia (GitHub Pages provides this).
- Some browsers block media in iframes.

### Screen share shows black
- Some Wayland compositors don't support getDisplayMedia well.
- Try sharing a specific window instead of the entire screen.

### Files not downloading
- The seeder must still be online. WebTorrent is P2P.
- WebTorrent trackers may be temporarily down. Wait and retry.
