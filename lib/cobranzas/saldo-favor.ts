/**
 * Saldo a favor del cliente (anticipos / recibos sin aplicar) — helper central.
 *
 * En Guipak, un recibo registrado en `ijnl_pay` puede no estar aplicado por
 * completo (o nada) a facturas via `irjnl`. Ese remanente es dinero que el
 * cliente entregó pero que aún no fue asignado a una factura — saldo a favor.
 *
 * El saldo gestionable de un cliente debe restar siempre ese saldo a favor.
 * Si el saldo a favor cubre o excede el pendiente bruto, el cliente NO debe
 * recibir cobranza (decisión de producto 10-may-2026).
 *
 * Implementa CP-13 (JOIN correcto recibo<->aplicacion por IR_PLOCAL/IR_PTYPDOC/
 * IR_RECNUM, sin usar IR_F*) y CP-14 (no usar IJ_ONLPAID ni desglosados).
 *
 * Fuentes: docs/softec/Relacion de tablas.txt y Rutina Principal de Cobros.txt.
 */
import { softecQuery } from '@/lib/db/softec';

export interface SaldoCliente {
  codigo_cliente: string;
  saldo_pendiente: number;
  saldo_a_favor: number;
  saldo_neto: number;
  cubierto_por_anticipo: boolean;
}

export type AjusteSaldo = Omit<SaldoCliente, 'codigo_cliente'>;

/**
 * Retorna un Map de codigo_cliente -> saldo_a_favor (monto de recibos sin
 * aplicar). Solo incluye clientes con saldo a favor mayor a un centavo.
 *
 * Si se pasa `codigos`:
 *   - `undefined`: retorna todos los clientes con saldo a favor.
 *   - array vacío: retorna Map vacío sin tocar la DB.
 *   - array con códigos: filtra (padding a 7 cuando son numéricos).
 *
 * Semántica del cálculo (1-sep-2026: alineada con el ERP — ver más abajo):
 *   1. Cuentan los recibos `ijnl_pay` de tipo RC y DC, y las notas de crédito
 *      `ijnl` con IJ_INVTORF='C'. Es exactamente lo que netea el motor del ERP
 *      (VCC\icalbalance.prg, procedimiento iCalDueBalance).
 *   2. Por cada documento se calcula `sin_aplicar = total - SUM(IR_AMTPAID)`.
 *   3. Solo cuentan los que tienen `sin_aplicar > 0.01` — los sobre-aplicados
 *      (raros, vienen de ajustes contables) NO restan del saldo a favor.
 *   4. Se suma por cliente. Nunca se mezclan créditos entre clientes.
 *
 * CAMBIO DEL 1-sep-2026 — por qué se ampliaron los tipos:
 *   El dashboard mostraba RD$27.9M de cartera contra RD$24.1M del "Análisis de
 *   Antigüedad de Saldo" del módulo CC. La brecha era crédito sin aplicar que
 *   esta función no veía. Se decidió (dueño) conciliar con el ERP:
 *     - se AGREGAN las notas de crédito, que faltaban por completo;
 *     - se AGREGAN los DC/DE, que el fix del 12-may-2026 había excluido;
 *     - se filtra por TIPO de documento (IJ_TYPEDOC) y no por SERIE
 *       (IJ_SINORIN): el filtro viejo `IJ_SINORIN='RC'` colaba 24 documentos
 *       DC justamente por mirar la serie.
 *   POR QUÉ AHORA SÍ SE PUEDEN INCLUIR LAS DE: el fix del 12-may existía porque
 *   las DE inflaban el saldo a favor en RD$5.59M (18 falsos "cubiertos por
 *   anticipo", clientes que dejaban de recibir gestión). Esa inflación no venía
 *   de las DE: venía de la LLAVE DEL JOIN. `IR_PTYPDOC` es el TIPO del documento
 *   (RC/DC/CR) e `IR_PAYDOC` es su SERIE (RC/DE/DC/CI); al unir
 *   `IR_PTYPDOC = IJ_SINORIN` los recibos de serie 'DE' tienen PTYPDOC='DC' y NO
 *   matchean nunca, así que se contaban como enteramente sin aplicar. Medido en
 *   DEV: 1.059 de 1.059 recibos DE quedaban sin match por PTYPDOC, contra 14 por
 *   PAYDOC. Se corrigió el join a `IR_PAYDOC = IJ_SINORIN` (serie contra serie,
 *   que es lo que hace el ERP) y con eso las DE dejan de inflar nada.
 *   Medido en DEV: RC 2,001,925.94 + NC 18,132.69 + DC 5,394.39 = 2,025,453.02,
 *   idéntico al crédito que netea el ERP.
 *
 * Performance: la query pre-agrega `irjnl` una vez y hace JOIN — evita la
 * subquery correlacionada por cliente que es lenta a escala (cuando se
 * intentó ese patrón en diagnostico-saldo-favor.mjs corrió en ~60s).
 */
export async function obtenerSaldoAFavorPorCliente(
  codigos?: string[]
): Promise<Map<string, number>> {
  // Early return: array vacío explícito significa "nada que consultar".
  if (codigos !== undefined && codigos.length === 0) {
    return new Map();
  }

  const params: (string | number)[] = [];
  let filtroCodigos = '';
  let filtroCodigosNc = '';

  if (codigos !== undefined) {
    const normalizados = codigos
      .map((c) => String(c).trim())
      .filter((c) => c.length > 0)
      .map((c) => (/^\d+$/.test(c) ? c.padStart(7, '0') : c));

    if (normalizados.length === 0) {
      return new Map();
    }

    const placeholders = normalizados.map(() => '?').join(',');
    filtroCodigos = `AND pay.IJ_CCODE IN (${placeholders})`;
    filtroCodigosNc = `AND nc.IJ_CCODE IN (${placeholders})`;
    // Los códigos van dos veces: una por cada rama del UNION ALL.
    params.push(...normalizados, ...normalizados);
  }

  // Filtrar por documento (WHERE sin_aplicar) ANTES de agrupar por cliente. Así
  // un documento sobre-aplicado (raro, viene de ajustes contables) no resta del
  // saldo a favor del cliente — replica el endpoint estado-cuenta.
  //
  // Rama 1: recibos de ijnl_pay. Se filtra por IJ_TYPEDOC ('RC','DC') y NO por
  // IJ_SINORIN: la serie y el tipo no son lo mismo, y filtrar por serie dejaba
  // entrar 24 documentos DC con serie 'RC' (medido en DEV el 1-sep-2026).
  // Rama 2: notas de crédito de ijnl (IJ_INVTORF='C'), que antes no se miraban.
  // Para las NC alcanza IJ_TOTAPPL: verificado en DEV contra el recálculo del
  // ERP (ONLPAID+ONLCR+irjnl) sobre los 368 documentos, diferencia 0.00.
  const rows = await softecQuery<{
    codigo_cliente: string;
    saldo_a_favor: number | string;
  }>(
    `SELECT
       codigo_cliente,
       SUM(sin_aplicar) AS saldo_a_favor
     FROM (
       SELECT
         pay.IJ_CCODE                            AS codigo_cliente,
         (pay.IJ_TOT - IFNULL(ap.aplicado, 0))   AS sin_aplicar
       FROM v_cobr_ijnl_pay pay
       LEFT JOIN (
         SELECT
           r.IR_PLOCAL,
           r.IR_PAYDOC,
           r.IR_RECNUM,
           SUM(r.IR_AMTPAID) AS aplicado
         FROM v_cobr_irjnl r
         GROUP BY r.IR_PLOCAL, r.IR_PAYDOC, r.IR_RECNUM
       ) ap
         ON  ap.IR_PLOCAL = pay.IJ_LOCAL
         AND ap.IR_PAYDOC = pay.IJ_SINORIN
         AND ap.IR_RECNUM = pay.IJ_RECNUM
       WHERE pay.IJ_CCODE IS NOT NULL
         AND pay.IJ_TYPEDOC IN ('RC', 'DC')
         ${filtroCodigos}

       UNION ALL

       SELECT
         nc.IJ_CCODE                                  AS codigo_cliente,
         (ABS(nc.IJ_TOT) - ABS(nc.IJ_TOTAPPL))        AS sin_aplicar
       FROM v_cobr_ijnl nc
       WHERE nc.IJ_CCODE IS NOT NULL
         AND nc.IJ_INVTORF = 'C'
         AND nc.IJ_TYPEDOC = 'CR'
         ${filtroCodigosNc}
     ) creditos
     WHERE sin_aplicar > 0.01
     GROUP BY codigo_cliente
     HAVING saldo_a_favor > 0.01`,
    params
  );

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(String(r.codigo_cliente).trim(), Number(r.saldo_a_favor));
  }
  return map;
}

/**
 * Postprocesa pendiente bruto + saldo a favor para calcular el saldo neto
 * gestionable de un cliente. Si el saldo a favor cubre o excede el pendiente,
 * `saldo_neto` queda en 0 y `cubierto_por_anticipo` en true.
 *
 * No mezcla saldos a favor entre clientes (cada cliente con sus propios
 * recibos). Si se llama con valores negativos los normaliza a cero antes
 * de calcular.
 */
export function ajustarSaldoCliente(
  saldoBruto: number,
  saldoFavor: number
): AjusteSaldo {
  const pendiente = Math.max(0, Number(saldoBruto) || 0);
  const favor = Math.max(0, Number(saldoFavor) || 0);
  const neto = Math.max(0, pendiente - favor);
  return {
    saldo_pendiente: pendiente,
    saldo_a_favor: favor,
    saldo_neto: neto,
    cubierto_por_anticipo: favor >= pendiente && pendiente > 0,
  };
}

/**
 * Atajo combinado: obtiene el Map de saldos a favor y aplica el ajuste por
 * cliente sobre una lista de pares (codigo, saldo_pendiente). Util en
 * endpoints que ya calcularon el pendiente bruto agregado por cliente.
 */
export async function ajustarSaldoClientes(
  pendientesPorCliente: { codigo_cliente: string; saldo_pendiente: number }[]
): Promise<SaldoCliente[]> {
  if (pendientesPorCliente.length === 0) return [];

  const codigos = pendientesPorCliente.map((p) => p.codigo_cliente);
  const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);

  return pendientesPorCliente.map((p) => {
    const codigo = String(p.codigo_cliente).trim();
    const favor = saldosFavor.get(codigo) ?? 0;
    return {
      codigo_cliente: codigo,
      ...ajustarSaldoCliente(p.saldo_pendiente, favor),
    };
  });
}
