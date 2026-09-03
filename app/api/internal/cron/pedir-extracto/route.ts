import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { pedirExtractoSiFalta } from '@/lib/conciliacion/seguimiento';

/**
 * POST /api/internal/cron/pedir-extracto
 *
 * Le pide al GRUPO el extracto bancario del día si todavía no ha llegado.
 * Va en su propia ruta —y no dentro de `conciliacion-seguimiento`— porque el
 * ritmo lo decide el planificador, no el código: aquí no hay lógica de "¿es
 * la hora?", solo "¿falta el extracto?".
 *
 * El disparo real (2026-09-03) vive en BullMQ (lib/queue/bullmq.ts,
 * JOBS.PEDIR_EXTRACTO / JOBS.PEDIR_EXTRACTO_RECORDATORIO), que llama
 * pedirExtractoSiFalta() directo — esta ruta HTTP queda para pruebas
 * manuales y como respaldo si alguna vez hace falta dispararlo desde afuera.
 *
 * Body opcional: { "modo": "peticion" | "recordatorio" } — default "peticion".
 * Si se dispara más veces de la cuenta no pasa nada grave: la función se
 * calla en cuanto detecta que ya hay extracto/movimientos recientes.
 */
export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let modo: 'peticion' | 'recordatorio' = 'peticion';
  try {
    const body = await req.json();
    if (body?.modo === 'recordatorio') modo = 'recordatorio';
  } catch {
    // sin body — modo por defecto
  }

  try {
    const resultado = await pedirExtractoSiFalta(modo);
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      modo,
      ...resultado,
    });
  } catch (error) {
    console.error('[cron/pedir-extracto]', error);
    return NextResponse.json({ error: 'Error pidiendo el extracto' }, { status: 500 });
  }
}
