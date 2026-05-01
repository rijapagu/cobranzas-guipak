import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { crearTareaSeguimientoAcuerdo } from '@/lib/cobranzas/auto-tareas';

/**
 * POST /api/portal/[token]/solicitar-acuerdo
 * Cliente solicita un acuerdo de pago desde el portal.
 * CP-07: Verifica token. La solicitud va al supervisor (no se aprueba sola).
 *
 * Body: { ij_inum, monto_propuesto, fecha_propuesta, mensaje }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    // CP-07: Verificar token
    const tokens = await cobranzasQuery<{
      id: number;
      codigo_cliente: string;
    }>(
      'SELECT id, codigo_cliente FROM cobranza_portal_tokens WHERE token = ? AND activo = 1 AND fecha_expiracion > NOW() LIMIT 1',
      [token]
    );

    if (tokens.length === 0) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }

    const { codigo_cliente } = tokens[0];
    const body = await request.json();
    const { ij_inum, monto_propuesto, fecha_propuesta, mensaje } = body;

    if (!ij_inum || !monto_propuesto || !fecha_propuesta) {
      return NextResponse.json(
        { error: 'Campos requeridos: ij_inum, monto_propuesto, fecha_propuesta' },
        { status: 400 }
      );
    }

    // Registrar acuerdo como PENDIENTE — supervisor debe aprobar
    const result = await cobranzasExecute(
      `INSERT INTO cobranza_acuerdos
       (codigo_cliente, ij_inum, monto_prometido, fecha_prometida, descripcion, estado, capturado_por_ia, registrado_por)
       VALUES (?, ?, ?, ?, ?, 'PENDIENTE', 0, 'PORTAL_CLIENTE')`,
      [
        codigo_cliente,
        ij_inum,
        monto_propuesto,
        new Date(fecha_propuesta),
        mensaje || 'Solicitud desde portal de autogestión',
      ]
    );

    await logAccion(null, 'ACUERDO_SOLICITADO_PORTAL', 'acuerdo', result.insertId.toString(), {
      codigo_cliente, ij_inum, monto_propuesto, fecha_propuesta,
    });

    await crearTareaSeguimientoAcuerdo({
      acuerdoId: result.insertId,
      codigoCliente: codigo_cliente,
      ijInum: ij_inum,
      fechaPrometida: fecha_propuesta,
      registradoPor: 'PORTAL_CLIENTE',
    }).catch((err) => console.error('[PORTAL-ACUERDO] auto-tarea fallo:', err));

    return NextResponse.json({
      ok: true,
      mensaje: 'Su solicitud de acuerdo de pago ha sido registrada. Un ejecutivo la revisará pronto.',
      acuerdo_id: result.insertId,
    });
  } catch (error) {
    console.error('[PORTAL-ACUERDO] Error:', error);
    return NextResponse.json({ error: 'Error procesando solicitud' }, { status: 500 });
  }
}
