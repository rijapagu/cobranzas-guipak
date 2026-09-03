/**
 * Memoria episodica (Fase 4): linea de tiempo de un cliente -- todo lo que le
 * paso, ordenado por fecha, cruzando las 7 tablas donde queda rastro de un
 * cliente. Para la tool linea_de_tiempo_cliente.
 *
 * Un UNION ALL (no 7 queries + merge en JS) para que el ORDER BY + LIMIT se
 * resuelvan en MySQL sobre el conjunto completo, no sobre 7 recortes parciales
 * que despues haya que volver a mezclar.
 */
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

export interface EventoLineaTiempo {
  fecha: string;
  tipo: 'GESTION' | 'CONVERSACION' | 'PROMESA' | 'CONCILIACION' | 'TAREA' | 'DISPUTA' | 'MENSAJE';
  resumen: string;
}

const FUENTES: { tabla: string; tipo: EventoLineaTiempo['tipo']; fecha: string; resumen: string }[] = [
  {
    tabla: 'cobranza_gestiones',
    tipo: 'GESTION',
    fecha: 'created_at',
    resumen: "CONCAT('Gestión #', id, ' (', canal, ') — ', estado, ' — factura ', ij_inum, ', RD$', FORMAT(saldo_pendiente, 2))",
  },
  {
    tabla: 'cobranza_conversaciones',
    tipo: 'CONVERSACION',
    fecha: 'created_at',
    resumen: "CONCAT(canal, ' ', direccion, ': ', LEFT(contenido, 150))",
  },
  {
    tabla: 'cobranza_acuerdos',
    tipo: 'PROMESA',
    fecha: 'created_at',
    resumen: "CONCAT('Promesa de pago: RD$', FORMAT(monto_prometido, 2), ' para el ', fecha_prometida, ' — ', estado)",
  },
  {
    tabla: 'cobranza_conciliacion',
    tipo: 'CONCILIACION',
    fecha: 'COALESCE(fecha_aprobacion, created_at)',
    resumen: "CONCAT('Depósito ', estado, ': RD$', FORMAT(monto, 2), ' (', LEFT(descripcion, 100), ')')",
  },
  {
    tabla: 'cobranza_tareas',
    tipo: 'TAREA',
    fecha: 'created_at',
    resumen: "CONCAT(cobranza_tareas.tipo, ': ', titulo, ' — ', estado)",
  },
  {
    tabla: 'cobranza_disputas',
    tipo: 'DISPUTA',
    fecha: 'created_at',
    resumen: "CONCAT('Disputa factura ', ij_inum, ': ', estado, ' — ', LEFT(motivo, 100))",
  },
  {
    tabla: 'cobranza_telegram_historial',
    tipo: 'MENSAJE',
    fecha: 'created_at',
    resumen: "CONCAT(rol, ': ', LEFT(contenido, 150))",
  },
];

export async function lineaDeTiempoCliente(
  codigo: string,
  opts: { desde?: string; hasta?: string; limite?: number; empresaId?: number } = {}
): Promise<EventoLineaTiempo[]> {
  const empresaId = opts.empresaId ?? EMPRESA_GUIPAK;
  const limite = Math.min(Math.max(opts.limite ?? 30, 1), 100);

  const subconsultas = FUENTES.map(
    (f) =>
      `SELECT ${f.fecha} AS fecha, '${f.tipo}' AS tipo, ${f.resumen} AS resumen
         FROM ${f.tabla} WHERE empresa_id = ? AND codigo_cliente = ?`
  ).join('\nUNION ALL\n');

  const params: (string | number)[] = [];
  for (let i = 0; i < FUENTES.length; i++) params.push(empresaId, codigo);

  let filtroFecha = '';
  if (opts.desde) {
    filtroFecha += ' AND DATE(fecha) >= ?';
    params.push(opts.desde);
  }
  if (opts.hasta) {
    filtroFecha += ' AND DATE(fecha) <= ?';
    params.push(opts.hasta);
  }
  params.push(limite);

  return cobranzasQuery<EventoLineaTiempo>(
    `SELECT * FROM (${subconsultas}) eventos
      WHERE 1=1${filtroFecha}
      ORDER BY fecha DESC
      LIMIT ?`,
    params
  );
}
