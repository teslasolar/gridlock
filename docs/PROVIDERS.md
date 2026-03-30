# GRIDLOCK Database Providers

GRIDLOCK is P2P-first — no database required. But if you WANT persistence beyond
your browser's IndexedDB, plug in your own backend. Your data, your database, your rules.

## Built-in Providers

| Provider | Use Case |
|----------|----------|
| **Supabase** | Postgres-backed, realtime, free tier |
| **Firebase** | Firestore, Google ecosystem |
| **REST API** | Any HTTP backend (Express, Django, Rails, Go, etc.) |
| **WebSocket** | Real-time custom backends |
| **Ignition Gateway** | Industrial SCADA / Inductive Automation |
| **Custom** | Template for anything else |

## Setup

### Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL setup (see below)
3. In GRIDLOCK, select "Supabase" from the DB Provider panel
4. Paste your config:
```json
{
  "url": "https://xxxxx.supabase.co",
  "anonKey": "eyJ..."
}
```

#### Supabase SQL Setup

```sql
-- Run this in Supabase SQL Editor

create table gridlock_messages (
  id bigserial primary key,
  room text not null,
  sender text not null,
  sender_name text not null,
  text text not null,
  created_at timestamptz default now()
);
create index idx_messages_room on gridlock_messages(room, created_at desc);

create table gridlock_files (
  id bigserial primary key,
  room text not null,
  name text not null,
  size bigint,
  magnet_uri text not null,
  info_hash text unique not null,
  shared_by text not null,
  created_at timestamptz default now()
);
create index idx_files_room on gridlock_files(room);

create table gridlock_state (
  room text not null,
  key text not null,
  value jsonb,
  updated_at timestamptz default now(),
  primary key (room, key)
);

create table gridlock_peers (
  room text not null,
  peer_id text not null,
  name text not null,
  last_seen timestamptz default now(),
  primary key (room, peer_id)
);

-- Enable RLS (optional — recommended for multi-tenant)
alter table gridlock_messages enable row level security;
alter table gridlock_files enable row level security;
alter table gridlock_state enable row level security;
alter table gridlock_peers enable row level security;

-- Allow all access with anon key (simple setup)
create policy "public_messages" on gridlock_messages for all using (true);
create policy "public_files" on gridlock_files for all using (true);
create policy "public_state" on gridlock_state for all using (true);
create policy "public_peers" on gridlock_peers for all using (true);
```

### Firebase

1. Create a project at [firebase.google.com](https://firebase.google.com)
2. Enable Firestore
3. Config:
```json
{
  "apiKey": "AIza...",
  "authDomain": "myapp.firebaseapp.com",
  "projectId": "myapp"
}
```
Collections are auto-created: `gridlock_rooms/{room}/messages`, `/files`, `/state`, `/peers`.

### REST API

Any backend that implements these endpoints:

```
GET    /rooms/:room/messages?limit=50
POST   /rooms/:room/messages          { from, name, text, timestamp }
GET    /rooms/:room/files
POST   /rooms/:room/files             { name, size, magnetURI, infoHash, sharedBy, timestamp }
GET    /rooms/:room/state
GET    /rooms/:room/state/:key
PUT    /rooms/:room/state/:key        { value }
GET    /rooms/:room/peers
POST   /rooms/:room/peers             { id, name }
```

Config:
```json
{
  "baseUrl": "https://your-api.com",
  "headers": {
    "Authorization": "Bearer your-token"
  }
}
```

### WebSocket

Backend must accept JSON messages with `{ _id, action, ...params }` and respond with `{ _id, data }`.

Actions: `saveMessage`, `getMessages`, `saveFile`, `getFiles`, `saveState`, `getState`, `getFullState`, `savePeer`, `getPeers`.

Config:
```json
{
  "url": "wss://your-server.com/ws"
}
```

### Ignition Gateway

Uses the Web Dev module REST endpoints on your Ignition Gateway.

1. Install the Web Dev module on your Ignition Gateway
2. Create a project (default: "gridlock")
3. Implement the REST endpoints under `system/webdev/gridlock/gridlock/*`
4. Config:
```json
{
  "baseUrl": "https://your-ignition:8088",
  "project": "gridlock",
  "apiKey": "optional-bearer-token"
}
```

### Custom Provider

Copy the `CustomProvider` class from `modules/providers.js` and implement the interface:

```javascript
import { BaseProvider, Providers } from './modules/providers.js';

class MyProvider extends BaseProvider {
  constructor() { super('my-backend'); }
  async init(config) { /* connect */ this.ready = true; }
  async saveMessage(room, msg) { /* ... */ }
  async getMessages(room, n) { return []; }
  // ... implement all methods
}

// Register it
Providers.register('my-backend', MyProvider);

// Then connect
await Providers.connect('my-backend', { /* your config */ });
```

## How It Works

- Provider is **optional** — GRIDLOCK works fully P2P without one
- When connected, chat messages and file metadata are **also** saved to your DB
- On join, history is loaded from the provider (catch up on what you missed)
- The provider never replaces P2P — it's an **additional** persistence layer
- All provider connections happen from YOUR browser to YOUR database
- GRIDLOCK never sees or touches your credentials
