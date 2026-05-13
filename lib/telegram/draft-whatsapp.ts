/**
 * Genera un draft de mensaje WhatsApp para un cliente y lo inserta en
 * cobranza_gestiones con estado PENDIENTE y canal=WHATSAPP.
 *
 * CP-02: el mensaje NO se envía. Solo se crea el draft.
 * CP-15: bloquea si el saldo a favor cubre todo el pendiente.
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { getPdfUrl } from '@/lib/drive/client';
import Anthropic from '@anthropic-ai/sdk';

export interface DraftWhatsAppResult {
  ok: boolean;
  gestion_id?: number;
  cliente?: string;
  codigo?: string;
  factura?: number;
  saldo?: number;
  mensaje_wa?: string;
  destinatario_telefono?: string | null;
  tiene_pdf?: boolean;
  url_pdf?: string | null;
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

function calcularSegmento(dias: number): string {
  if (dias < 1) return 'VERDE';
  if (dias <= 15) return 'AMARILLO';
  if (dias <= 30) return 'NARANJA';
  return 'ROJO';
}

export async function proponerWhatsAppCliente(
  termino: string
): Promise<DraftWhatsAppResult> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'Sin conexión a Softec' };

  const esCodigo = /^\d+$/.test(termino.trim());
  const filtro = esCodigo
    ? 'c.IC_CODE = ?'
    : '(c.IC_NAME LIKE ? OR c.IC_CODE = ?)';
  const params = esCodigo
    ? [termino.trim().padStart(7, '0')]
    : [`%${termino}%`, termino.trim()];

  const facturas = await softecQuery<{
    ij_inum: number;
    codigo_cliente: string;
    nombre_cliente: string;
    ncf_fiscal: string;
    total_factura: number;
    saldo_pendiente: number;
    fecha_vencimiento: Date;
    dias_vencido: number;
    contacto_cobros: string | null;
    email: string | null;
    telefono: string | null;
  }>(
    `SELECT
       f.IJ_INUM             AS ij_inum,
       c.IC_CODE             AS codigo_cliente,
       c.IC_NAME             AS nombre_cliente,
       f.IJ_NCFNUM           AS ncf_fiscal,
       f.IJ_TOT              AS total_factura,
       (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_pendiente,
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
    params
  );

  if (facturas.length === 0) {
    return { ok: false, motivo: 'SIN_FACTURAS_VENCIDAS', error: 'El cliente no tiene facturas pendientes' };
  }

  const f = facturas[0];
  const codigoCliente = String(f.codigo_cliente).trim();
  const nombreCliente = String(f.nombre_cliente).trim();

  // Disputa activa
  const disputas = await cobranzasQuery<{ count: number }>(
    "SELECT COUNT(*) AS count FROM cobranza_disputas WHERE ij_inum = ? AND estado IN ('ABIERTA','EN_REVISION')",
    [f.ij_inum]
  );
  if (Number(disputas[0]?.count) > 0) {
    return { ok: false, motivo: 'FACTURA_EN_DISPUTA', error: 'Esta factura tiene disputa activa' };
  }

  // Pausa o no contactar
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

  // CP-15: saldo a favor
  const pendienteRows = await softecQuery<{ pendiente: number }>(
    `SELECT COALESCE(SUM(IJ_TOT - IJ_TOTAPPL), 0) AS pendiente
       FROM v_cobr_ijnl
      WHERE IJ_CCODE = ? AND IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F'
        AND (IJ_TOT - IJ_TOTAPPL) > 0`,
    [codigoCliente]
  );
  const pendienteBruto = Number(pendienteRows[0]?.pendiente) || 0;
  const saldosFavor = await obtenerSaldoAFavorPorCliente([codigoCliente]);
  const saldoFavor = saldosFavor.get(codigoCliente) ?? 0;
  if (saldoFavor >= pendienteBruto && pendienteBruto > 0) {
    return {
      ok: false,
      motivo: 'CLIENTE_CUBIERTO_POR_ANTICIPO',
      error: 'El cliente tiene saldo a favor que cubre todo su pendiente.',
      saldo_pendiente: pendienteBruto,
      saldo_a_favor: saldoFavor,
    };
  }

  // Ya hay gestión WHATSAPP pendiente para esta factura
  const yaPendiente = await cobranzasQuery<{ id: number }>(
    "SELECT id FROM cobranza_gestiones WHERE ij_inum = ? AND canal='WHATSAPP' AND estado='PENDIENTE'",
    [f.ij_inum]
  );
  if (yaPendiente.length > 0) {
    return {
      ok: false,
      motivo: 'YA_HAY_GESTION_PENDIENTE',
      error: `Ya hay un WhatsApp pendiente para esta factura (ID: ${yaPendiente[0].id})`,
      gestion_id: yaPendiente[0].id,
    };
  }

  // Número de WhatsApp: enriquecido primero, fallback Softec
  const enr = await cobranzasQuery<{ whatsapp: string | null }>(
    'SELECT whatsapp FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
    [codigoCliente]
  );
  const telefonoDestino =
    (enr[0]?.whatsapp ? enr[0].whatsapp.trim() : '') ||
    (f.telefono ? String(f.telefono).trim() : '');

  // PDF disponible en Drive?
  const docRows = await cobranzasQuery<{ google_drive_id: string }>(
    'SELECT google_drive_id FROM cobranza_facturas_documentos WHERE ij_inum = ? LIMIT 1',
    [f.ij_inum]
  );
  const googleDriveId = docRows[0]?.google_drive_id || null;
  const urlPdf = googleDriveId ? getPdfUrl(googleDriveId) : null;

  // Generar mensaje WhatsApp con Claude (best-effort)
  const diasVencido = Number(f.dias_vencido);
  const segmento = calcularSegmento(diasVencido);
  const monto = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(f.saldo_pendiente));
  const contacto = f.contacto_cobros ? String(f.contacto_cobros).trim() : nombreCliente;

  let mensajeWa = '';
  try {
    mensajeWa = await generarMensajeWhatsApp({
      contacto,
      empresa: nombreCliente,
      factura: f.ij_inum,
      monto: `RD$${monto}`,
      diasVencido,
      segmento,
      urlPdf,
    });
  } catch {
    // Fallback manual si Claude falla
    mensajeWa = `Estimado(a) ${contacto},\n\nLe recordamos que tiene pendiente la factura #${f.ij_inum} por RD$${monto}, vencida hace ${diasVencido} días.\n\nLe agradecemos coordinar el pago.\n\nCobros Guipak`;
    if (urlPdf) mensajeWa += `\n\n📄 Factura: ${urlPdf}`;
  }

  // Insertar en cobranza_gestiones
  const insertResult = await cobranzasExecute(
    `INSERT INTO cobranza_gestiones (
      ij_local, ij_typedoc, ij_inum, codigo_cliente,
      total_factura, saldo_pendiente, moneda,
      fecha_vencimiento, dias_vencido, segmento_riesgo,
      canal, mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
      tiene_pdf, url_pdf,
      estado, ultima_consulta_softec, creado_por
    ) VALUES ('001', 'IN', ?, ?, ?, ?, 'DOP', ?, ?, ?, 'WHATSAPP', ?, NULL, NULL, ?, ?, 'PENDIENTE', NOW(), ?)`,
    [
      f.ij_inum,
      codigoCliente,
      Number(f.total_factura),
      Number(f.saldo_pendiente),
      new Date(f.fecha_vencimiento).toISOString().split('T')[0],
      diasVencido,
      segmento,
      mensajeWa,
      googleDriveId ? 1 : 0,
      urlPdf,
      'bot-telegram',
    ]
  );

  const gestionId = (insertResult as { insertId?: number }).insertId;
  if (!gestionId) return { ok: false, error: 'No se pudo crear la gestión' };

  return {
    ok: true,
    gestion_id: gestionId,
    cliente: nombreCliente,
    codigo: codigoCliente,
    factura: f.ij_inum,
    saldo: Number(f.saldo_pendiente),
    mensaje_wa: mensajeWa,
    destinatario_telefono: telefonoDestino || null,
    tiene_pdf: !!googleDriveId,
    url_pdf: urlPdf,
  };
}

async function generarMensajeWhatsApp(datos: {
  contacto: string;
  empresa: string;
  factura: number;
  monto: string;
  diasVencido: number;
  segmento: string;
  urlPdf: string | null;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Sin ANTHROPIC_API_KEY');

  const tono =
    datos.segmento === 'AMARILLO' ? 'cordial y breve, urgencia moderada'
    : datos.segmento === 'NARANJA' ? 'formal y directo'
    : 'firme y serio, sin amenazas legales';

  const prompt = `Redacta un mensaje de WhatsApp de cobranza para Suministros Guipak (República Dominicana).

Cliente: ${datos.empresa}
Contacto: ${datos.contacto}
Factura: #${datos.factura}
Monto: ${datos.monto}
Días vencido: ${datos.diasVencido}
Tono: ${tono}
${datos.urlPdf ? `URL factura: ${datos.urlPdf}` : 'Sin URL de factura disponible'}

REGLAS:
- Máximo 5 oraciones. WhatsApp es breve.
- Inicia con "Estimado(a) [nombre],"
- Menciona número de factura y monto.
- Si hay URL de factura, inclúyela al final con "📄 Factura: [url]"
- Firma: "Cobros Guipak"
- No inventes datos. No amenazas legales.
- Solo el texto del mensaje, sin JSON ni etiquetas.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  if (!text) throw new Error('Claude no generó texto');
  return text;
}
