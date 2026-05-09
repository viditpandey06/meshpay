import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config.js';
import { HybridCrypto } from './crypto/hybridCrypto.js';
import { createStore } from './store/mongoStore.js';
import { createRedis, PacketQueue } from './queue/packetQueue.js';
import { IdempotencyService } from './services/idempotencyService.js';
import { NetworkService } from './services/networkService.js';
import { IngestionService } from './services/ingestionService.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.frontendOrigins, methods: ['GET', 'POST'] }
});

app.use(cors({ origin: config.frontendOrigins }));
app.use(express.json({ limit: '2mb' }));

const emit = (event, payload) => io.emit(event, { at: Date.now(), ...payload });

const { store, mode: storeMode } = await createStore(config.mongoUri);
const redis = await createRedis(config.redisUrl);
const cryptoService = new HybridCrypto();
const idempotency = new IdempotencyService({ redis, ttlSeconds: config.idempotencyTtlSeconds });

let ingestion;
const queue = new PacketQueue({
  redis,
  processor: (job) => ingestion.processQueuedPacket(job),
  onFailed: (job, error, attempts) => ingestion.moveToDlq({
    packet: job.packet,
    packetHash: job.packetHash,
    bridgeNodeId: job.bridgeNodeId,
    reason: `worker_failed:${error.message}`,
    attempts
  })
});

ingestion = new IngestionService({
  cryptoService,
  idempotency,
  store,
  queue,
  config,
  emit
});

const network = new NetworkService({ store, cryptoService, emit });

app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    store: storeMode,
    queue: redis ? 'bullmq/redis' : 'memory',
    redis: Boolean(redis),
    publicKeyAlgorithm: 'RSA-2048 / OAEP-SHA256 + AES-256-GCM'
  });
});

app.get('/api/state', async (_req, res) => {
  const state = await store.getState({
    devices: network.snapshot(),
    idempotencySize: await idempotency.size()
  });
  res.json(state);
});

app.get('/api/server-key', (_req, res) => {
  res.json({
    publicKey: cryptoService.publicKey,
    algorithm: 'RSA-2048 / OAEP-SHA256',
    hybridScheme: 'RSA-OAEP encrypts an AES-256-GCM session key'
  });
});

app.post('/api/payments', async (req, res, next) => {
  try {
    const packet = await network.createPayment(req.body);
    res.status(201).json({
      packetId: packet.packetId,
      ttl: packet.ttl,
      ciphertextPreview: `${packet.ciphertext.slice(0, 64)}...`
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/mesh/gossip', async (_req, res, next) => {
  try {
    res.json(await network.gossipOnce());
  } catch (error) {
    next(error);
  }
});

app.post('/api/mesh/flush', async (_req, res, next) => {
  try {
    const uploads = network.collectBridgeUploads();
    if (uploads.length === 0) {
      await store.addEvent({
        packetId: '',
        type: 'NO_BRIDGE_PACKETS',
        deviceId: 'mesh',
        message: 'No bridge node is holding a packet yet. Run Gossip first.'
      });
      emit('mesh:event', {
        type: 'NO_BRIDGE_PACKETS',
        message: 'No bridge node is holding a packet yet. Run Gossip first.'
      });
      return res.json({
        uploadsAttempted: 0,
        results: [],
        message: 'No bridge node is holding a packet yet. Run Gossip first.'
      });
    }

    const results = await Promise.all(uploads.map(({ bridgeNodeId, packet }) =>
      ingestion.ingest(packet, bridgeNodeId, 5 - packet.ttl)
        .then((result) => ({ bridgeNodeId, packetId: packet.packetId, ...result }))
    ));

    res.json({ uploadsAttempted: uploads.length, results });
  } catch (error) {
    next(error);
  }
});

app.post('/api/mesh/reset', async (_req, res, next) => {
  try {
    await store.reset();
    await idempotency.clear();
    network.resetDevices();
    emit('mesh:event', { type: 'HARD_RESET' });
    res.json({ status: 'hard_reset' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/mesh/new-run', async (_req, res, next) => {
  try {
    await store.clearActiveRun();
    network.resetDevices();
    emit('mesh:event', { type: 'NEW_TRANSACTION_RUN' });
    res.json({ status: 'new_transaction_run' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/bridge/ingest', async (req, res, next) => {
  try {
    const bridgeNodeId = req.header('x-bridge-node-id') || 'unknown-bridge';
    const hopCount = Number(req.header('x-hop-count') || 0);
    res.json(await ingestion.ingest(req.body, bridgeNodeId, hopCount));
  } catch (error) {
    next(error);
  }
});

app.post('/api/dev/tamper-first-packet', async (_req, res, next) => {
  try {
    const firstUpload = network.collectBridgeUploads()[0];
    if (!firstUpload) return res.status(404).json({ error: 'no_bridge_packet_available' });

    const chars = firstUpload.packet.ciphertext.split('');
    const mid = Math.floor(chars.length / 2);
    chars[mid] = chars[mid] === 'A' ? 'B' : 'A';
    firstUpload.packet.ciphertext = chars.join('');

    res.json(await ingestion.ingest(firstUpload.packet, firstUpload.bridgeNodeId, 5 - firstUpload.packet.ttl));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.message === 'sender_and_receiver_must_be_different' ? 400 : 500;
  res.status(status).json({ error: error.message || 'internal_error' });
});

io.on('connection', (socket) => {
  socket.emit('mesh:event', { at: Date.now(), type: 'CONNECTED' });
});

server.listen(config.port, () => {
  console.log(`[api] http://localhost:${config.port}`);
  console.log(`[api] store=${storeMode} queue=${redis ? 'bullmq/redis' : 'memory'}`);
});

process.on('SIGINT', async () => {
  await queue.close();
  redis?.disconnect();
  process.exit(0);
});
