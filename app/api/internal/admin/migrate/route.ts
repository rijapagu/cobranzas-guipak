import { NextRequest, NextResponse } from 'next/server';
import { esRequestAdminValido } from '@/lib/auth/internal';
import { cobranzasQueryRaw, cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

/**
 * POST /api/internal/admin/migrate
 * Ejecuta las migrations de db/migrations/ que NO estén registradas en
 * cobranza_migraciones (las aplicadas se omiten — ya no hace falta que cada
 * migración vieja sea idempotente). Se detiene en el primer error para
 * respetar el orden.
 *
 * Body opcional: { "baseline": true } — registra TODOS los archivos actuales
 * como aplicados SIN ejecutarlos (adopción inicial sobre una DB ya migrada).
 *
 * Auth: header `x-internal-secret` con INTERNAL_ADMIN_SECRET (secreto DEDICADO,
 * distinto del de cron — este endpoint ejecuta SQL). Si la env var no está
 * configurada, el endpoint rechaza todo (fail-closed).
 */
export async function POST(req: NextRequest) {
  if (!esRequestAdminValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let baseline = false;
  try {
    const body = await req.json();
    baseline = body?.baseline === true;
  } catch {
    // sin body — modo normal
  }

  const migrationsDir = join(process.cwd(), 'db', 'migrations');

  try {
    await cobranzasQueryRaw(
      `CREATE TABLE IF NOT EXISTS cobranza_migraciones (
        archivo     VARCHAR(255) PRIMARY KEY,
        aplicada_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );

    const archivos = await readdir(migrationsDir);
    const sqls = archivos.filter((a) => a.endsWith('.sql')).sort();

    const aplicadasRows = await cobranzasQuery<{ archivo: string }>(
      'SELECT archivo FROM cobranza_migraciones'
    );
    const yaAplicadas = new Set(aplicadasRows.map((r) => r.archivo));

    if (baseline) {
      const registradas: string[] = [];
      for (const archivo of sqls) {
        if (yaAplicadas.has(archivo)) continue;
        await cobranzasExecute(
          'INSERT IGNORE INTO cobranza_migraciones (archivo) VALUES (?)',
          [archivo]
        );
        registradas.push(archivo);
      }
      return NextResponse.json({
        ok: true,
        modo: 'baseline',
        registradas,
        ya_aplicadas: yaAplicadas.size,
      });
    }

    const ejecutadas: string[] = [];
    const omitidas: string[] = [];

    for (const archivo of sqls) {
      if (yaAplicadas.has(archivo)) {
        omitidas.push(archivo);
        continue;
      }

      try {
        const contenido = await readFile(join(migrationsDir, archivo), 'utf-8');
        // 1. Strip line comments (--) primero
        const sinComentarios = contenido
          .split('\n')
          .map((linea) => {
            const idx = linea.indexOf('--');
            return idx === -1 ? linea : linea.substring(0, idx);
          })
          .join('\n');

        // 2. Split por ; al final de línea
        const statements = sinComentarios
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const stmt of statements) {
          await cobranzasQueryRaw(stmt);
        }

        await cobranzasExecute(
          'INSERT IGNORE INTO cobranza_migraciones (archivo) VALUES (?)',
          [archivo]
        );
        ejecutadas.push(`${archivo} (${statements.length} statements)`);
      } catch (err) {
        // Detener en el primer error: las migraciones son ordenadas.
        // (Endpoint solo-admin: el detalle del error es para el operador.)
        return NextResponse.json(
          {
            ok: false,
            ejecutadas,
            omitidas: omitidas.length,
            error_en: archivo,
            error: err instanceof Error ? err.message : String(err),
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      ejecutadas,
      omitidas: omitidas.length,
    });
  } catch (error) {
    console.error('[migrate] Error:', error);
    return NextResponse.json({ error: 'Error ejecutando migraciones' }, { status: 500 });
  }
}
