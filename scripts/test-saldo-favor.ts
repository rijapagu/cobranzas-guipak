/**
 * Smoke test del helper lib/cobranzas/saldo-favor.ts contra Softec real.
 *
 * Valores esperados (validados 10-may-2026 contra producción 45.32.218.224):
 *   - SUM(saldo_a_favor global) = 8,425,120.29
 *   - Clientes con saldo a favor   = 325 (tolerancia ±3 por variaciones intradía)
 *   - Casos puntuales (método "filtrar por recibo > 0.01" — alineado con
 *     /api/cobranzas/clientes/[codigo]/estado-cuenta validado 8-may):
 *       UNIV CATOLICA (0000997) ~ 1,313,413.61
 *       SR0017                  ~   277,699.14
 *       SENADO (CG0029)         ~   263,598.95 (cubre pendiente 187,620)
 *
 * Uso: npx tsx scripts/test-saldo-favor.ts
 */
import { readFileSync } from 'node:fs';

// Cargar .env.local ANTES de importar el helper (el pool MySQL se inicializa
// al cargar el módulo lib/db/softec.ts).
function cargarEnv() {
  let envContent = '';
  try {
    envContent = readFileSync('.env.local', 'utf8');
  } catch {
    envContent = readFileSync('../../../.env.local', 'utf8');
  }
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

let failures = 0;

function assert(cond: boolean, label: string, detalle?: string) {
  if (cond) {
    console.log(`    OK    ${label}`);
  } else {
    failures++;
    console.error(`    FAIL  ${label}${detalle ? ' — ' + detalle : ''}`);
  }
}

async function main() {
  cargarEnv();

  // Import dinámico DESPUÉS de cargar env.
  const { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente, ajustarSaldoClientes } =
    await import('../lib/cobranzas/saldo-favor');

  console.log('\n=== SMOKE TEST saldo-favor.ts ===\n');

  // -----------------------------------------------------------------
  // [1] Agregado global sin filtro
  // -----------------------------------------------------------------
  console.log('[1] obtenerSaldoAFavorPorCliente() sin filtro');
  const t1 = Date.now();
  const todo = await obtenerSaldoAFavorPorCliente();
  const t1ms = Date.now() - t1;

  let total = 0;
  for (const v of todo.values()) total += v;

  console.log(`    ${todo.size} clientes — Total a favor: ${fmt(total)} — ${t1ms}ms\n`);

  const EXPECTED_TOTAL = 8_425_120.29;
  const EXPECTED_CLIENTES = 325;

  assert(
    Math.abs(total - EXPECTED_TOTAL) < 5,
    `Total agregado ~ ${fmt(EXPECTED_TOTAL)} (tolerancia $5)`,
    `obtenido ${fmt(total)}, diff ${fmt(total - EXPECTED_TOTAL)}`
  );
  assert(
    Math.abs(todo.size - EXPECTED_CLIENTES) <= 3,
    `Clientes ~ ${EXPECTED_CLIENTES} (tolerancia ±3)`,
    `obtenido ${todo.size}`
  );
  assert(t1ms < 30_000, 'Query global completa en menos de 30s', `${t1ms}ms`);

  // -----------------------------------------------------------------
  // [2] Filtro por códigos específicos
  // -----------------------------------------------------------------
  console.log('\n[2] obtenerSaldoAFavorPorCliente(["0000997","SR0017","XX99999"])');
  const t2 = Date.now();
  const filtrado = await obtenerSaldoAFavorPorCliente(['0000997', 'SR0017', 'XX99999']);
  const t2ms = Date.now() - t2;

  console.log(`    ${filtrado.size} clientes encontrados — ${t2ms}ms`);
  for (const [k, v] of filtrado) {
    console.log(`      ${k}: ${fmt(v)}`);
  }

  assert(filtrado.size <= 2, 'Solo devuelve clientes que existen y tienen saldo a favor');
  assert(filtrado.has('0000997'), 'UNIV CATOLICA (0000997) aparece');
  assert(filtrado.has('SR0017'), 'SR0017 aparece');
  assert(!filtrado.has('XX99999'), 'Código inexistente no aparece');

  const univ = filtrado.get('0000997') ?? 0;
  const sr = filtrado.get('SR0017') ?? 0;
  assert(
    Math.abs(univ - 1_313_413.61) < 5,
    'UNIV CATOLICA saldo a favor ~ 1,313,413.61',
    `obtenido ${fmt(univ)}`
  );
  assert(
    Math.abs(sr - 277_699.14) < 5,
    'SR0017 saldo a favor ~ 277,699.14 (método filtrado por recibo, alineado con estado-cuenta)',
    `obtenido ${fmt(sr)}`
  );
  assert(t2ms < 5_000, 'Query filtrada en menos de 5s', `${t2ms}ms`);

  // -----------------------------------------------------------------
  // [3] Filtro vacío -> Map vacío sin tocar DB
  // -----------------------------------------------------------------
  console.log('\n[3] obtenerSaldoAFavorPorCliente([]) — caso borde');
  const t3 = Date.now();
  const vacio = await obtenerSaldoAFavorPorCliente([]);
  const t3ms = Date.now() - t3;
  console.log(`    ${vacio.size} clientes — ${t3ms}ms`);
  assert(vacio.size === 0, 'Filtro con array vacío retorna Map vacío');
  assert(t3ms < 2_000, 'Caso vacío no toca DB innecesariamente', `${t3ms}ms`);

  // -----------------------------------------------------------------
  // [4] ajustarSaldoCliente — casos unitarios
  // -----------------------------------------------------------------
  console.log('\n[4] ajustarSaldoCliente — casos unitarios');

  const c1 = ajustarSaldoCliente(1000, 1500);
  assert(c1.saldo_neto === 0, 'pendiente 1000, favor 1500 -> neto 0', JSON.stringify(c1));
  assert(c1.cubierto_por_anticipo === true, '...cubierto = true');
  assert(c1.saldo_a_favor === 1500, '...saldo_a_favor preservado');

  const c2 = ajustarSaldoCliente(1000, 300);
  assert(c2.saldo_neto === 700, 'pendiente 1000, favor 300 -> neto 700', JSON.stringify(c2));
  assert(c2.cubierto_por_anticipo === false, '...cubierto = false');

  const c3 = ajustarSaldoCliente(1000, 1000);
  assert(c3.saldo_neto === 0, 'pendiente == favor -> neto 0', JSON.stringify(c3));
  assert(c3.cubierto_por_anticipo === true, '...cubierto = true (== cuenta como cubierto)');

  const c4 = ajustarSaldoCliente(0, 500);
  assert(c4.saldo_neto === 0, 'pendiente 0, favor 500 -> neto 0', JSON.stringify(c4));
  assert(
    c4.cubierto_por_anticipo === false,
    '...cubierto = false (sin pendiente no hay nada que cubrir)'
  );

  const c5 = ajustarSaldoCliente(-100, -50);
  assert(
    c5.saldo_neto === 0 && c5.saldo_pendiente === 0 && c5.saldo_a_favor === 0,
    'Valores negativos se normalizan a 0',
    JSON.stringify(c5)
  );

  // -----------------------------------------------------------------
  // [5] ajustarSaldoClientes — integración con datos reales
  // -----------------------------------------------------------------
  console.log('\n[5] ajustarSaldoClientes — con datos reales SR0017 + 0000997');

  // Valores aproximados validados el 10-may
  const ajustes = await ajustarSaldoClientes([
    { codigo_cliente: 'SR0017', saldo_pendiente: 1_230_916.19 },
    { codigo_cliente: '0000997', saldo_pendiente: 2_035_454.58 },
    // Cliente con saldo a favor que excede el pendiente
    { codigo_cliente: 'CG0029', saldo_pendiente: 187_620.00 },
    // Cliente sin saldo a favor (verificar comportamiento por defecto)
    { codigo_cliente: 'NOEXISTE9999', saldo_pendiente: 1000 },
  ]);

  console.log('    Resultados:');
  for (const a of ajustes) {
    console.log(
      `      ${a.codigo_cliente}: pend=${fmt(a.saldo_pendiente)} favor=${fmt(a.saldo_a_favor)} neto=${fmt(a.saldo_neto)} cubierto=${a.cubierto_por_anticipo}`
    );
  }

  const sr0017 = ajustes.find((a) => a.codigo_cliente === 'SR0017');
  const univ0997 = ajustes.find((a) => a.codigo_cliente === '0000997');
  const cg0029 = ajustes.find((a) => a.codigo_cliente === 'CG0029');
  const sinSaldo = ajustes.find((a) => a.codigo_cliente === 'NOEXISTE9999');

  assert(
    !!sr0017 && Math.abs(sr0017.saldo_neto - 953_217.05) < 5,
    'SR0017 neto ~ 953,217.05 (pendiente 1,230,916.19 − favor 277,699.14)'
  );
  assert(
    !!univ0997 && Math.abs(univ0997.saldo_neto - 722_040.97) < 5,
    'UNIV CATOLICA neto ~ 722,040.97'
  );
  assert(
    !!cg0029 && cg0029.cubierto_por_anticipo === true && cg0029.saldo_neto === 0,
    'SENADO (CG0029) cubierto_por_anticipo=true, neto=0'
  );
  assert(
    !!sinSaldo && sinSaldo.saldo_a_favor === 0 && sinSaldo.saldo_neto === 1000,
    'Cliente sin saldo a favor mantiene pendiente intacto'
  );

  console.log();
  if (failures === 0) {
    console.log('=== TODOS OK ===');
    process.exit(0);
  } else {
    console.error(`=== ${failures} ASSERT(S) FALLARON ===`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('ERROR FATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
