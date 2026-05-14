/**
 * Genera un draft de correo CONSOLIDADO para un cliente: cubre TODA su deuda,
 * no solo una factura.
 *
 * CP-02: el correo NO se envía. Solo se crea el draft.
 * CP-10: Claude solo genera texto.
 * CP-15: si el cliente tiene saldo a favor que cubre su pendiente, NO se
 *        genera draft.
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { resolverEmailPropio, guardarContacto } from '@/lib/cobranzas/contactos';
import { seleccionarPlantillaById } from '@/lib/templates/seleccionar';
import { renderPlantilla } from '@/lib/templates/render';
import Anthropic from '@anthropic-ai/sdk';
import type { SegmentoRiesgo } from '@/lib/types/cartera';

interface FacturaCliente {
  ij_local: string;
  ij_typedoc: string;
  ij_inum: number;
  codigo_cliente: string;
  nombre_cliente: string;
  ncf_fiscal: string;
  total_factura: number;
  saldo_pendiente: number;
  moneda: string;
  fecha_vencimiento: Date;
  dias_vencido: number;
  contacto_cobros: string | null;
  email: string | null;
  telefono: string | null;
}

export interface DraftCorreoResult {
  ok: boolean;
  gestion_id?: number;
  cliente?: string;
  codigo?: string;
  factura?: number;
  total_facturas?: number;
  saldo?: number;
  asunto?: string;
  mensaje_email?: string;
  destinatario_email?: string | null;
  error?: string;
  motivo?:
    | 'CLIENTE_NO_ENCONTRADO'
    | 'SIN_FACTURAS_VENCIDAS'
    | 'FACTURA_EN_DISPUTA'
    | 'YA_HAY_GESTION_PENDIENTE'
    | 'ERROR_GENERAR'
    | 'CLIENTE_PAUSADO'
    | 'CLIENTE_CUBIERTO_POR_ANTICIPO';
  saldo_pendiente?: number;
  saldo_a_favor?: number;
}

function calcularSegmento(diasVencido: number): SegmentoRiesgo {
  if (diasVencido < 1) return 'VERDE';
  if (diasVencido <= 15) return 'AMARILLO';
  if (diasVencido <= 30) return 'NARANJA';
  return 'ROJO';
}

export async function proponerCorreoCliente(
  termino: string,
  emailDestinoParam?: string,
  plantillaId?: number
): Promise<DraftCorreoResult> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'Sin conexión a Softec' };

  // 1. Buscar TODAS las facturas pendientes del cliente
  const esCodigo = /^\d+$/.test(termino.trim());
  const filtro = esCodigo
    ? 'c.IC_CODE = ?'
    : '(c.IC_NAME LIKE ? OR c.IC_CODE = ?)';
  const params = esCodigo
    ? [termino.trim().padStart(7, '0')]
    : [`%${termino}%`, termino.trim()];

  const facturas = await softecQuery<FacturaCliente>(
    `SELECT
       'GUI'                AS ij_local,
       f.IJ_TYPEDOC          AS ij_typedoc,
       f.IJ_INUM             AS ij_inum,
       c.IC_CODE             AS codigo_cliente,
       c.IC_NAME             AS nombre_cliente,
       f.IJ_NCFNUM           AS ncf_fiscal,
       f.IJ_TOT              AS total_factura,
       (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_pendiente,
       'DOP'                 AS moneda,
       f.IJ_DUEDATE          AS fecha_vencimiento,
       DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencido,
       c.IC_CONTACT          AS contacto_cobros,
       c.IC_ARCONTC          AS email,
       c.IC_PHONE            AS telefono
     FROM v_cobr_ijnl f
     INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS='A'
     WHERE ${filtro}
       AND f.IJ_TYPEDOC='IN' AND f.IJ_INVTORF='T' AND f.IJ_PAID='F'
       AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
     ORDER BY DATEDIFF(CURDATE(), f.IJ_DUEDATE) DESC, (f.IJ_TOT - f.IJ_TOTAPPL) DESC
     LIMIT 50`,
    params
  );

  if (facturas.length === 0) {
    return {
      ok: false,
      motivo: 'SIN_FACTURAS_VENCIDAS',
      error: 'El cliente no tiene facturas pendientes',
    };
  }

  const masUrgente = facturas[0];
  const codigoCliente = String(masUrgente.codigo_cliente).trim();
  const nombreCliente = String(masUrgente.nombre_cliente).trim();
  const saldoTotal = facturas.reduce((s, f) => s + Number(f.saldo_pendiente), 0);
  const diasMaxVencido = Math.max(...facturas.map((f) => Number(f.dias_vencido)));
  const segmento = calcularSegmento(diasMaxVencido);

  // 2. Verificar pausa
  const pausa = await cobranzasQuery<{ pausa_hasta: string | null; no_contactar: number }>(
    'SELECT pausa_hasta, no_contactar FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
    [codigoCliente]
  );
  if (pausa[0]) {
    if (pausa[0].no_contactar) {
      return { ok: false, motivo: 'CLIENTE_PAUSADO', error: 'Cliente marcado como NO CONTACTAR' };
    }
    if (pausa[0].pausa_hasta && new Date(pausa[0].pausa_hasta) > new Date()) {
      return { ok: false, motivo: 'CLIENTE_PAUSADO', error: `Cliente pausado hasta ${pausa[0].pausa_hasta}` };
    }
  }

  // 3. CP-15: saldo a favor
  const saldosFavor = await obtenerSaldoAFavorPorCliente([codigoCliente]);
  const saldoFavor = saldosFavor.get(codigoCliente) ?? 0;
  if (saldoFavor >= saldoTotal && saldoTotal > 0) {
    return {
      ok: false,
      motivo: 'CLIENTE_CUBIERTO_POR_ANTICIPO',
      error: 'El cliente tiene saldo a favor que cubre todo su pendiente. Contabilidad debe aplicar el anticipo antes de cobrar.',
      saldo_pendiente: saldoTotal,
      saldo_a_favor: saldoFavor,
    };
  }

  // 4. Verificar gestión PENDIENTE existente para este cliente
  const yaPendiente = await cobranzasQuery<{ id: number }>(
    "SELECT id FROM cobranza_gestiones WHERE codigo_cliente = ? AND canal = 'EMAIL' AND estado='PENDIENTE' LIMIT 1",
    [codigoCliente]
  );
  if (yaPendiente.length > 0) {
    return {
      ok: false,
      motivo: 'YA_HAY_GESTION_PENDIENTE',
      error: `Ya existe una gestión de correo pendiente para este cliente (ID: ${yaPendiente[0].id})`,
      gestion_id: yaPendiente[0].id,
    };
  }

  // 5. Buscar email — prioridad: override explícito > nuestra BD > Softec IC_ARCONTC
  let emailDestino = (emailDestinoParam || '').trim();
  if (!emailDestino) {
    const emailPropio = await resolverEmailPropio(codigoCliente);
    emailDestino = emailPropio || (masUrgente.email || '').trim();
  }
  // El bot pregunta al usuario si desea guardar el email nuevo — no auto-guardar aquí.

  // 6. Memoria del cliente
  const memoriaRows = await cobranzasQuery<{
    patron_pago: string | null;
    canal_efectivo: string | null;
    contacto_real: string | null;
    mejor_momento: string | null;
    notas_daria: string | null;
  }>(
    'SELECT patron_pago, canal_efectivo, contacto_real, mejor_momento, notas_daria FROM cobranza_memoria_cliente WHERE codigo_cliente = ?',
    [codigoCliente]
  );
  const memoria = memoriaRows[0] || null;

  // 7. Generar correo: plantilla explícita → renderizar; si no, Claude
  let asunto = '';
  let mensajeEmail = '';
  const contactoNombre =
    memoria?.contacto_real ||
    (masUrgente.contacto_cobros ? String(masUrgente.contacto_cobros).trim() : '') ||
    nombreCliente;

  if (plantillaId) {
    const plantilla = await seleccionarPlantillaById(plantillaId);
    if (!plantilla) {
      return { ok: false, motivo: 'ERROR_GENERAR', error: `Plantilla #${plantillaId} no encontrada o inactiva` };
    }
    const rendered = renderPlantilla(
      { asunto: plantilla.asunto, cuerpo: plantilla.cuerpo },
      {
        cliente: contactoNombre,
        empresa_cliente: nombreCliente,
        numero_factura: facturas.length === 1 ? facturas[0].ij_inum : `${facturas.length} facturas`,
        ncf_fiscal: facturas.length === 1 ? String(masUrgente.ncf_fiscal || '').trim() : '',
        monto: Math.max(0, saldoTotal - saldoFavor),
        moneda: 'DOP',
        fecha_vencimiento: new Date(masUrgente.fecha_vencimiento).toISOString().split('T')[0],
        dias_vencida: diasMaxVencido,
      }
    );
    asunto = rendered.asunto;
    mensajeEmail = rendered.cuerpo;
  } else {
    try {
      const generado = await generarCorreoConsolidado(
        nombreCliente,
        codigoCliente,
        facturas,
        saldoTotal,
        saldoFavor,
        segmento,
        contactoNombre,
        memoria
      );
      asunto = generado.asunto;
      mensajeEmail = generado.cuerpo;
    } catch (err) {
      return {
        ok: false,
        motivo: 'ERROR_GENERAR',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // 8. Insertar gestión (referencia la factura más urgente pero saldo = total)
  const saldoNeto = Math.max(0, saldoTotal - saldoFavor);
  const insertResult = await cobranzasExecute(
    `INSERT INTO cobranza_gestiones (
      ij_local, ij_typedoc, ij_inum, codigo_cliente,
      total_factura, saldo_pendiente, moneda,
      fecha_vencimiento, dias_vencido, segmento_riesgo,
      canal, mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
      estado, ultima_consulta_softec, creado_por
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EMAIL', NULL, ?, ?, 'PENDIENTE', NOW(), ?)`,
    [
      masUrgente.ij_local,
      masUrgente.ij_typedoc,
      masUrgente.ij_inum,
      codigoCliente,
      saldoTotal,
      saldoNeto,
      'DOP',
      new Date(masUrgente.fecha_vencimiento).toISOString().split('T')[0],
      diasMaxVencido,
      segmento,
      mensajeEmail,
      asunto,
      'bot-telegram',
    ]
  );

  const gestionId = (insertResult as { insertId?: number }).insertId;
  if (!gestionId) {
    return { ok: false, error: 'No se pudo crear la gestión' };
  }

  return {
    ok: true,
    gestion_id: gestionId,
    cliente: nombreCliente,
    codigo: codigoCliente,
    factura: masUrgente.ij_inum,
    total_facturas: facturas.length,
    saldo: saldoNeto,
    asunto,
    mensaje_email: mensajeEmail,
    destinatario_email: emailDestino || null,
  };
}

// =====================================================================
// Generación de correo consolidado con Claude
// =====================================================================

interface MemoriaCliente {
  patron_pago: string | null;
  canal_efectivo: string | null;
  contacto_real: string | null;
  mejor_momento: string | null;
  notas_daria: string | null;
}

const TONOS: Record<SegmentoRiesgo, string> = {
  VERDE: 'amigable y preventivo — recordatorio cordial',
  AMARILLO: 'cordial con urgencia moderada — solicitar fecha de pago',
  NARANJA: 'formal y directo — solicitar pago inmediato o acuerdo',
  ROJO: 'firme y urgente — exigir pago, advertir gestión legal sin amenazas',
};

async function generarCorreoConsolidado(
  nombreCliente: string,
  codigoCliente: string,
  facturas: FacturaCliente[],
  saldoTotal: number,
  saldoFavor: number,
  segmento: SegmentoRiesgo,
  contacto: string,
  memoria: MemoriaCliente | null
): Promise<{ asunto: string; cuerpo: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return generarCorreoConsolidadoMock(nombreCliente, facturas, saldoTotal);
  }

  const saldoNeto = Math.max(0, saldoTotal - saldoFavor);
  const facturasTexto = facturas
    .slice(0, 20)
    .map((f) => {
      const fecha = new Date(f.fecha_vencimiento).toISOString().split('T')[0];
      return `  - Factura #${f.ij_inum} | Vcto: ${fecha} | ${Number(f.dias_vencido)}d vencida | RD$${Number(f.saldo_pendiente).toLocaleString('es-DO')}`;
    })
    .join('\n');

  const contextoMemoria = memoria
    ? `\nCONTEXTO DEL CLIENTE (personaliza sin inventar datos):
${memoria.patron_pago ? `- Patrón de pago: ${memoria.patron_pago}` : ''}
${memoria.contacto_real ? `- Contacto real: ${memoria.contacto_real}` : ''}
${memoria.notas_daria ? `- Notas del equipo: ${memoria.notas_daria}` : ''}`.trim()
    : '';

  const prompt = `Eres asistente de cobranzas de Suministros Guipak, S.R.L. (distribuidora B2B, República Dominicana).

Genera UN correo de cobranza CONSOLIDADO para este cliente. El correo debe cubrir TODA la deuda, no solo una factura.

DATOS DEL CLIENTE:
- Empresa: ${nombreCliente}
- Código: ${codigoCliente}
- Contacto: ${contacto || nombreCliente}
- Saldo total pendiente: RD$${saldoTotal.toLocaleString('es-DO')}${saldoFavor > 0 ? `\n- Saldo a favor: RD$${saldoFavor.toLocaleString('es-DO')} (ya descontado)` : ''}
- Saldo neto a cobrar: RD$${saldoNeto.toLocaleString('es-DO')}
- Total facturas pendientes: ${facturas.length}
- Factura más antigua: ${Number(facturas[0].dias_vencido)} días vencida
- Segmento: ${segmento}

DETALLE DE FACTURAS:
${facturasTexto}${facturas.length > 20 ? `\n  ... y ${facturas.length - 20} facturas más` : ''}
${contextoMemoria}

TONO: ${TONOS[segmento]}

REGLAS:
- Dirigir a "${contacto || nombreCliente}" (no "Estimado cliente").
- Mencionar el SALDO TOTAL NETO (RD$${saldoNeto.toLocaleString('es-DO')}), no factura por factura.
- Si hay más de 5 facturas, no listarlas todas — resumir ("${facturas.length} facturas pendientes, la más antigua de ${Number(facturas[0].dias_vencido)} días").
- Si hay 5 o menos, puedes listar los números de factura.
- Firma: "Departamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L."
- NO inventes datos, montos ni fechas.

Responde EXACTAMENTE en JSON:
{
  "asunto": "asunto del correo",
  "cuerpo": "cuerpo del correo"
}

Solo JSON, sin texto adicional.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return generarCorreoConsolidadoMock(nombreCliente, facturas, saldoTotal);

    const parsed = JSON.parse(match[0]);
    if (typeof parsed.asunto !== 'string' || typeof parsed.cuerpo !== 'string') {
      return generarCorreoConsolidadoMock(nombreCliente, facturas, saldoTotal);
    }
    return { asunto: parsed.asunto, cuerpo: parsed.cuerpo };
  } catch (err) {
    console.error('[draft-correo] Error generando correo consolidado:', err);
    return generarCorreoConsolidadoMock(nombreCliente, facturas, saldoTotal);
  }
}

function generarCorreoConsolidadoMock(
  nombreCliente: string,
  facturas: FacturaCliente[],
  saldoTotal: number
): { asunto: string; cuerpo: string } {
  return {
    asunto: `Estado de cuenta pendiente - ${nombreCliente}`,
    cuerpo: `Estimado/a ${nombreCliente},

Le informamos que su cuenta presenta un saldo pendiente de RD$${saldoTotal.toLocaleString('es-DO')} correspondiente a ${facturas.length} factura(s).

Le solicitamos coordinar el pago a la brevedad posible.

Saludos,
Departamento de Cuentas por Cobrar
Suministros Guipak, S.R.L.`,
  };
}
