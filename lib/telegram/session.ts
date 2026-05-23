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
 */
import { GuipakMemory } from '@guipak/memory';
import { cobranzasQuery } from '@/lib/db/cobranzas';

const SUPERVISOR = 'cobros';
const OBJECT_TYPE_CLIENTE = 'cliente';

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

export async function obtenerSesion(chatId: number): Promise<SesionChat | null> {
  try {
    const active = await memory.getActiveObject(SUPERVISOR, chatId);
    if (!active || active.objectType !== OBJECT_TYPE_CLIENTE) return null;
    return {
      codigo_cliente: active.objectId,
      nombre_cliente: active.objectLabel ?? active.objectId,
      ultimo_tema: active.lastTopic,
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
