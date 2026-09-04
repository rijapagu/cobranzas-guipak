import { createCronWorker, scheduleRepeatable, JOBS } from './bullmq';
import { ejecutarEmpujeMatutino } from './jobs/empuje-matutino';
import { ejecutarCadenciasHorarias } from './jobs/cadencias';
import { enviarReporteDiario } from '@/lib/reportes/reporte-diario';
import { ejecutarInteligenciaClientes } from './jobs/inteligencia-clientes';
import {
  pedirExtractoSiFalta,
  verificarDesconocidos,
  recordatorioChequesDevueltos,
  recordarDepositosSinDueno,
} from '@/lib/conciliacion/seguimiento';

/**
 * `err.message` solo puede venir VACIO (ej. ECONNREFUSED de mysql2) -- ver
 * el comentario de worker.on('failed') mas abajo. Un solo lugar para esa
 * extraccion en vez de repetirla en cada handler de error.
 */
function detalleError(err: unknown): string {
  const e = err as (NodeJS.ErrnoException & { code?: string }) | undefined;
  const detalle = [e?.message, e?.code].filter(Boolean).join(' | ');
  return detalle || String(err);
}

// Sin esto, un error no atrapado en CUALQUIER punto (no solo dentro de un
// job -- BullMQ ya aisla esos) mata el proceso con la traza por defecto de
// Node, que en Dokploy se pierde entre el resto del output si nadie está
// mirando en ese momento (2026-09-04: el worker llevaba meses reiniciandose
// sin que nadie lo notara). Loguea fuerte con el mismo detalle que
// worker.on('failed') y sale limpio -- restart:unless-stopped de
// docker-compose levanta un proceso nuevo; no tiene sentido intentar seguir
// con estado desconocido tras una excepcion no atrapada.
process.on('uncaughtException', (err) => {
  console.error(`[Worker] EXCEPCION NO ATRAPADA -> ${detalleError(err)}`, err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[Worker] PROMESA RECHAZADA SIN ATRAPAR -> ${detalleError(reason)}`, reason);
  process.exit(1);
});

async function main() {
  console.log('[Worker] Iniciando worker de cobranzas...');

  await scheduleRepeatable(JOBS.EMPUJE_MATUTINO, '0 12 * * *'); // 8:00 AM AST
  await scheduleRepeatable(JOBS.CADENCIAS_HORARIAS, '0 * * * *'); // cada hora
  await scheduleRepeatable(JOBS.REPORTE_DIARIO, '30 12 * * 1-5'); // 8:30 AM AST L-V
  await scheduleRepeatable(JOBS.INTELIGENCIA_CLIENTES, '0 5 * * *'); // 1:00 AM AST

  // Ciclo diario de conciliación (2026-09-03) — antes dependían de que alguien
  // los agendara a mano en Dokploy; pedir-extracto nunca llegó a agendarse ahí.
  await scheduleRepeatable(JOBS.PEDIR_EXTRACTO, '0 12 * * 1-5', { modo: 'peticion' }); // 8:00 AM AST L-V
  await scheduleRepeatable(JOBS.PEDIR_EXTRACTO_RECORDATORIO, '0 15 * * 1-5', { modo: 'recordatorio' }); // 11:00 AM AST L-V
  await scheduleRepeatable(JOBS.CONCILIACION_SEGUIMIENTO, '0 13,17,21 * * 1-5'); // 9AM/1PM/5PM AST L-V
  await scheduleRepeatable(JOBS.DEPOSITOS_SIN_DUENO, '0 19 * * 1-5'); // 3:00 PM AST L-V

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

    if (job.name === JOBS.INTELIGENCIA_CLIENTES) {
      const r = await ejecutarInteligenciaClientes();
      console.log(`[Worker] Inteligencia clientes: ${r.procesados} procesados, ${r.errores} errores`);
    }

    if (job.name === JOBS.PEDIR_EXTRACTO || job.name === JOBS.PEDIR_EXTRACTO_RECORDATORIO) {
      const modo = (job.data?.modo === 'recordatorio' ? 'recordatorio' : 'peticion') as
        | 'peticion'
        | 'recordatorio';
      const r = await pedirExtractoSiFalta(modo);
      console.log(`[Worker] Pedir extracto (${modo}): pedido=${r.pedido} motivo=${r.motivo}`);
    }

    if (job.name === JOBS.CONCILIACION_SEGUIMIENTO) {
      const [desconocidos, cheques] = await Promise.all([
        verificarDesconocidos(),
        recordatorioChequesDevueltos(),
      ]);
      console.log(
        `[Worker] Conciliación seguimiento: ${desconocidos.resueltos}/${desconocidos.verificados} desconocidos resueltos, ${cheques} recordatorio(s) de cheques`
      );
    }

    if (job.name === JOBS.DEPOSITOS_SIN_DUENO) {
      const r = await recordarDepositosSinDueno();
      console.log(`[Worker] Depósitos sin dueño: avisado=${r.avisado} motivo=${r.motivo}`);
    }
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Job completado: ${job.name} (${job.id})`);
  });

  worker.on('failed', (job, err) => {
    // `err.message` solo NO alcanza: los errores de conexion de mysql2
    // (ECONNREFUSED) llegan con message VACIO, asi que la linea quedaba en
    // "Job fallido: cadencias-horarias" y nada mas. Eso escondio un dia entero
    // de fallos del worker el 2026-09-01.
    console.error(`[Worker] Job fallido: ${job?.name} (intento ${job?.attemptsMade}) -> ${detalleError(err)}`);
  });

  console.log('[Worker] Listo. Esperando jobs...');

  process.on('SIGTERM', async () => {
    console.log('[Worker] Cerrando...');
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`[Worker] Error fatal -> ${detalleError(err)}`, err);
  process.exit(1);
});
