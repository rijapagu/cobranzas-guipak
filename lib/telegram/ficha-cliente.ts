/**
 * Memoria semántica (Fase 4): ficha compacta del cliente activo en la sesión,
 * para que el modelo tenga a mano "lo que ya sabemos de él" sin tener que
 * llamar 4-5 tools distintas en cada turno (consultar_notas_cliente,
 * consultar_perfil_riesgo_cliente, consultar_contactos_cliente_detalle,
 * listar_disputas...). Se inyecta en agent-prompt.ts cuando hay sesión activa.
 *
 * Es un resumen de HECHOS ya guardados en otras tablas — no agrega estado
 * nuevo. Si el modelo necesita el detalle completo o quiere actuar sobre algo
 * mencionado aquí (ej. resolver una disputa), sigue usando la tool específica.
 */
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { resolverEmailPropio, resolverWhatsAppPropio } from '@/lib/cobranzas/contactos';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

interface MemoriaClienteRow {
  patron_pago: string | null;
  canal_efectivo: string | null;
  mejor_momento: string | null;
  notas_daria: string | null;
}

interface RiesgoRow {
  risk_level: string;
  tendencia: string;
  accion_credito: string;
  accion_ventas: string;
  accion_cobranza: string;
}

interface DisputaActivaRow {
  total: number;
  facturas: string | null;
}

interface PromesaRow {
  monto_prometido: number;
  fecha_prometida: string;
}

interface PausaRow {
  no_contactar: number;
  pausa_hasta: string | null;
}

/**
 * Devuelve 0 a ~10 líneas de texto plano listas para inyectar en el prompt,
 * o null si no hay nada guardado más allá del nombre/código (no vale la pena
 * ocupar tokens con una ficha vacía).
 */
export async function fichaClienteCompacta(
  codigo: string,
  empresaId: number = EMPRESA_GUIPAK
): Promise<string | null> {
  const [memoria, riesgo, disputas, promesa, pausa, email, whatsapp] = await Promise.all([
    cobranzasQuery<MemoriaClienteRow>(
      'SELECT patron_pago, canal_efectivo, mejor_momento, notas_daria FROM cobranza_memoria_cliente WHERE empresa_id = ? AND codigo_cliente = ?',
      [empresaId, codigo]
    ).then((r) => r[0] ?? null).catch(() => null),
    cobranzasQuery<RiesgoRow>(
      'SELECT risk_level, tendencia, accion_credito, accion_ventas, accion_cobranza FROM cobranza_cliente_inteligencia WHERE empresa_id = ? AND codigo_cliente = ?',
      [empresaId, codigo]
    ).then((r) => r[0] ?? null).catch(() => null),
    cobranzasQuery<DisputaActivaRow>(
      "SELECT COUNT(*) AS total, GROUP_CONCAT(ij_inum) AS facturas FROM cobranza_disputas WHERE empresa_id = ? AND codigo_cliente = ? AND estado IN ('ABIERTA','EN_REVISION')",
      [empresaId, codigo]
    ).then((r) => r[0] ?? null).catch(() => null),
    cobranzasQuery<PromesaRow>(
      "SELECT monto_prometido, fecha_prometida FROM cobranza_acuerdos WHERE empresa_id = ? AND codigo_cliente = ? AND estado = 'PENDIENTE' ORDER BY fecha_prometida ASC LIMIT 1",
      [empresaId, codigo]
    ).then((r) => r[0] ?? null).catch(() => null),
    cobranzasQuery<PausaRow>(
      'SELECT no_contactar, pausa_hasta FROM cobranza_clientes_enriquecidos WHERE empresa_id = ? AND codigo_cliente = ?',
      [empresaId, codigo]
    ).then((r) => r[0] ?? null).catch(() => null),
    resolverEmailPropio(codigo, empresaId).catch(() => null),
    resolverWhatsAppPropio(codigo, empresaId).catch(() => null),
  ]);

  const lineas: string[] = [];

  const contacto = [email && `email ${email}`, whatsapp && `WhatsApp ${whatsapp}`]
    .filter(Boolean)
    .join(' · ');
  if (contacto) lineas.push(`- Contacto guardado: ${contacto}`);

  if (memoria?.patron_pago) lineas.push(`- Patrón de pago: ${memoria.patron_pago}`);
  if (memoria?.canal_efectivo) lineas.push(`- Canal más efectivo: ${memoria.canal_efectivo}`);
  if (memoria?.mejor_momento) lineas.push(`- Mejor momento para contactar: ${memoria.mejor_momento}`);
  if (memoria?.notas_daria) lineas.push(`- Notas del equipo: ${memoria.notas_daria}`);

  if (riesgo) {
    let linea = `- Riesgo: ${riesgo.risk_level} (tendencia ${riesgo.tendencia})`;
    const acciones = [
      riesgo.accion_credito !== 'NORMAL' && `crédito: ${riesgo.accion_credito}`,
      riesgo.accion_ventas !== 'NORMAL' && `ventas: ${riesgo.accion_ventas}`,
      riesgo.accion_cobranza !== 'NORMAL' && `cobranza: ${riesgo.accion_cobranza}`,
    ].filter(Boolean);
    if (acciones.length > 0) linea += ` — ${acciones.join(', ')}`;
    lineas.push(linea);
  }

  if (disputas && disputas.total > 0) {
    lineas.push(`- ⚠️ ${disputas.total} disputa(s) activa(s) (factura(s) ${disputas.facturas}) — CP-03: excluidas de cobranza automática mientras duren.`);
  }

  if (promesa) {
    const monto = Number(promesa.monto_prometido).toLocaleString('en-US', { minimumFractionDigits: 2 });
    lineas.push(`- Promesa de pago pendiente: RD$${monto} para el ${promesa.fecha_prometida}.`);
  }

  if (pausa?.no_contactar) {
    lineas.push('- 🚫 Marcado NO CONTACTAR — no debe recibir cobranza.');
  } else if (pausa?.pausa_hasta) {
    lineas.push(`- ⏸️ Pausado hasta ${pausa.pausa_hasta} — no recibe cobranza automática hasta entonces.`);
  }

  if (lineas.length === 0) return null;
  return lineas.join('\n');
}
