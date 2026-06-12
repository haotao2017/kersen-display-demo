import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export type RefreshJobPayload = {
  taskId: string;
  apId: string;
};

type HandlerResult = { holdSlot?: boolean } | void;
type Handler = (payload: RefreshJobPayload) => Promise<HandlerResult>;

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

    const concurrency = Math.max(1, Math.min(24, Number(process.env.ESL_REFRESH_WORKER_CONCURRENCY ?? 12)));
    this.worker = new Worker<RefreshJobPayload>(
      'esl-refresh',
      async (job) => {
        const acquired = await this.waitForApSlot(job.data.apId, job.data.taskId);
        if (!acquired) {
          // 等不到该基站的槽位：把任务放回队尾延迟重试，立即释放工作线程，
          // 避免单个基站（尤其是离线/卡顿的）占满全部并发、阻塞其他基站的任务。
          const requeueDelayMs = Math.max(500, Math.min(60_000, Number(process.env.ESL_AP_REFRESH_SLOT_REQUEUE_DELAY_MS ?? 3_000)));
          await this.queue?.add(
            `refresh:${job.data.taskId}`,
            job.data,
            { delay: requeueDelayMs, jobId: `${job.data.taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` },
          );
          return;
        }
        let result: HandlerResult;
        let shouldHold = true;
        try {
          result = await handler(job.data);
          shouldHold = result?.holdSlot !== false;
        } finally {
          this.releaseApSlot(job.data.apId, job.data.taskId, shouldHold);
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
        { jobId: `${payload.taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` },
      );
      return;
    }
    this.addLocal(payload);
  }

  async hasTask(taskId: string) {
    if (!taskId) return false;
    if (this.queue) {
      const jobs = await this.queue.getJobs(['active', 'waiting', 'delayed', 'prioritized'], 0, 5000);
      return jobs.some((job) => job.data.taskId === taskId);
    }
    if (this.localTaskIds.has(taskId)) return true;
    for (const state of this.localQueues.values()) {
      if (state.pending.some((item) => item.taskId === taskId)) return true;
    }
    return false;
  }

  async isApBusy(apId: string) {
    if (!apId) return false;
    if (this.connection) {
      const active = await this.connection.scard(`esl:ap:${apId}:active-refresh`);
      if (active > 0) return true;
    }
    if (this.queue) {
      const jobs = await this.queue.getJobs(['active', 'waiting', 'delayed', 'prioritized'], 0, 200);
      return jobs.some((job) => job.data.apId === apId);
    }
    const state = this.localQueues.get(apId);
    return Boolean(state && (state.active > 0 || state.pending.length > 0));
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
      void this.handler(payload).then(async (result) => {
        if (result?.holdSlot !== false) {
          await this.holdApSlot();
        }
      }, () => this.holdApSlot()).finally(() => {
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

  // 返回 true 表示拿到槽位；超时拿不到返回 false（调用方应把任务放回队尾），
  // 不再无限死等——死等会让一个基站的任务占住所有工作线程。
  private async waitForApSlot(apId: string, taskId: string): Promise<boolean> {
    if (!this.connection || !apId) return true;
    const limit = Math.max(1, Math.min(6, Number(process.env.ESL_AP_REFRESH_CONCURRENCY ?? 6)));
    const key = `esl:ap:${apId}:active-refresh`;
    const ttlMs = Math.max(10_000, Math.min(300_000, Number(process.env.ESL_AP_REFRESH_SLOT_TTL_MS ?? 120_000)));
    const waitTimeoutMs = Math.max(2_000, Math.min(120_000, Number(process.env.ESL_AP_REFRESH_SLOT_WAIT_TIMEOUT_MS ?? 15_000)));
    const deadline = Date.now() + waitTimeoutMs;

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
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private releaseApSlot(apId: string, taskId: string, hold = true) {
    if (!this.connection || !apId || !taskId) return;
    void (hold ? this.holdApSlot() : Promise.resolve())
      .then(() => this.connection?.srem(`esl:ap:${apId}:active-refresh`, taskId))
      .catch(() => undefined);
  }

  private async holdApSlot() {
    const holdMs = Math.max(0, Math.min(120_000, Number(process.env.ESL_AP_REFRESH_SLOT_HOLD_MS ?? 5_000)));
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
