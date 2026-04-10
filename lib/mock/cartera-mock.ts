/**
 * Datos mock para desarrollo sin conexión a Softec.
 * Simula la cartera vencida real de Guipak con datos dominicanos.
 */

import type { FacturaVencida, ResumenSegmento, PagoAplicado, SegmentoRiesgo } from '@/lib/types/cartera';

const clientes = [
  { codigo: '0000274', nombre: 'COMERCIAL MARTE SRL', razon: 'Comercial Marte S.R.L.', rnc: '131456789', email: 'pagos@comercialmarte.com.do', tel: '809-555-0101', tel2: '', contacto: 'Maria Rodriguez', cobros: 'Juan Perez', vendedor: 'V001' },
  { codigo: '0000312', nombre: 'DISTRIBUIDORA DEL CARIBE', razon: 'Distribuidora del Caribe S.A.S.', rnc: '101234567', email: '', tel: '829-555-0202', tel2: '809-555-0203', contacto: 'Carlos Mejia', cobros: 'Ana Santos', vendedor: 'V002' },
  { codigo: '0000458', nombre: 'FERRETERIA LA UNION', razon: 'Ferreteria La Union S.R.L.', rnc: '131789012', email: 'admin@ferreterialaunion.com', tel: '', tel2: '', contacto: 'Pedro Gonzalez', cobros: '', vendedor: 'V001' },
  { codigo: '0000521', nombre: 'SUPERMERCADO NACIONAL', razon: 'Supermercado Nacional S.A.', rnc: '101567890', email: 'cxp@supernacional.com.do', tel: '809-555-0404', tel2: '', contacto: 'Rosa Castillo', cobros: 'Miguel Torres', vendedor: 'V003' },
  { codigo: '0000642', nombre: 'GRUPO INDUSTRIAL MARTINEZ', razon: 'Grupo Industrial Martinez & Asociados', rnc: '131234567', email: '', tel: '', tel2: '', contacto: 'Luis Martinez', cobros: '', vendedor: 'V002' },
  { codigo: '0000189', nombre: 'IMPORTADORA ORIENTAL SRL', razon: 'Importadora Oriental S.R.L.', rnc: '101890123', email: 'contabilidad@importadoraoriental.com', tel: '849-555-0606', tel2: '809-555-0607', contacto: 'Francisca Reyes', cobros: 'Elena Diaz', vendedor: 'V001' },
  { codigo: '0000733', nombre: 'PLASTICOS DEL NORTE', razon: 'Plasticos del Norte S.R.L.', rnc: '131345678', email: '', tel: '809-555-0808', tel2: '', contacto: 'Roberto Nuñez', cobros: 'Carmen Mora', vendedor: 'V003' },
  { codigo: '0000856', nombre: 'ALIMENTOS CIBAO SAS', razon: 'Alimentos Cibao S.A.S.', rnc: '101456789', email: 'finanzas@alimentoscibao.com.do', tel: '829-555-0909', tel2: '', contacto: 'Sandra Pimentel', cobros: 'Jorge Brito', vendedor: 'V002' },
  { codigo: '0000395', nombre: 'CONSTRUCCIONES OMEGA', razon: 'Construcciones Omega S.R.L.', rnc: '131678901', email: 'pagos@omegaconstrucciones.com', tel: '809-555-1010', tel2: '849-555-1011', contacto: 'Fernando Matos', cobros: 'Lucia Hernandez', vendedor: 'V001' },
  { codigo: '0000967', nombre: 'TEXTILES DOMINICANOS', razon: 'Textiles Dominicanos S.A.', rnc: '101012345', email: '', tel: '809-555-1212', tel2: '', contacto: 'Altagracia Vega', cobros: '', vendedor: 'V003' },
];

function calcularSegmento(dias: number): SegmentoRiesgo {
  if (dias <= 0) return 'VERDE';
  if (dias <= 15) return 'AMARILLO';
  if (dias <= 30) return 'NARANJA';
  return 'ROJO';
}

function generarFactura(
  cliente: typeof clientes[0],
  inum: number,
  diasVencido: number,
  total: number,
  pagado: number,
  moneda: string = 'DOP'
): FacturaVencida {
  const hoy = new Date();
  const vencimiento = new Date(hoy);
  vencimiento.setDate(vencimiento.getDate() - diasVencido);
  const emision = new Date(vencimiento);
  emision.setDate(emision.getDate() - 30);

  const tasa = moneda === 'USD' ? 58.50 : 1;
  const saldo = total - pagado;

  return {
    codigo_cliente: cliente.codigo,
    nombre_cliente: cliente.nombre,
    razon_social: cliente.razon,
    rnc: cliente.rnc,
    email: cliente.email || null,
    telefono: cliente.tel || null,
    telefono2: cliente.tel2 || null,
    contacto_general: cliente.contacto || null,
    contacto_cobros: cliente.cobros || null,
    limite_credito: 500000,
    localidad: '001',
    tipo_doc: 'IN',
    numero_interno: inum,
    ncf_fiscal: `B0100000${String(inum).padStart(4, '0')}`,
    fecha_emision: emision.toISOString().split('T')[0],
    fecha_vencimiento: vencimiento.toISOString().split('T')[0],
    dias_vencido: diasVencido,
    subtotal_gravable: total / 1.18,
    itbis: total - total / 1.18,
    total_factura: total,
    total_pagado: pagado,
    saldo_pendiente: saldo,
    total_factura_dop: total * tasa,
    total_pagado_dop: pagado * tasa,
    saldo_pendiente_dop: saldo * tasa,
    moneda,
    tasa_cambio: tasa,
    terminos_pago: '30 dias neto',
    dias_credito: 30,
    vendedor: cliente.vendedor,
    fecha_ultimo_pago: pagado > 0 ? new Date(hoy.getTime() - diasVencido * 24 * 60 * 60 * 1000 - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
    segmento_riesgo: calcularSegmento(diasVencido),
    tiene_pdf: Math.random() > 0.3,
    url_pdf: null,
  };
}

export function getMockCartera(): FacturaVencida[] {
  return [
    // ROJO (30+ dias) — 12 facturas
    generarFactura(clientes[4], 1001, 1202, 85000, 0),
    generarFactura(clientes[4], 1002, 980, 120000, 30000),
    generarFactura(clientes[4], 1003, 745, 45000, 0),
    generarFactura(clientes[9], 1004, 180, 230000, 50000),
    generarFactura(clientes[9], 1005, 120, 67000, 0),
    generarFactura(clientes[2], 1006, 95, 340000, 100000),
    generarFactura(clientes[6], 1007, 75, 156000, 0),
    generarFactura(clientes[1], 1008, 62, 89000, 20000),
    generarFactura(clientes[0], 1009, 55, 420000, 200000),
    generarFactura(clientes[3], 1010, 45, 175000, 0),
    generarFactura(clientes[7], 1011, 38, 92000, 40000),
    generarFactura(clientes[8], 1012, 35, 310000, 150000),
    // NARANJA (16-30 dias) — 10 facturas
    generarFactura(clientes[0], 1013, 28, 185000, 0),
    generarFactura(clientes[1], 1014, 25, 67500, 0),
    generarFactura(clientes[3], 1015, 23, 290000, 100000),
    generarFactura(clientes[5], 1016, 22, 445000, 200000),
    generarFactura(clientes[7], 1017, 20, 78000, 0),
    generarFactura(clientes[8], 1018, 19, 5200, 0, 'USD'),
    generarFactura(clientes[2], 1019, 18, 125000, 50000),
    generarFactura(clientes[6], 1020, 17, 230000, 0),
    generarFactura(clientes[9], 1021, 16, 98000, 30000),
    generarFactura(clientes[4], 1022, 16, 540000, 200000),
    // AMARILLO (1-15 dias) — 13 facturas
    generarFactura(clientes[0], 1023, 14, 320000, 0),
    generarFactura(clientes[1], 1024, 12, 156000, 50000),
    generarFactura(clientes[2], 1025, 10, 89000, 0),
    generarFactura(clientes[3], 1026, 9, 210000, 100000),
    generarFactura(clientes[5], 1027, 8, 3500, 0, 'USD'),
    generarFactura(clientes[5], 1028, 7, 178000, 0),
    generarFactura(clientes[6], 1029, 6, 445000, 200000),
    generarFactura(clientes[7], 1030, 5, 67000, 20000),
    generarFactura(clientes[8], 1031, 4, 298000, 0),
    generarFactura(clientes[9], 1032, 3, 125000, 50000),
    generarFactura(clientes[0], 1033, 2, 89000, 0),
    generarFactura(clientes[1], 1034, 1, 432000, 200000),
    generarFactura(clientes[3], 1035, 1, 156000, 0),
  ];
}

export function getMockResumen(): ResumenSegmento[] {
  const facturas = getMockCartera();
  const grupos: Record<SegmentoRiesgo, { facturas: number; clientes: Set<string>; saldo: number }> = {
    ROJO: { facturas: 0, clientes: new Set(), saldo: 0 },
    NARANJA: { facturas: 0, clientes: new Set(), saldo: 0 },
    AMARILLO: { facturas: 0, clientes: new Set(), saldo: 0 },
    VERDE: { facturas: 0, clientes: new Set(), saldo: 0 },
  };

  for (const f of facturas) {
    const g = grupos[f.segmento_riesgo];
    g.facturas++;
    g.clientes.add(f.codigo_cliente);
    g.saldo += f.saldo_pendiente;
  }

  return (['ROJO', 'NARANJA', 'AMARILLO', 'VERDE'] as SegmentoRiesgo[]).map((seg) => ({
    segmento: seg,
    num_facturas: grupos[seg].facturas,
    num_clientes: grupos[seg].clientes.size,
    saldo_total: Math.round(grupos[seg].saldo * 100) / 100,
  }));
}

export function getMockPagos(ij_inum: number): PagoAplicado[] {
  if (ij_inum % 3 !== 0) return [];
  return [
    {
      fecha_pago: '2026-03-15',
      tipo_recibo: 'RC',
      numero_recibo: 5000 + ij_inum,
      tipo_factura: 'IN',
      numero_factura: ij_inum,
      monto_aplicado: 50000,
      monto_aplicado_dop: 50000,
      fecha_recibo: '2026-03-15',
      total_recibo: 50000,
      referencia_pago: 'Transferencia Banreservas',
    },
  ];
}
