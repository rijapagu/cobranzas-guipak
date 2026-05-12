/**
 * Lógica de matching de conciliación bancaria.
 *
 * Flujo de matching (en orden de prioridad):
 *   1. Buscar recibo (RC) en Softec con monto exacto + fecha ±3 días
 *      → Si hay un único cliente → CONCILIADO
 *   2. Buscar cuenta en aprendizaje → match contra Softec si conocida
 *      → CONCILIADO o POR_APLICAR
 *   3. Sin match → DESCONOCIDO (CP-05: requiere asignación manual)
 *
 * Cuando se encuentra match, también auto-aprende la cuenta bancaria
 * para futuros extractos.
 */

import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import type { LineaExtracto, EstadoConciliacion, CuentaAprendida } from '@/lib/types/conciliacion';

export interface DetalleRecibo {
  ir_recnum: number;
  codigo_cliente: string;
  nombre_cliente: string | null;
  monto: number;
}

export interface MatchResult {
  estado: EstadoConciliacion;
  ir_recnum: number | null;
  codigo_cliente: string | null;
  nombre_cliente: string | null;
  es_multi?: boolean;
  detalles?: DetalleRecibo[];
}

interface ReciboSoftec {
  IJ_RECNUM: number;
  IJ_CCODE: string;
  IJ_TOT: number;
  IJ_DATE: string;
}

export async function procesarLinea(linea: LineaExtracto): Promise<MatchResult> {
  const softecOk = await testSoftecConnection();

  if (softecOk) {
    // 1. Match exacto: un recibo = un depósito
    const matchRecibo = await matchContraRecibos(linea);
    if (matchRecibo) {
      if (matchRecibo.codigo_cliente && linea.cuenta_origen) {
        await aprenderCuenta(linea.cuenta_origen, linea.descripcion, matchRecibo.codigo_cliente, matchRecibo.nombre_cliente);
      }
      return matchRecibo;
    }

    // 2. Match multi-recibo: varios recibos suman el monto (libramientos)
    const matchMulti = await matchMultiRecibo(linea);
    if (matchMulti) return matchMulti;
  }

  if (linea.cuenta_origen) {
    const cuentas = await cobranzasQuery<CuentaAprendida>(
      'SELECT * FROM cobranza_cuentas_aprendizaje WHERE cuenta_origen = ?',
      [linea.cuenta_origen]
    );
    if (cuentas.length > 0) {
      const cuenta = cuentas[0];
      await cobranzasExecute(
        'UPDATE cobranza_cuentas_aprendizaje SET veces_usado = veces_usado + 1, ultima_vez_visto = NOW() WHERE id = ?',
        [cuenta.id]
      );
      return {
        estado: 'POR_APLICAR',
        ir_recnum: null,
        codigo_cliente: cuenta.codigo_cliente,
        nombre_cliente: cuenta.nombre_cliente,
      };
    }
  }

  return {
    estado: 'DESCONOCIDO',
    ir_recnum: null,
    codigo_cliente: null,
    nombre_cliente: null,
  };
}

async function matchContraRecibos(linea: LineaExtracto): Promise<MatchResult | null> {
  const recibos = await softecQuery<ReciboSoftec>(
    `SELECT IJ_RECNUM, IJ_CCODE, IJ_TOT, IJ_DATE
     FROM v_cobr_ijnl_pay
     WHERE IJ_SINORIN = 'RC'
       AND IJ_TOT = ?
       AND ABS(DATEDIFF(?, IJ_DATE)) <= 3
     LIMIT 5`,
    [linea.monto, linea.fecha_transaccion]
  );

  if (recibos.length === 0) return null;

  const clientes = [...new Set(recibos.map(r => String(r.IJ_CCODE).trim()))];

  if (clientes.length === 1) {
    const codigoCliente = clientes[0];
    const nombre = await obtenerNombreCliente(codigoCliente);

    return {
      estado: 'CONCILIADO',
      ir_recnum: recibos[0].IJ_RECNUM,
      codigo_cliente: codigoCliente,
      nombre_cliente: nombre,
    };
  }

  // Múltiples clientes con mismo monto — intentar desambiguar por cuenta aprendida
  if (linea.cuenta_origen) {
    const cuentas = await cobranzasQuery<CuentaAprendida>(
      'SELECT * FROM cobranza_cuentas_aprendizaje WHERE cuenta_origen = ?',
      [linea.cuenta_origen]
    );
    if (cuentas.length > 0) {
      const clienteAprendido = String(cuentas[0].codigo_cliente).trim();
      const reciboDelCliente = recibos.find(r => String(r.IJ_CCODE).trim() === clienteAprendido);
      if (reciboDelCliente) {
        return {
          estado: 'CONCILIADO',
          ir_recnum: reciboDelCliente.IJ_RECNUM,
          codigo_cliente: clienteAprendido,
          nombre_cliente: cuentas[0].nombre_cliente,
        };
      }
    }
  }

  return null;
}

async function matchMultiRecibo(linea: LineaExtracto): Promise<MatchResult | null> {
  const recibos = await softecQuery<ReciboSoftec>(
    `SELECT IJ_RECNUM, IJ_CCODE, IJ_TOT, IJ_DATE
     FROM v_cobr_ijnl_pay
     WHERE IJ_SINORIN = 'RC'
       AND IJ_TOT < ?
       AND IJ_TOT > 0
       AND ABS(DATEDIFF(?, IJ_DATE)) <= 3
     ORDER BY IJ_TOT DESC`,
    [linea.monto, linea.fecha_transaccion]
  );

  if (recibos.length < 2) return null;

  const targetCents = Math.round(linea.monto * 100);
  const candidatos = recibos.map(r => ({
    ...r,
    montoCents: Math.round(Number(r.IJ_TOT) * 100),
  }));

  const combo = buscarCombinacion(candidatos, targetCents, 8);
  if (!combo) return null;

  const detalles: DetalleRecibo[] = [];
  for (const r of combo) {
    const nombre = await obtenerNombreCliente(String(r.IJ_CCODE).trim());
    detalles.push({
      ir_recnum: r.IJ_RECNUM,
      codigo_cliente: String(r.IJ_CCODE).trim(),
      nombre_cliente: nombre,
      monto: Number(r.IJ_TOT),
    });
  }

  return {
    estado: 'CONCILIADO',
    ir_recnum: null,
    codigo_cliente: null,
    nombre_cliente: null,
    es_multi: true,
    detalles,
  };
}

function buscarCombinacion(
  candidatos: { IJ_RECNUM: number; IJ_CCODE: string; IJ_TOT: number; montoCents: number }[],
  targetCents: number,
  maxDepth: number
): typeof candidatos | null {
  let resultado: typeof candidatos | null = null;

  function backtrack(index: number, remaining: number, current: typeof candidatos) {
    if (resultado) return;
    if (remaining === 0) {
      resultado = [...current];
      return;
    }
    if (remaining < 0 || current.length >= maxDepth || index >= candidatos.length) return;

    for (let i = index; i < candidatos.length; i++) {
      if (candidatos[i].montoCents > remaining) continue;
      // Skip duplicates (same recnum)
      if (i > index && candidatos[i].montoCents === candidatos[i - 1].montoCents
          && candidatos[i].IJ_CCODE === candidatos[i - 1].IJ_CCODE) continue;

      current.push(candidatos[i]);
      backtrack(i + 1, remaining - candidatos[i].montoCents, current);
      current.pop();
    }
  }

  backtrack(0, targetCents, []);
  return resultado;
}

async function obtenerNombreCliente(codigo: string): Promise<string | null> {
  const rows = await softecQuery<{ IC_NAME: string }>(
    'SELECT IC_NAME FROM v_cobr_icust WHERE IC_CODE = ? LIMIT 1',
    [codigo]
  );
  return rows.length > 0 ? String(rows[0].IC_NAME).trim() : null;
}

async function aprenderCuenta(
  cuentaOrigen: string,
  descripcion: string,
  codigoCliente: string,
  nombreCliente: string | null
): Promise<void> {
  try {
    const existente = await cobranzasQuery<{ id: number }>(
      'SELECT id FROM cobranza_cuentas_aprendizaje WHERE cuenta_origen = ?',
      [cuentaOrigen]
    );

    if (existente.length > 0) {
      await cobranzasExecute(
        `UPDATE cobranza_cuentas_aprendizaje
         SET veces_usado = veces_usado + 1,
             ultima_vez_visto = NOW(),
             confianza = IF(veces_usado >= 2, 'AUTO', confianza)
         WHERE id = ?`,
        [existente[0].id]
      );
    } else {
      await cobranzasExecute(
        `INSERT INTO cobranza_cuentas_aprendizaje
           (cuenta_origen, nombre_origen, codigo_cliente, nombre_cliente, confianza, confirmado_por)
         VALUES (?, ?, ?, ?, 'AUTO', 'sistema-conciliacion')`,
        [cuentaOrigen, descripcion.substring(0, 200), codigoCliente, nombreCliente || '']
      );
    }
  } catch {
    // No fallar la conciliación por error de aprendizaje
  }
}
