/**
 * Capa de compatibilidad (Fase 3 Etapa 2): convierte el modelo canónico del
 * adaptador ERP a los tipos legacy de la UI (`FacturaVencida`) para que las
 * empresas en modo CSV usen las MISMAS páginas que Guipak sin tocar frontend.
 *
 * Cuando el frontend migre al modelo canónico (cierre de Etapa 2), este
 * archivo desaparece.
 */

import { cobranzasQuery } from '@/lib/db/cobranzas';
import { adaptadorParaEmpresa } from './index';
import type { ClienteCartera } from './tipos';
import type { FacturaVencida, SegmentoRiesgo } from '@/lib/types/cartera';

function segmentoDeDias(dias: number): SegmentoRiesgo {
  if (dias >= 1 && dias <= 15) return 'AMARILLO';
  if (dias >= 16 && dias <= 30) return 'NARANJA';
  if (dias > 30) return 'ROJO';
  return 'VERDE';
}

/**
 * Cartera de una empresa NO-Guipak en el formato legacy de la UI.
 * Aplica CP-03 (excluir facturas con disputa activa de la empresa).
 * Los campos que el origen no trae (ITBIS, límite de crédito, tasa...)
 * van en cero/valores neutros.
 */
export async function carteraCompatParaEmpresa(
  empresaId: number,
  opciones?: { incluirPorVencerDias?: number; limite?: number }
): Promise<FacturaVencida[]> {
  const adapter = await adaptadorParaEmpresa(empresaId);
  const [cartera, clientes] = await Promise.all([
    adapter.carteraPendiente({
      incluirPorVencerDias: opciones?.incluirPorVencerDias ?? 5,
      limite: opciones?.limite ?? 5000,
    }),
    adapter.clientes(),
  ]);
  if (cartera.length === 0) return [];

  const clientePorCodigo = new Map<string, ClienteCartera>(
    clientes.map((c) => [c.codigo, c])
  );

  // CP-03: excluir facturas con disputa activa de ESTA empresa.
  const disputas = await cobranzasQuery<{ ij_inum: number }>(
    "SELECT DISTINCT ij_inum FROM cobranza_disputas WHERE empresa_id = ? AND estado IN ('ABIERTA','EN_REVISION')",
    [empresaId]
  );
  const enDisputa = new Set(disputas.map((d) => Number(d.ij_inum)));

  return cartera
    .filter((f) => !enDisputa.has(f.numero))
    .map((f) => {
      const cli = clientePorCodigo.get(f.codigoCliente);
      const pagado = f.totalPagado ?? Math.max(0, f.total - f.saldoPendiente);
      return {
        codigo_cliente: f.codigoCliente,
        nombre_cliente: f.nombreCliente,
        razon_social: cli?.nombre ?? f.nombreCliente,
        rnc: cli?.rnc ?? '',
        email: cli?.email ?? null,
        telefono: cli?.telefono ?? null,
        telefono2: cli?.telefono2 ?? null,
        contacto_general: cli?.contactoCobros ?? null,
        contacto_cobros: cli?.contactoCobros ?? null,
        limite_credito: 0,
        localidad: '',
        tipo_doc: 'IN',
        numero_interno: f.numero,
        ncf_fiscal: f.ncf ?? '',
        fecha_emision: f.fechaEmision ?? '',
        fecha_vencimiento: f.fechaVencimiento,
        dias_vencido: f.diasVencida,
        subtotal_gravable: 0,
        itbis: 0,
        total_factura: f.total,
        total_pagado: pagado,
        saldo_pendiente: f.saldoPendiente,
        total_factura_dop: f.total,
        total_pagado_dop: pagado,
        saldo_pendiente_dop: f.saldoPendiente,
        moneda: f.moneda,
        tasa_cambio: 1,
        terminos_pago: '',
        dias_credito: 0,
        vendedor: cli?.vendedor ?? '',
        fecha_ultimo_pago: null,
        segmento_riesgo: segmentoDeDias(f.diasVencida),
      } satisfies FacturaVencida;
    });
}
