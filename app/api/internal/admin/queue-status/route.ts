import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { esRequestAdminValido } from '@/lib/auth/internal';
import { getCronQueue } from '@/lib/queue/bullmq';

/**
 * GET /api/internal/admin/queue-status
 *
 * Estado en vivo de BullMQ/Redis -- diagnóstico read-only para responder
 * "¿el proceso worker está vivo y procesando?" sin acceso al dashboard de
 * Dokploy. Nació el 2026-09-04 al investigar por qué cadencias-horarias no
 * había generado nada en casi 3 meses (último log: 2026-06-12), justo
 * después de un fix commit del mismo día -- y un fix de logging del
 * 2026-09-01 que documenta un día entero de fallos ECONNREFUSED contra la
 * DB desde el worker.
 *
 * Devuelve los repeatable jobs registrados (con next=timestamp de la
 * próxima corrida -- si esto está vacío el worker nunca llamó
 * scheduleRepeatable con éxito, o Redis se reinició sin que el worker
 * volviera a registrar nada), los conteos por estado, y el detalle de los
 * últimos jobs fallidos (failedReason trae el error real, incluyendo
 * ECONNREFUSED si sigue pasando).
 */
export async function GET(req: NextRequest) {
  if (!esRequestAdminValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const queue = getCronQueue();

    const [repeatables, counts, fallidos, completados] = await Promise.all([
      queue.getRepeatableJobs(),
      queue.getJobCounts(),
      queue.getFailed(0, 9),
      queue.getCompleted(0, 4),
    ]);

    return NextResponse.json({
      repeatable_jobs: repeatables.map((r) => ({
        name: r.name,
        pattern: r.pattern,
        tz: r.tz,
        next: r.next ? new Date(r.next).toISOString() : null,
      })),
      job_counts: counts,
      ultimos_fallidos: fallidos.map((j) => ({
        name: j.name,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason,
        timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
        processedOn: j.processedOn ? new Date(j.processedOn).toISOString() : null,
      })),
      ultimos_completados: completados.map((j) => ({
        name: j.name,
        finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
