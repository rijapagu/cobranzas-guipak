import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { crearTareaSeguimientoAcuerdo } from '@/lib/cobranzas/auto-tareas';
import { rateLimit, ipDeRequest } from '@/lib/auth/rate-limit';
import { adaptadorParaEmpresa } from '@/lib/erp';

const SolicitudSchema = z.object({
  ij_inum: z.number().int().positive(),
  monto_propuesto: z.number().positive(),
  fecha_propuesta: z.string().min(8).max(40),
  mensaje: z.string().max(1000).optional().nullable(),
});

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
    // Rate limit: 5 solicitudes de acuerdo por token cada hora + 20 por IP/hora
    const ip = ipDeRequest(request);
    const [porToken, porIp] = await Promise.all([
      rateLimit(`acuerdo:token:${token}`, 5, 60 * 60),
      rateLimit(`acuerdo:ip:${ip}`, 20, 60 * 60),
    ]);
    if (!porToken.permitido || !porIp.permitido) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
        { status: 429 }
      );
    }

    // CP-07: Verificar token (la empresa se resuelve DESDE el token)
    const tokens = await cobranzasQuery<{
      id: number;
      codigo_cliente: string;
      empresa_id: number;
    }>(
      'SELECT id, codigo_cliente, empresa_id FROM cobranza_portal_tokens WHERE token = ? AND activo = 1 AND fecha_expiracion > NOW() LIMIT 1',
      [token]
    );

    if (tokens.length === 0) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }

    const { codigo_cliente, empresa_id } = tokens[0];
    const body = await request.json().catch(() => null);
    const parsed = SolicitudSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', detalle: parsed.error.issues },
        { status: 400 }
      );
    }
    const { ij_inum, monto_propuesto, fecha_propuesta, mensaje } = parsed.data;

    // Fecha prometida: parseable y no en el pasado (tolerancia de 1 día por TZ).
    const fechaProm = new Date(fecha_propuesta);
    if (isNaN(fechaProm.getTime()) || fechaProm.getTime() < Date.now() - 24 * 3600 * 1000) {
      return NextResponse.json(
        { error: 'La fecha propuesta debe ser una fecha válida y futura' },
        { status: 400 }
      );
    }

    // IDOR a nivel de factura: la factura debe pertenecer al cliente del token
    // (en su empresa). El adaptador filtra por empresa_id + codigo_cliente, así
    // que un cliente no puede solicitar acuerdos sobre facturas ajenas.
    const adapter = await adaptadorParaEmpresa(empresa_id);
    const factura = await adapter.factura(ij_inum, codigo_cliente).catch(() => null);
    if (!factura) {
      return NextResponse.json(
        { error: 'La factura indicada no pertenece a su cuenta o no existe' },
        { status: 404 }
      );
    }
    // El monto propuesto no puede exceder el saldo de la factura (tolerancia RD$1).
    if (monto_propuesto > factura.saldoPendiente + 1) {
      return NextResponse.json(
        { error: 'El monto propuesto no puede exceder el saldo pendiente de la factura' },
        { status: 400 }
      );
    }

    // Registrar acuerdo como PENDIENTE — supervisor debe aprobar
    const result = await cobranzasExecute(
      `INSERT INTO cobranza_acuerdos
       (empresa_id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida, descripcion, estado, capturado_por_ia, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDIENTE', 0, 'PORTAL_CLIENTE')`,
      [
        empresa_id,
        codigo_cliente,
        ij_inum,
        monto_propuesto,
        fechaProm,
        mensaje || 'Solicitud desde portal de autogestión',
      ]
    );

    await logAccion(null, 'ACUERDO_SOLICITADO_PORTAL', 'acuerdo', result.insertId.toString(), {
      codigo_cliente, ij_inum, monto_propuesto, fecha_propuesta,
    });

    await crearTareaSeguimientoAcuerdo({
      empresaId: empresa_id,
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
