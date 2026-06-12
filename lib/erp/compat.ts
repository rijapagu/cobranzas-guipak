/**
 * Capa de compatibilidad (Fase 3 Etapa 2): convierte el modelo canónico del
 * adaptador ERP a los tipos legacy de la UI (`FacturaVencida`).
 *
 * Desde el refactor de cierre de Etapa 2 la usan TODAS las empresas —
 * incluida Guipak: la query de cartera vive en UN solo lugar
 * (softecAdapter.carteraPendiente) y las rutas consumen esto.
 *
 * Cuando el frontend migre al modelo canónico, este archivo desaparece.
 */

import { cobranzasQuery } from '@/lib/db/cobranzas';
import { adaptadorParaEmpresa } from './index';
import type { OpcionesCartera, FacturaPendiente } from './tipos';
import type { FacturaVencida, SegmentoRiesgo } from '@/lib/types/cartera';

export function segmentoDeDias(dias: number): SegmentoRiesgo {
  if (dias >= 1 && dias <= 15) return 'AMARILLO';
  if (dias >= 16 && dias <= 30) return 'NARANJA';
  if (dias > 30) return 'ROJO';
  return 'VERDE';
}

export function facturaCanonicaACompat(f: FacturaPendiente): FacturaVencida {
  const pagado = f.totalPagado ?? Math.max(0, f.total - f.saldoPendiente);
  return {
    codigo_cliente: f.codigoCliente,
    nombre_cliente: f.nombreCliente,
    razon_social: f.razonSocial ?? f.nombreCliente,
    rnc: f.rncCliente ?? '',
    email: f.emailCliente ?? null,
    telefono: f.telefonoCliente ?? null,
    telefono2: f.telefono2Cliente ?? null,
    contacto_general: f.contactoCliente ?? null,
    contacto_cobros: f.contactoCliente ?? null,
    limite_credito: f.limiteCredito ?? 0,
    localidad: f.localidad ?? '',
    tipo_doc: f.tipoDoc ?? 'IN',
    numero_interno: f.numero,
    ncf_fiscal: f.ncf ?? '',
    fecha_emision: f.fechaEmision ?? '',
    fecha_vencimiento: f.fechaVencimiento,
    dias_vencido: f.diasVencida,
    subtotal_gravable: f.subtotalGravable ?? 0,
    itbis: f.impuesto ?? 0,
    total_factura: f.total,
    total_pagado: pagado,
    saldo_pendiente: f.saldoPendiente,
    total_factura_dop: f.totalDop || f.total,
    total_pagado_dop: f.totalPagadoDop || pagado,
    saldo_pendiente_dop: f.saldoPendienteDop || f.saldoPendiente,
    moneda: f.moneda,
    tasa_cambio: f.tasaCambio ?? 1,
    terminos_pago: f.terminosPago ?? '',
    dias_credito: f.diasCredito ?? 0,
    vendedor: f.vendedor ?? '',
    fecha_ultimo_pago: f.fechaUltimoPago ?? null,
    segmento_riesgo: segmentoDeDias(f.diasVencida),
  };
}

/**
 * Cartera de una empresa en el formato legacy de la UI.
 * Aplica CP-03 (excluir facturas con disputa activa de la empresa).
 */
export async function carteraCompatParaEmpresa(
  empresaId: number,
  opciones?: OpcionesCartera
): Promise<FacturaVencida[]> {
  const adapter = await adaptadorParaEmpresa(empresaId);
  const cartera = await adapter.carteraPendiente(opciones);
  if (cartera.length === 0) return [];

  // CP-03: excluir facturas con disputa activa de ESTA empresa.
  const disputas = await cobranzasQuery<{ ij_inum: number }>(
    "SELECT DISTINCT ij_inum FROM cobranza_disputas WHERE empresa_id = ? AND estado IN ('ABIERTA','EN_REVISION')",
    [empresaId]
  );
  const enDisputa = new Set(disputas.map((d) => Number(d.ij_inum)));

  return cartera
    .filter((f) => !enDisputa.has(f.numero))
    .map(facturaCanonicaACompat);
}
