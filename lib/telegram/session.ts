/**
 * Capa 1 de la arquitectura de inteligencia:
 * Estado de sesion — "de que cliente estamos hablando ahora mismo".
 *
 * Backend: MySQL via @guipak/memory (tabla agent_session).
 * Reemplaza la version Redis-only previa que se perdia silenciosamente con
 * TTL/crashes. El API publico (SesionChat, obtenerSesion, guardarSesion,
 * limpiarSesion) se mantiene identico — los callers no cambian.
 *
 * El supervisor es 'cobros' (constante) y el object_type es 'cliente'.
 * codigo_cliente <-> object_id, nombre_cliente <-> object_label,
 * ultimo_tema <-> last_topic.
 *
 * TTL (2026-09-03): `agent_session` NUNCA caducaba — ni por tiempo ni por
 * ningun caller (limpiarSesion existia pero nadie la llamaba). Un cliente
 * consultado hace semanas quedaba "activo" para siempre en ese chat, y el
 * prompt ordena tratar cualquier pregunta ambigua como referida a ese
 * cliente. Confirmado en produccion: una sesion de junio respondio a una
 * pregunta de cartera completa de septiembre con el saldo de ese cliente
 * viejo. `obtenerSesion` ahora lee `updated_at` directo (GuipakMemory no lo
 * expone) y descarta la sesion si esta mas vieja que el TTL — mas corto en
 * el grupo, que es compartido por todo el equipo.
 */
import { GuipakMemory } from '@guipak/memory';
import { cobranzasQuery } from '@/lib/db/cobranzas';

const SUPERVISOR = 'cobros';
const OBJECT_TYPE_CLIENTE = 'cliente';

const TTL_PRIVADO_MIN = Number(process.env.SESION_TTL_MINUTOS) || 120;
const TTL_GRUPO_MIN = Number(process.env.SESION_TTL_GRUPO_MINUTOS) || 30;

export interface SesionChat {
  codigo_cliente: string;
  nombre_cliente: string;
  ultimo_tema?: string;
}

// Adapter minimo que GuipakMemory necesita. Usa los helpers existentes de
// lib/db/cobranzas en vez de exponer el pool — manteniendo encapsulado el
// pool global.
const mysqlAdapter = {
  async execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]> {
    const rows = await cobranzasQuery(
      sql,
      (params ?? []) as (string | number | boolean | null | Date)[]
    );
    return [rows, undefined];
  },
};

const memory = new GuipakMemory({ mysql: mysqlAdapter });

function ttlMinutosParaChat(chatId: number): number {
  const chatIdGrupo = process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS;
  const esGrupo = chatIdGrupo != null && chatIdGrupo !== '' && String(chatId) === chatIdGrupo;
  return esGrupo ? TTL_GRUPO_MIN : TTL_PRIVADO_MIN;
}

export async function obtenerSesion(chatId: number): Promise<SesionChat | null> {
  try {
    // Lectura directa (no via GuipakMemory) porque ActiveObject no expone
    // updated_at y lo necesitamos para el TTL.
    const rows = await cobranzasQuery<{
      object_type: string;
      object_id: string;
      object_label: string | null;
      last_topic: string | null;
      updated_at: string;
    }>(
      'SELECT object_type, object_id, object_label, last_topic, updated_at FROM agent_session WHERE supervisor = ? AND chat_id = ?',
      [SUPERVISOR, chatId]
    );
    const row = rows[0];
    if (!row || row.object_type !== OBJECT_TYPE_CLIENTE || !row.object_id) return null;

    const minutosInactivo = (Date.now() - new Date(row.updated_at).getTime()) / 60_000;
    if (minutosInactivo > ttlMinutosParaChat(chatId)) {
      await limpiarSesion(chatId);
      return null;
    }

    return {
      codigo_cliente: row.object_id,
      nombre_cliente: row.object_label ?? row.object_id,
      ultimo_tema: row.last_topic ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function guardarSesion(chatId: number, sesion: SesionChat): Promise<void> {
  try {
    await memory.setActiveObject(SUPERVISOR, chatId, {
      objectType: OBJECT_TYPE_CLIENTE,
      objectId: sesion.codigo_cliente,
      objectLabel: sesion.nombre_cliente,
      lastTopic: sesion.ultimo_tema,
    });
  } catch {
    // sesion es best-effort, nunca bloquea la respuesta
  }
}

export async function limpiarSesion(chatId: number): Promise<void> {
  try {
    await memory.clearActiveObject(SUPERVISOR, chatId);
  } catch { /* ignorar */ }
}
