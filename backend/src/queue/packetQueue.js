import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export async function createRedis(redisUrl) {
  if (!redisUrl) return null;

  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true
  });

  try {
    await redis.connect();
    return redis;
  } catch (error) {
    console.warn(`[redis] Redis unavailable, using memory queue/idempotency: ${error.message}`);
    redis.disconnect();
    return null;
  }
}

export class PacketQueue {
  constructor({ redis, processor, onFailed }) {
    this.redis = redis;
    this.processor = processor;
    this.onFailed = onFailed;
    this.memoryJobs = [];
    this.processing = false;

    if (redis) {
      this.queue = new Queue('packet-processing', { connection: redis });
      this.worker = new Worker('packet-processing', async (job) => processor(job.data), {
        connection: redis,
        concurrency: 4
      });
      this.worker.on('failed', async (job, error) => {
        if (job.attemptsMade >= (job.opts.attempts || 1)) {
          await onFailed(job.data, error, job.attemptsMade);
        }
      });
    }
  }

  async enqueue(data) {
    if (this.queue) {
      await this.queue.add('ingest-packet', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: 100,
        removeOnFail: 100
      });
      return;
    }

    this.memoryJobs.push({ data, attemptsMade: 0 });
    this.drainMemoryQueue();
  }

  async drainMemoryQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.memoryJobs.length > 0) {
      const job = this.memoryJobs.shift();
      try {
        job.attemptsMade += 1;
        await this.processor(job.data);
      } catch (error) {
        if (job.attemptsMade < 3) {
          this.memoryJobs.push(job);
        } else {
          await this.onFailed(job.data, error, job.attemptsMade);
        }
      }
    }

    this.processing = false;
  }

  async close() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
