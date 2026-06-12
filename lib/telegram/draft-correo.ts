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
import { EMPRESA_GUIPAK } from '@/lib/tenant';
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
    | 'SIN_EMAIL_REGISTRADO'
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
  plantillaId?: number,
  creadoPor: string = 'bot-telegram'
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

  let facturas = await softecQuery<FacturaCliente>(
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

  // 1.5 CP-03: excluir facturas con disputa activa del correo consolidado.
  const inums = facturas.map((f) => Number(f.ij_inum));
  const disputasRows = await cobranzasQuery<{ ij_inum: number }>(
    `SELECT DISTINCT ij_inum FROM cobranza_disputas
     WHERE empresa_id = 1 AND estado IN ('ABIERTA','EN_REVISION')
       AND ij_inum IN (${inums.map(() => '?').join(',')})`,
    inums
  );
  const enDisputa = new Set(disputasRows.map((d) => Number(d.ij_inum)));
  if (enDisputa.size > 0) {
    facturas = facturas.filter((f) => !enDisputa.has(Number(f.ij_inum)));
    if (facturas.length === 0) {
      return {
        ok: false,
        motivo: 'FACTURA_EN_DISPUTA',
        error: 'Todas las facturas pendientes del cliente están en disputa activa (CP-03)',
      };
    }
  }

  const masUrgente = facturas[0];
  const codigoCliente = String(masUrgente.codigo_cliente).trim();
  const nombreCliente = String(masUrgente.nombre_cliente).trim();
  const saldoTotal = facturas.reduce((s, f) => s + Number(f.saldo_pendiente), 0);
  const diasMaxVencido = Math.max(...facturas.map((f) => Number(f.dias_vencido)));
  const segmento = calcularSegmento(diasMaxVencido);

  // 2. Verificar pausa
  const pausa = await cobranzasQuery<{ pausa_hasta: string | null; no_contactar: number }>(
    'SELECT pausa_hasta, no_contactar FROM cobranza_clientes_enriquecidos WHERE empresa_id = 1 AND codigo_cliente = ?',
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
    "SELECT id FROM cobranza_gestiones WHERE empresa_id = 1 AND codigo_cliente = ? AND canal = 'EMAIL' AND estado='PENDIENTE' LIMIT 1",
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
  const emailEnBD = await resolverEmailPropio(codigoCliente, EMPRESA_GUIPAK);
  const emailEnSoftec = (masUrgente.email || '').trim();
  const emailParamLimpio = (emailDestinoParam || '').trim();

  let emailDestino = emailParamLimpio || emailEnBD || emailEnSoftec;

  // 5b. Si no hay email de NINGUNA fuente, devolver SIN_EMAIL_REGISTRADO.
  // Eso le indica al modelo que tiene que pedirle uno al usuario y llamarnos
  // de nuevo con email_destino. El draft NO se genera sin email.
  if (!emailDestino) {
    return {
      ok: false,
      motivo: 'SIN_EMAIL_REGISTRADO',
      error: `El cliente ${nombreCliente} (${codigoCliente}) no tiene email registrado. Pedile uno al usuario y volvé a llamar a proponer_correo_cobranza_cliente con email_destino.`,
      codigo: codigoCliente,
      cliente: nombreCliente,
    };
  }

  // 5c. Si el usuario dio un email_destino NUEVO (no está en BD ni en Softec),
  // lo guardamos automáticamente en nuestra BD propia. Efecto colateral del
  // FLUJO A — evita el paso extra de "¿deseas guardar este email?".
  const emailParamLower = emailParamLimpio.toLowerCase();
  const yaEstabaGuardado =
    emailParamLower &&
    (emailParamLower === (emailEnBD || '').toLowerCase() ||
      emailParamLower === (emailEnSoftec || '').toLowerCase());
  if (emailParamLimpio && !yaEstabaGuardado) {
    try {
      await cobranzasExecute(
        `INSERT INTO cobranza_clientes_enriquecidos (empresa_id, codigo_cliente, email, canal_preferido, actualizado_por)
         VALUES (1, ?, ?, 'EMAIL', 'bot-auto-correo')
         ON DUPLICATE KEY UPDATE email = VALUES(email), actualizado_por = VALUES(actualizado_por)`,
        [codigoCliente, emailParamLimpio]
      );
    } catch (err) {
      // No bloqueamos la generación del draft por un fallo del guardado.
      console.error('[proponerCorreoCliente] guardado auto de email falló:', err);
    }
  }

  // 6. Contacto para saludo (memoria si existe, luego Softec IC_CONTACT, luego nombre empresa)
  const memoriaRows = await cobranzasQuery<{ contacto_real: string | null }>(
    'SELECT contacto_real FROM cobranza_memoria_cliente WHERE empresa_id = 1 AND codigo_cliente = ?',
    [codigoCliente]
  );
  const contactoNombre =
    memoriaRows[0]?.contacto_real ||
    (masUrgente.contacto_cobros ? String(masUrgente.contacto_cobros).trim() : '') ||
    nombreCliente;

  // 7. Seleccionar plantilla — siempre obligatoria
  const saldoNeto = Math.max(0, saldoTotal - saldoFavor);

  const plantilla = plantillaId
    ? await seleccionarPlantillaById(plantillaId, EMPRESA_GUIPAK)
    : await seleccionarPlantilla({ segmento, diasVencido: diasMaxVencido, empresaId: EMPRESA_GUIPAK });

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
      empresa_id, ij_local, ij_typedoc, ij_inum, codigo_cliente,
      total_factura, saldo_pendiente, moneda,
      fecha_vencimiento, dias_vencido, segmento_riesgo,
      canal, mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
      estado, ultima_consulta_softec, creado_por
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EMAIL', NULL, ?, ?, 'PENDIENTE', NOW(), ?)`,
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
      creadoPor,
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
