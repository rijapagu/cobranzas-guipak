/**
 * Tipos del módulo de Conciliación Bancaria
 */

export type EstadoConciliacion = 'CONCILIADO' | 'POR_APLICAR' | 'DESCONOCIDO' | 'CHEQUE_DEVUELTO';

export type TipoMovimiento = 'CREDITO' | 'CHEQUE_DEVUELTO';

export interface LineaExtracto {
  fecha_transaccion: string;
  descripcion: string;
  referencia: string;
  cuenta_origen: string;
  monto: number;
  moneda: string;
  tipo?: TipoMovimiento;
}

export interface ConciliacionDetalle {
  ir_recnum: number;
  codigo_cliente: string;
  nombre_cliente: string | null;
  monto: number;
}

export interface ConciliacionEntry {
  id: number;
  fecha_extracto: string;
  banco: string;
  archivo_origen: string;
  fecha_transaccion: string;
  descripcion: string | null;
  referencia: string | null;
  cuenta_origen: string | null;
  monto: number;
  moneda: string;
  estado: EstadoConciliacion;
  ir_recnum: number | null;
  codigo_cliente: string | null;
  nombre_cliente?: string | null;
  aprobado_por: string | null;
  fecha_aprobacion: string | null;
  notas: string | null;
  cargado_por: string;
  created_at: string;
  es_multi?: boolean;
  detalles?: ConciliacionDetalle[];
}

export interface CuentaAprendida {
  id: number;
  cuenta_origen: string;
  nombre_origen: string | null;
  codigo_cliente: string;
  nombre_cliente: string | null;
  confianza: 'MANUAL' | 'AUTO';
  veces_usado: number;
  confirmado_por: string;
}

export interface ResultadoConciliacion {
  entradas: ConciliacionEntry[];
  total: number;
  conciliadas: number;
  por_aplicar: number;
  desconocidas: number;
  cheques_devueltos: number;
  monto_conciliado: number;
  monto_por_aplicar: number;
  monto_desconocido: number;
  monto_devuelto: number;
}

export interface ClienteOption {
  codigo: string;
  nombre: string;
}
