/**
 * Acciones sobre una transacción de conciliación (asignar cliente a un
 * depósito DESCONOCIDO, aprobar un POR_APLICAR) ejecutadas por un humano —
 * pantalla de Conciliación o el agente conversacional de Telegram/web. Una
 * sola implementación para los dos caminos de entrada, mismo patrón que
 * lib/telegram/gestion-acciones.ts, para que CP-05/CP-08 no puedan divergir
 * entre la web y el chat.
 */
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

export interface ActorConciliacion {
  userId: string;
  userEmail: string;
}

export interface ResultadoAccionConciliacion {
  ok: boolean;
  mensaje: string;
}

export interface DepositoPendiente {
  id: number;
  estado: string;
  fecha_transaccion: string;
  descripcion: string;
  referencia: string | null;
  cuenta_origen: string | null;
  monto: number;
  moneda: string;
  archivo_origen: string;
  codigo_cliente: string | null;
}

interface DepositoMinimo {
  id: number;
  estado: string;
  cuenta_origen: string | null;
  monto: number;
  codigo_cliente: string | null;
}

async function depositoPorId(id: number, empresaId: number): Promise<DepositoMinimo | null> {
  const rows = await cobranzasQuery<DepositoMinimo>(
    'SELECT id, estado, cuenta_origen, monto, codigo_cliente FROM cobranza_conciliacion WHERE id = ? AND empresa_id = ?',
    [id, empresaId]
  );
  return rows[0] || null;
}

/** Último archivo cargado (por fecha de carga), para acotar listados al día. */
export async function ultimoExtracto(
  empresaId: number = EMPRESA_GUIPAK
): Promise<{ archivo: string; banco: string; fechaExtracto: string; cargadoAt: string } | null> {
  const rows = await cobranzasQuery<{
    archivo_origen: string;
    banco: string;
    fecha_extracto: string;
    cargado_at: string;
  }>(
    `SELECT archivo_origen, banco, fecha_extracto, MAX(created_at) AS cargado_at
     FROM cobranza_conciliacion
     WHERE empresa_id = ?
     GROUP BY archivo_origen, banco, fecha_extracto
     ORDER BY cargado_at DESC LIMIT 1`,
    [empresaId]
  );
  const r = rows[0];
  if (!r) return null;
  return { archivo: r.archivo_origen, banco: r.banco, fechaExtracto: r.fecha_extracto, cargadoAt: r.cargado_at };
}

export interface FiltroDepositos {
  estado?: 'DESCONOCIDO' | 'POR_APLICAR' | 'CHEQUE_DEVUELTO' | 'TODOS';
  /** Si true (default) y no se pasa `archivo`, acota al último extracto cargado. */
  soloUltimoExtracto?: boolean;
  archivo?: string;
  limite?: number;
  empresaId?: number;
}

/** Depósitos que necesitan una decisión humana: sin dueño, por aplicar, o cheques devueltos. */
export async function listarDepositosPendientes(
  opts: FiltroDepositos = {}
): Promise<DepositoPendiente[]> {
  const empresaId = opts.empresaId ?? EMPRESA_GUIPAK;
  const estado = opts.estado ?? 'TODOS';
  const limite = Math.min(Math.max(opts.limite ?? 20, 1), 50);

  let archivo = opts.archivo;
  if (!archivo && (opts.soloUltimoExtracto ?? true)) {
    archivo = (await ultimoExtracto(empresaId))?.archivo;
  }

  const condiciones = ['empresa_id = ?'];
  const params: (string | number)[] = [empresaId];

  if (estado === 'TODOS') {
    condiciones.push("estado IN ('DESCONOCIDO','POR_APLICAR','CHEQUE_DEVUELTO')");
  } else {
    condiciones.push('estado = ?');
    params.push(estado);
  }
  if (archivo) {
    condiciones.push('archivo_origen = ?');
    params.push(archivo);
  }
  params.push(limite);

  return cobranzasQuery<DepositoPendiente>(
    `SELECT id, estado, fecha_transaccion, descripcion, referencia, cuenta_origen, monto, moneda, archivo_origen, codigo_cliente
     FROM cobranza_conciliacion
     WHERE ${condiciones.join(' AND ')}
     ORDER BY monto DESC
     LIMIT ?`,
    params
  );
}

/**
 * DESCONOCIDO → POR_APLICAR. Movido literal de
 * app/api/conciliacion/[id]/asignar-cliente/route.ts — misma lógica exacta
 * (CP-05: la cuenta nace MANUAL, sube a AUTO tras 2 usos), para que la web y
 * el chat no puedan divergir. `nombreCliente` se guarda tal cual lo pase el
 * caller (la web deja que la persona lo escriba; el chat debe resolverlo
 * contra Softec antes de llamar esto — ver asignarDepositoTool en tools.ts).
 */
export async function asignarClienteADeposito(
  id: number,
  codigoCliente: string,
  nombreCliente: string,
  actor: ActorConciliacion,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoAccionConciliacion> {
  const deposito = await depositoPorId(id, empresaId);
  if (!deposito) return { ok: false, mensaje: `Depósito ${id} no encontrado.` };
  if (deposito.estado !== 'DESCONOCIDO') {
    return { ok: false, mensaje: `El depósito ${id} ya está en estado ${deposito.estado}, no en DESCONOCIDO.` };
  }

  await cobranzasExecute(
    'UPDATE cobranza_conciliacion SET codigo_cliente = ?, estado = ?, aprobado_por = ? WHERE id = ? AND empresa_id = ?',
    [codigoCliente, 'POR_APLICAR', actor.userEmail, id, empresaId]
  );

  // CP-05: registrar/actualizar el aprendizaje cuenta→cliente. Nace MANUAL
  // siempre; solo sube a AUTO tras 2 confirmaciones humanas.
  const cuentaOrigen = deposito.cuenta_origen;
  if (cuentaOrigen) {
    const existente = await cobranzasQuery<{ id: number; veces_usado: number }>(
      'SELECT id, veces_usado FROM cobranza_cuentas_aprendizaje WHERE empresa_id = ? AND cuenta_origen = ?',
      [empresaId, cuentaOrigen]
    );
    if (existente.length > 0) {
      await cobranzasExecute(
        "UPDATE cobranza_cuentas_aprendizaje SET veces_usado = veces_usado + 1, ultima_vez_visto = NOW(), confianza = CASE WHEN veces_usado >= 2 THEN 'AUTO' ELSE confianza END WHERE id = ?",
        [existente[0].id]
      );
    } else {
      await cobranzasExecute(
        `INSERT INTO cobranza_cuentas_aprendizaje
         (empresa_id, cuenta_origen, nombre_origen, codigo_cliente, nombre_cliente, confianza, confirmado_por)
         VALUES (?, ?, ?, ?, ?, 'MANUAL', ?)`,
        [empresaId, cuentaOrigen, cuentaOrigen, codigoCliente, nombreCliente, actor.userEmail]
      );
    }
  }

  await logAccion(actor.userId, 'CUENTA_ASIGNADA', 'conciliacion', String(id), {
    cuenta_origen: cuentaOrigen,
    codigo_cliente: codigoCliente,
    nombre_cliente: nombreCliente,
    monto: Number(deposito.monto),
  });

  return {
    ok: true,
    mensaje: `Depósito ${id} asignado a ${nombreCliente} (${codigoCliente}) — queda POR APLICAR.`,
  };
}

/**
 * POR_APLICAR → CONCILIADO. Movido literal de
 * app/api/conciliacion/[id]/aprobar/route.ts.
 */
export async function aprobarDeposito(
  id: number,
  actor: ActorConciliacion,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoAccionConciliacion> {
  const deposito = await depositoPorId(id, empresaId);
  if (!deposito) return { ok: false, mensaje: `Depósito ${id} no encontrado.` };
  if (deposito.estado !== 'POR_APLICAR') {
    return { ok: false, mensaje: `El depósito ${id} ya está en estado ${deposito.estado}, no en POR_APLICAR.` };
  }

  await logAccion(actor.userId, 'CONCILIACION_APROBADA', 'conciliacion', String(id), {
    monto: Number(deposito.monto),
    cliente: deposito.codigo_cliente,
  });

  await cobranzasExecute(
    'UPDATE cobranza_conciliacion SET estado = ?, aprobado_por = ?, fecha_aprobacion = NOW() WHERE id = ? AND empresa_id = ?',
    ['CONCILIADO', actor.userEmail, id, empresaId]
  );

  return { ok: true, mensaje: `Depósito ${id} aprobado — queda CONCILIADO.` };
}
