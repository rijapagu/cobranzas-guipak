import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';

interface ClienteEnriquecido {
  codigo_cliente: string;
  nombre_cliente: string;
  rnc: string;
  // Softec
  email_softec: string | null;
  telefono_softec: string | null;
  telefono2_softec: string | null;
  contacto_cobros_softec: string | null;
  vendedor: string;
  // Enriquecido
  email_enriq: string | null;
  whatsapp_enriq: string | null;
  contacto_cobros_enriq: string | null;
  canal_preferido: string | null;
  no_contactar: boolean;
  pausa_hasta: string | null;
  notas_cobros: string | null;
  // Calculados
  tiene_email: boolean;
  tiene_whatsapp: boolean;
  total_facturas_pendientes: number;
  saldo_total: number;        // bruto (compat)
  // CP-15: anticipos / recibos sin aplicar.
  saldo_a_favor: number;
  saldo_neto: number;
  cubierto_por_anticipo: boolean;
}

/**
 * GET /api/cobranzas/clientes
 * Lista clientes con datos enriquecidos. Cruza Softec con cobranza_clientes_enriquecidos.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const busqueda = request.nextUrl.searchParams.get('busqueda')?.trim();
  const filtro = request.nextUrl.searchParams.get('filtro'); // sin_email, sin_whatsapp, sin_contacto, pausados

  try {
    // Todas las empresas (Guipak incluida) leen via adaptador ERP (lib/erp).
    // El mock solo aplica a Guipak sin conexión Softec.
    const empresaIdRuta = empresaIdDeSesion(session);
    const esGuipak = empresaIdRuta === EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaIdRuta);
    const softecOk = esGuipak && (await adapter.disponible());
    let clientesBase: ClienteEnriquecido[];

    if (!esGuipak || softecOk) {
      const [cartera, clientesErp] = await Promise.all([
        // 36500 días por vencer = toda factura con saldo, vencida o no
        // (la query Softec equivalente tampoco filtra por fecha).
        adapter.carteraPendiente({ incluirPorVencerDias: 36500, limite: 5000 }),
        adapter.clientes(),
      ]);
      const cliMap = new Map(clientesErp.map((c) => [c.codigo, c]));
      const agregado = new Map<string, { facturas: number; saldo: number }>();
      for (const f of cartera) {
        const a = agregado.get(f.codigoCliente) ?? { facturas: 0, saldo: 0 };
        a.facturas++;
        a.saldo += f.saldoPendiente;
        agregado.set(f.codigoCliente, a);
      }
      clientesBase = [...agregado.entries()]
        .map(([codigo, a]) => {
          const cli = cliMap.get(codigo);
          return {
            codigo_cliente: codigo,
            nombre_cliente: cli?.nombre ?? codigo,
            rnc: cli?.rnc ?? '',
            email_softec: cli?.email ?? null,
            telefono_softec: cli?.telefono ?? null,
            telefono2_softec: cli?.telefono2 ?? null,
            // Paridad legacy: en Softec este campo era IC_ARCONTC (email CxP);
            // en CSV no existe ese rol separado y cae al contacto de cobros.
            contacto_cobros_softec: cli?.emailCobros ?? cli?.contactoCobros ?? null,
            vendedor: cli?.vendedor ?? '',
            email_enriq: null,
            whatsapp_enriq: null,
            contacto_cobros_enriq: null,
            canal_preferido: null,
            no_contactar: false,
            pausa_hasta: null,
            notas_cobros: null,
            tiene_email: !!cli?.email?.trim(),
            tiene_whatsapp: !!cli?.telefono?.trim(),
            total_facturas_pendientes: a.facturas,
            saldo_total: Math.round(a.saldo * 100) / 100,
            saldo_a_favor: 0,
            saldo_neto: Math.round(a.saldo * 100) / 100,
            cubierto_por_anticipo: false,
          };
        })
        .sort((x, y) => y.saldo_total - x.saldo_total);
    } else {
      // Mock
      const mockData = getMockCartera();
      const clienteMap = new Map<string, ClienteEnriquecido>();
      mockData.forEach(f => {
        const existing = clienteMap.get(f.codigo_cliente);
        if (existing) {
          existing.total_facturas_pendientes++;
          existing.saldo_total += f.saldo_pendiente;
          existing.saldo_neto = existing.saldo_total; // mock no modela anticipos
        } else {
          clienteMap.set(f.codigo_cliente, {
            codigo_cliente: f.codigo_cliente,
            nombre_cliente: f.nombre_cliente,
            rnc: f.rnc || '',
            email_softec: f.email || null,
            telefono_softec: f.telefono || null,
            telefono2_softec: f.telefono2 || null,
            contacto_cobros_softec: f.contacto_cobros || null,
            vendedor: f.vendedor || '',
            email_enriq: null,
            whatsapp_enriq: null,
            contacto_cobros_enriq: null,
            canal_preferido: null,
            no_contactar: false,
            pausa_hasta: null,
            notas_cobros: null,
            tiene_email: !!f.email,
            tiene_whatsapp: !!f.telefono,
            total_facturas_pendientes: 1,
            saldo_total: f.saldo_pendiente,
            saldo_a_favor: 0,
            saldo_neto: f.saldo_pendiente,
            cubierto_por_anticipo: false,
          });
        }
      });
      clientesBase = Array.from(clienteMap.values());
    }

    // CP-15: aplicar saldo a favor por cliente (anticipos / recibos sin aplicar).
    if (softecOk && clientesBase.length > 0) {
      const codigos = clientesBase.map(c => String(c.codigo_cliente).trim());
      const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);
      clientesBase = clientesBase.map(c => {
        const codigo = String(c.codigo_cliente).trim();
        const favor = saldosFavor.get(codigo) ?? 0;
        const bruto = Number(c.saldo_total) || 0;
        const aplicable = Math.min(bruto, favor);
        const neto = Math.max(0, bruto - favor);
        return {
          ...c,
          saldo_a_favor: aplicable,
          saldo_neto: neto,
          cubierto_por_anticipo: favor >= bruto && bruto > 0,
        };
      });
    }

    // Cruzar con datos enriquecidos
    const enriquecidos = await cobranzasQuery<{
      codigo_cliente: string;
      email: string | null;
      whatsapp: string | null;
      contacto_cobros: string | null;
      canal_preferido: string | null;
      no_contactar: number;
      pausa_hasta: string | null;
      notas_cobros: string | null;
    }>(
      'SELECT codigo_cliente, email, whatsapp, contacto_cobros, canal_preferido, no_contactar, pausa_hasta, notas_cobros FROM cobranza_clientes_enriquecidos WHERE empresa_id = ?',
      [empresaIdDeSesion(session)]
    );

    const enriqMap = new Map(enriquecidos.map(e => [e.codigo_cliente.trim(), e]));

    clientesBase = clientesBase.map(c => {
      const enr = enriqMap.get(c.codigo_cliente.trim());
      if (enr) {
        return {
          ...c,
          email_enriq: enr.email,
          whatsapp_enriq: enr.whatsapp,
          contacto_cobros_enriq: enr.contacto_cobros,
          canal_preferido: enr.canal_preferido,
          no_contactar: !!enr.no_contactar,
          pausa_hasta: enr.pausa_hasta,
          notas_cobros: enr.notas_cobros,
          tiene_email: !!c.email_softec?.trim() || !!enr.email?.trim(),
          tiene_whatsapp: !!c.telefono_softec?.trim() || !!enr.whatsapp?.trim(),
        };
      }
      return c;
    });

    // Filtros
    if (busqueda) {
      const q = busqueda.toLowerCase();
      clientesBase = clientesBase.filter(c =>
        c.nombre_cliente.toLowerCase().includes(q) ||
        c.codigo_cliente.includes(q) ||
        c.rnc.includes(q)
      );
    }

    if (filtro === 'sin_email') {
      clientesBase = clientesBase.filter(c => !c.tiene_email);
    } else if (filtro === 'sin_whatsapp') {
      clientesBase = clientesBase.filter(c => !c.tiene_whatsapp);
    } else if (filtro === 'sin_contacto') {
      clientesBase = clientesBase.filter(c => !c.tiene_email && !c.tiene_whatsapp);
    } else if (filtro === 'pausados') {
      clientesBase = clientesBase.filter(c => c.no_contactar || c.pausa_hasta);
    }

    // Estadísticas
    const totalClientes = clientesBase.length;
    const sinEmail = clientesBase.filter(c => !c.tiene_email).length;
    const sinWhatsapp = clientesBase.filter(c => !c.tiene_whatsapp).length;
    const sinContacto = clientesBase.filter(c => !c.tiene_email && !c.tiene_whatsapp).length;

    // Paginación con default generoso (`total` refleja el conteo completo)
    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 3000, 3000);
    const offset = Math.max(Number(request.nextUrl.searchParams.get('offset')) || 0, 0);
    if (offset > 0 || clientesBase.length > limit) {
      clientesBase = clientesBase.slice(offset, offset + limit);
    }

    return NextResponse.json({
      clientes: clientesBase,
      total: totalClientes,
      estadisticas: { totalClientes, sinEmail, sinWhatsapp, sinContacto },
      modo: esGuipak && !softecOk ? 'mock' : 'live',
    });
  } catch (error) {
    console.error('[CLIENTES] Error:', error);
    return NextResponse.json({ error: 'Error consultando clientes' }, { status: 500 });
  }
}

/**
 * PUT /api/cobranzas/clientes
 * Actualiza datos enriquecidos de un cliente.
 * Los datos se guardan en cobranza_clientes_enriquecidos, NUNCA en Softec (CP-01).
 */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      codigo_cliente,
      email,
      whatsapp,
      contacto_cobros,
      canal_preferido,
      no_contactar,
      motivo_no_contactar,
      pausa_hasta,
      notas_cobros,
    } = body;

    if (!codigo_cliente) {
      return NextResponse.json({ error: 'codigo_cliente requerido' }, { status: 400 });
    }

    // Upsert en cobranza_clientes_enriquecidos
    const empresaId = empresaIdDeSesion(session);
    const existente = await cobranzasQuery<{ id: number }>(
      'SELECT id FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ? AND empresa_id = ? LIMIT 1',
      [codigo_cliente, empresaId]
    );

    if (existente.length > 0) {
      await cobranzasExecute(
        `UPDATE cobranza_clientes_enriquecidos SET
          email = ?, whatsapp = ?, contacto_cobros = ?,
          canal_preferido = ?, no_contactar = ?, motivo_no_contactar = ?,
          pausa_hasta = ?, notas_cobros = ?, actualizado_por = ?
        WHERE codigo_cliente = ? AND empresa_id = ?`,
        [
          email || null, whatsapp || null, contacto_cobros || null,
          canal_preferido || 'WHATSAPP', no_contactar ? 1 : 0, motivo_no_contactar || null,
          pausa_hasta ? new Date(pausa_hasta) : null, notas_cobros || null,
          session.email, codigo_cliente, empresaId,
        ]
      );
    } else {
      await cobranzasExecute(
        `INSERT INTO cobranza_clientes_enriquecidos
          (empresa_id, codigo_cliente, email, whatsapp, contacto_cobros, canal_preferido,
           no_contactar, motivo_no_contactar, pausa_hasta, notas_cobros, actualizado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empresaId, codigo_cliente, email || null, whatsapp || null, contacto_cobros || null,
          canal_preferido || 'WHATSAPP', no_contactar ? 1 : 0, motivo_no_contactar || null,
          pausa_hasta ? new Date(pausa_hasta) : null, notas_cobros || null, session.email,
        ]
      );
    }

    await logAccion(session.email, 'CLIENTE_ENRIQUECIDO', 'cliente', codigo_cliente, {
      email, whatsapp, contacto_cobros, canal_preferido, no_contactar,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[CLIENTES] Error PUT:', error);
    return NextResponse.json({ error: 'Error actualizando cliente' }, { status: 500 });
  }
}
