import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export type RefreshJobPayload = {
  taskId: string;
  apId: string;
};

type Handler = (payload: RefreshJobPayload) => Promise<void>;

@Injectable()
export class RefreshQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(RefreshQueueService.name);
  private readonly connection?: IORedis;
  private readonly queue?: Queue<RefreshJobPayload>;
  private worker?: Worker<RefreshJobPayload>;
  private handler?: Handler;
  private readonly localQueues = new Map<string, { active: number; pending: RefreshJobPayload[] }>();
  private readonly localTaskIds = new Set<string>();

  constructor() {
    const redisUrl = process.env.REDIS_URL || process.env.QUEUE_REDIS_URL;
    if (!redisUrl) {
      this.logger.log('Redis queue disabled; using in-process AP refresh queue.');
      return;
    }

    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.queue = new Queue<RefreshJobPayload>('esl-refresh', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: Math.max(1, Number(process.env.ESL_REFRESH_JOB_ATTEMPTS ?? 1)),
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }

  get mode() {
    return this.queue ? 'redis' : 'local';
  }

  async health() {
    if (!this.connection) {
      return { ok: true, mode: 'local' };
    }

    try {
      await this.connection.ping();
      return { ok: true, mode: 'redis' };
    } catch (error) {
      return {
        ok: false,
        mode: 'redis',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  registerHandler(handler: Handler) {
    this.handler = handler;
    if (!this.queue || !this.connection || this.worker) return;

    const concurrency = Math.max(1, Math.min(20, Number(process.env.ESL_REFRESH_WORKER_CONCURRENCY ?? 12)));
    this.worker = new Worker<RefreshJobPayload>(
      'esl-refresh',
      async (job) => {
        await this.waitForApSlot(job.data.apId, job.data.taskId);
        try {
          await handler(job.data);
        } finally {
          this.releaseApSlot(job.data.apId, job.data.taskId);
        }
      },
      { connection: this.connection, concurrency },
    );
    this.worker.on('failed', (job, error) => {
      this.releaseApSlot(job?.data.apId ?? '', job?.data.taskId ?? '');
      this.logger.warn(`Refresh job failed: ${job?.id ?? '-'} ${error.message}`);
    });
  }

  async add(payload: RefreshJobPayload) {
    if (this.queue) {
      await this.queue.add(
        `refresh:${payload.taskId}`,
        payload,
        { jobId: payload.taskId },
      );
      return;
    }
    this.addLocal(payload);
  }

  private addLocal(payload: RefreshJobPayload) {
    const state = this.localQueues.get(payload.apId) ?? { active: 0, pending: [] };
    if (!this.localTaskIds.has(payload.taskId)) {
      state.pending.push(payload);
      this.localTaskIds.add(payload.taskId);
    }
    this.localQueues.set(payload.apId, state);
    this.drainLocal(payload.apId);
  }

  private drainLocal(apId: string) {
    const state = this.localQueues.get(apId);
    if (!state || !this.handler) return;

    const concurrency = Math.max(1, Math.min(6, Number(process.env.ESL_AP_REFRESH_CONCURRENCY ?? 6)));
    while (state.active < concurrency && state.pending.length > 0) {
      const payload = state.pending.shift();
      if (!payload) continue;
      state.active += 1;
      this.localTaskIds.delete(payload.taskId);
      void this.handler(payload).finally(async () => {
        await this.holdApSlot();
        const latest = this.localQueues.get(apId);
        if (latest) {
          latest.active = Math.max(0, latest.active - 1);
          this.localQueues.set(apId, latest);
        }
        this.drainLocal(apId);
      });
    }
    this.localQueues.set(apId, state);
  }

  private async waitForApSlot(apId: string, taskId: string) {
    if (!this.connection || !apId) return;
    const limit = Math.max(1, Math.min(6, Number(process.env.ESL_AP_REFRESH_CONCURRENCY ?? 6)));
    const key = `esl:ap:${apId}:active-refresh`;
    const ttlMs = Math.max(10_000, Math.min(300_000, Number(process.env.ESL_AP_REFRESH_SLOT_TTL_MS ?? 120_000)));

    while (true) {
      const acquired = await this.connection.eval(
        `
local active = redis.call("SCARD", KEYS[1])
if active < tonumber(ARGV[2]) then
  redis.call("SADD", KEYS[1], ARGV[1])
  redis.call("PEXPIRE", KEYS[1], ARGV[3])
  return 1
end
return 0
        `,
        1,
        key,
        taskId,
        String(limit),
        String(ttlMs),
      );
      if (acquired === 1) {
        await this.connection.pexpire(key, ttlMs);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private releaseApSlot(apId: string, taskId: string) {
    if (!this.connection || !apId || !taskId) return;
    void this.holdApSlot()
      .then(() => this.connection?.srem(`esl:ap:${apId}:active-refresh`, taskId))
      .catch(() => undefined);
  }

  private async holdApSlot() {
    const holdMs = Math.max(0, Math.min(120_000, Number(process.env.ESL_AP_REFRESH_SLOT_HOLD_MS ?? 30_000)));
    if (holdMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
