/**
 * Tipos del módulo de Cartera Vencida
 */

export type SegmentoRiesgo = 'VERDE' | 'AMARILLO' | 'NARANJA' | 'ROJO';

export interface FacturaVencida {
  // Cliente
  codigo_cliente: string;
  nombre_cliente: string;
  razon_social: string;
  rnc: string;
  email: string | null;
  telefono: string | null;
  telefono2: string | null;
  contacto_general: string | null;
  contacto_cobros: string | null;
  limite_credito: number;
  // Factura
  localidad: string;
  tipo_doc: string;
  numero_interno: number;
  ncf_fiscal: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  dias_vencido: number;
  // Montos
  subtotal_gravable: number;
  itbis: number;
  total_factura: number;
  total_pagado: number;
  saldo_pendiente: number;
  total_factura_dop: number;
  total_pagado_dop: number;
  saldo_pendiente_dop: number;
  moneda: string;
  tasa_cambio: number;
  // Términos
  terminos_pago: string;
  dias_credito: number;
  vendedor: string;
  // Pagos
  fecha_ultimo_pago: string | null;
  // Segmento
  segmento_riesgo: SegmentoRiesgo;
  // Documentación (se cruza con cobranza_facturas_documentos)
  tiene_pdf?: boolean;
  url_pdf?: string | null;
}

export interface ResumenSegmento {
  segmento: SegmentoRiesgo;
  num_facturas: number;
  num_clientes: number;
  saldo_total: number;
}

export interface FiltrosCartera {
  segmentos?: SegmentoRiesgo[];
  busqueda?: string;
  vendedor?: string;
  dias_min?: number;
  dias_max?: number;
  monto_min?: number;
  monto_max?: number;
}

export interface PagoAplicado {
  fecha_pago: string;
  tipo_recibo: string;
  numero_recibo: number;
  tipo_factura: string;
  numero_factura: number;
  monto_aplicado: number;
  monto_aplicado_dop: number;
  fecha_recibo: string;
  total_recibo: number;
  referencia_pago: string;
}

export interface CarteraResponse {
  facturas: FacturaVencida[];
  total: number;
  modo: 'live' | 'mock';
  ultima_consulta: string;
}

export interface ResumenResponse {
  segmentos: ResumenSegmento[];
  total_cartera: number;
  total_facturas: number;
  total_clientes: number;
  modo: 'live' | 'mock';
}
