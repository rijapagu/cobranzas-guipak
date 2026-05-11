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
 * Semántica del cálculo (alineada con /api/cobranzas/clientes/[codigo]/
 * estado-cuenta, validado contra SR0017 el 8-may-2026):
 *   1. Por cada recibo se calcula `sin_aplicar = IJ_TOT - SUM(IR_AMTPAID)`.
 *   2. Solo cuentan los recibos con `sin_aplicar > 0.01` — los recibos
 *      sobre-aplicados (raros, vienen de ajustes contables) NO restan del
 *      saldo a favor del cliente.
 *   3. Se suma por cliente.
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

  if (codigos !== undefined) {
    const normalizados = codigos
      .map((c) => String(c).trim())
      .filter((c) => c.length > 0)
      .map((c) => (/^\d+$/.test(c) ? c.padStart(7, '0') : c));

    if (normalizados.length === 0) {
      return new Map();
    }

    filtroCodigos = `AND pay.IJ_CCODE IN (${normalizados.map(() => '?').join(',')})`;
    params.push(...normalizados);
  }

  // Filtrar por recibo (HAVING) ANTES de agrupar por cliente. Así un recibo
  // sobre-aplicado (raro, viene de ajustes contables) no resta del saldo a
  // favor del cliente — replica el comportamiento del endpoint estado-cuenta.
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
           r.IR_PTYPDOC,
           r.IR_RECNUM,
           SUM(r.IR_AMTPAID) AS aplicado
         FROM v_cobr_irjnl r
         GROUP BY r.IR_PLOCAL, r.IR_PTYPDOC, r.IR_RECNUM
       ) ap
         ON  ap.IR_PLOCAL  = pay.IJ_LOCAL
         AND ap.IR_PTYPDOC = pay.IJ_SINORIN
         AND ap.IR_RECNUM  = pay.IJ_RECNUM
       WHERE pay.IJ_CCODE IS NOT NULL
         ${filtroCodigos}
     ) recibos
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
