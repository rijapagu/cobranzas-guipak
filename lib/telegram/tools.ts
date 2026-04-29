import Anthropic from '@anthropic-ai/sdk';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';

/**
 * Definición de herramientas que Claude puede invocar desde el bot de Telegram.
 * Patrón inspirado en Agente Inventario (bot.py + tools.py).
 */

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'consultar_saldo_cliente',
    description:
      'Devuelve el aging detallado de un cliente: facturas vencidas con días vencido, saldo y segmento. Buscar por código de cliente o por nombre parcial.',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código de cliente (ej. "0000274") o parte del nombre',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'estado_cobros_hoy',
    description:
      'Resumen ad-hoc del estado actual de cobros: cartera total, distribución por segmento, alertas activas, mensajes pendientes de aprobación, promesas que vencen hoy.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'listar_pendientes_aprobacion',
    description:
      'Lista los mensajes generados por la IA que están esperando aprobación humana antes de enviarse al cliente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limite: {
          type: 'number',
          description: 'Cantidad máxima a listar (default 10)',
        },
      },
    },
  },
  {
    name: 'listar_promesas_vencidas',
    description:
      'Lista promesas de pago vencidas que no han sido cumplidas, ordenadas por días de retraso.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limite: {
          type: 'number',
          description: 'Cantidad máxima a listar (default 10)',
        },
      },
    },
  },
  {
    name: 'historial_conversaciones_cliente',
    description:
      'Devuelve las últimas conversaciones (WhatsApp/Email) intercambiadas con un cliente específico.',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: { type: 'string', description: 'Código del cliente en Softec' },
        limite: { type: 'number', description: 'Cantidad de mensajes a retornar (default 10)' },
      },
      required: ['codigo_cliente'],
    },
  },
  {
    name: 'buscar_cliente',
    description:
      'Busca clientes por nombre o código en Softec. Útil cuando el usuario menciona un cliente sin código exacto.',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: { type: 'string', description: 'Texto a buscar (nombre o código parcial)' },
      },
      required: ['termino'],
    },
  },
];

interface ResultadoTool {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export async function ejecutarTool(
  nombre: string,
  argumentos: Record<string, unknown>
): Promise<ResultadoTool> {
  try {
    switch (nombre) {
      case 'consultar_saldo_cliente':
        return await consultarSaldoCliente(String(argumentos.termino));

      case 'estado_cobros_hoy':
        return await estadoCobrosHoy();

      case 'listar_pendientes_aprobacion':
        return await listarPendientesAprobacion(Number(argumentos.limite) || 10);

      case 'listar_promesas_vencidas':
        return await listarPromesasVencidas(Number(argumentos.limite) || 10);

      case 'historial_conversaciones_cliente':
        return await historialConversacionesCliente(
          String(argumentos.codigo_cliente),
          Number(argumentos.limite) || 10
        );

      case 'buscar_cliente':
        return await buscarCliente(String(argumentos.termino));

      default:
        return { ok: false, error: `Tool desconocida: ${nombre}` };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =====================================================================
// Implementaciones
// =====================================================================

async function consultarSaldoCliente(termino: string): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'No hay conexión a Softec' };

  const esCodigo = /^\d+$/.test(termino.trim());
  const filtro = esCodigo ? 'c.IC_CODE = ?' : 'c.IC_NAME LIKE ?';
  const param = esCodigo ? termino.trim().padStart(7, '0') : `%${termino}%`;

  const facturas = await softecQuery<{
    codigo: string;
    cliente: string;
    factura: number;
    fecha_vence: Date;
    dias_vencida: number;
    monto_total: number;
    saldo: number;
  }>(
    `SELECT
      c.IC_CODE AS codigo,
      c.IC_NAME AS cliente,
      f.IJ_INUM AS factura,
      f.IJ_DUEDATE AS fecha_vence,
      DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencida,
      f.IJ_TOT AS monto_total,
      (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo
    FROM ijnl f
    INNER JOIN icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
    WHERE ${filtro}
      AND f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
      AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    ORDER BY f.IJ_DUEDATE ASC
    LIMIT 50`,
    [param]
  );

  if (facturas.length === 0) {
    return { ok: true, data: { mensaje: 'Cliente no tiene facturas pendientes', facturas: [] } };
  }

  const totalSaldo = facturas.reduce((sum, f) => sum + Number(f.saldo), 0);
  const cliente = String(facturas[0].cliente).trim();
  const codigo = String(facturas[0].codigo).trim();

  return {
    ok: true,
    data: {
      cliente,
      codigo,
      total_facturas: facturas.length,
      saldo_total: totalSaldo,
      facturas: facturas.map((f) => ({
        factura: f.factura,
        fecha_vence: new Date(f.fecha_vence).toISOString().split('T')[0],
        dias_vencida: Number(f.dias_vencida),
        saldo: Number(f.saldo),
      })),
    },
  };
}

async function estadoCobrosHoy(): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();

  let cartera_total = 0;
  let total_facturas = 0;
  let total_clientes = 0;
  const segmentos: Record<string, number> = { VERDE: 0, AMARILLO: 0, NARANJA: 0, ROJO: 0 };

  if (softecOk) {
    const seg = await softecQuery<{ segmento: string; num: number; saldo: number }>(`
      SELECT
        CASE
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1 AND 15 THEN 'AMARILLO'
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30 THEN 'ROJO'
          ELSE 'VERDE'
        END AS segmento,
        COUNT(*) AS num,
        SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo
      FROM ijnl f
      WHERE f.IJ_TYPEDOC='IN' AND f.IJ_INVTORF='T' AND f.IJ_PAID='F' AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      GROUP BY segmento
    `);
    for (const s of seg) {
      segmentos[s.segmento] = Number(s.num);
      total_facturas += Number(s.num);
      cartera_total += Number(s.saldo);
    }
    const tc = await softecQuery<{ total: number }>(
      `SELECT COUNT(DISTINCT IJ_CCODE) AS total FROM ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F' AND (IJ_TOT - IJ_TOTAPPL) > 0`
    );
    total_clientes = Number(tc[0]?.total) || 0;
  }

  const pendientes = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_gestiones WHERE estado='PENDIENTE'"
  );
  const promesasHoy = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE estado='PENDIENTE' AND fecha_prometida = CURDATE()"
  );
  const promesasVencidas = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE estado='PENDIENTE' AND fecha_prometida < CURDATE()"
  );

  return {
    ok: true,
    data: {
      cartera_total,
      total_facturas,
      total_clientes,
      por_segmento: segmentos,
      mensajes_pendientes_aprobacion: Number(pendientes[0]?.total) || 0,
      promesas_vencen_hoy: Number(promesasHoy[0]?.total) || 0,
      promesas_vencidas: Number(promesasVencidas[0]?.total) || 0,
    },
  };
}

async function listarPendientesAprobacion(limite: number): Promise<ResultadoTool> {
  const rows = await cobranzasQuery<{
    id: number;
    codigo_cliente: string;
    ij_inum: number;
    canal: string;
    saldo_pendiente: number;
    dias_vencida: number;
    segmento: string;
    created_at: string;
  }>(
    `SELECT id, codigo_cliente, ij_inum, canal, saldo_pendiente, dias_vencida, segmento, created_at
     FROM cobranza_gestiones
     WHERE estado='PENDIENTE'
     ORDER BY created_at ASC
     LIMIT ?`,
    [limite]
  );

  return {
    ok: true,
    data: {
      total: rows.length,
      mensajes: rows.map((r) => ({
        id: r.id,
        codigo_cliente: r.codigo_cliente,
        factura: r.ij_inum,
        canal: r.canal,
        saldo: Number(r.saldo_pendiente),
        dias_vencida: r.dias_vencida,
        segmento: r.segmento,
      })),
    },
  };
}

async function listarPromesasVencidas(limite: number): Promise<ResultadoTool> {
  const rows = await cobranzasQuery<{
    id: number;
    codigo_cliente: string;
    ij_inum: number;
    monto_prometido: number;
    fecha_prometida: string;
  }>(
    `SELECT id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida
     FROM cobranza_acuerdos
     WHERE estado='PENDIENTE' AND fecha_prometida < CURDATE()
     ORDER BY fecha_prometida ASC
     LIMIT ?`,
    [limite]
  );

  return {
    ok: true,
    data: {
      total: rows.length,
      promesas: rows.map((r) => ({
        id: r.id,
        codigo_cliente: r.codigo_cliente,
        factura: r.ij_inum,
        monto: Number(r.monto_prometido),
        fecha_prometida: r.fecha_prometida,
        dias_retraso: Math.floor(
          (Date.now() - new Date(r.fecha_prometida).getTime()) / 86400000
        ),
      })),
    },
  };
}

async function historialConversacionesCliente(
  codigoCliente: string,
  limite: number
): Promise<ResultadoTool> {
  const rows = await cobranzasQuery<{
    canal: string;
    direccion: string;
    contenido: string;
    created_at: string;
  }>(
    `SELECT canal, direccion, contenido, created_at
     FROM cobranza_conversaciones
     WHERE codigo_cliente = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [codigoCliente.padStart(7, '0'), limite]
  );

  return {
    ok: true,
    data: {
      codigo_cliente: codigoCliente,
      total: rows.length,
      conversaciones: rows.map((r) => ({
        canal: r.canal,
        direccion: r.direccion,
        contenido: r.contenido?.substring(0, 500),
        fecha: r.created_at,
      })),
    },
  };
}

async function buscarCliente(termino: string): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'Sin conexión a Softec' };

  const rows = await softecQuery<{
    codigo: string;
    nombre: string;
    saldo: number;
    facturas: number;
  }>(
    `SELECT
       c.IC_CODE AS codigo,
       c.IC_NAME AS nombre,
       COALESCE(SUM(f.IJ_TOT - f.IJ_TOTAPPL), 0) AS saldo,
       COUNT(f.IJ_INUM) AS facturas
     FROM icust c
     LEFT JOIN ijnl f ON f.IJ_CCODE = c.IC_CODE
       AND f.IJ_TYPEDOC='IN' AND f.IJ_INVTORF='T' AND f.IJ_PAID='F' AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
     WHERE c.IC_STATUS='A' AND (c.IC_NAME LIKE ? OR c.IC_CODE = ?)
     GROUP BY c.IC_CODE, c.IC_NAME
     ORDER BY saldo DESC
     LIMIT 15`,
    [`%${termino}%`, termino.padStart(7, '0')]
  );

  return {
    ok: true,
    data: {
      total: rows.length,
      clientes: rows.map((r) => ({
        codigo: String(r.codigo).trim(),
        nombre: String(r.nombre).trim(),
        saldo_pendiente: Number(r.saldo),
        facturas_pendientes: Number(r.facturas),
      })),
    },
  };
}
