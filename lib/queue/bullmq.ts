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
  INTELIGENCIA_CLIENTES: 'inteligencia-clientes',
  PEDIR_EXTRACTO: 'pedir-extracto',
  PEDIR_EXTRACTO_RECORDATORIO: 'pedir-extracto-recordatorio',
  CONCILIACION_SEGUIMIENTO: 'conciliacion-seguimiento',
  DEPOSITOS_SIN_DUENO: 'depositos-sin-dueno',
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

/**
 * Registra (o re-registra) un job repetible. Reemplaza cualquier programación
 * previa con ese nombre antes de añadir la nueva — así un redeploy con un
 * pattern distinto no deja el viejo corriendo en paralelo.
 *
 * `data` viaja al processor de worker.ts vía `job.data` (ej. {modo:'peticion'}
 * para diferenciar dos jobs que llaman a la misma función con distinto
 * argumento). `pattern`/`tz` son cron estándar de BullMQ (node-cron syntax);
 * este proyecto programa todo en UTC y hace la conversión a AST a mano en el
 * comentario de cada llamada (AST = UTC-4 fijo, sin horario de verano).
 */
export async function scheduleRepeatable(
  name: string,
  pattern: string,
  data: Record<string, unknown> = {},
  tz: string = 'UTC'
): Promise<void> {
  const queue = getCronQueue();

  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === name) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  await queue.add(name, data, { repeat: { pattern, tz } });
  console.log(`[BullMQ] ${name} programado: ${pattern} (${tz})`);
}

export function createCronWorker(
  processor: (job: Job) => Promise<void>
): Worker {
  return new Worker(QUEUES.CRON, processor, {
    connection: createRedisConnection(),
    concurrency: 1,
  });
}
