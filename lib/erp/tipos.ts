/**
 * Modelo canónico de cartera (Fase 3 — independiente del ERP).
 *
 * Toda la app debe consumir ESTOS tipos; los nombres IJ_ / IC_ de Softec
 * quedan encapsulados dentro del adaptador correspondiente. Cada origen de
 * datos (Softec, importación CSV, futuro ERP) implementa `ErpAdapter`.
 */

export interface ClienteCartera {
  codigo: string;
  nombre: string;
  rnc?: string | null;
  email?: string | null;
  telefono?: string | null;
  telefono2?: string | null;
  contactoCobros?: string | null;
  vendedor?: string | null;
}

export interface FacturaPendiente {
  /** Identificador de la factura en el origen (IJ_INUM en Softec). */
  numero: number;
  /** Comprobante fiscal (NCF en RD). */
  ncf?: string | null;
  codigoCliente: string;
  nombreCliente: string;
  total: number;
  saldoPendiente: number;
  /** total - saldoPendiente cuando el origen no lo trae explícito. */
  totalPagado?: number;
  moneda: string;
  /** YYYY-MM-DD (null si el origen no lo trae, ej. CSV mínimo). */
  fechaEmision?: string | null;
  /** YYYY-MM-DD */
  fechaVencimiento: string;
  /** Negativo = por vencer (VERDE preventivo). */
  diasVencida: number;
}

export interface PagoRecibo {
  numeroRecibo: number;
  codigoCliente: string;
  monto: number;
  /** YYYY-MM-DD */
  fecha: string;
  /** EF (efectivo), CK (cheque), TR (transferencia)... según el origen. */
  metodo?: string | null;
}

export type TipoErp = 'SOFTEC' | 'CSV' | 'NINGUNO';

export interface OpcionesCartera {
  /** Incluir facturas que vencen dentro de N días (preventivo). */
  incluirPorVencerDias?: number;
  limite?: number;
}

/**
 * Contrato que implementa cada origen de cartera.
 * Los métodos devuelven SIEMPRE el modelo canónico.
 */
export interface ErpAdapter {
  readonly tipo: TipoErp;

  /** ¿El origen está accesible ahora mismo? */
  disponible(): Promise<boolean>;

  /** Facturas con saldo pendiente (y opcionalmente por vencer). */
  carteraPendiente(opciones?: OpcionesCartera): Promise<FacturaPendiente[]>;

  /** Saldo actual de una factura (CP-06). null = factura no encontrada.
   *  En orígenes sin tiempo real (CSV) devuelve el último saldo importado. */
  saldoFactura(numero: number): Promise<number | null>;

  /** Datos de contacto de un cliente. */
  cliente(codigo: string): Promise<ClienteCartera | null>;

  /** Todos los clientes del origen (batch — evita N+1 en listados). */
  clientes(): Promise<ClienteCartera[]>;

  /** Recibos de pago en un rango de fechas (conciliación bancaria). */
  recibosEnRango(desde: string, hasta: string): Promise<PagoRecibo[]>;
}
