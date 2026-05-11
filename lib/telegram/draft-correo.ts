/**
 * Genera un draft de correo para un cliente y lo inserta en cobranza_gestiones
 * con estado PENDIENTE. Devuelve el ID para que se puedan presentar botones
 * de aprobación en Telegram.
 *
 * CP-02: el correo NO se envía. Solo se crea el draft.
 * CP-10: Claude solo genera texto.
 * CP-15: si el cliente tiene saldo a favor que cubre su pendiente, NO se
 *        genera draft (sería injusto cobrar a alguien que ya pagó de más).
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { generarMensajeCobranza } from '@/lib/claude/client';
import { seleccionarPlantilla } from '@/lib/templates/seleccionar';
import { renderPlantilla } from '@/lib/templates/render';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import Anthropic from '@anthropic-ai/sdk';
import type { SegmentoRiesgo } from '@/lib/types/cartera';

interface FacturaUrgente {
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
  // CP-15: cuando se bloquea por anticipo se reportan los montos para que
  // el bot pueda explicarle al supervisor por qué no se generó el correo.
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
  termino: string
): Promise<DraftCorreoResult> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'Sin conexión a Softec' };

  // 1. Buscar la factura más urgente del cliente
  const esCodigo = /^\d+$/.test(termino.trim());
  const filtro = esCodigo ? 'c.IC_CODE = ?' : 'c.IC_NAME LIKE ?';
  const param = esCodigo ? termino.trim().padStart(7, '0') : `%${termino}%`;

  const facturas = await softecQuery<FacturaUrgente>(
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
       c.IC_ARCONTC          AS contacto_cobros,
       c.IC_EMAIL            AS email,
       c.IC_PHONE            AS telefono
     FROM v_cobr_ijnl f
     INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS='A'
     WHERE ${filtro}
       AND f.IJ_TYPEDOC='IN' AND f.IJ_INVTORF='T' AND f.IJ_PAID='F'
       AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
     ORDER BY DATEDIFF(CURDATE(), f.IJ_DUEDATE) DESC, (f.IJ_TOT - f.IJ_TOTAPPL) DESC
     LIMIT 1`,
    [param]
  );

  if (facturas.length === 0) {
    return {
      ok: false,
      motivo: 'SIN_FACTURAS_VENCIDAS',
      error: 'El cliente no tiene facturas pendientes',
    };
  }

  const f = facturas[0];
  const codigoCliente = String(f.codigo_cliente).trim();
  const nombreCliente = String(f.nombre_cliente).trim();

  // 2. Verificar que no haya disputa activa (CP-03)
  const disputas = await cobranzasQuery<{ count: number }>(
    "SELECT COUNT(*) AS count FROM cobranza_disputas WHERE ij_inum = ? AND estado IN ('ABIERTA','EN_REVISION')",
    [f.ij_inum]
  );
  if (Number(disputas[0]?.count) > 0) {
    return {
      ok: false,
      motivo: 'FACTURA_EN_DISPUTA',
      error: 'Esta factura tiene disputa activa, no se puede gestionar',
    };
  }

  // 3. Verificar pausa
  const pausa = await cobranzasQuery<{ pausa_hasta: string | null; no_contactar: number }>(
    'SELECT pausa_hasta, no_contactar FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
    [codigoCliente]
  );
  if (pausa[0]) {
    if (pausa[0].no_contactar) {
      return {
        ok: false,
        motivo: 'CLIENTE_PAUSADO',
        error: 'Cliente marcado como NO CONTACTAR',
      };
    }
    if (pausa[0].pausa_hasta && new Date(pausa[0].pausa_hasta) > new Date()) {
      return {
        ok: false,
        motivo: 'CLIENTE_PAUSADO',
        error: `Cliente pausado hasta ${pausa[0].pausa_hasta}`,
      };
    }
  }

  // 3.5. CP-15: verificar que el cliente NO esté cubierto por saldo a favor.
  // Si los recibos sin aplicar del cliente cubren o superan su pendiente
  // bruto total, el correo de cobranza es injusto — la acción correcta es
  // que contabilidad aplique el anticipo, no que se le cobre.
  const pendienteCliente = await softecQuery<{ pendiente: number }>(
    `SELECT COALESCE(SUM(IJ_TOT - IJ_TOTAPPL), 0) AS pendiente
       FROM v_cobr_ijnl
      WHERE IJ_CCODE = ?
        AND IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F'
        AND (IJ_TOT - IJ_TOTAPPL) > 0`,
    [codigoCliente]
  );
  const pendienteBruto = Number(pendienteCliente[0]?.pendiente) || 0;
  const saldosFavor = await obtenerSaldoAFavorPorCliente([codigoCliente]);
  const saldoFavor = saldosFavor.get(codigoCliente) ?? 0;
  if (saldoFavor >= pendienteBruto && pendienteBruto > 0) {
    return {
      ok: false,
      motivo: 'CLIENTE_CUBIERTO_POR_ANTICIPO',
      error:
        'El cliente tiene saldo a favor que cubre todo su pendiente. ' +
        'Contabilidad debe aplicar el anticipo antes de cobrar.',
      saldo_pendiente: pendienteBruto,
      saldo_a_favor: saldoFavor,
    };
  }

  // 4. Verificar gestión PENDIENTE existente para esa factura
  const yaPendiente = await cobranzasQuery<{ id: number }>(
    "SELECT id FROM cobranza_gestiones WHERE ij_inum = ? AND estado='PENDIENTE'",
    [f.ij_inum]
  );
  if (yaPendiente.length > 0) {
    return {
      ok: false,
      motivo: 'YA_HAY_GESTION_PENDIENTE',
      error: `Ya existe una gestión pendiente para esta factura (ID: ${yaPendiente[0].id})`,
      gestion_id: yaPendiente[0].id,
    };
  }

  // 5. Buscar email enriquecido si no hay en Softec
  let emailDestino = (f.email || '').trim();
  if (!emailDestino) {
    const enr = await cobranzasQuery<{ email: string | null }>(
      'SELECT email FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
      [codigoCliente]
    );
    if (enr[0]?.email) emailDestino = enr[0].email.trim();
  }

  // 6. Generar mensaje
  // Enfoque B (bot manual): selecciona plantilla → render → opcionalmente
  // refina con Claude para tono natural. Si no hay plantilla, fallback a Claude solo.
  const diasVencido = Number(f.dias_vencido);
  const segmento = calcularSegmento(diasVencido);

  let asunto = '';
  let mensajeEmail = '';

  try {
    const plantilla = await seleccionarPlantilla({
      segmento,
      diasVencido,
    });

    if (plantilla) {
      const contacto = f.contacto_cobros ? String(f.contacto_cobros).trim() : '';
      const rendered = renderPlantilla(
        { asunto: plantilla.asunto, cuerpo: plantilla.cuerpo },
        {
          cliente: contacto || nombreCliente,
          empresa_cliente: nombreCliente,
          numero_factura: f.ij_inum,
          ncf_fiscal: f.ncf_fiscal ? String(f.ncf_fiscal).trim() : '',
          monto: Number(f.saldo_pendiente),
          moneda: 'DOP',
          fecha_vencimiento: new Date(f.fecha_vencimiento).toISOString().split('T')[0],
          dias_vencida: diasVencido,
        }
      );
      asunto = rendered.asunto;
      mensajeEmail = rendered.cuerpo;

      // Refinamiento opcional con Claude (solo si hay API key — best-effort)
      const refinado = await refinarConClaude(asunto, mensajeEmail, segmento);
      if (refinado) {
        asunto = refinado.asunto;
        mensajeEmail = refinado.cuerpo;
      }
    } else {
      // Fallback: Claude genera todo
      const generado = await generarMensajeCobranza({
        nombre_cliente: nombreCliente,
        contacto_cobros: f.contacto_cobros ? String(f.contacto_cobros).trim() : '',
        codigo_cliente: codigoCliente,
        numero_factura: f.ij_inum,
        ncf_fiscal: f.ncf_fiscal ? String(f.ncf_fiscal).trim() : '',
        saldo_pendiente: Number(f.saldo_pendiente),
        moneda: 'DOP',
        dias_vencido: diasVencido,
        fecha_vencimiento: new Date(f.fecha_vencimiento).toISOString().split('T')[0],
        segmento_riesgo: segmento,
        tiene_pdf: false,
        url_pdf: '',
      });
      asunto = generado.asunto_email;
      mensajeEmail = generado.mensaje_email;
    }
  } catch (err) {
    return {
      ok: false,
      motivo: 'ERROR_GENERAR',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 7. Insertar en cobranza_gestiones (PENDIENTE)
  const insertResult = await cobranzasExecute(
    `INSERT INTO cobranza_gestiones (
      ij_local, ij_typedoc, ij_inum, codigo_cliente,
      total_factura, saldo_pendiente, moneda,
      fecha_vencimiento, dias_vencido, segmento_riesgo,
      canal, mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
      estado, ultima_consulta_softec, creado_por
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EMAIL', NULL, ?, ?, 'PENDIENTE', NOW(), ?)`,
    [
      f.ij_local,
      f.ij_typedoc,
      f.ij_inum,
      codigoCliente,
      Number(f.total_factura),
      Number(f.saldo_pendiente),
      'DOP',
      new Date(f.fecha_vencimiento).toISOString().split('T')[0],
      diasVencido,
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
    factura: f.ij_inum,
    saldo: Number(f.saldo_pendiente),
    asunto,
    mensaje_email: mensajeEmail,
    destinatario_email: emailDestino || null,
  };
}

/**
 * Toma una plantilla ya renderizada y le pide a Claude que ajuste el tono
 * para sonar más natural manteniendo el contenido factual idéntico.
 * Devuelve null si no hay API key o si Claude falla — el caller usa la
 * plantilla cruda como fallback.
 */
async function refinarConClaude(
  asunto: string,
  cuerpo: string,
  segmento: SegmentoRiesgo
): Promise<{ asunto: string; cuerpo: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const tonoHint =
    segmento === 'VERDE' ? 'amigable y preventivo'
    : segmento === 'AMARILLO' ? 'cordial con urgencia moderada'
    : segmento === 'NARANJA' ? 'formal y directo'
    : 'firme y serio sin amenazas';

  const prompt = `Eres asistente de cobranzas de Suministros Guipak (República Dominicana).

Recibes una plantilla de correo ya redactada. Tu tarea: ajustar el tono para que suene natural y profesional, manteniendo el contenido factual EXACTAMENTE IGUAL.

Tono objetivo: ${tonoHint}.

REGLAS ESTRICTAS:
- NO inventes hechos nuevos, datos, fechas, montos, números de factura.
- NO agregues amenazas legales que no estén en el original.
- NO quites información factual del original.
- Puedes reordenar oraciones o reformular para mejor flujo.
- Mantén la firma "Departamento de Cuentas por Cobrar - Suministros Guipak".

ASUNTO ORIGINAL:
${asunto}

CUERPO ORIGINAL:
${cuerpo}

Responde EXACTAMENTE en JSON:
{
  "asunto": "asunto refinado",
  "cuerpo": "cuerpo refinado"
}

Solo JSON, sin texto adicional.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    if (typeof parsed.asunto !== 'string' || typeof parsed.cuerpo !== 'string') {
      return null;
    }
    return { asunto: parsed.asunto, cuerpo: parsed.cuerpo };
  } catch (err) {
    console.error('[draft-correo] Refinamiento Claude falló:', err);
    return null;
  }
}
