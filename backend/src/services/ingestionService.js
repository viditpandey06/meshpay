export class IngestionService {
  constructor({ cryptoService, idempotency, store, queue, config, emit }) {
    this.crypto = cryptoService;
    this.idempotency = idempotency;
    this.store = store;
    this.queue = queue;
    this.config = config;
    this.emit = emit;
  }

  async ingest(packet, bridgeNodeId, hopCount) {
    const packetHash = this.crypto.hashCiphertext(packet.ciphertext);
    const firstClaim = await this.idempotency.claim(packetHash);

    if (!firstClaim) {
      await this.store.upsertPacket({ ...packet, packetHash, status: 'DUPLICATE_DROPPED' });
      await this.store.addEvent({
        packetId: packet.packetId,
        type: 'DUPLICATE_DROPPED',
        deviceId: bridgeNodeId,
        message: `Duplicate packet dropped at ${bridgeNodeId}`
      });
      this.emit('mesh:event', { type: 'DUPLICATE_DROPPED', packetId: packet.packetId, bridgeNodeId });
      return { outcome: 'DUPLICATE_DROPPED', packetHash };
    }

    await this.store.upsertPacket({ ...packet, packetHash, status: 'QUEUED' });
    await this.store.addEvent({
      packetId: packet.packetId,
      type: 'QUEUED',
      deviceId: bridgeNodeId,
      message: `Packet queued by ${bridgeNodeId}`
    });

    await this.queue.enqueue({ packet, packetHash, bridgeNodeId, hopCount });
    this.emit('mesh:event', { type: 'QUEUED', packetId: packet.packetId, bridgeNodeId });
    return { outcome: 'QUEUED', packetHash };
  }

  async processQueuedPacket({ packet, packetHash, bridgeNodeId, hopCount }) {
    let instruction;
    try {
      instruction = this.crypto.decrypt(packet.ciphertext);
    } catch (error) {
      await this.moveToDlq({ packet, packetHash, bridgeNodeId, reason: 'decryption_failed', attempts: 1 });
      return;
    }

    const ageSeconds = Math.floor((Date.now() - instruction.signedAt) / 1000);
    if (ageSeconds > this.config.packetMaxAgeSeconds) {
      await this.moveToDlq({ packet, packetHash, bridgeNodeId, reason: 'stale_packet', attempts: 1 });
      return;
    }

    if (ageSeconds < -300) {
      await this.moveToDlq({ packet, packetHash, bridgeNodeId, reason: 'future_dated_packet', attempts: 1 });
      return;
    }

    const tx = await this.store.settle({ instruction, packetHash, bridgeNodeId, hopCount });
    await this.store.upsertPacket({ ...packet, packetHash, status: tx.status });
    await this.store.addEvent({
      packetId: packet.packetId,
      type: tx.status,
      deviceId: bridgeNodeId,
      message: tx.status === 'REJECTED'
        ? `Rejected through ${bridgeNodeId}: insufficient balance, self-transfer, or validation failure`
        : `Settled through ${bridgeNodeId}`
    });
    this.emit('mesh:event', { type: tx.status, packetId: packet.packetId, bridgeNodeId, transactionId: tx.id });
  }

  async moveToDlq({ packet, packetHash, bridgeNodeId, reason, attempts }) {
    await this.store.upsertPacket({ ...packet, packetHash, status: 'DLQ' });
    await this.store.addDlqPacket({
      packetId: packet.packetId,
      packetHash,
      bridgeNodeId,
      reason,
      attempts,
      ciphertextPreview: `${packet.ciphertext.slice(0, 64)}...`
    });
    await this.store.addEvent({
      packetId: packet.packetId,
      type: 'DLQ',
      deviceId: bridgeNodeId,
      message: `Moved to DLQ: ${reason}`
    });
    this.emit('mesh:event', { type: 'DLQ', packetId: packet.packetId, bridgeNodeId, reason });
  }
}
