/**
 * Detección de clientes vencidos sin datos de contacto — Asistente Cobros #9
 *
 * Cron diario (sugerido 8:15 AM AST) que recorre la cartera vencida y crea
 * tareas en /tareas para que el equipo complete email/WhatsApp/contacto de
 * cobros faltante. Sin estos datos, la cadencia automatica no puede emitir
 * gestiones efectivas y el cliente queda en limbo.
 *
 * Reutiliza la logica de la tool `listar_clientes_con_datos_faltantes` pero
 * desde el cron (no on-demand del bot): genera 1 tarea por cliente con
 * datos faltantes, idempotente, prioridad por saldo neto.
 *
 * Idempotente: skip si ya hay tarea PENDIENTE/EN_PROGRESO con
 * origen='DATO_FALTANTE' origen_ref='cliente:{codigo}'.
 *
 * Acuerdo Ricardo 2026-06-01. Memoria: project_cobros_frontera_asistente_supervisor.md
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';

const SALDO_NETO_MIN_DOP = Number(process.env.DATOS_FALTANTES_SALDO_MIN_DOP ?? 10_000);
const SALDO_NETO_ALTA_DOP = Number(process.env.DATOS_FALTANTES_SALDO_ALTA_DOP ?? 100_000);

interface ClienteSoftec {
  codigo: string;
  nombre: string;
  email_softec: string | null;
  telefono_softec: string | null;
  saldo_bruto: number;
  facturas: number;
}

interface StatsDatosFaltantes {
  clientes_vencidos_evaluados: number;
  faltan_email: number;
  faltan_whatsapp: number;
  faltan_ambos: number;
  tareas_creadas: number;
  skip_ya_existe: number;
  skip_saldo_bajo: number;
  skip_softec_offline: number;
}

function formatearMontoDOP(monto: number): string {
  return `RD$${monto.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

export async function ejecutarDatosFaltantes(): Promise<StatsDatosFaltantes> {
  const stats: StatsDatosFaltantes = {
    clientes_vencidos_evaluados: 0,
    faltan_email: 0,
    faltan_whatsapp: 0,
    faltan_ambos: 0,
    tareas_creadas: 0,
    skip_ya_existe: 0,
    skip_saldo_bajo: 0,
    skip_softec_offline: 0,
  };

  const softecOk = await testSoftecConnection();
  if (!softecOk) {
    stats.skip_softec_offline = 1;
    console.error('[datos-faltantes] Sin conexion a Softec, abortando');
    return stats;
  }

  // Cartera vencida con datos de contacto desde Softec
  const clientesSoftec = await softecQuery<ClienteSoftec>(`
    SELECT
      c.IC_CODE  AS codigo,
      c.IC_NAME  AS nombre,
      c.IC_ARCONTC AS email_softec,
      c.IC_PHONE AS telefono_softec,
      SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_bruto,
      COUNT(f.IJ_INUM) AS facturas
    FROM v_cobr_ijnl f
    INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
    WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
      AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      AND DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 0
    GROUP BY c.IC_CODE, c.IC_NAME, c.IC_ARCONTC, c.IC_PHONE
    ORDER BY saldo_bruto DESC
    LIMIT 300
  `);

  stats.clientes_vencidos_evaluados = clientesSoftec.length;
  if (clientesSoftec.length === 0) return stats;

  // Datos enriquecidos locales
  const codigos = clientesSoftec.map((c) => String(c.codigo).trim());
  const placeholders = codigos.map(() => '?').join(',');
  const enriqRows = await cobranzasQuery<{
    codigo_cliente: string;
    email: string | null;
    whatsapp: string | null;
  }>(
    `SELECT codigo_cliente, email, whatsapp
     FROM cobranza_clientes_enriquecidos
     WHERE codigo_cliente IN (${placeholders})`,
    codigos
  );
  const enriqMap = new Map(enriqRows.map((r) => [String(r.codigo_cliente).trim(), r]));

  // Saldos a favor (CP-15) para calcular saldo neto real
  const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);

  // Idempotencia: cargar tareas DATO_FALTANTE activas para estos clientes
  const refsBuscadas = codigos.map((c) => `cliente:${c}`);
  const tareasExistentes = await cobranzasQuery<{ origen_ref: string }>(
    `SELECT origen_ref
     FROM cobranza_tareas
     WHERE origen='DATO_FALTANTE'
       AND origen_ref IN (${refsBuscadas.map(() => '?').join(',')})
       AND estado IN ('PENDIENTE','EN_PROGRESO')`,
    refsBuscadas
  );
  const yaConTarea = new Set(tareasExistentes.map((t) => t.origen_ref));

  for (const c of clientesSoftec) {
    const codigo = String(c.codigo).trim();
    const enriq = enriqMap.get(codigo);

    const tieneEmail = !!(
      (c.email_softec && c.email_softec.trim()) ||
      (enriq?.email && enriq.email.trim())
    );
    const tieneWhatsapp = !!(
      (c.telefono_softec && c.telefono_softec.trim()) ||
      (enriq?.whatsapp && enriq.whatsapp.trim())
    );

    if (tieneEmail && tieneWhatsapp) continue; // tiene todo, skip

    const faltaEmail = !tieneEmail;
    const faltaWhatsapp = !tieneWhatsapp;

    if (faltaEmail && faltaWhatsapp) stats.faltan_ambos++;
    else if (faltaEmail) stats.faltan_email++;
    else stats.faltan_whatsapp++;

    // Calcular saldo neto (CP-15)
    const saldoBruto = Number(c.saldo_bruto) || 0;
    const favor = saldosFavor.get(codigo) ?? 0;
    const saldoNeto = Math.max(0, saldoBruto - favor);

    if (saldoNeto < SALDO_NETO_MIN_DOP) {
      stats.skip_saldo_bajo++;
      continue;
    }

    if (yaConTarea.has(`cliente:${codigo}`)) {
      stats.skip_ya_existe++;
      continue;
    }

    // Construir descripcion segun que falta
    const faltantes: string[] = [];
    if (faltaEmail) faltantes.push('EMAIL');
    if (faltaWhatsapp) faltantes.push('WHATSAPP');
    const faltanTxt = faltantes.join(' + ');

    const nombre = String(c.nombre).trim();
    const prioridad: 'ALTA' | 'MEDIA' = saldoNeto >= SALDO_NETO_ALTA_DOP ? 'ALTA' : 'MEDIA';
    const titulo = `Falta ${faltanTxt} para ${nombre}`;

    const descripcion =
      `Cliente ${nombre} (${codigo}) tiene ${c.facturas} factura(s) vencida(s) ` +
      `con saldo neto ${formatearMontoDOP(saldoNeto)} pero faltan datos de contacto: ${faltanTxt}.\n\n` +
      `Sin estos datos, la cadencia automatica no puede emitir gestiones efectivas. ` +
      `Por favor obtener${faltaEmail ? ' email' : ''}` +
      `${faltaEmail && faltaWhatsapp ? ' y' : ''}` +
      `${faltaWhatsapp ? ' WhatsApp/telefono' : ''} y guardarlo:\n\n` +
      `• Desde Telegram: pidele al bot "guardar email/WhatsApp para ${nombre}" con el dato.\n` +
      `• Desde /clientes: editar el cliente y completar los campos faltantes.\n\n` +
      `Marcar tarea HECHA cuando el dato este registrado.`;

    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente,
          prioridad, asignada_a, creado_por, origen, origen_ref)
       VALUES (?, ?, 'DOCUMENTO', CURDATE(), ?, ?, 'sistema',
               'cron-datos-faltantes', 'DATO_FALTANTE', ?)`,
      [
        titulo,
        descripcion,
        codigo,
        prioridad,
        `cliente:${codigo}`,
      ]
    );
    stats.tareas_creadas++;
  }

  return stats;
}
