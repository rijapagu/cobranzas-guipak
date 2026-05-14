/**
 * Genera un draft de correo CONSOLIDADO para un cliente: cubre TODA su deuda.
 *
 * CP-02: el correo NO se envía. Solo se crea el draft.
 * CP-15: si el cliente tiene saldo a favor que cubre su pendiente, NO se genera draft.
 *
 * El texto del correo SIEMPRE proviene de una plantilla activa en cobranza_plantillas_email.
 * No se usa Claude para generar texto libre — así el equipo controla exactamente lo que sale.
 * Si no hay plantilla aplicable, la función devuelve error SIN_PLANTILLA.
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { resolverEmailPropio } from '@/lib/cobranzas/contactos';
import { seleccionarPlantilla, seleccionarPlantillaById } from '@/lib/templates/seleccionar';
import { renderPlantilla } from '@/lib/templates/render';
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
  plantilla_usada?: number;
  error?: string;
  motivo?:
    | 'CLIENTE_NO_ENCONTRADO'
    | 'SIN_FACTURAS_VENCIDAS'
    | 'FACTURA_EN_DISPUTA'
    | 'YA_HAY_GESTION_PENDIENTE'
    | 'ERROR_GENERAR'
    | 'SIN_PLANTILLA'
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

  // 6. Contacto para saludo (memoria si existe, luego Softec IC_CONTACT, luego nombre empresa)
  const memoriaRows = await cobranzasQuery<{ contacto_real: string | null }>(
    'SELECT contacto_real FROM cobranza_memoria_cliente WHERE codigo_cliente = ?',
    [codigoCliente]
  );
  const contactoNombre =
    memoriaRows[0]?.contacto_real ||
    (masUrgente.contacto_cobros ? String(masUrgente.contacto_cobros).trim() : '') ||
    nombreCliente;

  // 7. Seleccionar plantilla — siempre obligatoria
  const saldoNeto = Math.max(0, saldoTotal - saldoFavor);

  const plantilla = plantillaId
    ? await seleccionarPlantillaById(plantillaId)
    : await seleccionarPlantilla({ segmento, diasVencido: diasMaxVencido });

  if (!plantilla) {
    const msg = plantillaId
      ? `Plantilla #${plantillaId} no encontrada o inactiva`
      : `No hay plantilla activa para segmento ${segmento} con ${diasMaxVencido} días vencido. Crea una en el panel de Plantillas.`;
    return { ok: false, motivo: 'SIN_PLANTILLA', error: msg };
  }

  const rendered = renderPlantilla(
    { asunto: plantilla.asunto, cuerpo: plantilla.cuerpo },
    {
      cliente: contactoNombre,
      empresa_cliente: nombreCliente,
      numero_factura: facturas.length === 1 ? facturas[0].ij_inum : `${facturas.length} facturas`,
      ncf_fiscal: facturas.length === 1 ? String(masUrgente.ncf_fiscal || '').trim() : '',
      monto: saldoNeto,
      moneda: 'DOP',
      fecha_vencimiento: new Date(masUrgente.fecha_vencimiento).toISOString().split('T')[0],
      dias_vencida: diasMaxVencido,
    }
  );

  // 8. Insertar gestión (referencia la factura más urgente pero saldo = total)
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
      rendered.cuerpo,
      rendered.asunto,
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
    asunto: rendered.asunto,
    mensaje_email: rendered.cuerpo,
    destinatario_email: emailDestino || null,
    plantilla_usada: plantilla.id,
  };
}
