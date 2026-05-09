# MeshPay

A full-stack simulation of secure, offline payment routing and idempotency.

MeshPay models a real-world offline payment handoff: one device creates an encrypted payment packet, nearby devices carry it through a simulated mesh, and the first bridge node with internet connectivity uploads it to the backend for duplicate-safe processing.

This is not a real Bluetooth/NFC payment product. The offline transport layer is simulated so the project can focus on the backend systems problems that matter: encrypted untrusted payloads, duplicate bridge uploads, queue-based ingestion, retry behavior, dead-letter isolation, and live packet-path observability.

## Live Deployment

- Frontend: `https://meshpay-frontend.vercel.app`
- Backend health: `https://meshpay-sqlr.onrender.com/api/health`
- Portfolio: `https://viditpandey.in`

## Key Architectural Features

- Hybrid encrypted packet payloads: payment instructions are encrypted with RSA-OAEP-SHA256 plus AES-256-GCM in `backend/src/crypto/hybridCrypto.js`.
- Duplicate-safe bridge ingestion: repeated uploads of the same encrypted packet are detected with a SHA-256 packet hash and an idempotency gate.
- Queue-backed processing pipeline: bridge uploads are accepted first, then processed asynchronously through a worker layer.
- Dead-letter queue path: malformed, stale, future-dated, or poison packets are isolated into DLQ records instead of disappearing silently.
- Live observability: Socket.IO streams mesh events to the React dashboard while REST endpoints provide full state snapshots.
- Infrastructure-optional design: MongoDB and Redis are supported, but the app can run in memory mode for a simple portfolio deployment.
- Deployment-ready split: Vercel serves the frontend, Render hosts the backend, and custom domains can be attached independently.

## Project Structure

```text
meshpay
|-- backend/
|   |-- src/
|   |   |-- crypto/
|   |   |   `-- hybridCrypto.js
|   |   |-- queue/
|   |   |   `-- packetQueue.js
|   |   |-- services/
|   |   |   |-- idempotencyService.js
|   |   |   |-- ingestionService.js
|   |   |   `-- networkService.js
|   |   |-- store/
|   |   |   |-- memoryStore.js
|   |   |   `-- mongoStore.js
|   |   |-- config.js
|   |   `-- server.js
|   `-- package.json
|-- frontend/
|   |-- src/
|   |   |-- main.jsx
|   |   `-- styles.css
|   |-- index.html
|   |-- package.json
|   `-- vercel.json
|-- scripts/
|-- render.yaml
|-- package.json
`-- README.md
```

## Tech Stack

- Frontend: React, Vite, Socket.IO client, plain CSS
- Backend: Node.js, Express, Socket.IO
- Crypto: Node.js `crypto`, RSA-OAEP-SHA256, AES-256-GCM
- Queue: BullMQ with Redis when `REDIS_URL` is configured
- Idempotency: Redis `SET NX EX` or in-memory TTL map
- Persistence: MongoDB with Mongoose when `MONGODB_URI` is configured, otherwise in-memory state
- Deployment: Vercel frontend, Render backend

## How The Packet Journey Works

1. The user creates a payment from the React dashboard.
2. `NetworkService.createPayment()` builds a payment instruction, hashes the PIN, adds a nonce and timestamp, and encrypts the payload.
3. The packet is injected into `phone-alice`.
4. A gossip round copies packets across simulated offline devices while reducing TTL.
5. Bridge nodes with internet access collect packets for upload.
6. `IngestionService.ingest()` hashes ciphertext and claims idempotency.
7. The first packet copy enters the queue; duplicate bridge uploads are dropped.
8. The worker decrypts the packet and validates freshness.
9. The store settles or rejects the transaction.
10. Events, transactions, packet status, and DLQ records are shown in the dashboard.

## Running Locally

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
npm run dev:backend
```

Start the frontend in another terminal:

```bash
npm run dev:frontend
```

Open:

```text
http://127.0.0.1:5173
```

The backend defaults to:

```text
http://localhost:4000
```

## API Surface

- `GET /api/health`: runtime mode and crypto summary
- `GET /api/state`: devices, accounts, packets, events, transactions, DLQ
- `GET /api/server-key`: server public key metadata
- `POST /api/payments`: create and inject encrypted packet
- `POST /api/mesh/gossip`: run one mesh propagation round
- `POST /api/mesh/flush`: upload bridge-held packets
- `POST /api/mesh/new-run`: clear active packet flow while keeping balances and ledger
- `POST /api/mesh/reset`: restore seed accounts and clear demo state
- `POST /api/dev/tamper-first-packet`: force decryption failure for DLQ demonstration
- `POST /api/bridge/ingest`: production-shaped bridge upload endpoint

## Author

Vidit Pandey

- Portfolio: `https://viditpandey.in`
- GitHub: `@viditpandey06`

## License

Copyright (c) 2026 Vidit Pandey. All Rights Reserved.

This repository is published for portfolio review and demonstration purposes only. You may view and read the source code through GitHub, but you are not granted permission to download, copy, modify, distribute, host, or use this software without explicit written permission from the author.
