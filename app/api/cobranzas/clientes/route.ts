import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
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
  saldo_total: number;
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
    const softecOk = await testSoftecConnection();
    let clientesBase: ClienteEnriquecido[];

    if (softecOk) {
      // Query clientes con facturas pendientes desde Softec
      const rows = await softecQuery<{
        codigo_cliente: string;
        nombre_cliente: string;
        rnc: string;
        email_softec: string | null;
        telefono_softec: string | null;
        telefono2_softec: string | null;
        contacto_cobros_softec: string | null;
        vendedor: string;
        total_facturas_pendientes: number;
        saldo_total: number;
      }>(`
        SELECT
          c.IC_CODE AS codigo_cliente,
          c.IC_NAME AS nombre_cliente,
          c.IC_RNC AS rnc,
          c.IC_EMAIL AS email_softec,
          c.IC_PHONE AS telefono_softec,
          c.IC_PHONE2 AS telefono2_softec,
          c.IC_ARCONTC AS contacto_cobros_softec,
          c.IC_SLSCODE AS vendedor,
          COUNT(f.IJ_INUM) AS total_facturas_pendientes,
          SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_total
        FROM v_cobr_icust c
        INNER JOIN v_cobr_ijnl f ON f.IJ_CCODE = c.IC_CODE
        WHERE c.IC_STATUS = 'A'
          AND f.IJ_TYPEDOC = 'IN'
          AND f.IJ_INVTORF = 'T'
          AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
        GROUP BY c.IC_CODE, c.IC_NAME, c.IC_RNC, c.IC_EMAIL,
                 c.IC_PHONE, c.IC_PHONE2, c.IC_ARCONTC, c.IC_SLSCODE
        ORDER BY saldo_total DESC
      `);

      clientesBase = rows.map(r => ({
        ...r,
        email_enriq: null,
        whatsapp_enriq: null,
        contacto_cobros_enriq: null,
        canal_preferido: null,
        no_contactar: false,
        pausa_hasta: null,
        notas_cobros: null,
        tiene_email: !!r.email_softec?.trim(),
        tiene_whatsapp: !!r.telefono_softec?.trim(),
      }));
    } else {
      // Mock
      const mockData = getMockCartera();
      const clienteMap = new Map<string, ClienteEnriquecido>();
      mockData.forEach(f => {
        const existing = clienteMap.get(f.codigo_cliente);
        if (existing) {
          existing.total_facturas_pendientes++;
          existing.saldo_total += f.saldo_pendiente;
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
          });
        }
      });
      clientesBase = Array.from(clienteMap.values());
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
    }>('SELECT codigo_cliente, email, whatsapp, contacto_cobros, canal_preferido, no_contactar, pausa_hasta, notas_cobros FROM cobranza_clientes_enriquecidos');

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

    return NextResponse.json({
      clientes: clientesBase,
      total: totalClientes,
      estadisticas: { totalClientes, sinEmail, sinWhatsapp, sinContacto },
      modo: softecOk ? 'live' : 'mock',
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
    const existente = await cobranzasQuery<{ id: number }>(
      'SELECT id FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ? LIMIT 1',
      [codigo_cliente]
    );

    if (existente.length > 0) {
      await cobranzasExecute(
        `UPDATE cobranza_clientes_enriquecidos SET
          email = ?, whatsapp = ?, contacto_cobros = ?,
          canal_preferido = ?, no_contactar = ?, motivo_no_contactar = ?,
          pausa_hasta = ?, notas_cobros = ?, actualizado_por = ?
        WHERE codigo_cliente = ?`,
        [
          email || null, whatsapp || null, contacto_cobros || null,
          canal_preferido || 'WHATSAPP', no_contactar ? 1 : 0, motivo_no_contactar || null,
          pausa_hasta ? new Date(pausa_hasta) : null, notas_cobros || null,
          session.email, codigo_cliente,
        ]
      );
    } else {
      await cobranzasExecute(
        `INSERT INTO cobranza_clientes_enriquecidos
          (codigo_cliente, email, whatsapp, contacto_cobros, canal_preferido,
           no_contactar, motivo_no_contactar, pausa_hasta, notas_cobros, actualizado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          codigo_cliente, email || null, whatsapp || null, contacto_cobros || null,
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
