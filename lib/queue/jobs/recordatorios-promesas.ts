/**
 * Recordatorios de promesas de pago — Asistente Cobros tareas #3, #4, #12
 *
 * Cron diario (sugerido 7:30 AM AST, antes del empuje matutino) que recorre
 * `cobranza_acuerdos` con estado='PENDIENTE' y crea tareas en
 * `cobranza_tareas` con `origen='ACUERDO_PAGO'` segun la fecha prometida:
 *
 *   Tipo A — fecha_prometida = HOY            → "Hoy debe pagar"
 *   Tipo B — ayer/anteayer (HOY-1 o HOY-2)    → "Verificar pago tras acuerdo"
 *   Tipo C — fecha < HOY-2                    → "Incumplio promesa — escalar"
 *
 * Idempotente: antes de cada INSERT verifica que no exista tarea PENDIENTE
 * o EN_PROGRESO con `origen_ref='acuerdo:{id}'`. El cron puede correrse
 * varias veces al dia sin duplicar.
 *
 * Acordado con Ricardo 2026-06-01 (Camino A — tareas en /tareas).
 * Memoria: project_cobros_frontera_asistente_supervisor.md
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';

const PRIORIDAD_ALTA_UMBRAL_DOP = 200_000;

interface AcuerdoPendiente {
  id: number;
  codigo_cliente: string;
  ij_inum: number;
  monto_prometido: number;
  fecha_prometida: string; // YYYY-MM-DD
  dias_diff: number;       // negativo = futuro, 0 = hoy, positivo = atrasado
}

interface StatsRecordatorios {
  acuerdos_evaluados: number;
  tipo_a_hoy: number;          // creadas
  tipo_b_verificar: number;     // creadas
  tipo_c_incumplida: number;    // creadas
  skip_ya_existe: number;
  skip_sin_nombre: number;
}

/**
 * Calcula prioridad de la tarea segun monto + tipo.
 * - Tipo C (incumplida) siempre ALTA.
 * - Monto > 200k DOP siempre ALTA.
 * - Resto MEDIA.
 */
function calcularPrioridad(monto: number, tipo: 'A' | 'B' | 'C'): 'ALTA' | 'MEDIA' {
  if (tipo === 'C') return 'ALTA';
  if (monto > PRIORIDAD_ALTA_UMBRAL_DOP) return 'ALTA';
  return 'MEDIA';
}

function clasificarTipo(diasDiff: number): 'A' | 'B' | 'C' | null {
  if (diasDiff === 0) return 'A';            // hoy
  if (diasDiff >= 1 && diasDiff <= 2) return 'B'; // ayer, anteayer
  if (diasDiff > 2) return 'C';              // mas de 2 dias atras
  return null;                               // futuro: no aplicable (otro cron)
}

function formatearMontoDOP(monto: number): string {
  return `RD$${monto.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function formatearFecha(fechaIso: string): string {
  // "2026-05-29" -> "29 may 2026"
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [y, m, d] = fechaIso.split('-').map(Number);
  return `${d} ${meses[m - 1]} ${y}`;
}

export async function ejecutarRecordatoriosPromesas(): Promise<StatsRecordatorios> {
  const stats: StatsRecordatorios = {
    acuerdos_evaluados: 0,
    tipo_a_hoy: 0,
    tipo_b_verificar: 0,
    tipo_c_incumplida: 0,
    skip_ya_existe: 0,
    skip_sin_nombre: 0,
  };

  // Cargar todos los acuerdos PENDIENTES cuya fecha es <= hoy (ya pasaron o son hoy).
  // No incluimos futuros porque seria otra mecanica distinta.
  const acuerdos = await cobranzasQuery<AcuerdoPendiente>(
    `SELECT
       id,
       codigo_cliente,
       ij_inum,
       monto_prometido,
       DATE_FORMAT(fecha_prometida, '%Y-%m-%d') AS fecha_prometida,
       DATEDIFF(CURDATE(), fecha_prometida) AS dias_diff
     FROM cobranza_acuerdos
     WHERE estado='PENDIENTE'
       AND fecha_prometida <= CURDATE()
     ORDER BY fecha_prometida ASC`
  );

  stats.acuerdos_evaluados = acuerdos.length;
  if (acuerdos.length === 0) return stats;

  // Idempotencia: cargar tareas ya existentes con origen ACUERDO_PAGO PENDIENTE/EN_PROGRESO
  // para todos los acuerdos en una sola query (evita N+1).
  const refsBuscadas = acuerdos.map((a) => `acuerdo:${a.id}`);
  const placeholdersIds = refsBuscadas.map(() => '?').join(',');
  const tareasExistentes = await cobranzasQuery<{ origen_ref: string }>(
    `SELECT origen_ref
     FROM cobranza_tareas
     WHERE origen='ACUERDO_PAGO'
       AND origen_ref IN (${placeholdersIds})
       AND estado IN ('PENDIENTE','EN_PROGRESO')`,
    refsBuscadas
  );
  const yaConTarea = new Set(tareasExistentes.map((t) => t.origen_ref));

  // Filtrar acuerdos que ya tienen tarea activa
  const acuerdosNuevos = acuerdos.filter((a) => {
    if (yaConTarea.has(`acuerdo:${a.id}`)) {
      stats.skip_ya_existe++;
      return false;
    }
    return true;
  });

  if (acuerdosNuevos.length === 0) return stats;

  // Enriquecer con nombres de cliente desde softec (batch, evita N+1)
  const softecOk = await testSoftecConnection();
  const codigosUnicos = [...new Set(acuerdosNuevos.map((a) => String(a.codigo_cliente).trim()))];
  const nombresMap = new Map<string, string>();

  if (softecOk && codigosUnicos.length > 0) {
    const placeholdersC = codigosUnicos.map(() => '?').join(',');
    const filasNombres = await softecQuery<{ IC_CODE: string; IC_NAME: string }>(
      `SELECT IC_CODE, IC_NAME FROM v_cobr_icust WHERE IC_CODE IN (${placeholdersC}) AND IC_STATUS = 'A'`,
      codigosUnicos
    );
    for (const f of filasNombres) {
      nombresMap.set(String(f.IC_CODE).trim(), String(f.IC_NAME).trim());
    }
  }

  // Generar las tareas
  for (const acuerdo of acuerdosNuevos) {
    const codigoCliente = String(acuerdo.codigo_cliente).trim();
    const nombreCliente = nombresMap.get(codigoCliente);

    if (!nombreCliente) {
      // Cliente no encontrado o softec offline — skip pero contabiliza.
      // El acuerdo sigue PENDIENTE en BD, lo recogera la proxima ejecucion.
      stats.skip_sin_nombre++;
      continue;
    }

    const tipo = clasificarTipo(Number(acuerdo.dias_diff));
    if (!tipo) continue; // futuro, no aplica

    const monto = Number(acuerdo.monto_prometido);
    const prioridad = calcularPrioridad(monto, tipo);

    let titulo = '';
    let descripcion = '';

    switch (tipo) {
      case 'A':
        titulo = `Hoy debe pagar — ${nombreCliente}`;
        descripcion =
          `Cliente ${nombreCliente} (${codigoCliente}) prometio pagar HOY ${formatearMontoDOP(monto)} ` +
          `por la factura #${acuerdo.ij_inum}.\n\n` +
          `Acciones del dia:\n` +
          `• Verificar en conciliacion si el deposito ya llego.\n` +
          `• Si no se ve el pago, llamar al cliente al final del dia.\n` +
          `• Marcar tarea como HECHA solo cuando el pago este confirmado.\n\n` +
          `Acuerdo #${acuerdo.id} | Fecha prometida: ${formatearFecha(acuerdo.fecha_prometida)}`;
        stats.tipo_a_hoy++;
        break;

      case 'B':
        titulo = `Verificar pago de ${nombreCliente}`;
        descripcion =
          `Cliente ${nombreCliente} (${codigoCliente}) prometio pagar ${formatearMontoDOP(monto)} ` +
          `el ${formatearFecha(acuerdo.fecha_prometida)} (hace ${acuerdo.dias_diff} dia${acuerdo.dias_diff > 1 ? 's' : ''}).\n\n` +
          `Acciones:\n` +
          `• Revisar conciliacion bancaria — puede que el deposito haya llegado y este sin asignar.\n` +
          `• Si no aparece el pago, llamar al cliente para confirmar estado.\n` +
          `• Cerrar tarea cuando se confirme cumplimiento o se renegocie.\n\n` +
          `Acuerdo #${acuerdo.id} | Factura #${acuerdo.ij_inum}`;
        stats.tipo_b_verificar++;
        break;

      case 'C':
        titulo = `Incumplio promesa — ${nombreCliente}`;
        descripcion =
          `Cliente ${nombreCliente} (${codigoCliente}) prometio pagar ${formatearMontoDOP(monto)} ` +
          `el ${formatearFecha(acuerdo.fecha_prometida)} (hace ${acuerdo.dias_diff} dias). ` +
          `Ya pasaron mas de 2 dias sin cumplir.\n\n` +
          `Considerar:\n` +
          `• Llamar al cliente para entender la causa.\n` +
          `• Renegociar plan si la situacion lo amerita (cambia el acuerdo a CANCELADO + crea nuevo).\n` +
          `• Si no responde o se niega: marcar acuerdo como INCUMPLIDO y escalar a cobranza intensiva.\n\n` +
          `Acuerdo #${acuerdo.id} | Factura #${acuerdo.ij_inum}`;
        stats.tipo_c_incumplida++;
        break;
    }

    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente, ij_inum,
          prioridad, asignada_a, creado_por, origen, origen_ref)
       VALUES (?, ?, 'SEGUIMIENTO', CURDATE(), ?, ?, ?, 'sistema', 'cron-recordatorios-promesas',
               'ACUERDO_PAGO', ?)`,
      [
        titulo,
        descripcion,
        codigoCliente,
        acuerdo.ij_inum,
        prioridad,
        `acuerdo:${acuerdo.id}`,
      ]
    );
  }

  return stats;
}
