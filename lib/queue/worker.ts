import { createCronWorker, scheduleEmpujeMatutino, JOBS } from './bullmq';
import { ejecutarEmpujeMatutino } from './jobs/empuje-matutino';

async function main() {
  console.log('[Worker] Iniciando worker de cobranzas...');

  await scheduleEmpujeMatutino();

  const worker = createCronWorker(async (job) => {
    console.log(`[Worker] Procesando job: ${job.name}`);

    if (job.name === JOBS.EMPUJE_MATUTINO) {
      await ejecutarEmpujeMatutino();
    }
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Job completado: ${job.name} (${job.id})`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job fallido: ${job?.name}`, err.message);
  });

  console.log('[Worker] Listo. Esperando jobs...');

  process.on('SIGTERM', async () => {
    console.log('[Worker] Cerrando...');
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Worker] Error fatal:', err);
  process.exit(1);
});
