import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { pedirExtractoSiFalta } from '@/lib/conciliacion/seguimiento';

/**
 * POST /api/internal/cron/pedir-extracto
 *
 * Le pide al administrador el extracto bancario del día si todavía no ha
 * llegado. Va en su propia ruta —y no dentro de `conciliacion-seguimiento`—
 * porque el ritmo lo decide el planificador, no el código: aquí no hay lógica
 * de "¿es la hora?", solo "¿falta el extracto?".
 *
 * Programar UNA vez al día, mañanas de lunes a viernes. Si se dispara más
 * veces no pasa nada grave: la función se calla en cuanto detecta que hoy ya
 * se cargó uno, pero mientras no llegue insistiría en cada ejecución.
 */
export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const resultado = await pedirExtractoSiFalta();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      ...resultado,
    });
  } catch (error) {
    console.error('[cron/pedir-extracto]', error);
    return NextResponse.json({ error: 'Error pidiendo el extracto' }, { status: 500 });
  }
}
