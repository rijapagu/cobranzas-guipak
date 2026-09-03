/**
 * Pausar / reactivar el contacto automático de un cliente.
 *
 * OJO: esto NO es una extracción literal de app/api/cobranzas/clientes/route.ts
 * PUT — ese handler hace un upsert de TODO el formulario (email, whatsapp,
 * contacto_cobros, canal_preferido, no_contactar, pausa_hasta, notas_cobros)
 * porque la página de ajustes del cliente siempre manda el formulario
 * completo. Una tool de chat como "pausa a Padrón hasta el 15" solo trae el
 * dato de la pausa — si reusara ese UPDATE literal, los demás campos
 * (email, whatsapp, notas...) se pisarían con NULL. Por eso esta función
 * hace un UPDATE parcial que toca solo pausa_hasta/motivo_no_contactar, y el
 * PUT de la ruta web sigue siendo la única vía para editar el resto.
 */
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

export interface ActorClienteEnriquecido {
  userId: string;
  userEmail: string;
}

export interface ResultadoAccionCliente {
  ok: boolean;
  mensaje: string;
}

function fechaValida(hasta: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(hasta) && !Number.isNaN(new Date(hasta).getTime());
}

export async function pausarCliente(
  codigoCliente: string,
  hasta: string,
  motivo: string | undefined,
  actor: ActorClienteEnriquecido,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoAccionCliente> {
  if (!fechaValida(hasta)) {
    return { ok: false, mensaje: 'Fecha inválida — usa el formato YYYY-MM-DD.' };
  }

  const existente = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ? AND empresa_id = ? LIMIT 1',
    [codigoCliente, empresaId]
  );

  if (existente.length > 0) {
    await cobranzasExecute(
      `UPDATE cobranza_clientes_enriquecidos
       SET pausa_hasta = ?, motivo_no_contactar = COALESCE(?, motivo_no_contactar), actualizado_por = ?
       WHERE codigo_cliente = ? AND empresa_id = ?`,
      [hasta, motivo ?? null, actor.userEmail, codigoCliente, empresaId]
    );
  } else {
    await cobranzasExecute(
      `INSERT INTO cobranza_clientes_enriquecidos
        (empresa_id, codigo_cliente, canal_preferido, pausa_hasta, motivo_no_contactar, actualizado_por)
       VALUES (?, ?, 'WHATSAPP', ?, ?, ?)`,
      [empresaId, codigoCliente, hasta, motivo ?? null, actor.userEmail]
    );
  }

  await logAccion(actor.userId, 'CLIENTE_PAUSADO', 'cliente', codigoCliente, { pausa_hasta: hasta, motivo });
  return { ok: true, mensaje: `${codigoCliente} pausado hasta ${hasta}. No recibirá cobranza automática hasta entonces.` };
}

export async function reactivarCliente(
  codigoCliente: string,
  actor: ActorClienteEnriquecido,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoAccionCliente> {
  const existente = await cobranzasQuery<{ id: number; pausa_hasta: string | null }>(
    'SELECT id, pausa_hasta FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ? AND empresa_id = ? LIMIT 1',
    [codigoCliente, empresaId]
  );
  if (existente.length === 0 || !existente[0].pausa_hasta) {
    return { ok: false, mensaje: `${codigoCliente} no tiene una pausa activa.` };
  }

  await cobranzasExecute(
    'UPDATE cobranza_clientes_enriquecidos SET pausa_hasta = NULL, actualizado_por = ? WHERE codigo_cliente = ? AND empresa_id = ?',
    [actor.userEmail, codigoCliente, empresaId]
  );
  await logAccion(actor.userId, 'CLIENTE_REACTIVADO', 'cliente', codigoCliente, {});
  return { ok: true, mensaje: `${codigoCliente} reactivado — vuelve a la cobranza normal.` };
}
