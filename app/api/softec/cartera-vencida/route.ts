import { NextRequest, NextResponse } from 'next/server';
import { ajustarSaldoClientes } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { carteraCompatParaEmpresa } from '@/lib/erp/compat';
import type { FacturaVencida, CarteraResponse, SegmentoRiesgo } from '@/lib/types/cartera';

/**
 * GET /api/softec/cartera-vencida
 *
 * Retorna la cartera vencida. Si Softec no está disponible, usa datos mock.
 * Implementa el filtro cross-DB de disputas en dos pasos (CP-03).
 * Respeta CP-04: siempre filtra IJ_TYPEDOC='IN', IJ_INVTORF='T', IJ_PAID='F'.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const segmentos = searchParams.get('segmentos')?.split(',') as SegmentoRiesgo[] | undefined;
    const busqueda = searchParams.get('busqueda')?.trim();
    const vendedor = searchParams.get('vendedor')?.trim();
    const diasMin = searchParams.get('dias_min') ? Number(searchParams.get('dias_min')) : undefined;
    const diasMax = searchParams.get('dias_max') ? Number(searchParams.get('dias_max')) : undefined;
    const montoMin = searchParams.get('monto_min') ? Number(searchParams.get('monto_min')) : undefined;
    const montoMax = searchParams.get('monto_max') ? Number(searchParams.get('monto_max')) : undefined;
    // Paginación (defaults generosos para no romper la UI actual; `total`
    // siempre refleja el conteo completo tras filtros)
    const limit = Math.min(Number(searchParams.get('limit')) || 5000, 5000);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    // Todas las empresas (Guipak incluida) leen via adaptador ERP: la query
    // de cartera vive en UN solo lugar (lib/erp). CP-15 (saldo a favor) es
    // dimensión Softec; el mock solo aplica a Guipak sin conexión.
    const empresaId = empresaIdDeSesion(session);
    const esGuipak = empresaId === EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaId);
    const softecOk = esGuipak && (await adapter.disponible());
    let facturas: FacturaVencida[];

    if (esGuipak && !softecOk) {
      facturas = getMockCartera();
    } else {
      facturas = await carteraCompatParaEmpresa(empresaId, {
        soloVencidas: true,
        incluirUltimoPago: true,
      });
    }

    // Aplicar filtros
    if (segmentos && segmentos.length > 0) {
      facturas = facturas.filter((f) => segmentos.includes(f.segmento_riesgo));
    }
    if (busqueda) {
      const q = busqueda.toLowerCase();
      facturas = facturas.filter(
        (f) =>
          f.nombre_cliente.toLowerCase().includes(q) ||
          f.codigo_cliente.includes(q) ||
          f.ncf_fiscal.includes(q)
      );
    }
    if (vendedor) {
      facturas = facturas.filter((f) => f.vendedor === vendedor);
    }
    if (diasMin !== undefined) {
      facturas = facturas.filter((f) => f.dias_vencido >= diasMin);
    }
    if (diasMax !== undefined) {
      facturas = facturas.filter((f) => f.dias_vencido <= diasMax);
    }
    if (montoMin !== undefined) {
      facturas = facturas.filter((f) => f.saldo_pendiente >= montoMin);
    }
    if (montoMax !== undefined) {
      facturas = facturas.filter((f) => f.saldo_pendiente <= montoMax);
    }

    // CP-15: ajustar por saldo a favor del cliente (anticipos / recibos sin
    // aplicar). Solo aplica con datos reales — el mock no tiene la dimensión.
    let saldosClientes:
      | Record<string, {
          saldo_pendiente: number;
          saldo_a_favor: number;
          saldo_neto: number;
          cubierto_por_anticipo: boolean;
        }>
      | undefined;
    let totalAFavor = 0;
    let totalNeto = 0;
    if (softecOk && facturas.length > 0) {
      const pendientePorCliente = new Map<string, number>();
      for (const f of facturas) {
        const codigo = String(f.codigo_cliente).trim();
        pendientePorCliente.set(
          codigo,
          (pendientePorCliente.get(codigo) ?? 0) + (Number(f.saldo_pendiente) || 0)
        );
      }
      const ajustes = await ajustarSaldoClientes(
        Array.from(pendientePorCliente.entries()).map(([codigo_cliente, saldo_pendiente]) => ({
          codigo_cliente,
          saldo_pendiente,
        }))
      );
      saldosClientes = {};
      for (const a of ajustes) {
        saldosClientes[a.codigo_cliente] = {
          saldo_pendiente: a.saldo_pendiente,
          saldo_a_favor: a.saldo_a_favor,
          saldo_neto: a.saldo_neto,
          cubierto_por_anticipo: a.cubierto_por_anticipo,
        };
        totalAFavor += a.saldo_a_favor;
        totalNeto += a.saldo_neto;
      }
      // Marcar flag en cada factura cuyo cliente esté cubierto.
      facturas = facturas.map((f) => {
        const s = saldosClientes![String(f.codigo_cliente).trim()];
        return s ? { ...f, cubierto_por_anticipo: s.cubierto_por_anticipo } : f;
      });
    }

    const totalFiltradas = facturas.length;
    if (offset > 0 || totalFiltradas > limit) {
      facturas = facturas.slice(offset, offset + limit);
    }

    const response: CarteraResponse = {
      facturas,
      total: totalFiltradas,
      modo: esGuipak && !softecOk ? 'mock' : 'live',
      ultima_consulta: new Date().toISOString(),
      saldos_clientes: saldosClientes,
      total_a_favor: saldosClientes ? totalAFavor : undefined,
      total_neto: saldosClientes ? totalNeto : undefined,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[CARTERA] Error:', error);
    return NextResponse.json({ error: 'Error consultando cartera' }, { status: 500 });
  }
}
