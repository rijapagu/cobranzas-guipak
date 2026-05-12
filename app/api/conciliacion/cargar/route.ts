import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { parsearExtracto } from '@/lib/utils/parser-extracto';
import { procesarLinea } from '@/lib/conciliacion/matcher';

/**
 * POST /api/conciliacion/cargar
 * Recibe extracto bancario (FormData) y lo procesa.
 * CP-05: Cuentas nuevas → DESCONOCIDO obligatorio.
 * CP-08: Log de toda acción.
 *
 * Detecta cheques devueltos y los registra como CHEQUE_DEVUELTO
 * para que el supervisor gestione la desaplicación en Softec.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores pueden cargar extractos' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('archivo') as File | null;
    const banco = formData.get('banco') as string || 'Sin especificar';

    if (!file) {
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const lineas = parsearExtracto(buffer, file.name);

    if (lineas.length === 0) {
      return NextResponse.json({ error: 'No se encontraron transacciones en el archivo' }, { status: 400 });
    }

    const fechaExtracto = new Date().toISOString().split('T')[0];
    let conciliadas = 0;
    let porAplicar = 0;
    let desconocidas = 0;

    const chequesDevueltos: { fecha: string; monto: number; referencia: string; descripcion: string }[] = [];

    for (const linea of lineas) {
      if (linea.tipo === 'CHEQUE_DEVUELTO') {
        await cobranzasExecute(
          `INSERT INTO cobranza_conciliacion (
            fecha_extracto, banco, archivo_origen,
            fecha_transaccion, descripcion, referencia, cuenta_origen,
            monto, moneda, estado, ir_recnum, codigo_cliente, cargado_por
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CHEQUE_DEVUELTO', NULL, NULL, ?)`,
          [
            fechaExtracto, banco, file.name,
            linea.fecha_transaccion, linea.descripcion, linea.referencia, linea.cuenta_origen || null,
            linea.monto, linea.moneda,
            session.email,
          ]
        );

        chequesDevueltos.push({
          fecha: linea.fecha_transaccion,
          monto: linea.monto,
          referencia: linea.referencia,
          descripcion: linea.descripcion,
        });
        continue;
      }

      const match = await procesarLinea(linea);

      await cobranzasExecute(
        `INSERT INTO cobranza_conciliacion (
          fecha_extracto, banco, archivo_origen,
          fecha_transaccion, descripcion, referencia, cuenta_origen,
          monto, moneda, estado, ir_recnum, codigo_cliente, cargado_por
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fechaExtracto, banco, file.name,
          linea.fecha_transaccion, linea.descripcion, linea.referencia, linea.cuenta_origen,
          linea.monto, linea.moneda, match.estado, match.ir_recnum, match.codigo_cliente,
          session.email,
        ]
      );

      if (match.estado === 'CONCILIADO') conciliadas++;
      else if (match.estado === 'POR_APLICAR') porAplicar++;
      else desconocidas++;
    }

    const totalCreditos = lineas.filter(l => l.tipo !== 'CHEQUE_DEVUELTO').length;
    const montoDevuelto = chequesDevueltos.reduce((s, c) => s + c.monto, 0);

    await logAccion(
      session.userId.toString(),
      'EXTRACTO_CARGADO',
      'conciliacion',
      '0',
      {
        archivo: file.name,
        banco,
        total_lineas: lineas.length,
        creditos: totalCreditos,
        conciliadas,
        por_aplicar: porAplicar,
        desconocidas,
        cheques_devueltos: chequesDevueltos.length,
        monto_devuelto: montoDevuelto,
      }
    );

    if (chequesDevueltos.length > 0) {
      await logAccion(
        'sistema',
        'ALERTA_CHEQUES_DEVUELTOS',
        'conciliacion',
        '0',
        {
          cantidad: chequesDevueltos.length,
          monto_total: montoDevuelto,
          detalle: chequesDevueltos,
        }
      );
    }

    return NextResponse.json({
      message: `Extracto procesado: ${totalCreditos} créditos, ${chequesDevueltos.length} cheques devueltos`,
      total: lineas.length,
      conciliadas,
      por_aplicar: porAplicar,
      desconocidas,
      cheques_devueltos: chequesDevueltos.length,
      monto_devuelto: montoDevuelto,
      detalle_devueltos: chequesDevueltos,
    });
  } catch (error) {
    console.error('[CONCILIACION-CARGAR] Error:', error);
    return NextResponse.json({ error: 'Error procesando extracto' }, { status: 500 });
  }
}
