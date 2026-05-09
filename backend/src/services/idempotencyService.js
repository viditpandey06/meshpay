export class IdempotencyService {
  constructor({ redis, ttlSeconds }) {
    this.redis = redis;
    this.ttlSeconds = ttlSeconds;
    this.memory = new Map();
  }

  async claim(packetHash) {
    if (this.redis) {
      const result = await this.redis.set(
        `idempotency:${packetHash}`,
        Date.now().toString(),
        'EX',
        this.ttlSeconds,
        'NX'
      );
      return result === 'OK';
    }

    this.evictExpired();
    if (this.memory.has(packetHash)) return false;
    this.memory.set(packetHash, Date.now());
    return true;
  }

  async size() {
    if (!this.redis) return this.memory.size;
    const keys = await this.redis.keys('idempotency:*');
    return keys.length;
  }

  async clear() {
    this.memory.clear();
    if (!this.redis) return;

    const keys = await this.redis.keys('idempotency:*');
    if (keys.length > 0) await this.redis.del(keys);
  }

  evictExpired() {
    const cutoff = Date.now() - this.ttlSeconds * 1000;
    for (const [hash, seenAt] of this.memory.entries()) {
      if (seenAt < cutoff) this.memory.delete(hash);
    }
  }
}
