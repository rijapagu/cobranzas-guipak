import { NextResponse } from 'next/server';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockResumen } from '@/lib/mock/cartera-mock';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { carteraCompatParaEmpresa } from '@/lib/erp/compat';
import type { ResumenSegmento, ResumenResponse, SegmentoRiesgo } from '@/lib/types/cartera';

/**
 * GET /api/softec/resumen-segmentos
 * Retorna resumen de cartera VENCIDA agrupado por segmento de riesgo.
 * Todas las empresas agregan desde el adaptador ERP (lib/erp); el mock solo
 * aplica a Guipak sin conexión Softec.
 *
 * CP-15: el `saldo_total` por segmento sigue siendo el bruto (porque los
 * anticipos pertenecen a clientes que pueden tener facturas en varios
 * segmentos — no se distribuyen). El ajuste se hace solo a nivel agregado
 * total: `total_a_favor` y `total_neto`. Es dimensión Softec: en otros
 * orígenes favor = 0 y neto == bruto.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const empresaId = empresaIdDeSesion(session);
    const esGuipak = empresaId === EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaId);
    const softecOk = esGuipak && (await adapter.disponible());

    if (esGuipak && !softecOk) {
      const segmentosMock = getMockResumen();
      const response: ResumenResponse = {
        segmentos: segmentosMock,
        total_cartera: segmentosMock.reduce((s, x) => s + Number(x.saldo_total), 0),
        total_facturas: segmentosMock.reduce((s, x) => s + Number(x.num_facturas), 0),
        total_clientes: segmentosMock.reduce((s, x) => s + Number(x.num_clientes), 0),
        modo: 'mock',
        total_a_favor: 0,
        total_neto: undefined,
      };
      return NextResponse.json(response);
    }

    const cartera = await carteraCompatParaEmpresa(empresaId, { soloVencidas: true });

    const porSegmento = new Map<SegmentoRiesgo, { facturas: number; clientes: Set<string>; saldo: number }>();
    const pendientePorCliente = new Map<string, number>();
    for (const f of cartera) {
      const s = porSegmento.get(f.segmento_riesgo) ?? { facturas: 0, clientes: new Set<string>(), saldo: 0 };
      s.facturas++;
      s.clientes.add(f.codigo_cliente);
      s.saldo += Number(f.saldo_pendiente) || 0;
      porSegmento.set(f.segmento_riesgo, s);
      pendientePorCliente.set(
        f.codigo_cliente,
        (pendientePorCliente.get(f.codigo_cliente) ?? 0) + (Number(f.saldo_pendiente) || 0)
      );
    }

    const orden: SegmentoRiesgo[] = ['ROJO', 'NARANJA', 'AMARILLO', 'VERDE'];
    const segmentos: ResumenSegmento[] = orden
      .filter((seg) => porSegmento.has(seg))
      .map((seg) => ({
        segmento: seg,
        num_facturas: porSegmento.get(seg)!.facturas,
        num_clientes: porSegmento.get(seg)!.clientes.size,
        saldo_total: Math.round(porSegmento.get(seg)!.saldo * 100) / 100,
      }));

    const totalCartera = segmentos.reduce((s, x) => s + x.saldo_total, 0);

    // CP-15: agregado a favor / neto — solo con Softec en vivo.
    let totalAFavor = 0;
    let totalNeto = Math.round(totalCartera * 100) / 100;
    if (softecOk && pendientePorCliente.size > 0) {
      const saldosFavor = await obtenerSaldoAFavorPorCliente([...pendientePorCliente.keys()]);
      let aFavorAplicable = 0;
      let netoAcumulado = 0;
      for (const [codigo, pendiente] of pendientePorCliente.entries()) {
        const favor = saldosFavor.get(codigo) ?? 0;
        aFavorAplicable += Math.min(pendiente, favor);
        netoAcumulado += Math.max(0, pendiente - favor);
      }
      totalAFavor = Math.round(aFavorAplicable * 100) / 100;
      totalNeto = Math.round(netoAcumulado * 100) / 100;
    }

    const response: ResumenResponse = {
      segmentos,
      total_cartera: Math.round(totalCartera * 100) / 100,
      total_facturas: segmentos.reduce((s, x) => s + x.num_facturas, 0),
      total_clientes: new Set(cartera.map((f) => f.codigo_cliente)).size,
      modo: 'live',
      total_a_favor: totalAFavor,
      total_neto: totalNeto,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[RESUMEN] Error:', error);
    return NextResponse.json({ error: 'Error consultando resumen' }, { status: 500 });
  }
}
