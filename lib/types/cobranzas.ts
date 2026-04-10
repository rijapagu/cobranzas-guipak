/**
 * Tipos del módulo de Cobranzas — Cola de Aprobación
 */

import type { SegmentoRiesgo } from './cartera';

export type EstadoGestion =
  | 'PENDIENTE'
  | 'APROBADO'
  | 'EDITADO'
  | 'DESCARTADO'
  | 'ESCALADO'
  | 'ENVIADO'
  | 'FALLIDO';

export type CanalGestion = 'WHATSAPP' | 'EMAIL' | 'AMBOS';

export interface CobranzaGestion {
  id: number;
  // Referencia factura
  ij_local: string;
  ij_typedoc: string;
  ij_inum: number;
  codigo_cliente: string;
  nombre_cliente?: string; // JOIN con icust o enriched
  // Montos
  total_factura: number;
  saldo_pendiente: number;
  moneda: string;
  fecha_vencimiento: string;
  dias_vencido: number;
  segmento_riesgo: SegmentoRiesgo;
  // Canal y mensajes
  canal: CanalGestion;
  mensaje_propuesto_wa: string | null;
  mensaje_propuesto_email: string | null;
  asunto_email: string | null;
  // Estado
  estado: EstadoGestion;
  aprobado_por: string | null;
  fecha_aprobacion: string | null;
  mensaje_final_wa: string | null;
  mensaje_final_email: string | null;
  motivo_descarte: string | null;
  // Envío
  fecha_envio: string | null;
  whatsapp_message_id: string | null;
  email_message_id: string | null;
  // Validación
  ultima_consulta_softec: string;
  // Documentación
  tiene_pdf: boolean;
  url_pdf: string | null;
  // Auditoría
  creado_por: string;
  created_at: string;
  updated_at: string;
  // Datos extra del cliente (no en tabla, se cruzan)
  email_cliente?: string | null;
  telefono_cliente?: string | null;
  contacto_cobros?: string | null;
}

export interface ColaAprobacionResponse {
  gestiones: CobranzaGestion[];
  total: number;
  pendientes: number;
  aprobadas_hoy: number;
  descartadas_hoy: number;
  escaladas_hoy: number;
}

export interface MensajeGenerado {
  mensaje_wa: string;
  mensaje_email: string;
  asunto_email: string;
}

export interface ContextoCobranza {
  nombre_cliente: string;
  contacto_cobros: string | null;
  codigo_cliente: string;
  numero_factura: number;
  ncf_fiscal: string;
  saldo_pendiente: number;
  moneda: string;
  dias_vencido: number;
  fecha_vencimiento: string;
  segmento_riesgo: SegmentoRiesgo;
  tiene_pdf: boolean;
  url_pdf: string | null;
  historial_gestiones?: string[];
}
