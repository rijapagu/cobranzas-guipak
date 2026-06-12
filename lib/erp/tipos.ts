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
  /** Email general del cliente. */
  email?: string | null;
  /** Email del departamento de CxP / cobros (IC_ARCONTC en Softec). */
  emailCobros?: string | null;
  telefono?: string | null;
  telefono2?: string | null;
  /** Nombre de la persona de contacto. */
  contactoCobros?: string | null;
  vendedor?: string | null;
  limiteCredito?: number;
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

  // --- Datos del cliente denormalizados por el origen (evita N+1 en listados) ---
  razonSocial?: string | null;
  rncCliente?: string | null;
  /** Email CxP / cobros del cliente (IC_ARCONTC en Softec). */
  emailCliente?: string | null;
  telefonoCliente?: string | null;
  telefono2Cliente?: string | null;
  /** Nombre de la persona de contacto de cobros. */
  contactoCliente?: string | null;
  vendedor?: string | null;
  limiteCredito?: number;

  // --- Detalle adicional de la factura (orígenes ricos como Softec) ---
  localidad?: string | null;
  tipoDoc?: string | null;
  subtotalGravable?: number;
  impuesto?: number;
  totalDop?: number;
  totalPagadoDop?: number;
  saldoPendienteDop?: number;
  tasaCambio?: number;
  terminosPago?: string | null;
  diasCredito?: number;
  /** YYYY-MM-DD del último pago aplicado (solo si se pide incluirUltimoPago). */
  fechaUltimoPago?: string | null;
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

/** Pago aplicado a UNA factura (historial para estado de cuenta). */
export interface PagoFactura {
  fecha: string;
  tipoRecibo?: string | null;
  numeroRecibo?: number | null;
  monto: number;
  montoDop?: number;
  fechaRecibo?: string | null;
  totalRecibo?: number;
  referencia?: string | null;
}

export type TipoErp = 'SOFTEC' | 'CSV' | 'NINGUNO';

export interface OpcionesCartera {
  /** Incluir facturas que vencen dentro de N días (preventivo). */
  incluirPorVencerDias?: number;
  /** true = SOLO facturas ya vencidas (diasVencida >= 1). Gana sobre incluirPorVencerDias. */
  soloVencidas?: boolean;
  /** Filtrar por un cliente puntual en el origen. */
  codigoCliente?: string;
  /** Calcular fechaUltimoPago (JOIN extra en Softec — solo si la vista lo usa). */
  incluirUltimoPago?: boolean;
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

  /** Una factura puntual AUNQUE ya esté pagada (contexto de disputas).
   *  null = no encontrada en el origen. */
  factura(numero: number, codigoCliente?: string): Promise<FacturaPendiente | null>;

  /** Datos de contacto de un cliente. */
  cliente(codigo: string): Promise<ClienteCartera | null>;

  /** Todos los clientes del origen (batch — evita N+1 en listados). */
  clientes(): Promise<ClienteCartera[]>;

  /** Pagos aplicados a una factura (estado de cuenta). [] si el origen no trae historial. */
  pagosFactura(numero: number, codigoCliente?: string): Promise<PagoFactura[]>;

  /** Recibos de pago en un rango de fechas (conciliación bancaria). */
  recibosEnRango(desde: string, hasta: string): Promise<PagoRecibo[]>;
}
