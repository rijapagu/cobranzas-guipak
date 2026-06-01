/**
 * Aplicar anticipos — Asistente Cobros tarea #8
 *
 * Cron diario (sugerido 7:45 AM AST) que detecta clientes con saldo a favor
 * (recibos sin aplicar en Softec) y crea tareas en /tareas para que el equipo
 * los aplique manualmente a sus facturas pendientes.
 *
 * Acuerdos con Ricardo 2026-06-01:
 * - Cubre los 58 clientes "Cubiertos por anticipo" detectados por CP-15.
 * - Tambien cubre clientes con saldo a favor parcial (menor al pendiente).
 * - Umbral minimo configurable (default RD$1,000) para evitar ruido por
 *   centavos.
 *
 * Idempotente: skip si ya hay tarea PENDIENTE/EN_PROGRESO con
 * origen='SALDO_FAVOR' origen_ref='saldo_favor:{codigo}'.
 *
 * Memoria: project_cobros_frontera_asistente_supervisor.md
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';

const UMBRAL_MINIMO_DOP = Number(process.env.SALDO_FAVOR_UMBRAL_MIN_DOP ?? 1000);

interface ClienteConPendiente {
  codigo_cliente: string;
  nombre_cliente: string;
  saldo_pendiente: number;
}

interface StatsAnticipos {
  con_saldo_favor: number;        // total clientes con saldo > umbral
  con_factura_pendiente: number;   // de esos, cuantos tienen factura abierta
  tareas_creadas_cubierto: number; // saldo_favor >= pendiente
  tareas_creadas_parcial_mayor: number; // 50% <= cobertura < 100%
  tareas_creadas_parcial_menor: number; // cobertura < 50%
  skip_ya_existe: number;
  skip_sin_pendiente: number;
  skip_softec_offline: number;
}

function clasificarCobertura(
  saldoFavor: number,
  saldoPendiente: number
): 'CUBIERTO' | 'PARCIAL_MAYOR' | 'PARCIAL_MENOR' {
  if (saldoFavor >= saldoPendiente) return 'CUBIERTO';
  const cobertura = saldoFavor / saldoPendiente;
  if (cobertura >= 0.5) return 'PARCIAL_MAYOR';
  return 'PARCIAL_MENOR';
}

function formatearMontoDOP(monto: number): string {
  return `RD$${monto.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

export async function ejecutarAplicarAnticipos(): Promise<StatsAnticipos> {
  const stats: StatsAnticipos = {
    con_saldo_favor: 0,
    con_factura_pendiente: 0,
    tareas_creadas_cubierto: 0,
    tareas_creadas_parcial_mayor: 0,
    tareas_creadas_parcial_menor: 0,
    skip_ya_existe: 0,
    skip_sin_pendiente: 0,
    skip_softec_offline: 0,
  };

  const softecOk = await testSoftecConnection();
  if (!softecOk) {
    stats.skip_softec_offline = 1;
    console.error('[aplicar-anticipos] Sin conexion a Softec, abortando');
    return stats;
  }

  // Cargar todos los clientes con saldo a favor (sin filtros = todos).
  const saldosFavor = await obtenerSaldoAFavorPorCliente();

  // Filtrar por umbral minimo
  const codigosConSaldoSignificativo = [...saldosFavor.entries()]
    .filter(([, monto]) => monto >= UMBRAL_MINIMO_DOP)
    .map(([codigo]) => codigo);

  stats.con_saldo_favor = codigosConSaldoSignificativo.length;
  if (codigosConSaldoSignificativo.length === 0) return stats;

  // Idempotencia: cargar tareas SALDO_FAVOR activas para estos clientes en una sola query
  const refsBuscadas = codigosConSaldoSignificativo.map((c) => `saldo_favor:${c}`);
  const placeholdersRefs = refsBuscadas.map(() => '?').join(',');
  const tareasExistentes = await cobranzasQuery<{ origen_ref: string }>(
    `SELECT origen_ref
     FROM cobranza_tareas
     WHERE origen='SALDO_FAVOR'
       AND origen_ref IN (${placeholdersRefs})
       AND estado IN ('PENDIENTE','EN_PROGRESO')`,
    refsBuscadas
  );
  const yaConTarea = new Set(tareasExistentes.map((t) => t.origen_ref));

  // Filtrar codigos que ya tienen tarea activa
  const codigosNuevos = codigosConSaldoSignificativo.filter((c) => {
    if (yaConTarea.has(`saldo_favor:${c}`)) {
      stats.skip_ya_existe++;
      return false;
    }
    return true;
  });

  if (codigosNuevos.length === 0) return stats;

  // Para esos codigos, obtener nombre y pendiente bruto desde Softec en una sola query.
  // Solo nos interesan clientes con factura pendiente actual — los que no tienen
  // pendiente no requieren aplicacion inmediata (su anticipo se aplicara al
  // proximo movimiento).
  const placeholdersCodigos = codigosNuevos.map(() => '?').join(',');
  const filasClientes = await softecQuery<{
    codigo_cliente: string;
    nombre_cliente: string;
    saldo_pendiente: string | number;
  }>(
    `SELECT
       c.IC_CODE                       AS codigo_cliente,
       c.IC_NAME                       AS nombre_cliente,
       SUM(f.IJ_TOT - f.IJ_TOTAPPL)    AS saldo_pendiente
     FROM v_cobr_icust c
     LEFT JOIN v_cobr_ijnl f
       ON  f.IJ_CCODE = c.IC_CODE
       AND f.IJ_TYPEDOC = 'IN'
       AND f.IJ_INVTORF = 'T'
       AND f.IJ_PAID = 'F'
       AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
     WHERE c.IC_CODE IN (${placeholdersCodigos}) AND c.IC_STATUS = 'A'
     GROUP BY c.IC_CODE, c.IC_NAME`,
    codigosNuevos
  );

  const clientesPorCodigo = new Map<string, ClienteConPendiente>();
  for (const f of filasClientes) {
    const codigo = String(f.codigo_cliente).trim();
    clientesPorCodigo.set(codigo, {
      codigo_cliente: codigo,
      nombre_cliente: String(f.nombre_cliente).trim(),
      saldo_pendiente: Number(f.saldo_pendiente) || 0,
    });
  }

  for (const codigo of codigosNuevos) {
    const cliente = clientesPorCodigo.get(codigo);
    if (!cliente) {
      // Cliente no encontrado / inactivo / sin factura abierta
      stats.skip_sin_pendiente++;
      continue;
    }
    if (cliente.saldo_pendiente <= 0) {
      stats.skip_sin_pendiente++;
      continue;
    }

    stats.con_factura_pendiente++;

    const saldoFavor = saldosFavor.get(codigo) || 0;
    const ajuste = ajustarSaldoCliente(cliente.saldo_pendiente, saldoFavor);
    const cobertura = clasificarCobertura(saldoFavor, cliente.saldo_pendiente);

    let titulo = '';
    let descripcion = '';
    let prioridad: 'ALTA' | 'MEDIA' = 'MEDIA';

    switch (cobertura) {
      case 'CUBIERTO':
        titulo = `Aplicar anticipo (cubre toda la deuda) — ${cliente.nombre_cliente}`;
        descripcion =
          `Cliente ${cliente.nombre_cliente} (${codigo}) tiene anticipos sin aplicar por ` +
          `${formatearMontoDOP(saldoFavor)} que CUBREN POR COMPLETO su saldo pendiente de ` +
          `${formatearMontoDOP(cliente.saldo_pendiente)}.\n\n` +
          `Saldo neto despues de aplicar: ${formatearMontoDOP(ajuste.saldo_neto)}\n\n` +
          `Accion en Softec:\n` +
          `1. Identificar los recibos sin aplicar (RC) de este cliente.\n` +
          `2. Aplicarlos a las facturas pendientes mas antiguas primero.\n` +
          `3. Marcar tarea HECHA cuando termine.\n\n` +
          `Este cliente esta hoy en el "set CP-15" y NO recibe cobranza hasta que se aplique.`;
        prioridad = 'ALTA';
        stats.tareas_creadas_cubierto++;
        break;

      case 'PARCIAL_MAYOR':
        titulo = `Aplicar anticipo (cubre >50%) — ${cliente.nombre_cliente}`;
        descripcion =
          `Cliente ${cliente.nombre_cliente} (${codigo}) tiene anticipos sin aplicar por ` +
          `${formatearMontoDOP(saldoFavor)} sobre un saldo pendiente de ` +
          `${formatearMontoDOP(cliente.saldo_pendiente)}.\n\n` +
          `Aplicacion reduce el pendiente real a: ${formatearMontoDOP(ajuste.saldo_neto)}\n` +
          `(${Math.round((saldoFavor / cliente.saldo_pendiente) * 100)}% de cobertura)\n\n` +
          `Accion en Softec:\n` +
          `1. Aplicar los recibos RC a las facturas mas antiguas.\n` +
          `2. La cadencia automatica trabajara contra el saldo NETO real.\n` +
          `3. Marcar tarea HECHA cuando termine.`;
        prioridad = 'MEDIA';
        stats.tareas_creadas_parcial_mayor++;
        break;

      case 'PARCIAL_MENOR':
        titulo = `Aplicar anticipo (parcial) — ${cliente.nombre_cliente}`;
        descripcion =
          `Cliente ${cliente.nombre_cliente} (${codigo}) tiene anticipos sin aplicar por ` +
          `${formatearMontoDOP(saldoFavor)} sobre un saldo pendiente de ` +
          `${formatearMontoDOP(cliente.saldo_pendiente)} (cobertura ` +
          `${Math.round((saldoFavor / cliente.saldo_pendiente) * 100)}%).\n\n` +
          `Aplicacion reduce el pendiente real a: ${formatearMontoDOP(ajuste.saldo_neto)}\n\n` +
          `Accion en Softec:\n` +
          `1. Aplicar los recibos RC. Aunque sea parcial, la cifra es real.\n` +
          `2. La diferencia sigue siendo cobrable por cadencia normal.\n` +
          `3. Marcar tarea HECHA cuando termine.`;
        prioridad = 'MEDIA';
        stats.tareas_creadas_parcial_menor++;
        break;
    }

    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente,
          prioridad, asignada_a, creado_por, origen, origen_ref)
       VALUES (?, ?, 'DOCUMENTO', CURDATE(), ?, ?, 'sistema',
               'cron-aplicar-anticipos', 'SALDO_FAVOR', ?)`,
      [
        titulo,
        descripcion,
        codigo,
        prioridad,
        `saldo_favor:${codigo}`,
      ]
    );
  }

  return stats;
}
