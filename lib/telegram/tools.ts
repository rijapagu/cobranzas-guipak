import Anthropic from '@anthropic-ai/sdk';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { proponerCorreoCliente } from './draft-correo';

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
  {
    name: 'crear_tarea',
    description:
      'Crea una tarea/recordatorio en el calendario del equipo. Úsala cuando el usuario diga "recuérdame", "agenda", "anota que mañana hay que...", "cliente me pidió que le llame el viernes". IMPORTANTE: la fecha debe pasarse en formato AAAA-MM-DD. Calcula la fecha tú mismo a partir de la fecha de hoy que aparece al inicio del system prompt. Confirma con el usuario después de crearla.',
    input_schema: {
      type: 'object' as const,
      properties: {
        titulo: { type: 'string', description: 'Título corto de la tarea' },
        fecha_vencimiento: {
          type: 'string',
          description: 'Fecha en formato AAAA-MM-DD (ej. "2026-05-09"). Calcula tú la fecha relativa.',
        },
        hora: {
          type: 'string',
          description: 'Hora opcional en formato HH:MM (24h, ej. "10:00"). Omite si no se mencionó.',
        },
        tipo: {
          type: 'string',
          enum: ['LLAMAR', 'DEPOSITAR_CHEQUE', 'SEGUIMIENTO', 'DOCUMENTO', 'REUNION', 'OTRO'],
          description: 'Categoría de la tarea',
        },
        codigo_cliente: {
          type: 'string',
          description: 'Código de cliente Softec (7 dígitos) si la tarea está relacionada a uno',
        },
        prioridad: {
          type: 'string',
          enum: ['BAJA', 'MEDIA', 'ALTA'],
          description: 'Prioridad (default MEDIA)',
        },
        descripcion: { type: 'string', description: 'Detalles opcionales' },
      },
      required: ['titulo', 'fecha_vencimiento'],
    },
  },
  {
    name: 'listar_tareas',
    description:
      'Lista tareas pendientes del equipo. Usa "rango" para filtrar: hoy, mañana, semana (próximos 7 días), atrasadas (vencidas no hechas), todas.',
    input_schema: {
      type: 'object' as const,
      properties: {
        rango: {
          type: 'string',
          enum: ['hoy', 'mañana', 'semana', 'atrasadas', 'todas'],
          description: 'Rango de fechas. Default "hoy".',
        },
        codigo_cliente: {
          type: 'string',
          description: 'Filtrar por cliente específico (opcional)',
        },
      },
    },
  },
  {
    name: 'marcar_tarea_hecha',
    description:
      'Marca una tarea como completada. Requiere el ID numérico de la tarea (lo obtienes de listar_tareas).',
    input_schema: {
      type: 'object' as const,
      properties: {
        tarea_id: { type: 'number', description: 'ID numérico de la tarea' },
        notas: { type: 'string', description: 'Notas opcionales del cierre' },
      },
      required: ['tarea_id'],
    },
  },
  {
    name: 'proponer_correo_cliente',
    description:
      'Genera un draft de correo de cobranza para un cliente y lo deja en cola PENDIENTE de aprobación. NO envía el correo. Devuelve el ID de gestión, el draft completo y los datos del cliente. El bot debe presentar este draft al usuario con botones para aprobar/editar/descartar (CP-02).',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código de cliente (ej. "0000274") o nombre parcial',
        },
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
  argumentos: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
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

      case 'crear_tarea':
        return await crearTarea(argumentos, ctx);

      case 'listar_tareas':
        return await listarTareas(argumentos);

      case 'marcar_tarea_hecha':
        return await marcarTareaHecha(argumentos, ctx);

      case 'proponer_correo_cliente': {
        const result = await proponerCorreoCliente(String(argumentos.termino));
        return { ok: result.ok, data: result };
      }

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
    FROM v_cobr_ijnl f
    INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
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
      FROM v_cobr_ijnl f
      WHERE f.IJ_TYPEDOC='IN' AND f.IJ_INVTORF='T' AND f.IJ_PAID='F' AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      GROUP BY segmento
    `);
    for (const s of seg) {
      segmentos[s.segmento] = Number(s.num);
      total_facturas += Number(s.num);
      cartera_total += Number(s.saldo);
    }
    const tc = await softecQuery<{ total: number }>(
      `SELECT COUNT(DISTINCT IJ_CCODE) AS total FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F' AND (IJ_TOT - IJ_TOTAPPL) > 0`
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
     FROM v_cobr_icust c
     LEFT JOIN v_cobr_ijnl f ON f.IJ_CCODE = c.IC_CODE
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

// =====================================================================
// Tareas
// =====================================================================

function validarFechaIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

async function crearTarea(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const titulo = String(args.titulo || '').trim();
  const fecha = String(args.fecha_vencimiento || '').trim();
  if (!titulo || titulo.length < 2) return { ok: false, error: 'Título inválido' };
  if (!validarFechaIso(fecha))
    return { ok: false, error: 'fecha_vencimiento debe ser AAAA-MM-DD' };

  const tipo = String(args.tipo || 'OTRO');
  const tiposValidos = ['LLAMAR', 'DEPOSITAR_CHEQUE', 'SEGUIMIENTO', 'DOCUMENTO', 'REUNION', 'OTRO'];
  const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'OTRO';

  const prioridad = String(args.prioridad || 'MEDIA');
  const prioridadFinal = ['BAJA', 'MEDIA', 'ALTA'].includes(prioridad) ? prioridad : 'MEDIA';

  const hora = args.hora ? String(args.hora) : null;
  const horaFinal = hora && /^\d{1,2}:\d{2}$/.test(hora) ? hora.padStart(5, '0') + ':00' : null;

  const codigoCliente = args.codigo_cliente ? String(args.codigo_cliente).padStart(7, '0') : null;
  const descripcion = args.descripcion ? String(args.descripcion) : null;
  const creadoPor = ctx?.userEmail || `telegram:${ctx?.userId || 'unknown'}`;

  const result = await cobranzasExecute(
    `INSERT INTO cobranza_tareas
     (titulo, descripcion, tipo, fecha_vencimiento, hora, codigo_cliente,
      prioridad, asignada_a, creado_por, origen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')`,
    [
      titulo,
      descripcion,
      tipoFinal,
      fecha,
      horaFinal,
      codigoCliente,
      prioridadFinal,
      creadoPor,
      creadoPor,
    ]
  );

  const id = (result as { insertId?: number }).insertId;
  await logAccion(ctx?.userId || null, 'TAREA_CREADA_BOT', 'tarea', String(id), {
    titulo,
    fecha,
    via: 'telegram',
  });

  return {
    ok: true,
    data: {
      id,
      titulo,
      fecha_vencimiento: fecha,
      hora: horaFinal,
      tipo: tipoFinal,
      prioridad: prioridadFinal,
      codigo_cliente: codigoCliente,
    },
  };
}

async function listarTareas(args: Record<string, unknown>): Promise<ResultadoTool> {
  const rango = String(args.rango || 'hoy');
  const codigoCliente = args.codigo_cliente ? String(args.codigo_cliente).padStart(7, '0') : null;

  let where = "estado IN ('PENDIENTE','EN_PROGRESO')";
  const params: (string | number)[] = [];

  if (rango === 'hoy') {
    where += ' AND fecha_vencimiento = CURDATE()';
  } else if (rango === 'mañana' || rango === 'manana') {
    where += ' AND fecha_vencimiento = DATE_ADD(CURDATE(), INTERVAL 1 DAY)';
  } else if (rango === 'semana') {
    where += ' AND fecha_vencimiento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)';
  } else if (rango === 'atrasadas') {
    where += ' AND fecha_vencimiento < CURDATE()';
  }
  // 'todas' → sin filtro fecha

  if (codigoCliente) {
    where += ' AND codigo_cliente = ?';
    params.push(codigoCliente);
  }

  const rows = await cobranzasQuery<{
    id: number;
    titulo: string;
    tipo: string;
    fecha_vencimiento: string;
    hora: string | null;
    codigo_cliente: string | null;
    prioridad: string;
    estado: string;
    asignada_a: string | null;
  }>(
    `SELECT id, titulo, tipo, fecha_vencimiento, hora, codigo_cliente,
            prioridad, estado, asignada_a
       FROM cobranza_tareas
      WHERE ${where}
      ORDER BY fecha_vencimiento ASC, hora IS NULL, hora ASC, prioridad DESC, id ASC
      LIMIT 50`,
    params
  );

  return {
    ok: true,
    data: {
      rango,
      total: rows.length,
      tareas: rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        tipo: r.tipo,
        fecha: typeof r.fecha_vencimiento === 'string'
          ? r.fecha_vencimiento.slice(0, 10)
          : new Date(r.fecha_vencimiento).toISOString().split('T')[0],
        hora: r.hora ? r.hora.slice(0, 5) : null,
        codigo_cliente: r.codigo_cliente,
        prioridad: r.prioridad,
        estado: r.estado,
        asignada_a: r.asignada_a,
      })),
    },
  };
}

async function marcarTareaHecha(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const id = Number(args.tarea_id);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'tarea_id inválido' };

  const existentes = await cobranzasQuery<{ id: number; titulo: string; estado: string }>(
    'SELECT id, titulo, estado FROM cobranza_tareas WHERE id = ?',
    [id]
  );
  if (existentes.length === 0) return { ok: false, error: 'Tarea no encontrada' };
  const t = existentes[0];
  if (t.estado === 'HECHA') return { ok: true, data: { id, mensaje: 'ya estaba HECHA' } };

  const cerradoPor = ctx?.userEmail || `telegram:${ctx?.userId || 'unknown'}`;
  const notas = args.notas ? String(args.notas) : null;

  await cobranzasExecute(
    `UPDATE cobranza_tareas
        SET estado='HECHA', completada_at=NOW(), completada_por=?, notas_completado=?
      WHERE id = ?`,
    [cerradoPor, notas, id]
  );

  await logAccion(ctx?.userId || null, 'TAREA_HECHA_BOT', 'tarea', String(id), { via: 'telegram' });

  return { ok: true, data: { id, titulo: t.titulo, mensaje: 'Marcada HECHA' } };
}
