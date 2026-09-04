import { NextRequest, NextResponse } from 'next/server';
import { esRequestAdminValido } from '@/lib/auth/internal';
import { cobranzasQuery } from '@/lib/db/cobranzas';

/**
 * GET /api/internal/admin/logs?accion=ERROR&entidad=telegram-extracto&limite=20
 *
 * Lectura de solo consulta sobre cobranza_logs -- no existía forma de ver un
 * error de producción sin acceso directo a la DB (ej. el "Incorrect
 * arguments to mysqld_stmt_execute" de la carga de extractos, 2026-09-04:
 * logError() ya lo guardaba con stack trace, pero nada lo exponía).
 *
 * Filtros opcionales; sin filtros devuelve los últimos `limite` (default 20,
 * tope 100) de cualquier tipo.
 */
export async function GET(req: NextRequest) {
  if (!esRequestAdminValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const accion = searchParams.get('accion');
  const entidad = searchParams.get('entidad');
  const limite = Math.min(Math.max(Number(searchParams.get('limite')) || 20, 1), 100);

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (accion) {
    where.push('accion = ?');
    params.push(accion);
  }
  if (entidad) {
    where.push('entidad = ?');
    params.push(entidad);
  }
  params.push(limite);

  const logs = await cobranzasQuery(
    `SELECT id, empresa_id, usuario_id, accion, entidad, entidad_id, detalle, created_at
       FROM cobranza_logs
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT ?`,
    params
  );

  return NextResponse.json({ total: logs.length, logs });
}
