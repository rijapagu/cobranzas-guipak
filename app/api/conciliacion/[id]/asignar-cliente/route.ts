import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

const asignarSchema = z.object({
  codigo_cliente: z.string().min(1),
  nombre_cliente: z.string().min(1),
});

/**
 * POST /api/conciliacion/[id]/asignar-cliente
 * Asigna cliente a entrada DESCONOCIDA.
 * CP-05: Primera vez siempre MANUAL.
 * CP-08: Log.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores' }, { status: 403 });
    }

    const { id } = await params;
    const entryId = Number(id);
    const body = await request.json();
    const parsed = asignarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'codigo_cliente y nombre_cliente requeridos' }, { status: 400 });
    }

    const { codigo_cliente, nombre_cliente } = parsed.data;

    const entries = await cobranzasQuery<{ id: number; estado: string; cuenta_origen: string; monto: number }>(
      'SELECT id, estado, cuenta_origen, monto FROM cobranza_conciliacion WHERE id = ?',
      [entryId]
    );

    if (entries.length === 0) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    if (entries[0].estado !== 'DESCONOCIDO') {
      return NextResponse.json({ error: `Estado actual: ${entries[0].estado}` }, { status: 400 });
    }

    const cuentaOrigen = entries[0].cuenta_origen;

    // Actualizar entrada con cliente asignado → POR_APLICAR
    await cobranzasExecute(
      'UPDATE cobranza_conciliacion SET codigo_cliente = ?, estado = ?, aprobado_por = ? WHERE id = ?',
      [codigo_cliente, 'POR_APLICAR', session.email, entryId]
    );

    // CP-05: Registrar en sistema de aprendizaje (confianza=MANUAL)
    if (cuentaOrigen) {
      const existente = await cobranzasQuery<{ id: number; veces_usado: number }>(
        'SELECT id, veces_usado FROM cobranza_cuentas_aprendizaje WHERE cuenta_origen = ?',
        [cuentaOrigen]
      );

      if (existente.length > 0) {
        // Actualizar contador
        await cobranzasExecute(
          'UPDATE cobranza_cuentas_aprendizaje SET veces_usado = veces_usado + 1, ultima_vez_visto = NOW(), confianza = CASE WHEN veces_usado >= 2 THEN ? ELSE confianza END WHERE id = ?',
          ['AUTO', existente[0].id]
        );
      } else {
        // Primera vez: insertar como MANUAL
        await cobranzasExecute(
          `INSERT INTO cobranza_cuentas_aprendizaje
           (cuenta_origen, nombre_origen, codigo_cliente, nombre_cliente, confianza, confirmado_por)
           VALUES (?, ?, ?, ?, 'MANUAL', ?)`,
          [cuentaOrigen, entries[0].cuenta_origen, codigo_cliente, nombre_cliente, session.email]
        );
      }
    }

    await logAccion(session.userId.toString(), 'CUENTA_ASIGNADA', 'conciliacion', id, {
      cuenta_origen: cuentaOrigen,
      codigo_cliente,
      nombre_cliente,
      monto: entries[0].monto,
    });

    return NextResponse.json({
      message: `Cliente asignado: ${nombre_cliente}`,
      nuevo_estado: 'POR_APLICAR',
    });
  } catch (error) {
    console.error('[CONCILIACION-ASIGNAR] Error:', error);
    return NextResponse.json({ error: 'Error asignando cliente' }, { status: 500 });
  }
}
