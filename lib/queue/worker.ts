import { createCronWorker, scheduleEmpujeMatutino, scheduleCadenciasHorarias, scheduleReporteDiario, JOBS } from './bullmq';
import { ejecutarEmpujeMatutino } from './jobs/empuje-matutino';
import { ejecutarCadenciasHorarias } from './jobs/cadencias';
import { enviarReporteDiario } from '@/lib/reportes/reporte-diario';

async function main() {
  console.log('[Worker] Iniciando worker de cobranzas...');

  await scheduleEmpujeMatutino();
  await scheduleCadenciasHorarias();
  await scheduleReporteDiario();

  const worker = createCronWorker(async (job) => {
    console.log(`[Worker] Procesando job: ${job.name}`);

    if (job.name === JOBS.EMPUJE_MATUTINO) {
      await ejecutarEmpujeMatutino();
    }

    if (job.name === JOBS.CADENCIAS_HORARIAS) {
      await ejecutarCadenciasHorarias();
    }

    if (job.name === JOBS.REPORTE_DIARIO) {
      const r = await enviarReporteDiario();
      if (!r.ok) console.error('[Worker] Reporte diario falló:', r.error);
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
