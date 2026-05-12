import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import type { ConciliacionEntry, ResultadoConciliacion } from '@/lib/types/conciliacion';

/**
 * GET /api/conciliacion/resultados
 * Lista resultados de conciliación con filtros y stats.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const estado = searchParams.get('estado');
    const fechaExtracto = searchParams.get('fecha_extracto');

    let sql = 'SELECT * FROM cobranza_conciliacion WHERE 1=1';
    const params: (string | number)[] = [];

    if (estado) {
      sql += ' AND estado = ?';
      params.push(estado);
    }
    if (fechaExtracto) {
      sql += ' AND fecha_extracto = ?';
      params.push(fechaExtracto);
    }

    sql += ' ORDER BY fecha_transaccion DESC, id DESC';

    const entradas = await cobranzasQuery<ConciliacionEntry>(sql, params);

    // Stats
    const allEntries = await cobranzasQuery<{ estado: string; monto: number }>(
      'SELECT estado, monto FROM cobranza_conciliacion' +
      (fechaExtracto ? ' WHERE fecha_extracto = ?' : ''),
      fechaExtracto ? [fechaExtracto] : []
    );

    const stats = {
      conciliadas: 0,
      por_aplicar: 0,
      desconocidas: 0,
      cheques_devueltos: 0,
      monto_conciliado: 0,
      monto_por_aplicar: 0,
      monto_desconocido: 0,
      monto_devuelto: 0,
    };

    for (const e of allEntries) {
      const monto = Number(e.monto);
      if (e.estado === 'CONCILIADO') {
        stats.conciliadas++;
        stats.monto_conciliado += monto;
      } else if (e.estado === 'POR_APLICAR') {
        stats.por_aplicar++;
        stats.monto_por_aplicar += monto;
      } else if (e.estado === 'CHEQUE_DEVUELTO') {
        stats.cheques_devueltos++;
        stats.monto_devuelto += monto;
      } else {
        stats.desconocidas++;
        stats.monto_desconocido += monto;
      }
    }

    const archivos = await cobranzasQuery<{
      archivo_origen: string;
      fecha_extracto: string;
      registros: number;
      cargado_por: string;
    }>(
      `SELECT archivo_origen, fecha_extracto, COUNT(*) as registros, MAX(cargado_por) as cargado_por
       FROM cobranza_conciliacion
       GROUP BY archivo_origen, fecha_extracto
       ORDER BY fecha_extracto DESC`
    );

    const response: ResultadoConciliacion = {
      entradas,
      total: entradas.length,
      ...stats,
    };

    return NextResponse.json({ ...response, archivos });
  } catch (error) {
    console.error('[CONCILIACION-RESULTADOS] Error:', error);
    return NextResponse.json({ error: 'Error consultando resultados' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores pueden limpiar registros' }, { status: 403 });
    }

    const archivo = request.nextUrl.searchParams.get('archivo');
    if (!archivo) {
      return NextResponse.json({ error: 'Debe especificar el archivo a eliminar (?archivo=nombre.csv)' }, { status: 400 });
    }

    const countResult = await cobranzasQuery<{ total: number }>(
      'SELECT COUNT(*) as total FROM cobranza_conciliacion WHERE archivo_origen = ?',
      [archivo]
    );
    const total = countResult[0]?.total || 0;

    if (total === 0) {
      return NextResponse.json({ error: 'No se encontraron registros de ese archivo' }, { status: 404 });
    }

    await cobranzasExecute(
      'DELETE FROM cobranza_conciliacion WHERE archivo_origen = ?',
      [archivo]
    );

    await logAccion(
      session.userId.toString(),
      'CONCILIACION_LIMPIADA',
      'conciliacion',
      '0',
      { archivo, registros_eliminados: total }
    );

    return NextResponse.json({ message: `${total} registros del archivo "${archivo}" eliminados`, total, archivo });
  } catch (error) {
    console.error('[CONCILIACION-RESULTADOS] Error DELETE:', error);
    return NextResponse.json({ error: 'Error limpiando registros' }, { status: 500 });
  }
}
