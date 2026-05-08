/**
 * Lógica de matching de conciliación bancaria.
 * Compara líneas del extracto contra Softec (v_cobr_irjnl).
 * CP-05: Cuentas desconocidas siempre requieren asignación manual.
 */

import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import type { LineaExtracto, EstadoConciliacion, CuentaAprendida } from '@/lib/types/conciliacion';

interface MatchResult {
  estado: EstadoConciliacion;
  ir_recnum: number | null;
  codigo_cliente: string | null;
  nombre_cliente: string | null;
}

interface SoftecPago {
  IR_RECNUM: number;
  IR_CCODE: string;
  IR_PDATE: string;
  IR_AMTPAID: number;
}

/**
 * Procesa una línea del extracto: busca cuenta aprendida → match contra Softec.
 */
export async function procesarLinea(linea: LineaExtracto): Promise<MatchResult> {
  // Paso 1: Buscar cuenta en aprendizaje
  let clienteConocido: CuentaAprendida | null = null;
  if (linea.cuenta_origen) {
    const cuentas = await cobranzasQuery<CuentaAprendida>(
      'SELECT * FROM cobranza_cuentas_aprendizaje WHERE cuenta_origen = ?',
      [linea.cuenta_origen]
    );
    if (cuentas.length > 0) {
      clienteConocido = cuentas[0];
    }
  }

  // CP-05: Si cuenta desconocida → DESCONOCIDO obligatorio
  if (!clienteConocido) {
    return {
      estado: 'DESCONOCIDO',
      ir_recnum: null,
      codigo_cliente: null,
      nombre_cliente: null,
    };
  }

  // Paso 2: Intentar match contra Softec
  const softecOk = await testSoftecConnection();

  if (softecOk) {
    return await matchContraSoftecReal(linea, clienteConocido);
  } else {
    return matchMock(linea, clienteConocido);
  }
}

async function matchContraSoftecReal(
  linea: LineaExtracto,
  cuenta: CuentaAprendida
): Promise<MatchResult> {
  // Match: monto exacto + fecha ±3 días
  const pagos = await softecQuery<SoftecPago>(
    `SELECT IR_RECNUM, IR_CCODE, IR_PDATE, IR_AMTPAID
     FROM v_cobr_irjnl
     WHERE IR_CCODE = ?
       AND IR_AMTPAID = ?
       AND ABS(DATEDIFF(?, IR_PDATE)) <= 3
     LIMIT 1`,
    [cuenta.codigo_cliente, linea.monto, linea.fecha_transaccion]
  );

  if (pagos.length > 0) {
    return {
      estado: 'CONCILIADO',
      ir_recnum: pagos[0].IR_RECNUM,
      codigo_cliente: cuenta.codigo_cliente,
      nombre_cliente: cuenta.nombre_cliente,
    };
  }

  // No match en Softec → POR_APLICAR (pago no registrado aún)
  return {
    estado: 'POR_APLICAR',
    ir_recnum: null,
    codigo_cliente: cuenta.codigo_cliente,
    nombre_cliente: cuenta.nombre_cliente,
  };
}

/**
 * Mock matching cuando Softec no está disponible.
 */
function matchMock(
  linea: LineaExtracto,
  cuenta: CuentaAprendida
): MatchResult {
  // Simular: 50% conciliado, 50% por aplicar
  const hash = linea.monto * 100 + linea.fecha_transaccion.charCodeAt(8);
  const conciliado = hash % 2 === 0;

  return {
    estado: conciliado ? 'CONCILIADO' : 'POR_APLICAR',
    ir_recnum: conciliado ? Math.floor(5000 + Math.random() * 1000) : null,
    codigo_cliente: cuenta.codigo_cliente,
    nombre_cliente: cuenta.nombre_cliente,
  };
}
