# MeshPay

A full-stack simulation of secure, offline payment routing and idempotency.

MeshPay is built with Node.js, React, Redis/BullMQ, and MongoDB.

The project models a real-world offline transfer idea: one phone creates an encrypted payment packet, nearby phones carry it through a mesh, and the first bridge node with internet uploads it to the backend. This is a simulation, not a real Bluetooth implementation. The hard backend concerns are real: encrypted payloads, idempotent ingestion, duplicate storms, queue processing, DLQ isolation, and packet path observability.

## Stack

- Frontend: React, Vite, Socket.io client
- Backend: Node.js, Express, Socket.io
- Crypto: RSA-OAEP-SHA256 plus AES-256-GCM
- Queue: BullMQ with Redis when `REDIS_URL` is configured
- Idempotency: Redis `SET NX EX` when Redis is configured, memory fallback otherwise
- Persistence: MongoDB when `MONGODB_URI` is configured, memory fallback otherwise

## Features

- Create encrypted offline payment packets
- Simulate gossip-based mesh propagation across virtual devices
- Use bridge nodes to upload packets into the backend
- Drop duplicate bridge uploads through an idempotency gate
- Process first-seen packets through a queue worker
- Move invalid or poison packets into a dead-letter queue
- Persist packet metadata, route events, transactions, and DLQ records
- Visualize device state, packet path, live events, transactions, and DLQ

## Run Locally

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

The backend defaults to `http://localhost:4000`.

## Optional Infrastructure

Create `backend/.env` from `backend/.env.example`.

Without Redis or MongoDB, the app still runs with memory fallback so the demo can be opened quickly. For a deployed portfolio version, MongoDB Atlas is recommended and Redis Cloud is optional.

With Redis:

```env
REDIS_URL=redis://127.0.0.1:6379
```

With MongoDB:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/offline-mesh
```

For cloud deployment, set `MONGODB_URI` to your MongoDB Atlas connection string and `REDIS_URL` to your cloud Redis connection string.

Use `mongodb+srv://...` for Atlas. Use `rediss://...` when your Redis provider requires TLS.

## Do You Need MongoDB And Redis?

- MongoDB Atlas: recommended for deployment. Render web services have an ephemeral filesystem, so memory-only data disappears on restart or redeploy. MongoDB gives your accounts, transactions, packet records, DLQ records, and event history persistence.
- Redis Cloud: optional for a single-instance portfolio demo. It improves the architecture story because BullMQ and the idempotency gate become shared infrastructure instead of in-process memory, but the app still works without it.
- If you want the simplest deploy: use MongoDB Atlas and skip Redis initially.
- If you want the strongest system-design story on your resume: use both MongoDB Atlas and Redis Cloud.

Important limitation: the simulated mesh device state still lives in backend process memory. MongoDB persists ledger and observability data, and Redis persists queue/idempotency behavior, but an active in-flight mesh run still resets if the backend process restarts.

## Deployment Plan

Recommended low-friction setup:

- Frontend: Vercel
- Backend: Render web service
- Database: MongoDB Atlas
- Queue and idempotency: start without Redis, then add Redis Cloud if you want the full queue/idempotency architecture in production
- Domain: GoDaddy DNS pointing to Vercel for the frontend domain

### Vercel Setup For MeshPay Frontend

1. Import the repository into Vercel as a new project.
2. Set the project root directory to `frontend`.
3. Confirm the framework preset is Vite.
4. Set `VITE_API_URL=https://your-render-service.onrender.com`.
5. Deploy.

### Render Setup For MeshPay Backend

1. Create a new Render web service from the same repository, or use the included `render.yaml`.
2. Set the service root directory to `backend` if you are configuring it manually.
3. Use `npm install` as the build command and `npm start` as the start command if Render does not auto-detect them.
4. Add:

```env
PORT=4000
FRONTEND_ORIGINS=https://your-vercel-project.vercel.app,https://yourdomain.com
MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://...
IDEMPOTENCY_TTL_SECONDS=86400
PACKET_MAX_AGE_SECONDS=86400
```

5. Deploy and verify `GET /api/health`.

### Custom Domain Flow

Recommended shape:

- `yourdomain.com` or `www.yourdomain.com` -> Vercel frontend
- `api.yourdomain.com` -> Render backend

That keeps the product URL clean and gives the API its own hostname.

Backend environment variables:

```env
PORT=4000
FRONTEND_ORIGINS=https://your-vercel-app.vercel.app,https://yourdomain.com
MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://...
IDEMPOTENCY_TTL_SECONDS=86400
PACKET_MAX_AGE_SECONDS=86400
```

Frontend environment variables:

```env
VITE_API_URL=https://your-backend-service.onrender.com
```

GoDaddy domain flow:

1. Add `yourdomain.com` or `www.yourdomain.com` to the Vercel project.
2. Copy the DNS records Vercel gives you and add them in GoDaddy.
3. Add `api.yourdomain.com` to the Render backend service.
4. Copy the DNS record Render gives you and add it in GoDaddy.
5. Add both frontend domains to `FRONTEND_ORIGINS`.
6. Set `VITE_API_URL=https://api.yourdomain.com` in Vercel.
7. Redeploy both services.

Do not commit real MongoDB or Redis credentials. Keep them only in hosting provider environment variables.

## Interview Story

This project is best presented as a secure offline mesh payment simulation platform. The Bluetooth layer is intentionally simulated in software; the project focuses on the backend system design around eventual delivery, exactly-once processing, encrypted untrusted hops, queue-based ingestion, DLQ handling, and observability.

## API Surface

- `GET /api/health`: runtime mode and crypto summary
- `GET /api/state`: devices, accounts, packets, events, transactions, DLQ
- `POST /api/payments`: create and inject encrypted packet
- `POST /api/mesh/gossip`: run one mesh propagation round
- `POST /api/mesh/flush`: upload packets from bridge nodes
- `POST /api/mesh/new-run`: clear the active packet/mesh and keep balances plus ledger
- `POST /api/mesh/reset`: hard reset accounts, packets, idempotency, devices, ledger, and DLQ
- `POST /api/dev/tamper-first-packet`: force a decryption failure for DLQ demo
- `POST /api/bridge/ingest`: production-shaped bridge upload endpoint
