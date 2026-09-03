/**
 * Listado y activación/desactivación de cadencias automáticas.
 * Extraído de app/api/cobranzas/cadencias/route.ts (solo la parte que
 * necesita la tool conversacional: listar y alternar activa). Crear/editar
 * los demás campos (segmento, día, acción, plantilla) sigue siendo solo-web
 * por ahora — el PUT de la ruta web ya hace su propio UPDATE parcial seguro
 * y no necesita pasar por aquí.
 */
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

export interface ActorCadencia {
  userId: string;
  userEmail: string;
}

export interface Cadencia {
  id: number;
  segmento: string;
  dia_desde_vencimiento: number;
  accion: string;
  requiere_aprobacion: boolean;
  plantilla_mensaje_id: number | null;
  activa: boolean;
}

export interface ResultadoAccionCadencia {
  ok: boolean;
  mensaje: string;
}

export async function listarCadencias(
  empresaId: number = EMPRESA_GUIPAK
): Promise<{ cadencias: Cadencia[]; ultimo_run: { created_at: string } | null }> {
  const rows = await cobranzasQuery<{
    id: number;
    segmento: string;
    dia_desde_vencimiento: number;
    accion: string;
    requiere_aprobacion: number;
    plantilla_mensaje_id: number | null;
    activa: number;
  }>(
    'SELECT id, segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id, activa FROM cobranza_cadencias WHERE empresa_id = ? ORDER BY dia_desde_vencimiento ASC, segmento ASC',
    [empresaId]
  );

  const ultimoRun = await cobranzasQuery<{ detalle: string; created_at: string }>(
    "SELECT detalle, created_at FROM cobranza_logs WHERE empresa_id = ? AND accion='CADENCIAS_HORARIAS' ORDER BY created_at DESC LIMIT 1",
    [empresaId]
  );

  return {
    cadencias: rows.map((c) => ({
      ...c,
      requiere_aprobacion: !!c.requiere_aprobacion,
      activa: !!c.activa,
    })),
    ultimo_run: ultimoRun[0] ? { created_at: ultimoRun[0].created_at } : null,
  };
}

export async function actualizarCadencia(
  id: number,
  activa: boolean,
  actor: ActorCadencia,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoAccionCadencia> {
  const result = await cobranzasExecute(
    'UPDATE cobranza_cadencias SET activa = ? WHERE id = ? AND empresa_id = ?',
    [activa ? 1 : 0, id, empresaId]
  );
  if (result.affectedRows === 0) return { ok: false, mensaje: `Cadencia ${id} no encontrada.` };

  await logAccion(actor.userId, 'CADENCIA_ACTUALIZADA', 'cadencia', String(id), { activa });
  return { ok: true, mensaje: `Cadencia ${id} ${activa ? 'activada' : 'desactivada'}.` };
}
