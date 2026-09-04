/**
 * Seguimiento proactivo de la cola de aprobación (2026-09-04, a pedido
 * expreso de Ricardo): el empuje matutino solo CONTABA cuántas gestiones
 * quedaban pendientes ("64 mensajes esperando aprobación") y no volvía a
 * insistir hasta el día siguiente -- eso deja todo el trabajo de "ir a
 * buscarlas" del lado del usuario, exactamente lo que un asistente que sepa
 * usar la app mejor que un operario NO debería hacer.
 *
 * Este job corre cada 2 horas en horario laboral y, si hay algo pendiente,
 * EMPUJA cada gestión con sus botones (Aprobar/Editar/Descartar/Escalar) --
 * los mismos botones y el mismo callback que ya existían para el flujo
 * reactivo, ver lib/telegram/gestion-acciones.ts -- y lista los depósitos de
 * conciliación sin dueño para que se resuelvan respondiendo en el chat. Si
 * no hay nada pendiente, no manda nada: así se cumple "que pregunte y
 * vuelva a preguntar hasta que no quede tarea pendiente" sin ser spam
 * cuando la cola ya está en cero.
 */
import { logAccion } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { enHorarioLaboral } from '@/lib/horario';
import { enviarMensajeGrupo } from '@/lib/telegram/client';
import { listarGestionesPendientes, construirBotonesGestion } from '@/lib/telegram/gestion-acciones';
import { listarDepositosPendientes } from '@/lib/conciliacion/acciones';
import { adaptadorParaEmpresa } from '@/lib/erp';

/** Tope por corrida: con 64+ pendientes de golpe (backlog de meses), mandar
 * los 64 de una sentada satura el chat -- se van vaciando de a poco, cada 2h,
 * y la cabecera siempre dice el total real que falta. */
const MAX_GESTIONES_POR_CICLO = 10;
const MAX_DEPOSITOS_POR_CICLO = 10;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SEGMENTO_EMOJI: Record<string, string> = {
  VERDE: '🟢',
  AMARILLO: '🟡',
  NARANJA: '🟠',
  ROJO: '🔴',
};

export interface ResultadoSeguimientoPendientes {
  enviado: boolean;
  motivo: string;
  gestiones_pendientes?: number;
  depositos_pendientes?: number;
}

export async function ejecutarSeguimientoPendientes(): Promise<ResultadoSeguimientoPendientes> {
  if (!enHorarioLaboral()) return { enviado: false, motivo: 'fuera de horario laboral' };

  const empresaId = EMPRESA_GUIPAK;
  const [gestiones, depositos] = await Promise.all([
    listarGestionesPendientes(MAX_GESTIONES_POR_CICLO, empresaId),
    listarDepositosPendientes({ empresaId, estado: 'TODOS', soloUltimoExtracto: false, limite: MAX_DEPOSITOS_POR_CICLO }),
  ]);

  if (gestiones.total === 0 && depositos.length === 0) {
    return { enviado: false, motivo: 'nada pendiente' };
  }

  // Nombres desde el ERP (best-effort, mismo patrón que lib/cobranzas/disputas.ts) --
  // sin nombre, un código como "0000603" no le dice nada a quien tiene que decidir.
  let nombresPorCodigo: Record<string, string> = {};
  const codigos = [...new Set(gestiones.items.map((g) => g.codigo_cliente))];
  if (codigos.length > 0) {
    try {
      const adapter = await adaptadorParaEmpresa(empresaId);
      const clientes = await adapter.clientes();
      const buscados = new Set(codigos.map((c) => c.trim()));
      nombresPorCodigo = Object.fromEntries(
        clientes.filter((c) => buscados.has(c.codigo)).map((c) => [c.codigo, c.nombre])
      );
    } catch {
      // ERP no disponible -- sigue sin nombres
    }
  }

  if (gestiones.total > 0) {
    const restantes = gestiones.total - gestiones.items.length;
    await enviarMensajeGrupo(
      `🔔 <b>Seguimiento de cobranza</b> — quedan <b>${gestiones.total}</b> correo(s)/WhatsApp sin aprobar.\n` +
        `Te mando ${gestiones.items.length === 1 ? 'el más antiguo' : `los ${gestiones.items.length} más antiguos`}` +
        (restantes > 0 ? ` (${restantes} más en la cola, van llegando en las próximas rondas):` : ':')
    );

    for (const g of gestiones.items) {
      const nombre = nombresPorCodigo[g.codigo_cliente.trim()] || g.codigo_cliente;
      const emoji = SEGMENTO_EMOJI[g.segmento_riesgo] || '';
      const monto = Number(g.saldo_pendiente).toLocaleString('es-DO', { minimumFractionDigits: 2 });
      const texto =
        `📨 <b>Gestión #${g.id}</b> — ${nombre} (${g.codigo_cliente})\n` +
        `${g.canal} · RD$${monto} · ${g.dias_vencido} días vencido · ${emoji} ${g.segmento_riesgo}` +
        (g.asunto_email ? `\nAsunto: ${g.asunto_email}` : '');

      try {
        await enviarMensajeGrupo(texto, { teclado: construirBotonesGestion(g.id) });
      } catch (err) {
        console.error(`[SeguimientoPendientes] Error enviando gestión ${g.id}:`, err);
      }
      await esperar(400); // evita flood-control de Telegram al mandar varios seguidos
    }
  }

  if (depositos.length > 0) {
    const lineas = depositos.map((d) => {
      const monto = Number(d.monto).toLocaleString('es-DO', { minimumFractionDigits: 2 });
      return `  #${d.id} — RD$${monto} — ${(d.descripcion || '').slice(0, 50)} (${d.estado})`;
    });
    await enviarMensajeGrupo(
      `🏦 <b>${depositos.length} depósito(s) de conciliación sin resolver:</b>\n${lineas.join('\n')}\n\n` +
        `Respondeme "el &lt;id&gt; es de &lt;cliente&gt;" y lo asigno, o "aprueba el &lt;id&gt;" si ya tiene dueño.`
    );
  }

  await logAccion('sistema', 'SEGUIMIENTO_PENDIENTES', 'sistema', '0', {
    gestiones_pendientes: gestiones.total,
    gestiones_enviadas: gestiones.items.length,
    depositos_pendientes: depositos.length,
  });

  return {
    enviado: true,
    motivo: 'ok',
    gestiones_pendientes: gestiones.total,
    depositos_pendientes: depositos.length,
  };
}
