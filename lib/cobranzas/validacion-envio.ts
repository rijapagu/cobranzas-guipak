import { cobranzasQuery } from '@/lib/db/cobranzas';

/**
 * Validación doble antes de enviar cobranza (SPEC §2.3):
 * además del saldo en Softec (CP-06), verificar la conciliación bancaria.
 *
 * Si el cliente tiene depósitos POR_APLICAR (dinero ya recibido en el banco
 * que aún no se registró en Softec), cobrar sería un error vergonzoso:
 * el supervisor debe aplicar primero ese pago.
 */
export async function pagosPorAplicar(
  codigoCliente: string,
  empresaId: number
): Promise<{ cantidad: number; total: number }> {
  const rows = await cobranzasQuery<{ n: number; total: number | null }>(
    `SELECT COUNT(*) AS n, SUM(monto) AS total
     FROM cobranza_conciliacion
     WHERE empresa_id = ? AND estado = 'POR_APLICAR' AND TRIM(codigo_cliente) = ?`,
    [empresaId, codigoCliente]
  );
  return {
    cantidad: Number(rows[0]?.n) || 0,
    total: Number(rows[0]?.total) || 0,
  };
}
