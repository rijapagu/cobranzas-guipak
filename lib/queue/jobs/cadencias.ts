/**
 * Capa D — Cadencias automáticas
 *
 * Evaluación horaria de la cartera vencida contra la configuración de
 * cobranza_cadencias. Por cada factura, determina si corresponde ejecutar
 * el siguiente paso de la cadencia y crea la gestión o tarea apropiada.
 *
 * Protección anti-flood en primer run: si una factura no tiene registro de
 * cadencia y lleva > 30 días vencida, se hace fast-forward (se registra el
 * paso más alto aplicable sin crear gestión). Solo facturas que cruzan un
 * nuevo umbral generan acción.
 *
 * CP-02: gestiones de EMAIL/WHATSAPP con requiere_aprobacion=1 → estado
 * PENDIENTE (nunca se envían sin aprobación).
 * CP-03: facturas en disputa activa se omiten.
 * CP-15: clientes cubiertos por anticipo se omiten.
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { seleccionarPlantilla } from '@/lib/templates/seleccionar';
import { renderPlantilla } from '@/lib/templates/render';
import { generarMensajeCobranza } from '@/lib/claude/client';

const MAX_PASOS_POR_RUN = 30;
const DIAS_FLOOD_PROTECTION = 30;

interface Cadencia {
  id: number;
  segmento: string;
  dia_desde_vencimiento: number;
  accion: 'EMAIL' | 'WHATSAPP' | 'LLAMADA_TICKET' | 'RECLASIFICAR' | 'ESCALAR_LEGAL';
  requiere_aprobacion: number;
  plantilla_mensaje_id: number | null;
}

interface FacturaVencida {
  ij_inum: number;
  ij_local: string;
  ij_typedoc: string;
  codigo_cliente: string;
  nombre_cliente: string;
  ncf_fiscal: string;
  total_factura: number;
  saldo_pendiente: number;
  fecha_vencimiento: Date;
  dias_vencida: number;
  segmento: string;
  contacto_cobros: string | null;
  email: string | null;
  telefono: string | null;
}

interface CadenciaEstado {
  ultimo_paso_id: number | null;
  ultimo_dia_aplicado: number | null;
  omitir_pasos_previos: number;
  pausada_hasta: Date | null;
}

function calcularSegmento(dias: number): string {
  if (dias < 1) return 'VERDE';
  if (dias <= 15) return 'AMARILLO';
  if (dias <= 30) return 'NARANJA';
  return 'ROJO';
}

export async function ejecutarCadenciasHorarias(): Promise<{
  evaluadas: number;
  aplicadas: number;
  fastForward: number;
  omitidas: number;
}> {
  const stats = { evaluadas: 0, aplicadas: 0, fastForward: 0, omitidas: 0 };

  const softecOk = await testSoftecConnection();
  if (!softecOk) {
    console.error('[cadencias] Sin conexión a Softec, abortando');
    return stats;
  }

  // Cargar configuración de cadencias activas
  const cadencias = await cobranzasQuery<Cadencia>(
    'SELECT id, segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id FROM cobranza_cadencias WHERE activa=1 ORDER BY dia_desde_vencimiento ASC'
  );
  if (cadencias.length === 0) {
    console.log('[cadencias] Sin cadencias activas configuradas');
    return stats;
  }

  // Obtener facturas vencidas desde Softec
  const facturas = await softecQuery<FacturaVencida>(`
    SELECT
      f.IJ_INUM            AS ij_inum,
      'GUI'                AS ij_local,
      f.IJ_TYPEDOC         AS ij_typedoc,
      c.IC_CODE            AS codigo_cliente,
      c.IC_NAME            AS nombre_cliente,
      f.IJ_NCFNUM          AS ncf_fiscal,
      f.IJ_TOT             AS total_factura,
      (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_pendiente,
      f.IJ_DUEDATE         AS fecha_vencimiento,
      DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencida,
      CASE
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1  AND 15 THEN 'AMARILLO'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30               THEN 'ROJO'
        ELSE 'VERDE'
      END AS segmento,
      c.IC_CONTACT         AS contacto_cobros,
      c.IC_ARCONTC         AS email,
      c.IC_PHONE           AS telefono
    FROM v_cobr_ijnl f
    INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
    WHERE f.IJ_TYPEDOC = 'IN'
      AND f.IJ_INVTORF = 'T'
      AND f.IJ_PAID = 'F'
      AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      AND DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 0
    ORDER BY DATEDIFF(CURDATE(), f.IJ_DUEDATE) ASC
    LIMIT 500
  `);

  if (facturas.length === 0) return stats;
  stats.evaluadas = facturas.length;

  // Exclusiones: disputas activas
  const disputasRows = await cobranzasQuery<{ ij_inum: number }>(
    "SELECT DISTINCT ij_inum FROM cobranza_disputas WHERE estado IN ('ABIERTA','EN_REVISION')"
  );
  const disputas = new Set(disputasRows.map((d) => d.ij_inum));

  // Exclusiones: clientes pausados / no contactar
  const pausadosRows = await cobranzasQuery<{ codigo_cliente: string }>(
    "SELECT codigo_cliente FROM cobranza_clientes_enriquecidos WHERE no_contactar=1 OR (pausa_hasta IS NOT NULL AND pausa_hasta > NOW())"
  );
  const pausados = new Set(pausadosRows.map((p) => String(p.codigo_cliente).trim()));

  // CP-15: clientes cubiertos por anticipo
  const codigos = [...new Set(facturas.map((f) => String(f.codigo_cliente).trim()))];
  const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);
  const pendientesPorCliente = new Map<string, number>();
  for (const f of facturas) {
    const c = String(f.codigo_cliente).trim();
    pendientesPorCliente.set(c, (pendientesPorCliente.get(c) ?? 0) + Number(f.saldo_pendiente));
  }
  const cubiertos = new Set<string>();
  for (const [codigo, pendiente] of pendientesPorCliente) {
    const favor = saldosFavor.get(codigo) ?? 0;
    if (favor >= pendiente && pendiente > 0) cubiertos.add(codigo);
  }

  // Cargar estados de cadencia existentes (una sola query)
  const inums = facturas.map((f) => f.ij_inum);
  const estadosRows = await cobranzasQuery<{
    factura_id: string;
    ultimo_paso_id: number | null;
    ultimo_dia_aplicado: number | null;
    omitir_pasos_previos: number;
    pausada_hasta: string | null;
  }>(
    `SELECT factura_id, ultimo_paso_id, ultimo_dia_aplicado, omitir_pasos_previos, pausada_hasta
     FROM cobranza_factura_cadencia_estado
     WHERE factura_id IN (${inums.map(() => '?').join(',')})`,
    inums.map(String)
  );
  const estadoMap = new Map<string, CadenciaEstado>(
    estadosRows.map((r) => [
      r.factura_id,
      {
        ultimo_paso_id: r.ultimo_paso_id,
        ultimo_dia_aplicado: r.ultimo_dia_aplicado,
        omitir_pasos_previos: r.omitir_pasos_previos,
        pausada_hasta: r.pausada_hasta ? new Date(r.pausada_hasta) : null,
      },
    ])
  );

  // Cargar PDFs disponibles (de webhook CRM o vinculación manual)
  const pdfRows = await cobranzasQuery<{ ij_inum: number; url_pdf: string; google_drive_id: string }>(
    `SELECT ij_inum, url_pdf, google_drive_id FROM cobranza_facturas_documentos
     WHERE ij_inum IN (${inums.map(() => '?').join(',')})`,
    inums.map(String)
  );
  const pdfMap = new Map(pdfRows.map((r) => [Number(r.ij_inum), { url_pdf: r.url_pdf, google_drive_id: r.google_drive_id }]));

  let pasosAplicados = 0;

  for (const factura of facturas) {
    if (pasosAplicados >= MAX_PASOS_POR_RUN) break;

    const ij = factura.ij_inum;
    const facturaId = String(ij);
    const codigoCliente = String(factura.codigo_cliente).trim();
    const diasVencida = Number(factura.dias_vencida);

    // Exclusiones
    if (disputas.has(ij)) { stats.omitidas++; continue; }
    if (pausados.has(codigoCliente)) { stats.omitidas++; continue; }
    if (cubiertos.has(codigoCliente)) { stats.omitidas++; continue; }

    const estado = estadoMap.get(facturaId);

    // Pausa de cadencia individual
    if (estado?.pausada_hasta && estado.pausada_hasta > new Date()) {
      stats.omitidas++;
      continue;
    }

    const ultimoDia = estado?.ultimo_dia_aplicado ?? -1;

    // Encontrar el siguiente paso aplicable:
    // todos los pasos con dia <= dias_vencida y dia > ultimo_dia_aplicado
    const pasosAplicables = cadencias.filter(
      (c) => c.dia_desde_vencimiento <= diasVencida && c.dia_desde_vencimiento > ultimoDia
    );

    if (pasosAplicables.length === 0) continue;

    // PROTECCIÓN ANTI-FLOOD: primer run de factura con > DIAS_FLOOD_PROTECTION días
    // → fast-forward al paso más alto sin crear gestión
    if (!estado && diasVencida > DIAS_FLOOD_PROTECTION) {
      const pasoMasAlto = pasosAplicables[pasosAplicables.length - 1];
      await upsertEstado(facturaId, pasoMasAlto.id, pasoMasAlto.dia_desde_vencimiento, true);
      stats.fastForward++;
      continue;
    }

    // Tomar el primer paso pendiente (el de menor dia)
    const paso = pasosAplicables[0];

    try {
      const pdf = pdfMap.get(factura.ij_inum);
      await aplicarPaso(paso, factura, estado, pdf);
      await upsertEstado(facturaId, paso.id, paso.dia_desde_vencimiento, false);
      pasosAplicados++;
      stats.aplicadas++;
    } catch (err) {
      console.error(`[cadencias] Error en factura ${ij}:`, err);
    }
  }

  console.log(
    `[cadencias] ${stats.evaluadas} evaluadas | ${stats.aplicadas} aplicadas | ${stats.fastForward} fast-forward | ${stats.omitidas} omitidas`
  );

  await logAccion(
    'sistema',
    'CADENCIAS_HORARIAS',
    'sistema',
    'run',
    { ...stats, timestamp: new Date().toISOString() }
  );

  return stats;
}

async function upsertEstado(
  facturaId: string,
  pasoId: number,
  dia: number,
  omitir: boolean
): Promise<void> {
  await cobranzasExecute(
    `INSERT INTO cobranza_factura_cadencia_estado
       (factura_id, ultimo_paso_id, fecha_ultimo_paso, ultimo_dia_aplicado, omitir_pasos_previos)
     VALUES (?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       ultimo_paso_id = VALUES(ultimo_paso_id),
       fecha_ultimo_paso = VALUES(fecha_ultimo_paso),
       ultimo_dia_aplicado = VALUES(ultimo_dia_aplicado),
       omitir_pasos_previos = VALUES(omitir_pasos_previos)`,
    [facturaId, pasoId, dia, omitir ? 1 : 0]
  );
}

async function aplicarPaso(
  paso: Cadencia,
  factura: FacturaVencida,
  _estado: CadenciaEstado | undefined,
  pdf?: { url_pdf: string; google_drive_id: string }
): Promise<void> {
  const segmento = factura.segmento as 'VERDE' | 'AMARILLO' | 'NARANJA' | 'ROJO';
  const diasVencida = Number(factura.dias_vencida);
  const codigoCliente = String(factura.codigo_cliente).trim();

  if (paso.accion === 'LLAMADA_TICKET') {
    // Crear tarea de seguimiento
    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente, prioridad, asignada_a, creado_por, origen)
       VALUES (?, ?, 'LLAMAR', CURDATE(), ?, ?, 'sistema', 'cadencias', 'CADENCIA')`,
      [
        `Llamar a ${String(factura.nombre_cliente).trim()} — Factura #${factura.ij_inum}`,
        `Cadencia automática día ${paso.dia_desde_vencimiento}. Saldo: RD$${Number(factura.saldo_pendiente).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        codigoCliente,
        diasVencida >= 30 ? 'ALTA' : 'MEDIA',
      ]
    );
    return;
  }

  if (paso.accion === 'RECLASIFICAR') {
    // No action needed — segment is calculated dynamically
    return;
  }

  // EMAIL, WHATSAPP o ESCALAR_LEGAL → crear gestión
  const canal = paso.accion === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL';
  const estado = paso.requiere_aprobacion ? 'PENDIENTE' : 'APROBADO';

  // Verificar que no haya gestión PENDIENTE para esta factura
  const yaExiste = await cobranzasQuery<{ id: number }>(
    "SELECT id FROM cobranza_gestiones WHERE ij_inum = ? AND estado='PENDIENTE' LIMIT 1",
    [factura.ij_inum]
  );
  if (yaExiste.length > 0) return;

  let mensajeEmail = '';
  let mensajeWa = '';
  let asunto = '';

  if (canal === 'EMAIL') {
    try {
      const plantilla = await seleccionarPlantilla({ segmento, diasVencido: diasVencida });
      if (plantilla) {
        const contacto = factura.contacto_cobros ? String(factura.contacto_cobros).trim() : '';
        const rendered = renderPlantilla(
          { asunto: plantilla.asunto, cuerpo: plantilla.cuerpo },
          {
            cliente: contacto || String(factura.nombre_cliente).trim(),
            empresa_cliente: String(factura.nombre_cliente).trim(),
            numero_factura: factura.ij_inum,
            ncf_fiscal: factura.ncf_fiscal ? String(factura.ncf_fiscal).trim() : '',
            monto: Number(factura.saldo_pendiente),
            moneda: 'DOP',
            fecha_vencimiento: new Date(factura.fecha_vencimiento).toISOString().split('T')[0],
            dias_vencida: diasVencida,
          }
        );
        asunto = rendered.asunto;
        mensajeEmail = rendered.cuerpo;
      } else {
        const generado = await generarMensajeCobranza({
          nombre_cliente: String(factura.nombre_cliente).trim(),
          contacto_cobros: factura.contacto_cobros ? String(factura.contacto_cobros).trim() : '',
          codigo_cliente: codigoCliente,
          numero_factura: factura.ij_inum,
          ncf_fiscal: factura.ncf_fiscal ? String(factura.ncf_fiscal).trim() : '',
          saldo_pendiente: Number(factura.saldo_pendiente),
          moneda: 'DOP',
          dias_vencido: diasVencida,
          fecha_vencimiento: new Date(factura.fecha_vencimiento).toISOString().split('T')[0],
          segmento_riesgo: segmento,
          tiene_pdf: !!pdf,
          url_pdf: pdf?.url_pdf || '',
        });
        asunto = generado.asunto_email;
        mensajeEmail = generado.mensaje_email;
      }
    } catch {
      asunto = `Cobranza Guipak — Factura #${factura.ij_inum}`;
      mensajeEmail = '';
    }
  }

  if (canal === 'WHATSAPP') {
    mensajeWa = `Estimado cliente de ${String(factura.nombre_cliente).trim()}, le recordamos que la factura #${factura.ij_inum} por RD$${Number(factura.saldo_pendiente).toLocaleString('en-US', { minimumFractionDigits: 2 })} lleva ${diasVencida} días vencida. Comuníquese con nosotros para coordinar el pago. Gracias.`;
  }

  const aprobadoPor = estado === 'APROBADO' ? 'cadencias-auto' : null;

  await cobranzasExecute(
    `INSERT INTO cobranza_gestiones (
      ij_local, ij_typedoc, ij_inum, codigo_cliente,
      total_factura, saldo_pendiente, moneda,
      fecha_vencimiento, dias_vencido, segmento_riesgo,
      canal, mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
      estado, aprobado_por, ultima_consulta_softec, creado_por,
      tiene_pdf, url_pdf
    ) VALUES (?, ?, ?, ?, ?, ?, 'DOP', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'cadencias', ?, ?)`,
    [
      factura.ij_local || 'GUI',
      factura.ij_typedoc,
      factura.ij_inum,
      codigoCliente,
      Number(factura.total_factura),
      Number(factura.saldo_pendiente),
      new Date(factura.fecha_vencimiento).toISOString().split('T')[0],
      diasVencida,
      segmento,
      canal,
      mensajeWa || null,
      mensajeEmail || null,
      asunto || null,
      estado,
      aprobadoPor,
      pdf ? 1 : 0,
      pdf?.url_pdf || null,
    ]
  );
}
