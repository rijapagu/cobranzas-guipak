/**
 * Generadores de reportes Excel — extraídos literalmente de las 3 rutas web
 * (app/api/cobranzas/reportes/*) para compartirlos con la tool conversacional
 * enviar_reporte_excel. Cada función devuelve el buffer ya armado; quien
 * llama decide si lo sirve como descarga HTTP o lo manda por Telegram.
 */
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { carteraCompatParaEmpresa } from '@/lib/erp/compat';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import * as XLSX from 'xlsx';

export interface ReporteExcel {
  buffer: Buffer;
  filename: string;
  registros: number;
}

/** Idéntico a app/api/cobranzas/reportes/cartera-excel/route.ts. */
export async function generarExcelCartera(empresaId: number): Promise<ReporteExcel> {
  const esGuipak = empresaId === EMPRESA_GUIPAK;
  const adapter = await adaptadorParaEmpresa(empresaId);
  const softecOk = esGuipak && (await adapter.disponible());
  let facturas: Record<string, unknown>[];

  if (!esGuipak || softecOk) {
    const cartera = await carteraCompatParaEmpresa(empresaId, { soloVencidas: true });
    facturas = cartera.map((f) => ({
      'Código Cliente': f.codigo_cliente,
      'Nombre Cliente': f.nombre_cliente,
      'RNC': f.rnc,
      '# Factura': f.numero_interno,
      'NCF': f.ncf_fiscal,
      'Fecha Emisión': f.fecha_emision,
      'Fecha Vencimiento': f.fecha_vencimiento,
      'Días Vencido': f.dias_vencido,
      'Total Factura': f.total_factura,
      'Total Pagado': f.total_pagado,
      'Saldo Pendiente': f.saldo_pendiente,
      'Moneda': f.moneda,
      'Vendedor': f.vendedor,
      'Segmento': f.segmento_riesgo,
      'Email CxP': f.email || '',
      'Teléfono': f.telefono || '',
      'Contacto General': f.contacto_cobros || '',
    }));
  } else {
    const mock = getMockCartera();
    facturas = mock.map((f) => ({
      'Código Cliente': f.codigo_cliente,
      'Nombre Cliente': f.nombre_cliente,
      'RNC': f.rnc,
      '# Factura': f.numero_interno,
      'NCF': f.ncf_fiscal,
      'Fecha Emisión': f.fecha_emision,
      'Fecha Vencimiento': f.fecha_vencimiento,
      'Días Vencido': f.dias_vencido,
      'Total Factura': f.total_factura,
      'Total Pagado': f.total_pagado,
      'Saldo Pendiente': f.saldo_pendiente,
      'Moneda': f.moneda,
      'Vendedor': f.vendedor,
      'Segmento': f.segmento_riesgo,
      'Email': f.email || '',
      'Teléfono': f.telefono || '',
      'Contacto Cobros': f.contacto_cobros || '',
    }));
  }

  // CP-15: columnas "Saldo a Favor (cliente)" y "Saldo Neto (cliente)".
  if (softecOk && facturas.length > 0) {
    const codigos = Array.from(new Set(facturas.map((f) => String(f['Código Cliente']).trim())));
    const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);
    const brutoPorCliente = new Map<string, number>();
    for (const f of facturas) {
      const codigo = String(f['Código Cliente']).trim();
      brutoPorCliente.set(codigo, (brutoPorCliente.get(codigo) ?? 0) + (Number(f['Saldo Pendiente']) || 0));
    }
    facturas = facturas.map((f) => {
      const codigo = String(f['Código Cliente']).trim();
      const favor = saldosFavor.get(codigo) ?? 0;
      const bruto = brutoPorCliente.get(codigo) ?? 0;
      const aplicable = Math.min(bruto, favor);
      const neto = Math.max(0, bruto - favor);
      return {
        ...f,
        'Saldo a Favor (cliente)': aplicable,
        'Saldo Neto (cliente)': neto,
        'Cubierto por Anticipo': favor >= bruto && bruto > 0 ? 'SÍ' : 'NO',
      };
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(facturas);
  ws['!cols'] = [
    { wch: 14 }, { wch: 35 }, { wch: 12 }, { wch: 10 }, { wch: 22 },
    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
    { wch: 15 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 30 },
    { wch: 15 }, { wch: 20 },
    { wch: 18 }, { wch: 18 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Cartera Vencida');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const fecha = new Date().toISOString().split('T')[0];
  return { buffer, filename: `cartera-vencida-${fecha}.xlsx`, registros: facturas.length };
}

/** Idéntico a app/api/cobranzas/reportes/gestiones-excel/route.ts. */
export async function generarExcelGestiones(
  empresaId: number,
  desde?: string,
  hasta?: string
): Promise<ReporteExcel> {
  const desdeF = desde || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const hastaF = hasta || new Date().toISOString().split('T')[0];

  const gestiones = await cobranzasQuery<Record<string, unknown>>(
    `SELECT
      g.id AS 'ID',
      g.codigo_cliente AS 'Código Cliente',
      g.ij_inum AS '# Factura',
      g.segmento_riesgo AS 'Segmento',
      g.canal AS 'Canal',
      g.saldo_pendiente AS 'Saldo',
      g.moneda AS 'Moneda',
      g.dias_vencido AS 'Días Vencido',
      g.estado AS 'Estado',
      g.aprobado_por AS 'Aprobado Por',
      g.fecha_aprobacion AS 'Fecha Aprobación',
      g.fecha_envio AS 'Fecha Envío',
      g.motivo_descarte AS 'Motivo Descarte',
      g.creado_por AS 'Creado Por',
      g.created_at AS 'Fecha Creación'
    FROM cobranza_gestiones g
    WHERE g.empresa_id = ? AND DATE(g.created_at) BETWEEN ? AND ?
    ORDER BY g.created_at DESC`,
    [empresaId, desdeF, hastaF]
  );

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(gestiones);
  ws['!cols'] = [
    { wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    { wch: 15 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 15 },
    { wch: 18 }, { wch: 18 }, { wch: 25 }, { wch: 15 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Gestiones');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { buffer, filename: `gestiones-${desdeF}-a-${hastaF}.xlsx`, registros: gestiones.length };
}

/** Idéntico a app/api/cobranzas/reportes/estado-cuenta-excel/route.ts. */
export interface ReporteEstadoCuenta extends ReporteExcel {
  saldo_bruto: number;
  saldo_a_favor: number;
  saldo_neto: number;
}

export async function generarExcelEstadoCuenta(
  empresaId: number,
  codigoCliente: string
): Promise<ReporteEstadoCuenta> {
  const esGuipak = empresaId === EMPRESA_GUIPAK;
  const adapter = await adaptadorParaEmpresa(empresaId);
  const softecOk = esGuipak && (await adapter.disponible());
  let facturas: Record<string, unknown>[];
  let nombreCliente = codigoCliente;

  if (!esGuipak || softecOk) {
    const [cartera, cli] = await Promise.all([
      adapter.carteraPendiente({ incluirPorVencerDias: 36500, codigoCliente }),
      adapter.cliente(codigoCliente),
    ]);
    const delCliente = cartera.sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
    if (cli) nombreCliente = cli.nombre;
    else if (delCliente[0]) nombreCliente = delCliente[0].nombreCliente;
    facturas = delCliente.map((f) => ({
      'Nombre Cliente': f.nombreCliente,
      '# Factura': f.numero,
      'NCF': f.ncf ?? '',
      'Fecha Emisión': f.fechaEmision ?? '',
      'Fecha Vencimiento': f.fechaVencimiento,
      'Días Vencido': f.diasVencida,
      'Total': f.total,
      'Pagado': f.totalPagado ?? Math.max(0, f.total - f.saldoPendiente),
      'Saldo': f.saldoPendiente,
      'Moneda': f.moneda,
    }));
  } else {
    const mock = getMockCartera().filter((f) => f.codigo_cliente === codigoCliente);
    if (mock.length > 0) nombreCliente = mock[0].nombre_cliente;
    facturas = (mock.length > 0 ? mock : getMockCartera().slice(0, 5)).map((f) => ({
      'Nombre Cliente': f.nombre_cliente,
      '# Factura': f.numero_interno,
      'NCF': f.ncf_fiscal,
      'Fecha Emisión': f.fecha_emision,
      'Fecha Vencimiento': f.fecha_vencimiento,
      'Días Vencido': f.dias_vencido,
      'Total': f.total_factura,
      'Pagado': f.total_pagado,
      'Saldo': f.saldo_pendiente,
      'Moneda': f.moneda,
    }));
  }

  const saldoBruto = facturas.reduce((sum, f) => sum + (Number(f['Saldo']) || 0), 0);
  let saldoAFavor = 0;
  if (softecOk) {
    const favorMap = await obtenerSaldoAFavorPorCliente([codigoCliente]);
    saldoAFavor = favorMap.get(String(codigoCliente).trim()) ?? 0;
  }
  const ajuste = ajustarSaldoCliente(saldoBruto, saldoAFavor);

  if (facturas.length > 0) {
    facturas = facturas.map((f) => ({
      ...f,
      'Saldo a Favor (cliente)': ajuste.saldo_a_favor,
      'Saldo Neto (cliente)': ajuste.saldo_neto,
      'Cubierto por Anticipo': ajuste.cubierto_por_anticipo ? 'SÍ' : 'NO',
    }));
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(facturas);
  ws['!cols'] = [
    { wch: 35 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 8 },
    { wch: 20 }, { wch: 18 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Estado de Cuenta');

  const resumenRows: Record<string, unknown>[] = [
    { Concepto: 'Cliente', Valor: nombreCliente },
    { Concepto: 'Código', Valor: codigoCliente },
    { Concepto: 'Facturas pendientes', Valor: facturas.length },
    { Concepto: 'Saldo bruto (RD$)', Valor: ajuste.saldo_pendiente },
    { Concepto: 'Saldo a favor / anticipos (RD$)', Valor: ajuste.saldo_a_favor },
    { Concepto: 'Saldo neto cobrable (RD$)', Valor: ajuste.saldo_neto },
    { Concepto: 'Cubierto por anticipo', Valor: ajuste.cubierto_por_anticipo ? 'SÍ' : 'NO' },
    {
      Concepto: 'Nota',
      Valor: ajuste.cubierto_por_anticipo
        ? 'El cliente tiene saldo a favor que cubre todo su pendiente.'
        : ajuste.saldo_a_favor > 0
          ? 'El saldo neto descuenta el saldo a favor del cliente.'
          : 'El cliente no tiene saldo a favor.',
    },
  ];
  const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
  wsResumen['!cols'] = [{ wch: 38 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const fecha = new Date().toISOString().split('T')[0];
  const nombreArchivo = nombreCliente.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  return {
    buffer,
    filename: `estado-cuenta-${nombreArchivo}-${fecha}.xlsx`,
    registros: facturas.length,
    saldo_bruto: ajuste.saldo_pendiente,
    saldo_a_favor: ajuste.saldo_a_favor,
    saldo_neto: ajuste.saldo_neto,
  };
}
