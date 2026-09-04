/**
 * Disputas de factura — listado, creación y transiciones de estado.
 * Extraído de las rutas web (app/api/cobranzas/disputas/*) para compartirlo
 * con las tools conversacionales (listar_disputas/crear_disputa/resolver_disputa),
 * mismo patrón que lib/telegram/gestion-acciones.ts: una sola implementación
 * para que la web y el chat no puedan divergir.
 *
 * CP-03: una factura con disputa ABIERTA o EN_REVISION queda excluida de la
 * cobranza automática mientras dure.
 */
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

export interface ActorDisputa {
  userId: string;
  userEmail: string;
}

export interface Disputa {
  id: number;
  codigo_cliente: string;
  nombre_cliente: string;
  ij_inum: number;
  motivo: string;
  monto_disputado: number | null;
  estado: string;
  resolucion: string | null;
  resuelto_por: string | null;
  fecha_resolucion: string | null;
  registrado_por: string;
  created_at: string;
}

export interface ResultadoAccionDisputa {
  ok: boolean;
  mensaje: string;
  id?: number;
}

export async function listarDisputas(
  opts: {
    estado?: 'ABIERTA' | 'EN_REVISION' | 'RESUELTA' | 'ANULADA';
    codigoCliente?: string;
    limite?: number;
    empresaId?: number;
  } = {}
): Promise<Disputa[]> {
  const empresaId = opts.empresaId ?? EMPRESA_GUIPAK;
  const where = ['d.empresa_id = ?'];
  const params: (string | number)[] = [empresaId];
  if (opts.estado) {
    where.push('d.estado = ?');
    params.push(opts.estado);
  }
  if (opts.codigoCliente) {
    where.push('d.codigo_cliente = ?');
    params.push(opts.codigoCliente);
  }
  const limite = Math.min(Math.max(opts.limite ?? 20, 1), 50);

  // LIMIT como literal, no como parámetro: mysql2/prepared statements
  // rechaza "LIMIT ?" en este servidor con "Incorrect arguments to
  // mysqld_stmt_execute" (2026-09-04) -- `limite` ya está acotado arriba.
  const rows = await cobranzasQuery<Omit<Disputa, 'nombre_cliente'>>(
    `SELECT d.id, d.codigo_cliente, d.ij_inum, d.motivo, d.monto_disputado, d.estado,
            d.resolucion, d.resuelto_por, d.fecha_resolucion, d.registrado_por, d.created_at
       FROM cobranza_disputas d
      WHERE ${where.join(' AND ')}
      ORDER BY FIELD(d.estado, 'ABIERTA','EN_REVISION','RESUELTA','ANULADA'), d.created_at DESC
      LIMIT ${limite}`,
    params
  );

  // Nombres desde el ERP (best-effort, igual que la ruta web).
  let nombresPorCodigo: Record<string, string> = {};
  const codigos = [...new Set(rows.map((d) => d.codigo_cliente))];
  if (codigos.length > 0) {
    try {
      const adapter = await adaptadorParaEmpresa(empresaId);
      const clientes = await adapter.clientes();
      const buscados = new Set(codigos.map((c) => String(c).trim()));
      nombresPorCodigo = Object.fromEntries(
        clientes.filter((c) => buscados.has(c.codigo)).map((c) => [c.codigo, c.nombre])
      );
    } catch {
      // ERP no disponible — sigue sin nombres
    }
  }

  return rows.map((d) => ({
    ...d,
    monto_disputado: d.monto_disputado != null ? Number(d.monto_disputado) : null,
    nombre_cliente: nombresPorCodigo[d.codigo_cliente.trim()] || d.codigo_cliente,
  }));
}

export async function crearDisputa(
  datos: { codigoCliente: string; ijInum: number; motivo: string; montoDisputado?: number | null },
  actor: ActorDisputa,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoAccionDisputa> {
  if (datos.motivo.trim().length < 5) {
    return { ok: false, mensaje: 'El motivo debe tener al menos 5 caracteres.' };
  }
  const result = await cobranzasExecute(
    `INSERT INTO cobranza_disputas (empresa_id, codigo_cliente, ij_inum, motivo, monto_disputado, registrado_por)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [empresaId, datos.codigoCliente, datos.ijInum, datos.motivo.trim(), datos.montoDisputado ?? null, actor.userEmail]
  );
  const id = result.insertId;

  await logAccion(actor.userId, 'DISPUTA_CREADA', 'disputa', String(id), {
    codigo_cliente: datos.codigoCliente,
    ij_inum: datos.ijInum,
    motivo: datos.motivo.slice(0, 100),
  });

  return { ok: true, mensaje: `Disputa ${id} abierta para la factura ${datos.ijInum}.`, id };
}

const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  ABIERTA: ['EN_REVISION', 'ANULADA'],
  EN_REVISION: ['RESUELTA', 'ANULADA'],
};

/** ABIERTA→EN_REVISION|ANULADA · EN_REVISION→RESUELTA(requiere resolución)|ANULADA. RESUELTA/ANULADA son finales. */
export async function actualizarDisputa(
  id: number,
  cambios: { estado: 'EN_REVISION' | 'RESUELTA' | 'ANULADA'; resolucion?: string },
  actor: ActorDisputa,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoAccionDisputa> {
  const rows = await cobranzasQuery<{ estado: string }>(
    'SELECT estado FROM cobranza_disputas WHERE id = ? AND empresa_id = ?',
    [id, empresaId]
  );
  const actual = rows[0];
  if (!actual) return { ok: false, mensaje: `Disputa ${id} no encontrada.` };
  if (actual.estado === 'RESUELTA' || actual.estado === 'ANULADA') {
    return { ok: false, mensaje: `La disputa ${id} ya está ${actual.estado} — no se puede modificar.` };
  }
  if (!TRANSICIONES_VALIDAS[actual.estado]?.includes(cambios.estado)) {
    return { ok: false, mensaje: `Transición inválida: ${actual.estado} → ${cambios.estado}.` };
  }
  if (cambios.estado === 'RESUELTA' && !cambios.resolucion) {
    return { ok: false, mensaje: 'Para resolver una disputa hace falta indicar la resolución.' };
  }

  const updates = ['estado = ?'];
  const values: (string | number)[] = [cambios.estado];
  if (cambios.estado === 'RESUELTA') {
    updates.push('resolucion = ?', 'resuelto_por = ?', 'fecha_resolucion = NOW()');
    values.push(cambios.resolucion!, actor.userEmail);
  } else if (cambios.estado === 'ANULADA') {
    updates.push('resuelto_por = ?', 'fecha_resolucion = NOW()');
    values.push(actor.userEmail);
    if (cambios.resolucion) {
      updates.push('resolucion = ?');
      values.push(cambios.resolucion);
    }
  }
  values.push(id);

  await cobranzasExecute(`UPDATE cobranza_disputas SET ${updates.join(', ')} WHERE id = ?`, values);

  await logAccion(actor.userId, `DISPUTA_${cambios.estado}`, 'disputa', String(id), {
    estado_anterior: actual.estado,
    estado_nuevo: cambios.estado,
  });

  return { ok: true, mensaje: `Disputa ${id} pasó a ${cambios.estado}.` };
}
