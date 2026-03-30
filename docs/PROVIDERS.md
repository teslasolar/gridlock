# GRIDLOCK Database & Protocol Providers

GRIDLOCK is P2P-first — no database required. But if you WANT persistence beyond
your browser's IndexedDB, plug in your own backend. Your data, your database, your rules.

## Built-in Providers

### Databases
| Provider | Use Case |
|----------|----------|
| **Supabase** | Postgres-backed, realtime, free tier |
| **Firebase** | Firestore, Google ecosystem |
| **Redis** | Upstash, Webdis, or any Redis HTTP bridge |

### APIs
| Provider | Use Case |
|----------|----------|
| **REST API** | Any HTTP backend (Express, Django, Rails, Go, etc.) |
| **GraphQL** | Hasura, AppSync, custom GraphQL servers |
| **WebSocket** | Real-time custom backends |

### Industrial / IoT
| Provider | Use Case |
|----------|----------|
| **MQTT** | Mosquitto, HiveMQ, EMQX, AWS IoT Core |
| **OPC-UA** | Industrial SCADA via REST gateway |
| **AMQP** | RabbitMQ, message queues |
| **Ignition Gateway** | Inductive Automation SCADA |

### Low-Level
| Provider | Use Case |
|----------|----------|
| **Raw TCP/UDP** | Custom binary/text protocols via WS bridge |
| **Custom** | Template — implement anything |

---

## Setup

### Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL setup (below)
3. In GRIDLOCK sidebar → DB Provider → select Supabase
4. Paste config:
```json
{
  "url": "https://xxxxx.supabase.co",
  "anonKey": "eyJ..."
}
```

#### SQL Setup
```sql
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

create table gridlock_state (
  room text not null,
  key text not null,
  value jsonb,
  primary key (room, key)
);

create table gridlock_peers (
  room text not null,
  peer_id text not null,
  name text not null,
  last_seen timestamptz default now(),
  primary key (room, peer_id)
);

-- RLS policies (allow all with anon key)
alter table gridlock_messages enable row level security;
alter table gridlock_files enable row level security;
alter table gridlock_state enable row level security;
alter table gridlock_peers enable row level security;
create policy "public" on gridlock_messages for all using (true);
create policy "public" on gridlock_files for all using (true);
create policy "public" on gridlock_state for all using (true);
create policy "public" on gridlock_peers for all using (true);
```

---

### Firebase

1. Create project at [firebase.google.com](https://firebase.google.com)
2. Enable Firestore
3. Config:
```json
{
  "apiKey": "AIza...",
  "authDomain": "myapp.firebaseapp.com",
  "projectId": "myapp"
}
```
Collections auto-created: `gridlock_rooms/{room}/messages`, `/files`, `/state`, `/peers`.

---

### Redis

Works with Upstash (free tier), Webdis, or any Redis HTTP bridge.

#### Upstash (easiest)
1. Create a database at [upstash.com](https://upstash.com)
2. Copy the REST URL and token
3. Config:
```json
{
  "url": "https://xxxx.upstash.io",
  "token": "AXxx..."
}
```

#### Webdis (self-hosted)
```json
{
  "url": "http://localhost:7379"
}
```

Keys used: `gridlock:{room}:messages` (list), `:files` (list), `:state:{key}` (string), `:peers` (hash).

---

### REST API

Any backend that implements these endpoints:

```
GET    /rooms/:room/messages?limit=50
POST   /rooms/:room/messages          { from, name, text, timestamp }
GET    /rooms/:room/files
POST   /rooms/:room/files             { name, size, magnetURI, ... }
GET    /rooms/:room/state
GET    /rooms/:room/state/:key
PUT    /rooms/:room/state/:key        { value }
GET    /rooms/:room/peers
POST   /rooms/:room/peers             { id, name }
```

```json
{
  "baseUrl": "https://your-api.com",
  "headers": { "Authorization": "Bearer your-token" }
}
```

---

### GraphQL

Works with Hasura, AWS AppSync, or any GraphQL server.
Expects tables: `gridlock_messages`, `gridlock_files`, `gridlock_state`, `gridlock_peers`.

#### Hasura Setup
```json
{
  "endpoint": "https://your-hasura.hasura.app/v1/graphql",
  "headers": { "x-hasura-admin-secret": "your-secret" }
}
```

The provider generates standard Hasura-style mutations and queries.
For custom GraphQL schemas, extend the `GraphQLProvider` class.

---

### WebSocket

Backend must accept JSON: `{ _id, action, ...params }` and respond with `{ _id, data }`.

Actions: `saveMessage`, `getMessages`, `saveFile`, `getFiles`, `saveState`, `getState`, `getFullState`, `savePeer`, `getPeers`.

```json
{
  "url": "wss://your-server.com/ws"
}
```

---

### MQTT

Connects to any MQTT broker via WebSocket. Messages published to topics:
`gridlock/{room}/messages`, `/files`, `/state/{key}`, `/peers`.

#### Public Broker (testing)
```json
{
  "brokerUrl": "wss://broker.hivemq.com:8884/mqtt"
}
```

#### Private Broker (Mosquitto, EMQX, etc.)
```json
{
  "brokerUrl": "wss://your-broker:8083/mqtt",
  "username": "gridlock",
  "password": "your-password",
  "qos": 1
}
```

#### AWS IoT Core
```json
{
  "brokerUrl": "wss://xxxx.iot.us-east-1.amazonaws.com/mqtt",
  "clientId": "gridlock-browser"
}
```
(Requires SigV4 auth — use a custom provider or pre-signed URL.)

State keys use `retain: true` so late joiners get the last value.

---

### OPC-UA

Connects to OPC-UA servers via a REST gateway. The gateway translates HTTP requests to OPC-UA read/write operations.

Compatible gateways: node-opcua-webapi, Prosys OPC UA Simulation Server, Unified Automation UaGateway.

```json
{
  "gatewayUrl": "http://localhost:4840/api",
  "namespace": "gridlock",
  "username": "optional",
  "password": "optional"
}
```

Node paths: `Objects/gridlock/{room}/Messages`, `/Files`, `/State/{key}`, `/Peers`.

---

### AMQP / RabbitMQ

Connects via the RabbitMQ Management HTTP API.

1. Enable the management plugin: `rabbitmq-plugins enable rabbitmq_management`
2. Create exchange: `gridlock.{room}` (topic type)
3. Bind queues: `gridlock.{room}.messages`, `.files`, `.state`, `.peers`
4. Config:

```json
{
  "managementUrl": "http://localhost:15672/api",
  "username": "guest",
  "password": "guest",
  "vhost": "/"
}
```

---

### Ignition Gateway

Uses the Web Dev module REST endpoints.

```json
{
  "baseUrl": "https://your-ignition:8088",
  "project": "gridlock",
  "apiKey": "optional-bearer-token"
}
```

Endpoints under `system/webdev/{project}/gridlock/*`.

---

### Raw TCP/UDP (Socket)

For custom protocols. Requires a WebSocket-to-TCP/UDP bridge on your network.

```json
{
  "bridgeUrl": "ws://localhost:9090",
  "protocol": "tcp",
  "host": "192.168.1.100",
  "port": 5000,
  "encoding": "json"
}
```

The bridge translates between WebSocket frames and raw TCP/UDP packets.
Message format: `{ _id, action, channel, data }` → bridge reads/writes to the socket.

---

### Custom Provider

Copy the template and implement your own:

```javascript
import { BaseProvider, Providers } from './modules/providers.js';

class MyProvider extends BaseProvider {
  constructor() { super('my-backend'); }
  async init(config) { /* connect */ this.ready = true; }
  async saveMessage(room, msg) { /* ... */ }
  async getMessages(room, n) { return []; }
  async saveFile(room, entry) { /* ... */ }
  async getFiles(room) { return []; }
  async saveState(room, key, value) { /* ... */ }
  async getState(room, key) { return null; }
  async getFullState(room) { return {}; }
  async savePeer(room, peer) { /* ... */ }
  async getPeers(room) { return []; }
  async destroy() { this.ready = false; }
}

Providers.register('my-backend', MyProvider);
await Providers.connect('my-backend', { /* config */ });
```

---

## How It Works

- Provider is **optional** — GRIDLOCK works fully P2P without one
- When connected, chat messages and file metadata are **also** saved to your DB
- On join, history is loaded from the provider
- The provider never replaces P2P — it's an **additional** persistence layer
- All provider connections happen from YOUR browser to YOUR database
- GRIDLOCK never sees or touches your credentials
