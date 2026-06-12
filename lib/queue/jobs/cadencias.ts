/**
 * Capa D — Cadencias automáticas (multi-tenant desde Fase 3 Etapa 4)
 *
 * Evaluación horaria de la cartera vencida contra la configuración de
 * cobranza_cadencias, POR EMPRESA: el loop recorre las empresas activas con
 * ERP disponible (Guipak→Softec, tenants→cartera CSV importada) y cada una
 * usa SUS cadencias, SUS plantillas y SU identidad en los mensajes.
 *
 * Protección anti-flood en primer run: si una factura no tiene registro de
 * cadencia y lleva > 30 días vencida, se hace fast-forward (se registra el
 * paso más alto aplicable sin crear gestión). Solo facturas que cruzan un
 * nuevo umbral generan acción.
 *
 * CP-02: gestiones de EMAIL/WHATSAPP con requiere_aprobacion=1 → estado
 * PENDIENTE (nunca se envían sin aprobación).
 * CP-03: facturas en disputa activa se omiten.
 * CP-15: clientes cubiertos por anticipo se omiten (dimensión Softec).
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { seleccionarPlantilla } from '@/lib/templates/seleccionar';
import { renderPlantilla } from '@/lib/templates/render';
import { generarMensajeCobranza } from '@/lib/claude/client';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { configDeEmpresa, type IdentidadEmpresa } from '@/lib/empresas/config';

const MAX_PASOS_POR_RUN = 30;
const DIAS_FLOOD_PROTECTION = 30;
// Ventana preventiva VERDE: facturas que vencen dentro de N días entran al
// pipeline con dias_vencida negativo (paso VERDE con dia_desde_vencimiento < 0).
const DIAS_PREVENTIVO = 5;
// Sentinela "sin paso aplicado": debe ser menor que cualquier
// dia_desde_vencimiento posible, incluidos los negativos del preventivo
// (el antiguo -1 impedía aplicar pasos con día negativo).
const SIN_PASO_APLICADO = -9999;

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
  moneda: string;
  fecha_vencimiento: string;
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

export interface StatsCadencias {
  empresas: number;
  evaluadas: number;
  aplicadas: number;
  fastForward: number;
  omitidas: number;
  /** Errores por factura (visible solo para el operador via cron interno). */
  errores: string[];
}

function calcularSegmento(dias: number): string {
  if (dias < 1) return 'VERDE';
  if (dias <= 15) return 'AMARILLO';
  if (dias <= 30) return 'NARANJA';
  return 'ROJO';
}

/**
 * Loop multi-tenant: corre las cadencias de cada empresa activa.
 * Un fallo en una empresa no detiene a las demás.
 */
export async function ejecutarCadenciasHorarias(): Promise<StatsCadencias> {
  const total: StatsCadencias = { empresas: 0, evaluadas: 0, aplicadas: 0, fastForward: 0, omitidas: 0, errores: [] };

  const empresas = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM empresas WHERE activa = 1 ORDER BY id'
  );

  for (const { id: empresaId } of empresas) {
    try {
      const stats = await ejecutarCadenciasEmpresa(empresaId);
      if (stats === null) continue; // sin ERP disponible o sin cadencias
      total.empresas++;
      total.evaluadas += stats.evaluadas;
      total.aplicadas += stats.aplicadas;
      total.fastForward += stats.fastForward;
      total.omitidas += stats.omitidas;
      total.errores.push(...stats.errores);
    } catch (err) {
      console.error(`[cadencias] Error en empresa ${empresaId}:`, err);
      total.errores.push(`empresa ${empresaId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `[cadencias] ${total.empresas} empresas | ${total.evaluadas} evaluadas | ${total.aplicadas} aplicadas | ${total.fastForward} fast-forward | ${total.omitidas} omitidas`
  );
  return total;
}

async function ejecutarCadenciasEmpresa(
  empresaId: number
): Promise<Omit<StatsCadencias, 'empresas'> | null> {
  const stats: Omit<StatsCadencias, 'empresas'> = { evaluadas: 0, aplicadas: 0, fastForward: 0, omitidas: 0, errores: [] };

  const adapter = await adaptadorParaEmpresa(empresaId);
  if (!(await adapter.disponible())) return null;

  // Cargar configuración de cadencias activas de ESTA empresa
  const cadencias = await cobranzasQuery<Cadencia>(
    'SELECT id, segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id FROM cobranza_cadencias WHERE empresa_id = ? AND activa=1 ORDER BY dia_desde_vencimiento ASC',
    [empresaId]
  );
  if (cadencias.length === 0) return null;

  // Cartera pendiente desde el adaptador ERP (incluye preventivo VERDE),
  // en orden ascendente de mora como el flujo original.
  const cartera = await adapter.carteraPendiente({
    incluirPorVencerDias: DIAS_PREVENTIVO,
    limite: 500,
  });
  const facturas: FacturaVencida[] = cartera
    .map((f) => ({
      ij_inum: f.numero,
      ij_local: f.localidad || (empresaId === EMPRESA_GUIPAK ? 'GUI' : '001'),
      ij_typedoc: f.tipoDoc || 'IN',
      codigo_cliente: f.codigoCliente,
      nombre_cliente: f.nombreCliente,
      ncf_fiscal: f.ncf ?? '',
      total_factura: f.total,
      saldo_pendiente: f.saldoPendiente,
      moneda: f.moneda || 'DOP',
      fecha_vencimiento: f.fechaVencimiento,
      dias_vencida: f.diasVencida,
      segmento: calcularSegmento(f.diasVencida),
      contacto_cobros: f.contactoCliente ?? null,
      email: f.emailCliente ?? null,
      telefono: f.telefonoCliente ?? null,
    }))
    .sort((a, b) => a.dias_vencida - b.dias_vencida);

  if (facturas.length === 0) return stats;
  stats.evaluadas = facturas.length;

  // Identidad de la empresa para los mensajes (IA y fallbacks)
  const { identidad } = await configDeEmpresa(empresaId);

  // Exclusiones: disputas activas
  const disputasRows = await cobranzasQuery<{ ij_inum: number }>(
    "SELECT DISTINCT ij_inum FROM cobranza_disputas WHERE empresa_id = ? AND estado IN ('ABIERTA','EN_REVISION')",
    [empresaId]
  );
  const disputas = new Set(disputasRows.map((d) => d.ij_inum));

  // Exclusiones: clientes pausados / no contactar
  const pausadosRows = await cobranzasQuery<{ codigo_cliente: string }>(
    'SELECT codigo_cliente FROM cobranza_clientes_enriquecidos WHERE empresa_id = ? AND (no_contactar=1 OR (pausa_hasta IS NOT NULL AND pausa_hasta > NOW()))',
    [empresaId]
  );
  const pausados = new Set(pausadosRows.map((p) => String(p.codigo_cliente).trim()));

  // CP-15: clientes cubiertos por anticipo (dimensión Softec — solo Guipak)
  const cubiertos = new Set<string>();
  if (empresaId === EMPRESA_GUIPAK) {
    const codigos = [...new Set(facturas.map((f) => f.codigo_cliente))];
    const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);
    const pendientesPorCliente = new Map<string, number>();
    for (const f of facturas) {
      pendientesPorCliente.set(
        f.codigo_cliente,
        (pendientesPorCliente.get(f.codigo_cliente) ?? 0) + Number(f.saldo_pendiente)
      );
    }
    for (const [codigo, pendiente] of pendientesPorCliente) {
      const favor = saldosFavor.get(codigo) ?? 0;
      if (favor >= pendiente && pendiente > 0) cubiertos.add(codigo);
    }
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
     WHERE empresa_id = ? AND factura_id IN (${inums.map(() => '?').join(',')})`,
    [empresaId, ...inums.map(String)]
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
     WHERE empresa_id = ? AND ij_inum IN (${inums.map(() => '?').join(',')})`,
    [empresaId, ...inums.map(String)]
  );
  const pdfMap = new Map(pdfRows.map((r) => [Number(r.ij_inum), { url_pdf: r.url_pdf, google_drive_id: r.google_drive_id }]));

  let pasosAplicados = 0;

  for (const factura of facturas) {
    if (pasosAplicados >= MAX_PASOS_POR_RUN) break;

    const ij = factura.ij_inum;
    const facturaId = String(ij);
    const codigoCliente = factura.codigo_cliente;
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

    const ultimoDia = estado?.ultimo_dia_aplicado ?? SIN_PASO_APLICADO;

    // Encontrar el siguiente paso aplicable:
    // - dia <= dias_vencida y dia > ultimo_dia_aplicado
    // - y del MISMO segmento que la factura: una cadencia configurada para
    //   ROJO no debe dispararse sobre una factura AMARILLO, y el paso VERDE
    //   preventivo no debe aplicarse a facturas ya vencidas.
    const pasosAplicables = cadencias.filter(
      (c) =>
        c.dia_desde_vencimiento <= diasVencida &&
        c.dia_desde_vencimiento > ultimoDia &&
        c.segmento === factura.segmento
    );

    if (pasosAplicables.length === 0) continue;

    // PROTECCIÓN ANTI-FLOOD: primer run de factura con > DIAS_FLOOD_PROTECTION días
    // → fast-forward al paso más alto sin crear gestión
    if (!estado && diasVencida > DIAS_FLOOD_PROTECTION) {
      const pasoMasAlto = pasosAplicables[pasosAplicables.length - 1];
      await upsertEstado(empresaId, facturaId, pasoMasAlto.id, pasoMasAlto.dia_desde_vencimiento, true);
      stats.fastForward++;
      continue;
    }

    // Tomar el primer paso pendiente (el de menor dia)
    const paso = pasosAplicables[0];

    try {
      const pdf = pdfMap.get(factura.ij_inum);
      await aplicarPaso(empresaId, identidad, paso, factura, pdf);
      await upsertEstado(empresaId, facturaId, paso.id, paso.dia_desde_vencimiento, false);
      pasosAplicados++;
      stats.aplicadas++;
    } catch (err) {
      console.error(`[cadencias] Empresa ${empresaId}, error en factura ${ij}:`, err);
      stats.errores.push(
        `empresa ${empresaId}, factura ${ij}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(
    `[cadencias] Empresa ${empresaId}: ${stats.evaluadas} evaluadas | ${stats.aplicadas} aplicadas | ${stats.fastForward} fast-forward | ${stats.omitidas} omitidas`
  );

  await logAccion(
    'sistema',
    'CADENCIAS_HORARIAS',
    'sistema',
    'run',
    {
      evaluadas: stats.evaluadas,
      aplicadas: stats.aplicadas,
      fastForward: stats.fastForward,
      omitidas: stats.omitidas,
      errores: stats.errores.length,
      timestamp: new Date().toISOString(),
    },
    undefined,
    empresaId
  );

  return stats;
}

async function upsertEstado(
  empresaId: number,
  facturaId: string,
  pasoId: number,
  dia: number,
  omitir: boolean
): Promise<void> {
  await cobranzasExecute(
    `INSERT INTO cobranza_factura_cadencia_estado
       (empresa_id, factura_id, ultimo_paso_id, fecha_ultimo_paso, ultimo_dia_aplicado, omitir_pasos_previos)
     VALUES (?, ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       ultimo_paso_id = VALUES(ultimo_paso_id),
       fecha_ultimo_paso = VALUES(fecha_ultimo_paso),
       ultimo_dia_aplicado = VALUES(ultimo_dia_aplicado),
       omitir_pasos_previos = VALUES(omitir_pasos_previos)`,
    [empresaId, facturaId, pasoId, dia, omitir ? 1 : 0]
  );
}

async function aplicarPaso(
  empresaId: number,
  identidad: IdentidadEmpresa,
  paso: Cadencia,
  factura: FacturaVencida,
  pdf?: { url_pdf: string; google_drive_id: string }
): Promise<void> {
  const segmento = factura.segmento as 'VERDE' | 'AMARILLO' | 'NARANJA' | 'ROJO';
  const diasVencida = Number(factura.dias_vencida);
  const codigoCliente = factura.codigo_cliente;

  if (paso.accion === 'LLAMADA_TICKET') {
    // Crear tarea de seguimiento
    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (empresa_id, titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente, prioridad, asignada_a, creado_por, origen)
       VALUES (?, ?, ?, 'LLAMAR', CURDATE(), ?, ?, 'sistema', 'cadencias', 'CADENCIA')`,
      [
        empresaId,
        `Llamar a ${factura.nombre_cliente} — Factura #${factura.ij_inum}`,
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
  // Regla de oro (CP-02): TODA gestión de cadencia nace PENDIENTE y pasa por
  // aprobación humana. `requiere_aprobacion=0` creaba gestiones APROBADAS con
  // aprobado_por='cadencias-auto' que ningún humano había visto — un "enviar
  // lote" posterior las despachaba sin revisión. La migración 029 normaliza
  // la config; este código lo garantiza aunque la config diga lo contrario.
  const estado = 'PENDIENTE';

  // Verificar que no haya gestión ACTIVA para esta factura (PENDIENTE,
  // APROBADO/EDITADO sin enviar, o ENVIANDO) — evita doble cobro.
  const yaExiste = await cobranzasQuery<{ id: number }>(
    "SELECT id FROM cobranza_gestiones WHERE empresa_id = ? AND ij_inum = ? AND estado IN ('PENDIENTE','APROBADO','EDITADO','ENVIANDO') LIMIT 1",
    [empresaId, factura.ij_inum]
  );
  if (yaExiste.length > 0) return;

  let mensajeEmail = '';
  let mensajeWa = '';
  let asunto = '';

  if (canal === 'EMAIL') {
    try {
      const plantilla = await seleccionarPlantilla({ segmento, diasVencido: diasVencida, empresaId });
      if (plantilla) {
        const contacto = factura.contacto_cobros ?? '';
        const rendered = renderPlantilla(
          { asunto: plantilla.asunto, cuerpo: plantilla.cuerpo },
          {
            cliente: contacto || factura.nombre_cliente,
            empresa_cliente: factura.nombre_cliente,
            numero_factura: factura.ij_inum,
            ncf_fiscal: factura.ncf_fiscal,
            monto: Number(factura.saldo_pendiente),
            moneda: factura.moneda,
            fecha_vencimiento: factura.fecha_vencimiento,
            dias_vencida: diasVencida,
          }
        );
        asunto = rendered.asunto;
        mensajeEmail = rendered.cuerpo;
      } else {
        const generado = await generarMensajeCobranza({
          nombre_cliente: factura.nombre_cliente,
          contacto_cobros: factura.contacto_cobros ?? '',
          codigo_cliente: codigoCliente,
          numero_factura: factura.ij_inum,
          ncf_fiscal: factura.ncf_fiscal,
          saldo_pendiente: Number(factura.saldo_pendiente),
          moneda: factura.moneda,
          dias_vencido: diasVencida,
          fecha_vencimiento: factura.fecha_vencimiento,
          segmento_riesgo: segmento,
          tiene_pdf: !!pdf,
          url_pdf: pdf?.url_pdf || '',
        }, identidad);
        asunto = generado.asunto_email;
        mensajeEmail = generado.mensaje_email;
      }
    } catch {
      asunto = `Cobranza ${identidad.alias} — Factura #${factura.ij_inum}`;
      mensajeEmail = '';
    }
  }

  if (canal === 'WHATSAPP') {
    const saldoFmt = Number(factura.saldo_pendiente).toLocaleString('en-US', { minimumFractionDigits: 2 });
    if (diasVencida < 1) {
      // Preventivo: la factura aún no vence
      mensajeWa = `Estimado cliente de ${factura.nombre_cliente}, le recordamos que la factura #${factura.ij_inum} por RD$${saldoFmt} vence el ${factura.fecha_vencimiento}. Agradecemos programar su pago a tiempo. Gracias. - ${identidad.alias}`;
    } else {
      mensajeWa = `Estimado cliente de ${factura.nombre_cliente}, le recordamos que la factura #${factura.ij_inum} por RD$${saldoFmt} lleva ${diasVencida} días vencida. Comuníquese con nosotros para coordinar el pago. Gracias. - ${identidad.alias}`;
    }
  }

  const aprobadoPor = null;

  const insertGestion = await cobranzasExecute(
    `INSERT INTO cobranza_gestiones (
      empresa_id, ij_local, ij_typedoc, ij_inum, codigo_cliente,
      total_factura, saldo_pendiente, moneda,
      fecha_vencimiento, dias_vencido, segmento_riesgo,
      canal, mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
      estado, aprobado_por, ultima_consulta_softec, creado_por,
      tiene_pdf, url_pdf
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'cadencias', ?, ?)`,
    [
      empresaId,
      factura.ij_local,
      factura.ij_typedoc,
      factura.ij_inum,
      codigoCliente,
      Number(factura.total_factura),
      Number(factura.saldo_pendiente),
      factura.moneda,
      factura.fecha_vencimiento,
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

  // ──────────────────────────────────────────────────────────────────────────
  // Tarea espejo del Asistente Cobros (Camino A — junio 2026)
  //
  // Por cada gestion EMAIL/WHATSAPP que requiere aprobacion humana (estado
  // PENDIENTE), creamos una tarea en cobranza_tareas para que tambien sea
  // visible en /tareas con fecha + prioridad. Origen 'CADENCIA' + origen_ref
  // 'gestion:{id}' permite a la UI saber que tiene un draft asociado y a los
  // endpoints aprobar/descartar de gestiones cerrar la tarea espejo en sync.
  //
  // No se crea para LLAMADA_TICKET (ya se crea como tarea LLAMAR mas arriba)
  // ni para gestiones aprobadas automaticamente (requiere_aprobacion=0).
  // ──────────────────────────────────────────────────────────────────────────
  if (estado === 'PENDIENTE' && insertGestion.insertId) {
    const tipoMsg = canal === 'WHATSAPP' ? 'WhatsApp' : 'correo';
    const titulo = `Aprobar ${tipoMsg} cobranza — ${factura.nombre_cliente}`;
    const previewLen = 140;
    const rawPreview = canal === 'WHATSAPP'
      ? mensajeWa
      : (asunto ? `${asunto} | ${mensajeEmail}` : mensajeEmail);
    const preview = (rawPreview || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, previewLen);
    const previewSuffix = (rawPreview || '').length > previewLen ? '…' : '';
    const saldoFmt = Number(factura.saldo_pendiente).toLocaleString('en-US', {
      minimumFractionDigits: 2,
    });
    const descripcion =
      `Cliente ${factura.nombre_cliente} · Factura #${factura.ij_inum} · ` +
      `Mora ${diasVencida}d (${segmento}) · RD$${saldoFmt}\n\n` +
      `Preview ${tipoMsg}: ${preview}${previewSuffix}\n\n` +
      `Aprobar/editar/rechazar en Cola de Aprobación (gestion #${insertGestion.insertId}).`;
    const prioridad = segmento === 'ROJO' || diasVencida >= 30 ? 'ALTA' : 'MEDIA';

    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (empresa_id, titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente, ij_inum,
          prioridad, asignada_a, creado_por, origen, origen_ref)
       VALUES (?, ?, ?, 'SEGUIMIENTO', CURDATE(), ?, ?, ?, 'sistema', 'cadencias',
               'CADENCIA', ?)`,
      [
        empresaId,
        titulo,
        descripcion,
        codigoCliente,
        factura.ij_inum,
        prioridad,
        `gestion:${insertGestion.insertId}`,
      ]
    );
  }
}
