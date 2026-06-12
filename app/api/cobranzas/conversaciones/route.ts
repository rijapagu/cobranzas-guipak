import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';

/**
 * GET /api/cobranzas/conversaciones?cliente=XXXX
 * Si no se pasa cliente, retorna resumen de todas las conversaciones.
 * Si se pasa cliente, retorna los mensajes de ese cliente.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const cliente = request.nextUrl.searchParams.get('cliente');
    const empresaId = empresaIdDeSesion(session);

    if (cliente) {
      // Mensajes de un cliente específico
      const mensajes = await cobranzasQuery(
        `SELECT id, gestion_id, codigo_cliente, ij_inum, canal, direccion, contenido, asunto,
                whatsapp_from, estado, generado_por_ia, aprobado_por, created_at
         FROM cobranza_conversaciones
         WHERE empresa_id = ? AND codigo_cliente = ?
         ORDER BY created_at ASC`,
        [empresaId, cliente]
      );

      return NextResponse.json({ mensajes, cliente });
    }

    // Resumen de conversaciones por cliente (con nombre de inteligencia o gestiones)
    const conversaciones = await cobranzasQuery(
      `
      SELECT
        c.codigo_cliente,
        COALESCE(MAX(ci.nombre_cliente) COLLATE utf8mb4_0900_ai_ci, c.codigo_cliente) AS nombre_cliente,
        COUNT(*) as total_mensajes,
        SUM(CASE WHEN c.direccion = 'RECIBIDO' AND NOT EXISTS (
          SELECT 1 FROM cobranza_conversaciones c2
          WHERE c2.empresa_id = c.empresa_id
            AND c2.codigo_cliente = c.codigo_cliente
            AND c2.direccion = 'ENVIADO'
            AND c2.created_at > c.created_at
        ) THEN 1 ELSE 0 END) as recibidos_sin_responder,
        MAX(c.created_at) as ultimo_mensaje,
        (SELECT contenido FROM cobranza_conversaciones c3
         WHERE c3.empresa_id = c.empresa_id AND c3.codigo_cliente = c.codigo_cliente
         ORDER BY c3.created_at DESC LIMIT 1) as ultimo_contenido,
        (SELECT canal FROM cobranza_conversaciones c4
         WHERE c4.empresa_id = c.empresa_id AND c4.codigo_cliente = c.codigo_cliente
         ORDER BY c4.created_at DESC LIMIT 1) as ultimo_canal
      FROM cobranza_conversaciones c
      LEFT JOIN cobranza_cliente_inteligencia ci
        ON ci.codigo_cliente COLLATE utf8mb4_0900_ai_ci = c.codigo_cliente AND ci.empresa_id = c.empresa_id
      WHERE c.empresa_id = ?
      GROUP BY c.codigo_cliente
      ORDER BY MAX(c.created_at) DESC
    `,
      [empresaId]
    );

    return NextResponse.json({ conversaciones });
  } catch (error) {
    console.error('[CONVERSACIONES] Error:', error);
    return NextResponse.json({ error: 'Error consultando conversaciones' }, { status: 500 });
  }
}
