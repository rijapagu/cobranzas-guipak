/**
 * Adaptador Softec → modelo canónico (Fase 3).
 *
 * Encapsula las queries IJ_ / IC_ contra las vistas v_cobr_ (CP-01: solo
 * lectura). Etapa 2: ESTA es la única fuente de la query de cartera — las
 * rutas consumen el modelo canónico (o su compat FacturaVencida) y ya no
 * duplican SQL de Softec.
 *
 * Semántica de campos de cliente en Softec:
 *   IC_EMAIL    → email general          (ClienteCartera.email)
 *   IC_ARCONTC  → email de CxP/cobros    (ClienteCartera.emailCobros / FacturaPendiente.emailCliente)
 *   IC_CONTACT  → nombre del contacto    (contactoCobros / contactoCliente)
 */

import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { toYmd } from '@/lib/utils/fechas';
import type {
  ErpAdapter,
  FacturaPendiente,
  ClienteCartera,
  PagoRecibo,
  PagoFactura,
  OpcionesCartera,
} from './tipos';

interface FilaCartera {
  numero: number;
  ncf: string | null;
  codigo_cliente: string;
  nombre_cliente: string;
  razon_social: string | null;
  rnc: string | null;
  email_cxp: string | null;
  telefono: string | null;
  telefono2: string | null;
  contacto: string | null;
  limite_credito: number | null;
  vendedor: string | null;
  localidad: string | null;
  tipo_doc: string | null;
  subtotal: number | null;
  impuesto: number | null;
  total: number;
  pagado: number;
  saldo: number;
  total_dop: number | null;
  pagado_dop: number | null;
  saldo_dop: number | null;
  tasa: number | null;
  terminos: string | null;
  dias_credito: number | null;
  moneda: string | null;
  fecha_emision: string | Date | null;
  fecha_vencimiento: string | Date;
  dias_vencida: number;
  fecha_ultimo_pago?: string | Date | null;
}

function mapFactura(r: FilaCartera): FacturaPendiente {
  const total = Number(r.total) || 0;
  const saldo = Number(r.saldo) || 0;
  return {
    numero: Number(r.numero),
    ncf: r.ncf ? String(r.ncf).trim() : null,
    codigoCliente: String(r.codigo_cliente).trim(),
    nombreCliente: String(r.nombre_cliente).trim(),
    total,
    saldoPendiente: saldo,
    totalPagado: Number(r.pagado) || total - saldo,
    moneda: r.moneda ? String(r.moneda).trim() : 'DOP',
    fechaEmision: r.fecha_emision ? toYmd(r.fecha_emision) : null,
    fechaVencimiento: toYmd(r.fecha_vencimiento),
    diasVencida: Number(r.dias_vencida) || 0,
    razonSocial: r.razon_social ? String(r.razon_social).trim() : null,
    rncCliente: r.rnc ? String(r.rnc).trim() : null,
    emailCliente: r.email_cxp ? String(r.email_cxp).trim() : null,
    telefonoCliente: r.telefono ? String(r.telefono).trim() : null,
    telefono2Cliente: r.telefono2 ? String(r.telefono2).trim() : null,
    contactoCliente: r.contacto ? String(r.contacto).trim() : null,
    vendedor: r.vendedor ? String(r.vendedor).trim() : null,
    limiteCredito: Number(r.limite_credito) || 0,
    localidad: r.localidad ? String(r.localidad).trim() : null,
    tipoDoc: r.tipo_doc ? String(r.tipo_doc).trim() : null,
    subtotalGravable: Number(r.subtotal) || 0,
    impuesto: Number(r.impuesto) || 0,
    totalDop: Number(r.total_dop) || 0,
    totalPagadoDop: Number(r.pagado_dop) || 0,
    saldoPendienteDop: Number(r.saldo_dop) || 0,
    tasaCambio: Number(r.tasa) || 1,
    terminosPago: r.terminos ? String(r.terminos).trim() : null,
    diasCredito: Number(r.dias_credito) || 0,
    fechaUltimoPago: r.fecha_ultimo_pago ? toYmd(r.fecha_ultimo_pago) : null,
  };
}

function mapCliente(r: {
  codigo: string;
  nombre: string;
  rnc: string | null;
  email: string | null;
  email_cxp: string | null;
  telefono: string | null;
  telefono2: string | null;
  contacto: string | null;
  vendedor: string | null;
  limite_credito: number | null;
}): ClienteCartera {
  return {
    codigo: String(r.codigo).trim(),
    nombre: String(r.nombre).trim(),
    rnc: r.rnc ? String(r.rnc).trim() : null,
    email: r.email ? String(r.email).trim() : null,
    emailCobros: r.email_cxp ? String(r.email_cxp).trim() : null,
    telefono: r.telefono ? String(r.telefono).trim() : null,
    telefono2: r.telefono2 ? String(r.telefono2).trim() : null,
    contactoCobros: r.contacto ? String(r.contacto).trim() : null,
    vendedor: r.vendedor ? String(r.vendedor).trim() : null,
    limiteCredito: Number(r.limite_credito) || 0,
  };
}

const SELECT_CLIENTE = `
  IC_CODE AS codigo, IC_NAME AS nombre, IC_RNC AS rnc,
  IC_EMAIL AS email, IC_ARCONTC AS email_cxp,
  IC_PHONE AS telefono, IC_PHONE2 AS telefono2,
  IC_CONTACT AS contacto, IC_SLSCODE AS vendedor, IC_CRDLMT AS limite_credito`;

export const softecAdapter: ErpAdapter = {
  tipo: 'SOFTEC',

  disponible(): Promise<boolean> {
    return testSoftecConnection();
  },

  async carteraPendiente(opciones?: OpcionesCartera): Promise<FacturaPendiente[]> {
    const limite = Math.min(opciones?.limite ?? 5000, 5000);
    // soloVencidas → DATEDIFF >= 1 (equivale al IJ_DUEDATE < CURDATE() legacy).
    const umbralDias = opciones?.soloVencidas ? 1 : -(opciones?.incluirPorVencerDias ?? 0);
    const conUltimoPago = opciones?.incluirUltimoPago === true;

    const filtroCliente = opciones?.codigoCliente ? 'AND f.IJ_CCODE = ?' : '';
    const params: (string | number)[] = [umbralDias];
    if (opciones?.codigoCliente) params.push(opciones.codigoCliente);

    // CP-04: filtros obligatorios IN / T / F / saldo > 0.
    const sqlBase = `
      SELECT
        f.IJ_INUM    AS numero,
        CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0')) AS ncf,
        c.IC_CODE    AS codigo_cliente,
        c.IC_NAME    AS nombre_cliente,
        c.IC_RAZON   AS razon_social,
        c.IC_RNC     AS rnc,
        c.IC_ARCONTC AS email_cxp,
        c.IC_PHONE   AS telefono,
        c.IC_PHONE2  AS telefono2,
        c.IC_CONTACT AS contacto,
        c.IC_CRDLMT  AS limite_credito,
        f.IJ_SLSCODE AS vendedor,
        f.IJ_LOCAL   AS localidad,
        f.IJ_TYPEDOC AS tipo_doc,
        f.IJ_TAXSUB  AS subtotal,
        f.IJ_TAX     AS impuesto,
        f.IJ_TOT     AS total,
        f.IJ_TOTAPPL AS pagado,
        (f.IJ_TOT - f.IJ_TOTAPPL)   AS saldo,
        f.IJ_DTOT    AS total_dop,
        f.IJ_DTOTAPP AS pagado_dop,
        (f.IJ_DTOT - f.IJ_DTOTAPP)  AS saldo_dop,
        f.IJ_CURRENC AS moneda,
        f.IJ_EXCHRAT AS tasa,
        f.IJ_TERMS   AS terminos,
        f.IJ_NET     AS dias_credito,
        f.IJ_DATE    AS fecha_emision,
        f.IJ_DUEDATE AS fecha_vencimiento,
        DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencida
        ${conUltimoPago ? ', MAX(r.IR_PDATE) AS fecha_ultimo_pago' : ''}
      FROM v_cobr_ijnl f
      INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
      ${conUltimoPago
        ? `LEFT JOIN v_cobr_irjnl r
             ON  r.IR_LOCAL   = f.IJ_LOCAL
             AND r.IR_SINORIN = f.IJ_SINORIN
             AND r.IR_INUM    = f.IJ_INUM
             AND r.IR_CCODE   = f.IJ_CCODE`
        : ''}
      WHERE f.IJ_TYPEDOC = 'IN'
        AND f.IJ_INVTORF = 'T'
        AND f.IJ_PAID = 'F'
        AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
        AND DATEDIFF(CURDATE(), f.IJ_DUEDATE) >= ?
        ${filtroCliente}
      ${conUltimoPago
        ? `GROUP BY
             f.IJ_INUM, f.IJ_NCFFIX, f.IJ_NCFNUM,
             c.IC_CODE, c.IC_NAME, c.IC_RAZON, c.IC_RNC, c.IC_ARCONTC,
             c.IC_PHONE, c.IC_PHONE2, c.IC_CONTACT, c.IC_CRDLMT,
             f.IJ_SLSCODE, f.IJ_LOCAL, f.IJ_TYPEDOC, f.IJ_TAXSUB, f.IJ_TAX,
             f.IJ_TOT, f.IJ_TOTAPPL, f.IJ_DTOT, f.IJ_DTOTAPP,
             f.IJ_CURRENC, f.IJ_EXCHRAT, f.IJ_TERMS, f.IJ_NET,
             f.IJ_DATE, f.IJ_DUEDATE`
        : ''}
      ORDER BY dias_vencida DESC, codigo_cliente ASC
      LIMIT ${limite}`;

    const rows = await softecQuery<FilaCartera>(sqlBase, params);
    return rows.map(mapFactura);
  },

  async saldoFactura(numero: number): Promise<number | null> {
    const rows = await softecQuery<{ saldo: number }>(
      `SELECT (IJ_TOT - IJ_TOTAPPL) AS saldo FROM v_cobr_ijnl
       WHERE IJ_INUM = ? AND IJ_TYPEDOC = 'IN' AND IJ_INVTORF = 'T' LIMIT 1`,
      [numero]
    );
    return rows.length > 0 ? Number(rows[0].saldo) : null;
  },

  async factura(numero: number, codigoCliente?: string): Promise<FacturaPendiente | null> {
    const filtroCliente = codigoCliente ? 'AND f.IJ_CCODE = ?' : '';
    const params: (string | number)[] = [numero];
    if (codigoCliente) params.push(codigoCliente);
    // Sin filtro IJ_PAID: una disputa puede referirse a una factura ya saldada.
    const rows = await softecQuery<FilaCartera>(
      `SELECT
         f.IJ_INUM    AS numero,
         CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0')) AS ncf,
         c.IC_CODE    AS codigo_cliente,
         c.IC_NAME    AS nombre_cliente,
         c.IC_RAZON   AS razon_social,
         c.IC_RNC     AS rnc,
         c.IC_ARCONTC AS email_cxp,
         c.IC_PHONE   AS telefono,
         c.IC_PHONE2  AS telefono2,
         c.IC_CONTACT AS contacto,
         c.IC_CRDLMT  AS limite_credito,
         f.IJ_SLSCODE AS vendedor,
         f.IJ_LOCAL   AS localidad,
         f.IJ_TYPEDOC AS tipo_doc,
         f.IJ_TAXSUB  AS subtotal,
         f.IJ_TAX     AS impuesto,
         f.IJ_TOT     AS total,
         f.IJ_TOTAPPL AS pagado,
         (f.IJ_TOT - f.IJ_TOTAPPL)  AS saldo,
         f.IJ_DTOT    AS total_dop,
         f.IJ_DTOTAPP AS pagado_dop,
         (f.IJ_DTOT - f.IJ_DTOTAPP) AS saldo_dop,
         f.IJ_CURRENC AS moneda,
         f.IJ_EXCHRAT AS tasa,
         f.IJ_TERMS   AS terminos,
         f.IJ_NET     AS dias_credito,
         f.IJ_DATE    AS fecha_emision,
         f.IJ_DUEDATE AS fecha_vencimiento,
         DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencida
       FROM v_cobr_ijnl f
       INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE
       WHERE f.IJ_INUM = ? AND f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T'
         ${filtroCliente}
       LIMIT 1`,
      params
    );
    return rows.length > 0 ? mapFactura(rows[0]) : null;
  },

  async cliente(codigo: string): Promise<ClienteCartera | null> {
    const rows = await softecQuery<Parameters<typeof mapCliente>[0]>(
      `SELECT ${SELECT_CLIENTE} FROM v_cobr_icust WHERE IC_CODE = ? LIMIT 1`,
      [codigo]
    );
    return rows.length > 0 ? mapCliente(rows[0]) : null;
  },

  async clientes(): Promise<ClienteCartera[]> {
    const rows = await softecQuery<Parameters<typeof mapCliente>[0]>(
      `SELECT ${SELECT_CLIENTE} FROM v_cobr_icust WHERE IC_STATUS = 'A'`
    );
    return rows.map(mapCliente);
  },

  async pagosFactura(numero: number, codigoCliente?: string): Promise<PagoFactura[]> {
    const filtroCliente = codigoCliente ? 'AND r.IR_CCODE = ?' : '';
    const params: (string | number)[] = [numero];
    if (codigoCliente) params.push(codigoCliente);

    const rows = await softecQuery<{
      fecha_pago: string | Date;
      tipo_recibo: string | null;
      numero_recibo: number | null;
      monto: number;
      monto_dop: number | null;
      fecha_recibo: string | Date | null;
      total_recibo: number | null;
      referencia: string | null;
    }>(
      `SELECT
         r.IR_PDATE   AS fecha_pago,
         r.IR_PAYDOC  AS tipo_recibo,
         r.IR_RECNUM  AS numero_recibo,
         r.IR_AMTPAID AS monto,
         r.IR_DAMTPAI AS monto_dop,
         p.IJ_DATE    AS fecha_recibo,
         p.IJ_TOT     AS total_recibo,
         p.IJ_DESCR   AS referencia
       FROM v_cobr_irjnl r
       LEFT JOIN v_cobr_ijnl_pay p
         ON  p.IJ_LOCAL  = r.IR_PLOCAL
         AND p.IJ_RECNUM = r.IR_RECNUM
       WHERE r.IR_FINUM = ? ${filtroCliente}
       ORDER BY r.IR_PDATE ASC`,
      params
    );
    return rows.map((r) => ({
      fecha: toYmd(r.fecha_pago),
      tipoRecibo: r.tipo_recibo ? String(r.tipo_recibo).trim() : null,
      numeroRecibo: r.numero_recibo !== null ? Number(r.numero_recibo) : null,
      monto: Number(r.monto) || 0,
      montoDop: Number(r.monto_dop) || 0,
      fechaRecibo: r.fecha_recibo ? toYmd(r.fecha_recibo) : null,
      totalRecibo: Number(r.total_recibo) || 0,
      referencia: r.referencia ? String(r.referencia).trim() : null,
    }));
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
