/**
 * Adaptador Softec → modelo canónico (Fase 3).
 *
 * Encapsula las queries IJ_ / IC_ contra las vistas v_cobr_ (CP-01: solo
 * lectura). En la Etapa 2 del roadmap, los módulos de la app migran de
 * softecQuery directo a este adaptador.
 */

import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { toYmd } from '@/lib/utils/fechas';
import type {
  ErpAdapter,
  FacturaPendiente,
  ClienteCartera,
  PagoRecibo,
  OpcionesCartera,
} from './tipos';

export const softecAdapter: ErpAdapter = {
  tipo: 'SOFTEC',

  disponible(): Promise<boolean> {
    return testSoftecConnection();
  },

  async carteraPendiente(opciones?: OpcionesCartera): Promise<FacturaPendiente[]> {
    const porVencer = opciones?.incluirPorVencerDias ?? 0;
    const limite = Math.min(opciones?.limite ?? 2000, 5000);

    const rows = await softecQuery<{
      numero: number;
      ncf: string | null;
      codigo_cliente: string;
      nombre_cliente: string;
      total: number;
      saldo: number;
      fecha_vencimiento: string | Date;
      dias_vencida: number;
    }>(
      `SELECT
         f.IJ_INUM    AS numero,
         f.IJ_NCFNUM  AS ncf,
         c.IC_CODE    AS codigo_cliente,
         c.IC_NAME    AS nombre_cliente,
         f.IJ_TOT     AS total,
         (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo,
         f.IJ_DUEDATE AS fecha_vencimiento,
         DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencida
       FROM v_cobr_ijnl f
       INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
       WHERE f.IJ_TYPEDOC = 'IN'
         AND f.IJ_INVTORF = 'T'
         AND f.IJ_PAID = 'F'
         AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
         AND DATEDIFF(CURDATE(), f.IJ_DUEDATE) >= ?
       ORDER BY dias_vencida DESC
       LIMIT ${limite}`,
      [-porVencer]
    );

    return rows.map((r) => ({
      numero: Number(r.numero),
      ncf: r.ncf ? String(r.ncf).trim() : null,
      codigoCliente: String(r.codigo_cliente).trim(),
      nombreCliente: String(r.nombre_cliente).trim(),
      total: Number(r.total) || 0,
      saldoPendiente: Number(r.saldo) || 0,
      moneda: 'DOP',
      fechaVencimiento: toYmd(r.fecha_vencimiento),
      diasVencida: Number(r.dias_vencida) || 0,
    }));
  },

  async saldoFactura(numero: number): Promise<number | null> {
    const rows = await softecQuery<{ saldo: number }>(
      `SELECT (IJ_TOT - IJ_TOTAPPL) AS saldo FROM v_cobr_ijnl
       WHERE IJ_INUM = ? AND IJ_TYPEDOC = 'IN' AND IJ_INVTORF = 'T' LIMIT 1`,
      [numero]
    );
    return rows.length > 0 ? Number(rows[0].saldo) : null;
  },

  async cliente(codigo: string): Promise<ClienteCartera | null> {
    const rows = await softecQuery<{
      codigo: string;
      nombre: string;
      rnc: string | null;
      email: string | null;
      telefono: string | null;
      telefono2: string | null;
      contacto: string | null;
      vendedor: string | null;
    }>(
      `SELECT IC_CODE AS codigo, IC_NAME AS nombre, IC_RNC AS rnc,
              IC_ARCONTC AS email, IC_PHONE AS telefono, IC_PHONE2 AS telefono2,
              IC_CONTACT AS contacto, IC_SLSCODE AS vendedor
       FROM v_cobr_icust WHERE IC_CODE = ? LIMIT 1`,
      [codigo]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      codigo: String(r.codigo).trim(),
      nombre: String(r.nombre).trim(),
      rnc: r.rnc ? String(r.rnc).trim() : null,
      email: r.email ? String(r.email).trim() : null,
      telefono: r.telefono ? String(r.telefono).trim() : null,
      telefono2: r.telefono2 ? String(r.telefono2).trim() : null,
      contactoCobros: r.contacto ? String(r.contacto).trim() : null,
      vendedor: r.vendedor ? String(r.vendedor).trim() : null,
    };
  },

  async recibosEnRango(desde: string, hasta: string): Promise<PagoRecibo[]> {
    const rows = await softecQuery<{
      recibo: number;
      codigo_cliente: string;
      monto: number;
      fecha: string | Date;
      metodo: string | null;
    }>(
      `SELECT IJ_RECNUM AS recibo, IJ_CCODE AS codigo_cliente,
              IJ_TOT AS monto, IJ_DATE AS fecha, IJ_PAY AS metodo
       FROM v_cobr_ijnl_pay
       WHERE IJ_SINORIN = 'RC' AND IJ_DATE BETWEEN ? AND ?
       ORDER BY IJ_DATE ASC`,
      [desde, hasta]
    );
    return rows.map((r) => ({
      numeroRecibo: Number(r.recibo),
      codigoCliente: String(r.codigo_cliente).trim(),
      monto: Number(r.monto) || 0,
      fecha: toYmd(r.fecha),
      metodo: r.metodo ? String(r.metodo).trim() : null,
    }));
  },
};
