# MeshPay Interview Prep

This document is a code walkthrough plus interview prep sheet for the project. The goal is to help you explain the app confidently enough that it sounds like you built it end to end, because you understand the structure, tradeoffs, and purpose of each part.

## 1. Project In One Sentence

This is a secure offline payment mesh simulation where a payment packet is encrypted on the sender side, propagated across virtual devices, picked up by an internet-enabled bridge node, and then ingested by a backend that handles idempotency, queueing, settlement, failure isolation, and observability.

## 2. High-Level Architecture

The system has two main parts:

- Frontend: React + Vite app that lets the user create a payment packet, run gossip rounds, flush bridge nodes, tamper with packets, and inspect events, transactions, and DLQ records.
- Backend: Express + Socket.IO server that simulates the mesh network, encrypts/decrypts packets, deduplicates uploads, queues processing, settles transactions, and stores state in either memory or MongoDB.

Request / event flow:

1. User fills the payment form in the frontend.
2. Frontend calls `POST /api/payments`.
3. Backend creates an encrypted packet and injects it into `phone-alice`.
4. User triggers `POST /api/mesh/gossip`.
5. Packet is copied across devices until a bridge node has it.
6. User triggers `POST /api/mesh/flush`.
7. Backend sends each bridge-held packet through ingestion.
8. Ingestion hashes ciphertext, applies idempotency, queues the first copy, drops duplicates.
9. Queue worker decrypts, validates age, settles balances, or moves bad packets to DLQ.
10. Backend emits live Socket.IO events and frontend refreshes state.

## 3. Important Interview Positioning

If someone asks whether this is a real offline payments product, the honest answer is:

- No, it is a simulation of the transport and backend pipeline.
- The Bluetooth / device-to-device layer is modeled in software, not implemented with real radios.
- The backend concerns are intentionally realistic: encryption, untrusted hops, duplicate uploads, idempotent ingestion, retries, DLQ handling, and event visibility.

That answer sounds strong because it is precise instead of exaggerated.

## 4. Repo Structure

- `package.json`: root workspace setup and shared scripts
- `backend/package.json`: backend dependencies and runtime scripts
- `frontend/package.json`: frontend dependencies and Vite scripts
- `backend/src/server.js`: backend entry point, route wiring, service composition
- `backend/src/config.js`: environment variable parsing
- `backend/src/crypto/hybridCrypto.js`: hybrid encryption and hashing
- `backend/src/services/networkService.js`: simulated mesh device behavior
- `backend/src/services/ingestionService.js`: bridge upload processing and settlement flow
- `backend/src/services/idempotencyService.js`: duplicate protection via Redis or memory
- `backend/src/queue/packetQueue.js`: BullMQ queue and memory fallback worker
- `backend/src/store/memoryStore.js`: in-memory data store
- `backend/src/store/mongoStore.js`: MongoDB-backed store with same interface
- `frontend/index.html`: Vite HTML shell
- `frontend/src/main.jsx`: all React UI logic
- `frontend/src/styles.css`: all styling
- `scripts/*.ps1`: helper scripts to start backend/frontend on Windows

## 5. Frontend State Management

### Is Redux used?

No. Redux is not used anywhere in the project.

Proof:

- No `redux`, `@reduxjs/toolkit`, `react-redux`, store file, reducers, or dispatch pattern exist.
- State is handled locally inside `App()` with React hooks in `frontend/src/main.jsx:30-278`.

### What state management is used instead?

The project uses React local component state with hooks:

- `useState` for mutable UI and fetched backend data
- `useEffect` for initial loading and websocket subscription
- `useMemo` for derived values used by rendering and button enablement

### Why this makes sense

Redux would be overkill here because:

- there is only one page
- almost all important data already lives on the backend
- the frontend mostly displays server state and triggers actions
- there is no deep prop-drilling problem because most UI is rendered from the top-level `App`

If asked why you did not use Redux, a strong answer is:

> I kept state local because the app is a single-screen control panel. The source of truth is mostly the backend, and React hooks were enough for fetched state, live events, and form controls without introducing unnecessary store complexity.

## 6. Frontend File-By-File Walkthrough

### `frontend/index.html`

Reference: `frontend/index.html:1-12`

Purpose:

- This is the HTML shell that Vite serves.
- The React app mounts into `<div id="root"></div>`.
- `src/main.jsx` is loaded as an ES module.

Important lines:

- `frontend/index.html:9`: root DOM node for React
- `frontend/index.html:10`: Vite loads the frontend entry file

### `frontend/src/main.jsx`

Reference: `frontend/src/main.jsx:1-373`

This file contains the whole React app.

#### Imports

- `React, useEffect, useMemo, useState` from React: `frontend/src/main.jsx:1`
- `createRoot` from React DOM: `frontend/src/main.jsx:2`
- `io` from `socket.io-client`: `frontend/src/main.jsx:3`
- icons from `lucide-react`: `frontend/src/main.jsx:4-16`
- stylesheet import: `frontend/src/main.jsx:17`

#### API base URL

`frontend/src/main.jsx:19`

```js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
```

Meaning:

- In local dev, backend defaults to `localhost:4000`.
- In deployment, Vercel should inject `VITE_API_URL`.

#### `api(path, options = {})`

Reference: `frontend/src/main.jsx:21-28`

Purpose:

- Central helper for all frontend HTTP calls.
- Prepends `API_URL`.
- Adds JSON headers.
- Throws an `Error` when the backend returns a non-2xx response.

Why it exists:

- avoids repeating `fetch(...)` boilerplate
- standardizes error handling

#### `App()`

Reference: `frontend/src/main.jsx:30-278`

This is the top-level component and effectively the frontend controller.

##### `useState` hooks

Reference: `frontend/src/main.jsx:31-42`

- `state`: holds `/api/state` payload from backend
- `health`: holds `/api/health` payload
- `events`: local real-time event buffer from Socket.IO
- `notice`: banner message shown in the UI
- `busyAction`: tracks which button action is currently running
- `form`: controlled form state for payment input

This is the answer if asked: "How is form state handled?"

> The payment form uses controlled inputs backed by `useState`, so every input change updates the `form` object in React state.

##### `refresh`

Reference: `frontend/src/main.jsx:44-51`

Purpose:

- Fetches both `/api/state` and `/api/health` in parallel using `Promise.all`.
- Updates the main screen state.

Why it matters:

- keeps frontend simple
- avoids duplicating refresh logic across actions

##### `useEffect`

Reference: `frontend/src/main.jsx:53-63`

Purpose:

- Runs once on mount because dependency array is empty.
- Performs initial data load.
- Opens a Socket.IO connection to the backend.
- On every `mesh:event`, it prepends the event to local `events` state and re-fetches current backend state.
- Cleans up the socket on unmount.

Important explanation:

- Live updates come from Socket.IO events.
- Detailed screen state still comes from REST endpoints, not fully from socket payloads.

That means the sockets are being used for "refresh triggers + live feed," not as the sole data transport.

##### `selectedPacket`

Reference: `frontend/src/main.jsx:65`

Purpose:

- Chooses the most recent packet from `state.packets[0]`.
- The packet list is already sorted newest-first by the backend store.

##### `selectedPath`

Reference: `frontend/src/main.jsx:66-72`

Uses `useMemo`.

Purpose:

- Filters backend events to only the currently selected packet.
- Reverses them so the packet trace is shown in chronological order.

Why `useMemo` is used:

- It avoids recalculating this derived array on every render unless `state` or `selectedPacket` changes.

##### `flow`

Reference: `frontend/src/main.jsx:74-94`

Uses `useMemo`.

Purpose:

- Encodes the UI state machine.
- Determines which buttons are enabled.
- Generates the "Step 1 / Step 2 / Step 3" helper text.

Key logic:

- `canInject`: true when no active packet exists
- `canGossip`: true when a packet exists but no bridge has it yet
- `canBridgeProcess`: true when an internet-enabled bridge device has the packet
- `isComplete`: true when packet has reached a terminal state

This is a strong interview point:

> Instead of scattering button disable rules across JSX, I centralized the progression rules in a derived `flow` object so the screen behaves like a controlled simulation state machine.

##### `runAction`

Reference: `frontend/src/main.jsx:96-108`

Purpose:

- Shared wrapper around button-triggered async actions.
- Sets busy state.
- Shows info/success/error notices.
- Refreshes the backend state after the action completes.

Why it matters:

- reduces repeated async boilerplate
- gives consistent UX

##### `submitPayment`

Reference: `frontend/src/main.jsx:110-119`

Purpose:

- Client-side guard against sender = receiver
- Sends `POST /api/payments`
- Uses `runAction`

Important nuance:

- Validation also exists on the backend, so frontend validation is only a UX improvement.

##### `gossip`

Reference: `frontend/src/main.jsx:121-125`

Purpose:

- Calls `POST /api/mesh/gossip`

##### `flush`

Reference: `frontend/src/main.jsx:127-131`

Purpose:

- Calls `POST /api/mesh/flush`
- Bridge nodes upload packets for ingestion

##### `tamper`

Reference: `frontend/src/main.jsx:133-137`

Purpose:

- Calls `POST /api/dev/tamper-first-packet`
- Used only to demonstrate DLQ / decryption failure behavior

##### `reset`

Reference: `frontend/src/main.jsx:139-146`

Purpose:

- Calls `POST /api/mesh/reset`
- Clears local live event buffer
- Restores seed balances and clears all records on the backend

##### `newRun`

Reference: `frontend/src/main.jsx:148-155`

Purpose:

- Calls `POST /api/mesh/new-run`
- Clears active packet and path history
- Keeps balances and ledger

This distinction is worth memorizing:

- `new-run` = keep balances, clear active packet flow
- `reset` = restore seed balances and clear everything

#### JSX layout

Reference: `frontend/src/main.jsx:157-277`

Major UI areas:

- top bar with runtime health: `frontend/src/main.jsx:159-169`
- command band with form and actions: `frontend/src/main.jsx:171-238`
- notice + step guide: `frontend/src/main.jsx:240-241`
- metrics: `frontend/src/main.jsx:243-248`
- main visualization panels: `frontend/src/main.jsx:250-269`
- tables for accounts / transactions / DLQ: `frontend/src/main.jsx:271-275`

#### Helper components

##### `StatusPill`

Reference: `frontend/src/main.jsx:280-282`

Simple presentational component for health badges.

##### `SectionTitle`

Reference: `frontend/src/main.jsx:284-286`

Simple heading component.

##### `Metric`

Reference: `frontend/src/main.jsx:288-295`

Renders a metric card like packets, settled, DLQ, idempotency keys.

##### `NetworkMap`

Reference: `frontend/src/main.jsx:297-309`

Purpose:

- Renders each simulated device.
- Highlights bridge devices visually.

##### `PacketPath`

Reference: `frontend/src/main.jsx:311-331`

Purpose:

- Shows event path for the currently selected packet.
- If no packet exists, shows an empty state.

Important behavior:

- Uses event data from backend, not direct device graph animation.

##### `EventStream`

Reference: `frontend/src/main.jsx:333-345`

Purpose:

- Shows live event feed.
- Prefers socket-fed `events` if present; otherwise falls back to persisted backend events.

##### `DataTable`

Reference: `frontend/src/main.jsx:347-367`

Purpose:

- Generic table renderer for accounts, transactions, and DLQ

##### `short`

Reference: `frontend/src/main.jsx:369-371`

Purpose:

- Shortens long IDs to first 8 characters for display

##### React bootstrap

Reference: `frontend/src/main.jsx:373`

- Mounts `<App />` into the root element.

### `frontend/src/styles.css`

Reference: `frontend/src/styles.css:1-466`

Purpose:

- Entire visual design lives here.
- No CSS framework is used.
- Layout uses CSS Grid and Flexbox.

Important style concepts:

- CSS custom properties in `:root`: `frontend/src/styles.css:5-17`
- responsive layout with media queries: `frontend/src/styles.css:435-466`
- semantic color coding for statuses:
  - blue for in-progress: `frontend/src/styles.css:328-331`
  - green for settled: `frontend/src/styles.css:333-335`
  - red for failures / DLQ / rejected: `frontend/src/styles.css:337-340`

What to say if asked about the styling approach:

> I kept styling handwritten in a single CSS file because the app is a compact dashboard. I used CSS variables for theme consistency, Grid for macro layout, Flexbox for row alignment, and a few responsive breakpoints for mobile behavior.

## 7. Backend File-By-File Walkthrough

### `backend/src/config.js`

Reference: `backend/src/config.js:1-15`

Purpose:

- Loads environment variables via `dotenv`
- Normalizes config into one exported object

Important fields:

- `port`
- `frontendOrigins`
- `mongoUri`
- `redisUrl`
- `idempotencyTtlSeconds`
- `packetMaxAgeSeconds`

Why it is useful:

- keeps env parsing in one place
- route and service code do not need to access `process.env` directly

### `backend/src/crypto/hybridCrypto.js`

Reference: `backend/src/crypto/hybridCrypto.js:1-69`

This file is one of the strongest interview talking points.

#### Constants

Reference: `backend/src/crypto/hybridCrypto.js:3-5`

- `AES_KEY_BYTES = 32`: AES-256 needs a 32-byte key
- `GCM_IV_BYTES = 12`: 12-byte IV is standard for GCM
- `RSA_ENCRYPTED_KEY_BYTES = 256`: RSA-2048 encrypted block size is 256 bytes

#### `HybridCrypto` constructor

Reference: `backend/src/crypto/hybridCrypto.js:8-17`

Purpose:

- Generates an RSA key pair at server startup

Important caveat:

- Keys are ephemeral. If the backend restarts, the old private key is gone.
- This is okay for a demo, but not enough for a production system.

That is a very good interview honesty point.

#### `encrypt(payload)`

Reference: `backend/src/crypto/hybridCrypto.js:19-35`

Flow:

1. Convert payload JSON into bytes
2. Generate random AES key
3. Generate random GCM IV
4. Encrypt payload with AES-256-GCM
5. Encrypt AES key using RSA public key with OAEP SHA-256
6. Concatenate encrypted AES key + IV + encrypted payload + auth tag
7. Return Base64 ciphertext

Why hybrid encryption is used:

- RSA is not efficient for encrypting large payloads
- AES is efficient for payload encryption
- RSA securely transports the AES session key

#### `decrypt(base64Ciphertext)`

Reference: `backend/src/crypto/hybridCrypto.js:37-60`

Flow:

1. Decode Base64
2. Validate minimum ciphertext size
3. Slice out encrypted AES key
4. Slice out IV
5. Slice out encrypted payload and auth tag
6. RSA-decrypt AES key
7. AES-GCM decrypt payload
8. Parse JSON

Important interview point:

- AES-GCM provides confidentiality plus integrity because tampering breaks auth tag verification.
- That is why the tamper endpoint can force a decryption failure and land in DLQ.

#### `hashCiphertext(base64Ciphertext)`

Reference: `backend/src/crypto/hybridCrypto.js:62-64`

Purpose:

- Produces SHA-256 hash of the ciphertext
- Used as the idempotency key

#### `pinHash(pin)`

Reference: `backend/src/crypto/hybridCrypto.js:66-68`

Purpose:

- Hashes the PIN into the encrypted instruction payload

Important honesty point:

- In this demo, the PIN hash is included in the payload, but there is no backend PIN verification step during settlement.
- It exists to make the packet feel closer to a secure payment instruction, not as a complete auth system.

### `backend/src/services/networkService.js`

Reference: `backend/src/services/networkService.js:1-127`

This file simulates the offline mesh.

#### Constructor

Reference: `backend/src/services/networkService.js:4-9`

Injected dependencies:

- `store`
- `cryptoService`
- `emit`

Why this is good design:

- The service is not hard-wired to a database implementation.
- It uses abstraction and dependency injection style composition.

#### `resetDevices()`

Reference: `backend/src/services/networkService.js:11-19`

Purpose:

- Creates the in-memory device graph
- Defines which phones are offline vs bridge nodes

Important limitation:

- Device state is process memory only
- It is not persisted to MongoDB

#### `createPayment(...)`

Reference: `backend/src/services/networkService.js:21-50`

Purpose:

- Validates sender and receiver are not the same
- Builds an instruction payload
- Hashes the PIN
- Adds nonce and signed timestamp
- Encrypts instruction using `HybridCrypto`
- Builds packet metadata
- Persists packet record
- Injects packet into start device

Difference between instruction and packet:

- Instruction = sensitive business payload that gets encrypted
- Packet = transport envelope plus some display metadata

That distinction is useful in interviews.

#### `inject(deviceId, packet)`

Reference: `backend/src/services/networkService.js:52-64`

Purpose:

- Adds packet to a specific device
- Writes an `INJECTED` event
- Emits live socket event

#### `gossipOnce()`

Reference: `backend/src/services/networkService.js:66-99`

Purpose:

- Simulates one gossip round
- Copies packets from each device snapshot to every other device that does not already have the packet
- Decrements TTL on copies
- Records a `HOP` event per transfer

Important implementation detail:

- It uses a snapshot of device packets at the start of the round, which avoids newly copied packets recursively spreading within the same iteration unexpectedly.

Important modeling note:

- This is a broadcast-style simulation, not a geographically realistic mesh algorithm.

#### `collectBridgeUploads()`

Reference: `backend/src/services/networkService.js:101-110`

Purpose:

- Scans only internet-enabled devices
- Returns upload candidates for ingestion

#### `deviceCounts()`

Reference: `backend/src/services/networkService.js:112-117`

Purpose:

- Returns count of packets per device

#### `snapshot()`

Reference: `backend/src/services/networkService.js:119-126`

Purpose:

- Returns frontend-safe device summary

### `backend/src/services/idempotencyService.js`

Reference: `backend/src/services/idempotencyService.js:1-46`

Purpose:

- Prevents duplicate ingestion of the same ciphertext

#### Constructor

Reference: `backend/src/services/idempotencyService.js:2-6`

State:

- Redis client if available
- TTL for key expiry
- in-memory `Map` fallback

#### `claim(packetHash)`

Reference: `backend/src/services/idempotencyService.js:8-24`

Redis mode:

- Uses `SET key value EX ttl NX`
- That means "set only if key does not already exist"
- If Redis returns `OK`, this is the first claimant

Memory mode:

- Removes expired entries first
- Rejects if hash already exists
- Otherwise stores timestamp

This is the answer if asked how duplicate suppression works.

#### `size()`

Reference: `backend/src/services/idempotencyService.js:26-30`

Purpose:

- Returns number of tracked idempotency keys
- Used for frontend metric display

#### `clear()`

Reference: `backend/src/services/idempotencyService.js:32-38`

Purpose:

- Clears memory map or Redis keys during hard reset

#### `evictExpired()`

Reference: `backend/src/services/idempotencyService.js:40-45`

Purpose:

- Manual TTL cleanup for in-memory mode

### `backend/src/queue/packetQueue.js`

Reference: `backend/src/queue/packetQueue.js:1-85`

Purpose:

- Provides queue abstraction with Redis-backed BullMQ when available
- Falls back to in-process memory queue otherwise

#### `createRedis(redisUrl)`

Reference: `backend/src/queue/packetQueue.js:4-21`

Purpose:

- Creates `ioredis` client
- Connects lazily
- If connection fails, logs warning and returns `null`

Design benefit:

- The app remains usable even without Redis

#### `PacketQueue` constructor

Reference: `backend/src/queue/packetQueue.js:23-43`

Purpose:

- Stores processor callback and failure callback
- Sets up BullMQ `Queue` and `Worker` when Redis exists
- Configures worker concurrency to 4

Important pattern:

- Queueing is abstracted behind one class so the rest of the app can call `enqueue(...)` without caring whether Redis is available.

#### `enqueue(data)`

Reference: `backend/src/queue/packetQueue.js:45-58`

Redis path:

- Adds job with:
  - `attempts: 3`
  - exponential backoff starting at 500 ms
  - completed and failed jobs trimmed to 100 each

Memory path:

- Pushes into in-memory array
- Starts local drain loop

#### `drainMemoryQueue()`

Reference: `backend/src/queue/packetQueue.js:60-79`

Purpose:

- Prevents re-entrant processing with `this.processing`
- Processes queued items sequentially
- Retries failed jobs up to 3 times
- Sends permanent failures to `onFailed`

#### `close()`

Reference: `backend/src/queue/packetQueue.js:81-84`

Purpose:

- Gracefully closes BullMQ worker and queue

### `backend/src/services/ingestionService.js`

Reference: `backend/src/services/ingestionService.js:1-91`

This file handles the bridge upload pipeline.

#### Constructor

Reference: `backend/src/services/ingestionService.js:2-9`

Dependencies:

- `cryptoService`
- `idempotency`
- `store`
- `queue`
- `config`
- `emit`

#### `ingest(packet, bridgeNodeId, hopCount)`

Reference: `backend/src/services/ingestionService.js:11-38`

Purpose:

1. Hash ciphertext
2. Attempt idempotency claim
3. If duplicate:
   - mark packet `DUPLICATE_DROPPED`
   - add event
   - emit socket event
   - return duplicate outcome
4. If first-seen:
   - mark packet `QUEUED`
   - add event
   - enqueue processing job
   - emit socket event

This separation is important:

- ingest = admission control + queue submission
- processing = actual decryption + settlement

#### `processQueuedPacket({ ... })`

Reference: `backend/src/services/ingestionService.js:40-71`

Purpose:

1. Decrypt packet
2. If decryption fails, send to DLQ
3. Check packet age against `packetMaxAgeSeconds`
4. Reject future-dated packets with more than 5 minutes skew
5. Call store settlement logic
6. Update packet status
7. Add event
8. Emit socket event

Why this is strong design:

- The "ingestion gate" and the "settlement worker" are conceptually separated
- This is closer to real backend pipeline design

#### `moveToDlq({ ... })`

Reference: `backend/src/services/ingestionService.js:73-90`

Purpose:

- Marks packet as `DLQ`
- Stores DLQ record including ciphertext preview and attempts
- Writes event
- Emits socket event

### `backend/src/store/memoryStore.js`

Reference: `backend/src/store/memoryStore.js:1-91`

Purpose:

- In-memory persistence implementation
- Used when MongoDB is absent or unreachable

#### `seedAccounts()`

Reference: `backend/src/store/memoryStore.js:1-6`

Purpose:

- Returns starting demo balances

#### `MemoryStore` constructor

Reference: `backend/src/store/memoryStore.js:8-11`

- Calls `reset()` immediately

#### `reset()`

Reference: `backend/src/store/memoryStore.js:13-19`

Purpose:

- Restores demo accounts
- Clears packets, events, transactions, and DLQ

#### `clearActiveRun()`

Reference: `backend/src/store/memoryStore.js:21-24`

Purpose:

- Clears packet/event state only
- Keeps balances and transaction ledger

#### `upsertPacket(packet)`

Reference: `backend/src/store/memoryStore.js:26-33`

Purpose:

- Insert or overwrite packet by `packetId`
- Updates `updatedAt`

#### `addEvent(event)`

Reference: `backend/src/store/memoryStore.js:35-39`

Purpose:

- Appends event record with local incremental `id`

#### `createTransaction(transaction)`

Reference: `backend/src/store/memoryStore.js:41-45`

Purpose:

- Adds newest transaction to the front of the array using `unshift`

#### `addDlqPacket(record)`

Reference: `backend/src/store/memoryStore.js:47-50`

Purpose:

- Adds newest DLQ record to the front of the array

#### `settle({ ... })`

Reference: `backend/src/store/memoryStore.js:53-78`

Purpose:

- Loads sender and receiver accounts
- Validates they exist
- Validates amount
- If sender has enough funds and is not transferring to self:
  - debit sender
  - credit receiver
  - status = `SETTLED`
- Otherwise status = `REJECTED`
- Creates transaction record

#### `getState({ devices, idempotencySize })`

Reference: `backend/src/store/memoryStore.js:80-90`

Purpose:

- Builds the frontend response payload

### `backend/src/store/mongoStore.js`

Reference: `backend/src/store/mongoStore.js:1-166`

Purpose:

- MongoDB-backed implementation of the same store contract as `MemoryStore`

Design pattern:

- `MongoStore` extends `MemoryStore` so both stores share the same method names / public interface.
- This lets the rest of the app remain storage-agnostic.

#### Mongoose schemas

References:

- account schema: `backend/src/store/mongoStore.js:4-8`
- packet schema: `backend/src/store/mongoStore.js:10-21`
- event schema: `backend/src/store/mongoStore.js:23-31`
- transaction schema: `backend/src/store/mongoStore.js:33-43`
- DLQ schema: `backend/src/store/mongoStore.js:45-53`

#### Constructor

Reference: `backend/src/store/mongoStore.js:56-63`

Purpose:

- Creates Mongoose models for each collection

#### `reset()`

Reference: `backend/src/store/mongoStore.js:65-77`

Purpose:

- Deletes all collections
- Reseeds demo accounts

Used by hard reset endpoint.

#### `ensureSeedData()`

Reference: `backend/src/store/mongoStore.js:79-84`

Purpose:

- Seeds accounts only if the database is empty

Why this matters:

- Prevents wiping data every time the backend starts

#### `clearActiveRun()`

Reference: `backend/src/store/mongoStore.js:86-91`

Purpose:

- Deletes packets and packet events only

#### `upsertPacket(packet)`

Reference: `backend/src/store/mongoStore.js:93-99`

Purpose:

- Upserts by `packetId`

#### `addEvent(event)`

Reference: `backend/src/store/mongoStore.js:101-103`

Purpose:

- Inserts packet event document

#### `createTransaction(transaction)`

Reference: `backend/src/store/mongoStore.js:105-107`

Purpose:

- Inserts transaction document

#### `addDlqPacket(record)`

Reference: `backend/src/store/mongoStore.js:109-111`

Purpose:

- Inserts DLQ document

#### `settle({ ... })`

Reference: `backend/src/store/mongoStore.js:113-139`

Purpose:

- Same business logic as memory store
- Uses Mongoose documents and `save()`

Important nuance:

- This is not wrapped in a MongoDB transaction, which is acceptable for a demo but would matter in a production ledger system.

#### `getState({ devices, idempotencySize })`

Reference: `backend/src/store/mongoStore.js:141-151`

Purpose:

- Reads sorted collections and builds frontend response

#### `createStore(mongoUri)`

Reference: `backend/src/store/mongoStore.js:154-166`

Purpose:

- Chooses memory store when no URI exists
- Tries MongoDB connection otherwise
- Falls back to memory if connection fails

This is the main runtime abstraction switch for persistence.

### `backend/src/server.js`

Reference: `backend/src/server.js:1-200`

This is the composition root of the backend.

#### Imports

References: `backend/src/server.js:1-11`

Main dependencies:

- HTTP server
- Express
- CORS
- Socket.IO
- config
- crypto service
- store factory
- queue factory
- idempotency service
- network service
- ingestion service

#### App and socket setup

References: `backend/src/server.js:13-20`

Purpose:

- Creates Express app
- Creates HTTP server
- Attaches Socket.IO
- Enables CORS
- Enables JSON body parsing with 2 MB limit

#### `emit`

Reference: `backend/src/server.js:22`

Purpose:

- Shared helper that attaches timestamp and emits events to all websocket clients

#### Service composition

References: `backend/src/server.js:24-51`

Purpose:

- create store
- create Redis connection
- instantiate crypto service
- instantiate idempotency service
- instantiate queue
- instantiate ingestion service
- instantiate network service

Interesting implementation detail:

- `let ingestion` is declared before queue creation, then assigned later.
- The queue receives callbacks that call `ingestion.processQueuedPacket(...)`.
- This works because the callback is invoked later, after `ingestion` has been assigned.

That is worth understanding because an interviewer may ask about it.

#### `GET /api/health`

Reference: `backend/src/server.js:53-61`

Purpose:

- Returns runtime mode information:
  - storage mode
  - queue mode
  - whether Redis is connected
  - crypto algorithm description

#### `GET /api/state`

Reference: `backend/src/server.js:63-69`

Purpose:

- Returns full screen state for frontend:
  - device snapshot
  - idempotency size
  - accounts
  - packets
  - transactions
  - DLQ
  - events

#### `GET /api/server-key`

Reference: `backend/src/server.js:71-77`

Purpose:

- Exposes server public key metadata

Note:

- The current frontend does not use this route.
- It exists to make the backend more production-shaped and inspectable.

#### `POST /api/payments`

Reference: `backend/src/server.js:79-90`

Purpose:

- Delegates payment creation to `network.createPayment`
- Returns packet ID, TTL, and a ciphertext preview

#### `POST /api/mesh/gossip`

Reference: `backend/src/server.js:92-98`

Purpose:

- Runs one gossip simulation round

#### `POST /api/mesh/flush`

Reference: `backend/src/server.js:100-130`

Purpose:

- Collects bridge-held packets
- If none exist:
  - stores `NO_BRIDGE_PACKETS` event
  - emits live event
  - returns informative message
- If uploads exist:
  - ingests all of them in parallel using `Promise.all`

Why this matters:

- Multiple bridge nodes may upload duplicates of the same packet.
- The ingestion service and idempotency layer handle the duplicate storm.

#### `POST /api/mesh/reset`

Reference: `backend/src/server.js:132-142`

Purpose:

- full reset:
  - reset store
  - clear idempotency
  - reset devices
  - emit `HARD_RESET`

#### `POST /api/mesh/new-run`

Reference: `backend/src/server.js:144-153`

Purpose:

- partial reset:
  - clear active packet/event state
  - reset devices
  - keep balances / ledger

#### `POST /api/bridge/ingest`

Reference: `backend/src/server.js:155-163`

Purpose:

- Production-shaped direct ingestion endpoint
- Reads bridge metadata from headers:
  - `x-bridge-node-id`
  - `x-hop-count`

#### `POST /api/dev/tamper-first-packet`

Reference: `backend/src/server.js:165-179`

Purpose:

- Dev/demo endpoint to corrupt ciphertext deliberately
- Causes decryption to fail and packet to move to DLQ

#### Error middleware

Reference: `backend/src/server.js:181-185`

Purpose:

- Logs server errors
- Maps `sender_and_receiver_must_be_different` to HTTP 400
- Returns JSON error payload

#### Socket connection event

Reference: `backend/src/server.js:187-189`

Purpose:

- Sends initial `CONNECTED` event to each new client

#### Server start

Reference: `backend/src/server.js:191-194`

Purpose:

- Starts listening on configured port
- Logs active store and queue mode

#### SIGINT cleanup

Reference: `backend/src/server.js:196-200`

Purpose:

- closes queue
- disconnects Redis
- exits process

## 8. Package And Script Files

### Root `package.json`

Reference: `package.json:1-17`

Purpose:

- Defines npm workspaces for `backend` and `frontend`
- Exposes top-level convenience scripts

Important scripts:

- `dev`: runs backend workspace dev script
- `dev:backend`
- `dev:frontend`
- `start`
- `lint`

### `backend/package.json`

Reference: `backend/package.json:1-24`

Purpose:

- Declares ESM backend
- Backend runtime script is `src/server.js`
- Uses `nodemon` for dev restart

Key dependencies:

- `express`: API server
- `socket.io`: realtime events
- `mongoose`: MongoDB ODM
- `ioredis`: Redis client
- `bullmq`: Redis-backed queue
- `cors`, `dotenv`

### `frontend/package.json`

Reference: `frontend/package.json:1-20`

Purpose:

- Declares ESM frontend
- Uses Vite for dev/build/preview

Key dependencies:

- `react`, `react-dom`
- `socket.io-client`
- `lucide-react`
- `vite`

### PowerShell scripts

#### `scripts/start-dev.ps1`

Reference: `scripts/start-dev.ps1:1-24`

Purpose:

- Starts backend and frontend as separate processes
- Prints URLs

#### `scripts/start-backend.ps1`

Reference: `scripts/start-backend.ps1:1-6`

- Moves to project root and runs backend dev command

#### `scripts/start-frontend.ps1`

Reference: `scripts/start-frontend.ps1:1-6`

- Moves to project root and runs frontend dev command

## 9. State, Data, And Source Of Truth

### Frontend state

- UI state lives in React local state
- The frontend is not the long-term source of truth
- It mostly mirrors backend state via `refresh()`

### Backend state

There are multiple categories:

- device mesh state: `NetworkService.devices` in process memory
- persistence state: store implementation, either `MemoryStore` or `MongoStore`
- idempotency cache: Redis or in-memory `Map`
- queued jobs: BullMQ or in-memory job array

### Important implication

Even with MongoDB and Redis enabled, active mesh device state is still in process memory. So a backend restart resets live packet placement across phones.

## 10. Key Technical Decisions You Should Be Ready To Explain

### Why no Redux?

Because:

- single-page app
- limited local UI state
- backend already owns most data
- no need for global store complexity

### Why use Socket.IO plus REST?

Because:

- REST is simple for full-state fetches
- sockets are good for live event notifications
- combining them keeps the backend payload model simple

### Why use hybrid encryption?

Because:

- AES is efficient for payload encryption
- RSA securely protects the session key
- GCM also detects tampering

### Why queue processing after ingestion?

Because:

- bridge uploads may arrive in bursts
- queueing separates admission from settlement
- it creates a cleaner backend pipeline with retries and DLQ behavior

### Why hash ciphertext for idempotency?

Because:

- the same encrypted packet should map to the same dedupe key
- hashing gives fixed-size lookup keys

### Why storage abstraction?

Because:

- app can run without infra in memory mode
- same business logic can operate with MongoDB or memory
- easier demo setup and easier deployment flexibility

## 11. Known Limitations You Should State Honestly

These are not weaknesses if you explain them clearly.

- Mesh networking is simulated, not real Bluetooth/NFC transport.
- RSA key pair is generated in memory at startup and not persisted.
- `pinHash` is included but not verified against a user/account auth system.
- Mongo settlement is not using database transactions.
- `idempotencyService.size()` uses Redis `KEYS`, which is acceptable for a demo but not ideal at scale.
- Device graph state is not persisted.
- There are no automated tests in this repo right now.
- The frontend is all in one React file, which is fine for a compact demo but not how you would keep scaling a larger product.

## 12. What You Can Say You Focused On As The Builder

Strong builder narrative:

> I designed the project to emphasize backend systems thinking more than just UI. The interesting part was modeling an offline payment packet moving through untrusted hops, then treating internet reconnection as an ingestion problem with dedupe, retries, DLQ handling, and observability. I kept the frontend intentionally simple so the state of the simulation and backend pipeline stayed easy to inspect.

## 13. Good Interview Questions And Strong Answers

### "How is state managed in the frontend?"

Answer:

> I used React hooks only. `useState` holds fetched backend state, health state, notices, form state, and the local live event list. `useEffect` does initial fetch plus Socket.IO subscription. `useMemo` computes derived UI state like the selected packet path and which actions are allowed at each simulation step. There is no Redux because the app is single-page and backend-driven.

### "What happens when I click Inject?"

Answer:

> The frontend calls `POST /api/payments`. On the backend, `NetworkService.createPayment()` validates sender/receiver, builds the payment instruction, hashes the PIN, adds a nonce and timestamp, encrypts it with the hybrid crypto service, creates packet metadata, stores the packet, and injects it into the starting device.

### "How do duplicates get handled?"

Answer:

> Bridge uploads are hashed by ciphertext. `IngestionService.ingest()` asks `IdempotencyService.claim(packetHash)` whether this ciphertext has already been seen. Redis mode uses `SET NX EX`, and memory mode uses a `Map` with manual TTL eviction. If the claim fails, the packet is marked `DUPLICATE_DROPPED` and never reaches settlement again.

### "What is the role of Redis here?"

Answer:

> Redis backs two concerns: BullMQ job queueing and shared idempotency keys. If Redis is unavailable, the app gracefully falls back to in-memory queueing and dedupe so the demo still works.

### "Why do you have a DLQ?"

Answer:

> I wanted failure isolation instead of letting bad packets disappear silently. If decryption fails, the packet is stale, future-dated, or a worker exhausts retries, I move it to a dead-letter queue with metadata so it remains visible for debugging and review.

### "Why do you call it production-shaped instead of production-ready?"

Answer:

> Because the architecture reflects real backend concerns, but some parts are intentionally simplified for a portfolio simulation: the mesh itself is simulated, key management is ephemeral, device state is in memory, and ledger settlement is not implemented with full database transaction semantics.

## 14. Fast Memory Tricks

Remember the backend as five layers:

1. `server.js`: wiring and routes
2. `networkService.js`: mesh simulation
3. `ingestionService.js`: upload pipeline
4. `packetQueue.js` + `idempotencyService.js`: reliability helpers
5. `memoryStore.js` / `mongoStore.js`: persistence

Remember the frontend as four concerns:

1. form input
2. action buttons
3. live events
4. state visualization tables and panels

Remember the most important React hooks used:

- `useState`
- `useEffect`
- `useMemo`

Remember what is not used:

- Redux
- Zustand
- React Router
- TypeScript
- Tailwind
- automated tests

## 15. Final "Sound Like The Builder" Summary

If you need a short polished explanation:

> I built a React + Node.js simulation for offline mesh payments where packets are encrypted client-side, propagated through simulated devices, and uploaded by bridge nodes once internet is available. On the backend I focused on production-style ingestion concerns like idempotency, queueing, retries, dead-letter handling, and packet trace visibility. The frontend is intentionally a compact control console built with React hooks and Socket.IO rather than Redux, because the main source of truth is the backend and the UI mostly orchestrates and visualizes the pipeline.
