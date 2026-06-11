/**
 * Resolver de adaptador ERP por empresa (Fase 3).
 *
 * Etapa 0: Guipak (empresa 1) usa Softec; cualquier otra empresa recibe el
 * adaptador nulo hasta que la Etapa 2 implemente el adaptador CSV y la
 * lectura de empresas.erp_tipo.
 */

import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { softecAdapter } from './softec';
import type { ErpAdapter, FacturaPendiente, ClienteCartera, PagoRecibo } from './tipos';

const adaptadorNulo: ErpAdapter = {
  tipo: 'NINGUNO',
  async disponible(): Promise<boolean> {
    return false;
  },
  async carteraPendiente(): Promise<FacturaPendiente[]> {
    return [];
  },
  async saldoFactura(): Promise<number | null> {
    return null;
  },
  async cliente(): Promise<ClienteCartera | null> {
    return null;
  },
  async recibosEnRango(): Promise<PagoRecibo[]> {
    return [];
  },
};

export function adaptadorParaEmpresa(empresaId: number): ErpAdapter {
  if (empresaId === EMPRESA_GUIPAK) return softecAdapter;
  // Etapa 2: leer empresas.erp_tipo y devolver csvAdapter / softecAdapter
  // configurado por empresa.
  return adaptadorNulo;
}

export type { ErpAdapter, FacturaPendiente, ClienteCartera, PagoRecibo } from './tipos';
