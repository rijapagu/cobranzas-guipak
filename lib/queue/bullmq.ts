import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'cobranzas-redis';
const redisPort = parseInt(process.env.REDIS_PORT || '6379');

export function createRedisConnection() {
  return new IORedis(redisPort, redisHost, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export const QUEUES = {
  CRON: 'cobranzas-cron',
} as const;

export const JOBS = {
  EMPUJE_MATUTINO: 'empuje-matutino',
  CADENCIAS_HORARIAS: 'cadencias-horarias',
  REPORTE_DIARIO: 'reporte-diario',
} as const;

let cronQueue: Queue | null = null;

export function getCronQueue(): Queue {
  if (!cronQueue) {
    cronQueue = new Queue(QUEUES.CRON, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      },
    });
  }
  return cronQueue;
}

export async function scheduleEmpujeMatutino() {
  const queue = getCronQueue();

  // Remove existing repeatable job before re-adding
  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === JOBS.EMPUJE_MATUTINO) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // 8:00 AM AST = 12:00 UTC (UTC-4)
  await queue.add(
    JOBS.EMPUJE_MATUTINO,
    {},
    {
      repeat: { pattern: '0 12 * * *', tz: 'UTC' },
    }
  );

  console.log('[BullMQ] Empuje matutino programado: 8:00 AM AST (12:00 UTC)');
}

export async function scheduleCadenciasHorarias() {
  const queue = getCronQueue();

  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === JOBS.CADENCIAS_HORARIAS) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Cada hora en punto
  await queue.add(
    JOBS.CADENCIAS_HORARIAS,
    {},
    { repeat: { pattern: '0 * * * *', tz: 'UTC' } }
  );

  console.log('[BullMQ] Cadencias horarias programadas: 0 * * * *');
}

export async function scheduleReporteDiario() {
  const queue = getCronQueue();

  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === JOBS.REPORTE_DIARIO) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // 8:30 AM AST = 12:30 UTC — 30 min después del empuje matutino
  await queue.add(
    JOBS.REPORTE_DIARIO,
    {},
    { repeat: { pattern: '30 12 * * 1-5', tz: 'UTC' } }
  );

  console.log('[BullMQ] Reporte diario programado: 8:30 AM AST L-V (12:30 UTC)');
}

export function createCronWorker(
  processor: (job: Job) => Promise<void>
): Worker {
  return new Worker(QUEUES.CRON, processor, {
    connection: createRedisConnection(),
    concurrency: 1,
  });
}
