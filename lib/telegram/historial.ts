import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente';
  contenido: string;
}

/**
 * codigoCliente etiqueta el mensaje con la sesion activa en ese momento
 * (Fase 4, memoria episodica) -- permite buscarHistorial({codigoCliente})
 * y linea_de_tiempo_cliente sin tener que adivinar de que cliente se hablaba
 * despues del hecho. Null si no habia sesion activa (pregunta de cartera
 * completa, saludo, etc).
 */
export async function guardarMensaje(
  chatId: number,
  telegramUserId: number,
  rol: 'usuario' | 'asistente',
  contenido: string,
  codigoCliente?: string | null
): Promise<void> {
  await cobranzasExecute(
    'INSERT INTO cobranza_telegram_historial (empresa_id, chat_id, telegram_user_id, rol, contenido, codigo_cliente) VALUES (1, ?, ?, ?, ?, ?)',
    [chatId, telegramUserId, rol, contenido, codigoCliente ?? null]
  );
}

export interface ResultadoBusquedaHistorial {
  rol: 'usuario' | 'asistente';
  contenido: string;
  codigo_cliente: string | null;
  chat_id: number;
  created_at: string;
}

/**
 * Busqueda de memoria episodica. `chatIds` es obligatorio y lo decide quien
 * llama (la tool recordar_conversaciones), no esta funcion -- asi el permiso
 * de "solo el grupo + tu propio chat, nunca privados ajenos" queda donde se
 * conoce la identidad de quien pregunta, no enterrado aqui.
 *
 * termino con 3+ caracteres usa FULLTEXT BOOLEAN MODE (busca cada palabra
 * como prefijo, todas requeridas); con menos de 3 usa LIKE, porque InnoDB
 * ignora tokens mas cortos que innodb_ft_min_token_size (default 3) al
 * indexar -- una palabra de 1-2 letras nunca va a matchear via FULLTEXT.
 */
export async function buscarHistorial(opts: {
  termino?: string;
  codigoCliente?: string;
  desde?: string;
  hasta?: string;
  chatIds: number[];
  limite?: number;
  empresaId?: number;
}): Promise<ResultadoBusquedaHistorial[]> {
  if (opts.chatIds.length === 0) return [];
  const empresaId = opts.empresaId ?? 1;

  const where: string[] = ['empresa_id = ?', `chat_id IN (${opts.chatIds.map(() => '?').join(',')})`];
  const params: (string | number)[] = [empresaId, ...opts.chatIds];

  if (opts.codigoCliente) {
    where.push('codigo_cliente = ?');
    params.push(opts.codigoCliente);
  }
  if (opts.desde) {
    where.push('DATE(created_at) >= ?');
    params.push(opts.desde);
  }
  if (opts.hasta) {
    where.push('DATE(created_at) <= ?');
    params.push(opts.hasta);
  }

  const termino = opts.termino?.trim();
  if (termino && termino.length >= 3) {
    const booleano = termino
      .split(/\s+/)
      .filter(Boolean)
      .map((palabra) => `+${palabra.replace(/[+\-<>()~*"@]/g, '')}*`)
      .join(' ');
    if (booleano) {
      where.push('MATCH(contenido) AGAINST (? IN BOOLEAN MODE)');
      params.push(booleano);
    }
  } else if (termino) {
    where.push('contenido LIKE ?');
    params.push(`%${termino}%`);
  }

  const limite = Math.min(Math.max(opts.limite ?? 15, 1), 50);
  params.push(limite);

  return cobranzasQuery<ResultadoBusquedaHistorial>(
    `SELECT rol, contenido, codigo_cliente, chat_id, created_at
       FROM cobranza_telegram_historial
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?`,
    params
  );
}

export async function cargarHistorial(chatId: number, limite = 30): Promise<MensajeHistorial[]> {
  // Carga los últimos N mensajes ordenados por fecha DESC, luego invierte para Claude
  const rows = await cobranzasQuery<{ rol: string; contenido: string }>(
    `SELECT rol, contenido FROM (
       SELECT rol, contenido, created_at
         FROM cobranza_telegram_historial
        WHERE empresa_id = 1 AND chat_id = ?
        ORDER BY created_at DESC
        LIMIT ?
     ) sub ORDER BY created_at ASC`,
    [chatId, limite]
  );
  return rows.map((r) => ({
    rol: r.rol as 'usuario' | 'asistente',
    contenido: r.contenido,
  }));
}

/**
 * Por usuario_id (2026-09-03), no por telegram_user_id — el widget web usa
 * telegram_user_id=0 para todos, así que buscar por eso colapsaba las
 * preferencias de todo el mundo en un solo balde. `ambito='EQUIPO'` son
 * reglas compartidas explícitas (ver migración 034); esas se ven siempre,
 * además de las propias de `usuarioId`.
 */
export async function cargarMemoriaEquipo(
  usuarioId: number
): Promise<{ clave: string; valor: string }[]> {
  return cobranzasQuery<{ clave: string; valor: string }>(
    "SELECT clave, valor FROM cobranza_telegram_memoria_equipo WHERE empresa_id = 1 AND (usuario_id = ? OR ambito = 'EQUIPO') ORDER BY updated_at DESC",
    [usuarioId]
  );
}

/**
 * `telegramUserId` se conserva solo para auditoría (0 desde el widget web);
 * la identidad real para leer/escribir es `usuarioId`.
 */
export async function guardarMemoriaEquipo(
  telegramUserId: number,
  usuarioId: number,
  clave: string,
  valor: string,
  ambito: 'USUARIO' | 'EQUIPO' = 'USUARIO'
): Promise<void> {
  await cobranzasExecute(
    `INSERT INTO cobranza_telegram_memoria_equipo (empresa_id, telegram_user_id, usuario_id, ambito, clave, valor)
     VALUES (1, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), usuario_id = VALUES(usuario_id), ambito = VALUES(ambito), updated_at = NOW()`,
    [telegramUserId, usuarioId, ambito, clave, valor]
  );
}
