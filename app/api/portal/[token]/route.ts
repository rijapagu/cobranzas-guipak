import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { configDeEmpresa } from '@/lib/empresas/config';
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import { rateLimit, ipDeRequest } from '@/lib/auth/rate-limit';

/**
 * GET /api/portal/[token]
 * Retorna facturas pendientes del cliente asociado al token.
 * CP-07: Verifica token válido y no expirado.
 * No requiere session auth — acceso público por token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    // Rate limit: endpoint público — 30 consultas por IP cada 5 minutos
    // (también frena la enumeración de tokens).
    const limite = await rateLimit(`portal:${ipDeRequest(request)}`, 30, 5 * 60);
    if (!limite.permitido) {
      return NextResponse.json(
        { error: 'Demasiadas consultas. Intenta de nuevo en unos minutos.' },
        { status: 429 }
      );
    }

    // CP-07: Verificar token (la empresa se resuelve DESDE el token)
    const tokens = await cobranzasQuery<{
      id: number;
      codigo_cliente: string;
      fecha_expiracion: string;
      activo: number;
      empresa_id: number;
    }>(
      'SELECT id, codigo_cliente, fecha_expiracion, activo, empresa_id FROM cobranza_portal_tokens WHERE token = ? AND activo = 1 AND fecha_expiracion > NOW() LIMIT 1',
      [token]
    );

    if (tokens.length === 0) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }

    const portalToken = tokens[0];

    // Actualizar último acceso
    await cobranzasExecute(
      'UPDATE cobranza_portal_tokens SET ultimo_acceso = NOW() WHERE id = ?',
      [portalToken.id]
    );

    const codigoCliente = portalToken.codigo_cliente;

    // Obtener facturas del cliente — la empresa se resuelve DESDE el token
    // (CP-07) y la cartera viene del adaptador ERP de ESA empresa: el portal
    // funciona igual para Guipak (Softec) que para tenants CSV.
    const empresaPortal = Number(portalToken.empresa_id) || EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaPortal);
    const erpOk = await adapter.disponible();
    let facturas: Record<string, unknown>[] = [];
    let nombreCliente = '';

    if (erpOk) {
      const cartera = await adapter.carteraPendiente({
        incluirPorVencerDias: 36500,
        codigoCliente,
      });
      facturas = cartera
        .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento))
        .map((f) => ({
          nombre_cliente: f.nombreCliente,
          numero_interno: f.numero,
          ncf_fiscal: f.ncf ?? '',
          fecha_emision: f.fechaEmision ?? '',
          fecha_vencimiento: f.fechaVencimiento,
          dias_vencido: f.diasVencida,
          total_factura: f.total,
          total_pagado: f.totalPagado ?? Math.max(0, f.total - f.saldoPendiente),
          saldo_pendiente: f.saldoPendiente,
          moneda: f.moneda,
        }));
      if (cartera.length > 0) {
        nombreCliente = cartera[0].nombreCliente;
      }
    } else if (empresaPortal !== EMPRESA_GUIPAK) {
      // Tenant sin cartera importada: portal vacío (sin mock de demo).
      facturas = [];
    } else {
      // Mock mode
      const mockData = getMockCartera();
      const clienteFacturas = mockData.filter(f => f.codigo_cliente === codigoCliente);
      if (clienteFacturas.length > 0) {
        nombreCliente = clienteFacturas[0].nombre_cliente;
        facturas = clienteFacturas.map(f => ({
          numero_interno: f.numero_interno,
          ncf_fiscal: f.ncf_fiscal,
          fecha_emision: f.fecha_emision,
          fecha_vencimiento: f.fecha_vencimiento,
          dias_vencido: f.dias_vencido,
          total_factura: f.total_factura,
          total_pagado: f.total_pagado,
          saldo_pendiente: f.saldo_pendiente,
          moneda: f.moneda,
        }));
      } else {
        // Demo: mostrar primeras facturas
        nombreCliente = mockData[0]?.nombre_cliente || 'Cliente Demo';
        facturas = mockData.slice(0, 5).map(f => ({
          numero_interno: f.numero_interno,
          ncf_fiscal: f.ncf_fiscal,
          fecha_emision: f.fecha_emision,
          fecha_vencimiento: f.fecha_vencimiento,
          dias_vencido: f.dias_vencido,
          total_factura: f.total_factura,
          total_pagado: f.total_pagado,
          saldo_pendiente: f.saldo_pendiente,
          moneda: f.moneda,
        }));
      }
    }

    // Obtener documentos vinculados
    const docs = await cobranzasQuery<{
      ij_inum: number;
      url_pdf: string;
    }>(
      'SELECT ij_inum, url_pdf FROM cobranza_facturas_documentos WHERE empresa_id = ? AND codigo_cliente = ?',
      [portalToken.empresa_id, codigoCliente]
    );
    const docMap = new Map(docs.map(d => [Number(d.ij_inum), d.url_pdf]));

    const facturasConDocs = facturas.map(f => {
      const inum = Number(f.numero_interno);
      return {
        ...f,
        tiene_pdf: docMap.has(inum),
        url_pdf: docMap.get(inum) || null,
      };
    });

    // Obtener acuerdos de pago activos
    const acuerdos = await cobranzasQuery<{
      id: number;
      ij_inum: number;
      monto_prometido: number;
      fecha_prometida: string;
      estado: string;
    }>(
      "SELECT id, ij_inum, monto_prometido, fecha_prometida, estado FROM cobranza_acuerdos WHERE empresa_id = ? AND codigo_cliente = ? AND estado = 'PENDIENTE' ORDER BY fecha_prometida ASC",
      [portalToken.empresa_id, codigoCliente]
    );

    const totalSaldo = facturasConDocs.reduce((sum: number, f: Record<string, unknown>) =>
      sum + Number(f.saldo_pendiente || 0), 0);

    // CP-15: si el cliente tiene saldo a favor (anticipos / recibos sin
    // aplicar), debemos mostrarle el saldo neto real. Si el saldo a favor
    // cubre todo el pendiente, generamos un mensaje claro para que NO
    // perciba el portal como un cobro injusto.
    let saldoAFavor = 0;
    if (empresaPortal === EMPRESA_GUIPAK && erpOk) {
      const favorMap = await obtenerSaldoAFavorPorCliente([codigoCliente]);
      saldoAFavor = favorMap.get(String(codigoCliente).trim()) ?? 0;
    }
    const ajuste = ajustarSaldoCliente(totalSaldo, saldoAFavor);

    let mensaje: string | null = null;
    if (ajuste.cubierto_por_anticipo) {
      mensaje =
        `No tienes pagos pendientes. Tienes RD$${ajuste.saldo_a_favor.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a favor con nosotros. ` +
        'Tu equipo de cobranzas aplicará el anticipo a las próximas facturas. ' +
        'Si necesitas un detalle, escríbenos.';
    } else if (saldoAFavor > 0.01 && totalSaldo > 0) {
      mensaje =
        `Tienes RD$${ajuste.saldo_a_favor.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a favor que se aplicará a tus facturas pendientes. ` +
        `Tu saldo neto a pagar es RD$${ajuste.saldo_neto.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
    }

    // Branding del portal: el nombre de la empresa dueña del token.
    const { identidad } = await configDeEmpresa(empresaPortal);

    return NextResponse.json({
      empresa: {
        nombre: identidad.nombre,
      },
      cliente: {
        codigo: codigoCliente,
        nombre: nombreCliente,
      },
      facturas: facturasConDocs,
      acuerdos,
      resumen: {
        total_facturas: facturasConDocs.length,
        saldo_total: totalSaldo,
        // CP-15: nuevos campos
        saldo_a_favor: ajuste.saldo_a_favor,
        saldo_neto: ajuste.saldo_neto,
        cubierto_por_anticipo: ajuste.cubierto_por_anticipo,
        mensaje,
      },
      modo: empresaPortal === EMPRESA_GUIPAK && !erpOk ? 'mock' : 'live',
    });
  } catch (error) {
    console.error('[PORTAL] Error:', error);
    return NextResponse.json({ error: 'Error cargando datos del portal' }, { status: 500 });
  }
}
