import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { parsearExtracto } from '@/lib/utils/parser-extracto';
import { procesarLinea } from '@/lib/conciliacion/matcher';
import { crearTareasConciliacion, notificarConciliacionDesdeBD } from '@/lib/conciliacion/seguimiento';

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

    // Anti-duplicado nivel archivo: el mismo archivo cargado dos veces
    // duplicaría todos los registros (montos dobles en stats y alertas).
    const yaCargado = await cobranzasQuery<{ n: number }>(
      'SELECT COUNT(*) AS n FROM cobranza_conciliacion WHERE archivo_origen = ?',
      [file.name]
    );
    if (Number(yaCargado[0]?.n) > 0) {
      return NextResponse.json(
        {
          error: `El archivo "${file.name}" ya fue cargado antes (${yaCargado[0].n} registros). ` +
            'Si es un extracto distinto, renómbralo antes de subirlo.',
        },
        { status: 409 }
      );
    }

    const fechaExtracto = new Date().toISOString().split('T')[0];
    let conciliadas = 0;
    let porAplicar = 0;
    let desconocidas = 0;
    let duplicadasOmitidas = 0;

    let multiRecibo = 0;
    const chequesDevueltos: { fecha: string; monto: number; referencia: string; descripcion: string }[] = [];

    for (const linea of lineas) {
      // Anti-duplicado nivel línea: la misma transacción puede venir en dos
      // archivos distintos (exports con rangos de fechas solapados).
      const lineaExistente = await cobranzasQuery<{ id: number }>(
        `SELECT id FROM cobranza_conciliacion
         WHERE fecha_transaccion = ? AND monto = ? AND referencia = ? AND descripcion = ?
         LIMIT 1`,
        [linea.fecha_transaccion, linea.monto, linea.referencia || '', linea.descripcion || '']
      );
      if (lineaExistente.length > 0) {
        duplicadasOmitidas++;
        continue;
      }
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

      const insertResult = await cobranzasExecute(
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

      if (match.es_multi && match.detalles && match.detalles.length > 0) {
        const conciliacionId = insertResult.insertId;
        for (const det of match.detalles) {
          await cobranzasExecute(
            `INSERT INTO cobranza_conciliacion_detalle
               (conciliacion_id, ir_recnum, codigo_cliente, nombre_cliente, monto)
             VALUES (?, ?, ?, ?, ?)`,
            [conciliacionId, det.ir_recnum, det.codigo_cliente, det.nombre_cliente, det.monto]
          );
        }
        multiRecibo++;
      }

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
        duplicadas_omitidas: duplicadasOmitidas,
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

    // Crear tareas de seguimiento y notificar por Telegram
    let tareasCreadas = 0;
    try {
      tareasCreadas = await crearTareasConciliacion({
        conciliadas, por_aplicar: porAplicar, desconocidas,
        cheques_devueltos: chequesDevueltos.length,
        monto_conciliado: 0, monto_desconocido: 0, monto_devuelto: montoDevuelto,
        multi_recibo: multiRecibo, archivo: file.name, banco,
      });
    } catch (e) {
      console.error('[CONCILIACION-CARGAR] Error creando tareas:', e);
    }

    // Notificar por Telegram en background (consulta montos reales de la BD)
    notificarConciliacionDesdeBD(file.name, banco, multiRecibo, tareasCreadas)
      .catch(e => console.error('[CONCILIACION-CARGAR] Error notificando:', e));

    return NextResponse.json({
      message: `Extracto procesado: ${totalCreditos} créditos, ${chequesDevueltos.length} cheques devueltos` +
        (duplicadasOmitidas > 0 ? `, ${duplicadasOmitidas} duplicadas omitidas` : ''),
      total: lineas.length,
      conciliadas,
      por_aplicar: porAplicar,
      desconocidas,
      duplicadas_omitidas: duplicadasOmitidas,
      multi_recibo: multiRecibo,
      cheques_devueltos: chequesDevueltos.length,
      monto_devuelto: montoDevuelto,
      detalle_devueltos: chequesDevueltos,
      tareas_creadas: tareasCreadas,
    });
  } catch (error) {
    console.error('[CONCILIACION-CARGAR] Error:', error);
    return NextResponse.json({ error: 'Error procesando extracto' }, { status: 500 });
  }
}
