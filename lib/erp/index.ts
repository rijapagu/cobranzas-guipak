/**
 * Resolver de adaptador ERP por empresa (Fase 3).
 *
 * Etapa 2: lee `empresas.erp_tipo` de la BD (cache en memoria 60s) y devuelve
 * el adaptador correspondiente. Guipak (empresa 1) usa Softec; las empresas
 * en modo CSV sirven su cartera importada; sin ERP configurado → adaptador
 * nulo (todo vacío).
 */

import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { softecAdapter } from './softec';
import { crearCsvAdapter } from './csv';
import type { ErpAdapter, FacturaPendiente, ClienteCartera, PagoRecibo, PagoFactura, TipoErp } from './tipos';

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
  async factura(): Promise<FacturaPendiente | null> {
    return null;
  },
  async cliente(): Promise<ClienteCartera | null> {
    return null;
  },
  async clientes(): Promise<ClienteCartera[]> {
    return [];
  },
  async pagosFactura(): Promise<PagoFactura[]> {
    return [];
  },
  async recibosEnRango(): Promise<PagoRecibo[]> {
    return [];
  },
};

// Cache erp_tipo por empresa (TTL corto: el alta/cambio de modo es raro,
// pero no queremos un SELECT a empresas en cada request).
const TTL_MS = 60_000;
const cacheTipo = new Map<number, { tipo: TipoErp; expira: number }>();

async function erpTipoDeEmpresa(empresaId: number): Promise<TipoErp> {
  const hit = cacheTipo.get(empresaId);
  if (hit && hit.expira > Date.now()) return hit.tipo;

  let tipo: TipoErp = 'NINGUNO';
  try {
    const rows = await cobranzasQuery<{ erp_tipo: string }>(
      'SELECT erp_tipo FROM empresas WHERE id = ? AND activa = 1 LIMIT 1',
      [empresaId]
    );
    const valor = rows[0]?.erp_tipo;
    if (valor === 'SOFTEC' || valor === 'CSV' || valor === 'NINGUNO') tipo = valor;
  } catch {
    // empresas inaccesible → fail-safe: Guipak sigue con Softec, el resto nulo.
    tipo = empresaId === EMPRESA_GUIPAK ? 'SOFTEC' : 'NINGUNO';
  }

  cacheTipo.set(empresaId, { tipo, expira: Date.now() + TTL_MS });
  return tipo;
}

export async function adaptadorParaEmpresa(empresaId: number): Promise<ErpAdapter> {
  const tipo = await erpTipoDeEmpresa(empresaId);
  if (tipo === 'SOFTEC') {
    // Hoy solo Guipak tiene Softec; otra empresa con erp_tipo SOFTEC requeriría
    // credenciales propias (Etapa 5) — hasta entonces, solo empresa 1.
    return empresaId === EMPRESA_GUIPAK ? softecAdapter : adaptadorNulo;
  }
  if (tipo === 'CSV') return crearCsvAdapter(empresaId);
  return adaptadorNulo;
}

/** Invalida el cache (tras importar cartera o cambiar erp_tipo). */
export function invalidarCacheErp(empresaId?: number): void {
  if (empresaId === undefined) cacheTipo.clear();
  else cacheTipo.delete(empresaId);
}

export type { ErpAdapter, FacturaPendiente, ClienteCartera, PagoRecibo } from './tipos';
