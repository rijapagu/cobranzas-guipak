import { cobranzasExecute, cobranzasQuery } from '@/lib/db/cobranzas';

/**
 * Crea automáticamente una tarea de seguimiento al día siguiente de la fecha
 * prometida en un acuerdo de pago. Idempotente por (origen, origen_ref).
 */
export async function crearTareaSeguimientoAcuerdo(opts: {
  acuerdoId: number;
  codigoCliente: string;
  ijInum: number | null;
  fechaPrometida: Date | string;
  registradoPor: string;
}): Promise<number | null> {
  const ref = String(opts.acuerdoId);

  const existentes = await cobranzasQuery<{ id: number }>(
    "SELECT id FROM cobranza_tareas WHERE origen='ACUERDO_PAGO' AND origen_ref = ? LIMIT 1",
    [ref]
  );
  if (existentes.length > 0) return existentes[0].id;

  const promesa = new Date(opts.fechaPrometida);
  if (isNaN(promesa.getTime())) return null;
  const seguimiento = new Date(promesa.getTime() + 24 * 3600 * 1000);
  const fechaIso = seguimiento.toISOString().split('T')[0];

  const titulo = `Verificar pago prometido de ${opts.codigoCliente}`;
  const descripcion = opts.ijInum
    ? `Acuerdo #${opts.acuerdoId} sobre factura ${opts.ijInum}. Confirmar si entró el pago.`
    : `Acuerdo #${opts.acuerdoId}. Confirmar si entró el pago.`;

  const result = await cobranzasExecute(
    `INSERT INTO cobranza_tareas
     (titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente, ij_inum,
      prioridad, creado_por, asignada_a, origen, origen_ref)
     VALUES (?, ?, 'SEGUIMIENTO', ?, ?, ?, 'MEDIA', ?, ?, 'ACUERDO_PAGO', ?)`,
    [
      titulo,
      descripcion,
      fechaIso,
      opts.codigoCliente,
      opts.ijInum,
      opts.registradoPor,
      opts.registradoPor,
      ref,
    ]
  );

  return (result as { insertId?: number }).insertId ?? null;
}
