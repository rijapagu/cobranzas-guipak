import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { parsearExtracto } from '@/lib/utils/parser-extracto';
import { procesarLinea } from '@/lib/conciliacion/matcher';
import { crearTareasConciliacion, notificarConciliacionDesdeBD } from '@/lib/conciliacion/seguimiento';

/**
 * Carga de un extracto bancario.
 *
 * Vive aquí y no en la ruta HTTP porque hay DOS puertas de entrada — la pantalla
 * de Conciliación y el bot de Telegram — y las reglas del negocio no pueden
 * existir por duplicado: CP-05 (cuenta nueva → DESCONOCIDO obligatorio) y CP-08
 * (log de toda acción) tienen que valer igual por las dos.
 *
 * Quien llama es responsable de comprobar el permiso (ADMIN o SUPERVISOR) y de
 * decir POR QUIÉN actúa: aquí no hay sesión, hay un actor explícito.
 */

/** Quién carga el extracto. El bot actúa siempre como la persona que le habla. */
export interface ActorCarga {
  userId: number;
  email: string;
  empresaId: number;
}

export interface ChequeDevuelto {
  fecha: string;
  monto: number;
  referencia: string;
  descripcion: string;
}

export interface ResultadoCarga {
  /** `false` cuando el archivo no trae ninguna transacción nueva. */
  huboNovedad: boolean;
  mensaje: string;
  total: number;
  conciliadas: number;
  porAplicar: number;
  desconocidas: number;
  duplicadasOmitidas: number;
  multiRecibo: number;
  chequesDevueltos: ChequeDevuelto[];
  montoDevuelto: number;
  tareasCreadas: number;
}

/** El archivo no traía ninguna transacción reconocible. */
export class ExtractoVacio extends Error {
  constructor() {
    super('No se encontraron transacciones en el archivo');
    this.name = 'ExtractoVacio';
  }
}

export async function cargarExtracto(
  buffer: Buffer,
  nombreArchivo: string,
  banco: string,
  actor: ActorCarga,
  opciones: { notificarGrupo?: boolean } = {}
): Promise<ResultadoCarga> {
  const { empresaId } = actor;
  const notificarGrupo = opciones.notificarGrupo ?? true;
  const lineas = await parsearExtracto(buffer, nombreArchivo);
  if (lineas.length === 0) throw new ExtractoVacio();

  // Fecha del extracto = la transacción más reciente del archivo
  // (antes se guardaba la fecha de CARGA, que desordenaba el agrupado).
  const fechaExtracto = lineas.reduce(
    (max, l) => (l.fecha_transaccion > max ? l.fecha_transaccion : max),
    lineas[0].fecha_transaccion
  );

  let conciliadas = 0;
  let porAplicar = 0;
  let desconocidas = 0;
  let duplicadasOmitidas = 0;
  let multiRecibo = 0;
  const chequesDevueltos: ChequeDevuelto[] = [];

  for (const linea of lineas) {
    // Anti-duplicado por CONTENIDO de la transacción. Es el que de verdad
    // protege: la misma transacción puede venir en dos archivos distintos
    // (exports con rangos de fechas solapados) y con nombres distintos.
    const lineaExistente = await cobranzasQuery<{ id: number }>(
      `SELECT id FROM cobranza_conciliacion
       WHERE empresa_id = ? AND fecha_transaccion = ? AND monto = ? AND referencia = ? AND descripcion = ?
       LIMIT 1`,
      [empresaId, linea.fecha_transaccion, linea.monto, linea.referencia || '', linea.descripcion || '']
    );
    if (lineaExistente.length > 0) {
      duplicadasOmitidas++;
      continue;
    }

    if (linea.tipo === 'CHEQUE_DEVUELTO') {
      await cobranzasExecute(
        `INSERT INTO cobranza_conciliacion (
          empresa_id, fecha_extracto, banco, archivo_origen,
          fecha_transaccion, descripcion, referencia, cuenta_origen,
          monto, moneda, estado, ir_recnum, codigo_cliente, cargado_por
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CHEQUE_DEVUELTO', NULL, NULL, ?)`,
        [
          empresaId, fechaExtracto, banco, nombreArchivo,
          linea.fecha_transaccion, linea.descripcion, linea.referencia, linea.cuenta_origen || null,
          linea.monto, linea.moneda,
          actor.email,
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

    const match = await procesarLinea(linea, empresaId);

    const insertResult = await cobranzasExecute(
      `INSERT INTO cobranza_conciliacion (
        empresa_id, fecha_extracto, banco, archivo_origen,
        fecha_transaccion, descripcion, referencia, cuenta_origen,
        monto, moneda, estado, ir_recnum, codigo_cliente, cargado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId, fechaExtracto, banco, nombreArchivo,
        linea.fecha_transaccion, linea.descripcion, linea.referencia, linea.cuenta_origen,
        linea.monto, linea.moneda, match.estado, match.ir_recnum, match.codigo_cliente,
        actor.email,
      ]
    );

    if (match.es_multi && match.detalles && match.detalles.length > 0) {
      const conciliacionId = insertResult.insertId;
      for (const det of match.detalles) {
        await cobranzasExecute(
          `INSERT INTO cobranza_conciliacion_detalle
             (empresa_id, conciliacion_id, ir_recnum, codigo_cliente, nombre_cliente, monto)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [empresaId, conciliacionId, det.ir_recnum, det.codigo_cliente, det.nombre_cliente, det.monto]
        );
      }
      multiRecibo++;
    }

    if (match.estado === 'CONCILIADO') conciliadas++;
    else if (match.estado === 'POR_APLICAR') porAplicar++;
    else desconocidas++;
  }

  const totalCreditos = lineas.length - chequesDevueltos.length;
  const montoDevuelto = chequesDevueltos.reduce((s, c) => s + c.monto, 0);
  const huboNovedad = duplicadasOmitidas < lineas.length;

  // Un extracto que ya estaba cargado entero no es un error: es un reenvío.
  // Antes esto se atajaba comparando el NOMBRE del archivo, y por chat eso
  // molestaba a diario — los bancos mandan el extracto llamándolo igual todos
  // los meses. Se responde con calma y sin crear tareas ni avisar a nadie.
  if (!huboNovedad) {
    await logAccion(String(actor.userId), 'EXTRACTO_REPETIDO', 'conciliacion', '0', {
      archivo: nombreArchivo,
      banco,
      lineas: lineas.length,
    });
    return {
      huboNovedad: false,
      mensaje: `Ese extracto ya estaba cargado: sus ${lineas.length} transacciones ya estaban todas registradas. No se duplicó nada.`,
      total: lineas.length,
      conciliadas: 0,
      porAplicar: 0,
      desconocidas: 0,
      duplicadasOmitidas,
      multiRecibo: 0,
      chequesDevueltos: [],
      montoDevuelto: 0,
      tareasCreadas: 0,
    };
  }

  await logAccion(String(actor.userId), 'EXTRACTO_CARGADO', 'conciliacion', '0', {
    archivo: nombreArchivo,
    banco,
    total_lineas: lineas.length,
    creditos: totalCreditos,
    conciliadas,
    por_aplicar: porAplicar,
    desconocidas,
    duplicadas_omitidas: duplicadasOmitidas,
    cheques_devueltos: chequesDevueltos.length,
    monto_devuelto: montoDevuelto,
  });

  if (chequesDevueltos.length > 0) {
    await logAccion('sistema', 'ALERTA_CHEQUES_DEVUELTOS', 'conciliacion', '0', {
      cantidad: chequesDevueltos.length,
      monto_total: montoDevuelto,
      detalle: chequesDevueltos,
    });
  }

  let tareasCreadas = 0;
  try {
    tareasCreadas = await crearTareasConciliacion({
      conciliadas, por_aplicar: porAplicar, desconocidas,
      cheques_devueltos: chequesDevueltos.length,
      monto_conciliado: 0, monto_desconocido: 0, monto_devuelto: montoDevuelto,
      multi_recibo: multiRecibo, archivo: nombreArchivo, banco,
    });
  } catch (e) {
    console.error('[CONCILIACION-CARGAR] Error creando tareas:', e);
  }

  // En background: consulta los montos reales de la BD y avisa por Telegram.
  // notificarGrupo=false cuando quien llama YA está en el grupo (el webhook de
  // Telegram cuando el chat es el grupo) — antes esto duplicaba el mensaje: el
  // resumen detallado al que subió el archivo Y el resumen con montos al grupo,
  // siendo el mismo chat.
  if (notificarGrupo) {
    notificarConciliacionDesdeBD(nombreArchivo, banco, multiRecibo, tareasCreadas)
      .catch(e => console.error('[CONCILIACION-CARGAR] Error notificando:', e));
  }

  return {
    huboNovedad: true,
    mensaje:
      `Extracto procesado: ${totalCreditos} créditos, ${chequesDevueltos.length} cheques devueltos` +
      (duplicadasOmitidas > 0 ? `, ${duplicadasOmitidas} duplicadas omitidas` : ''),
    total: lineas.length,
    conciliadas,
    porAplicar,
    desconocidas,
    duplicadasOmitidas,
    multiRecibo,
    chequesDevueltos,
    montoDevuelto,
    tareasCreadas,
  };
}
