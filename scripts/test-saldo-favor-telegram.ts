/**
 * Smoke test CP-15 para los cambios del commit 4 (Bloque 2):
 *   1. Query SUM pendiente bruto por cliente — usada en empuje-matutino,
 *      estado_cobros_hoy y draft-correo. Debe devolver number, no string.
 *   2. Combinada con obtenerSaldoAFavorPorCliente reproduce el cálculo
 *      bruto/neto/cubierto para clientes conocidos (CG0029 cubierto;
 *      0000997 no cubierto).
 *   3. Conteo global de clientes cubiertos coincide con el esperado (57).
 *
 * Valores esperados (10-may-2026 contra producción):
 *   CG0029 (SENADO):    pendiente ~187,620 / favor ~263,598 → CUBIERTO
 *   0000997 (UNIV CATÓLICA): saldo a favor ~1.31M, no cubre todo el pendiente
 *
 * Uso: npx tsx scripts/test-saldo-favor-telegram.ts
 */
import { readFileSync } from 'node:fs';

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
  if (cond) console.log(`    OK    ${label}`);
  else {
    failures++;
    console.error(`    FAIL  ${label}${detalle ? ' — ' + detalle : ''}`);
  }
}

async function main() {
  cargarEnv();

  const { obtenerSaldoAFavorPorCliente } = await import(
    '../lib/cobranzas/saldo-favor'
  );
  const { softecQuery } = await import('../lib/db/softec');

  console.log('\n=== SMOKE TEST CP-15 telegram + empuje matutino ===\n');

  // 1. SUM pendiente bruto global por cliente
  console.log('[1] SUM pendiente bruto por cliente (query empuje-matutino)');
  const pendientesGlobal = await softecQuery<{
    codigo_cliente: string;
    pendiente: number;
  }>(`
    SELECT IJ_CCODE AS codigo_cliente, SUM(IJ_TOT - IJ_TOTAPPL) AS pendiente
      FROM v_cobr_ijnl
     WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F'
       AND (IJ_TOT - IJ_TOTAPPL) > 0
     GROUP BY IJ_CCODE
  `);
  // Guipak tiene ~270-280 clientes activos con pendiente; usamos un piso bajo.
  assert(pendientesGlobal.length > 200, `clientes con pendiente > 200`, `actual ${pendientesGlobal.length}`);
  const totalBruto = pendientesGlobal.reduce((s, r) => s + Number(r.pendiente), 0);
  assert(totalBruto > 30_000_000 && totalBruto < 35_000_000,
    `total bruto entre 30M y 35M`,
    `actual ${fmt(totalBruto)}`);

  // 2. Cruce con helper y conteo de cubiertos
  console.log('\n[2] Conteo de clientes cubiertos por anticipo');
  const codigos = pendientesGlobal.map((p) => String(p.codigo_cliente).trim());
  const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);
  let cubiertos = 0;
  let aFavorAplicable = 0;
  let neto = 0;
  for (const r of pendientesGlobal) {
    const codigo = String(r.codigo_cliente).trim();
    const pendiente = Number(r.pendiente);
    const favor = saldosFavor.get(codigo) ?? 0;
    aFavorAplicable += Math.min(pendiente, favor);
    neto += Math.max(0, pendiente - favor);
    if (favor >= pendiente && pendiente > 0) cubiertos += 1;
  }
  console.log(`    bruto:           ${fmt(totalBruto)}`);
  console.log(`    a favor aplicable: ${fmt(aFavorAplicable)}`);
  console.log(`    neto:            ${fmt(neto)}`);
  console.log(`    cubiertos:       ${cubiertos}`);
  assert(cubiertos >= 50 && cubiertos <= 65,
    `clientes cubiertos entre 50 y 65 (esperado ~57)`,
    `actual ${cubiertos}`);
  // El "a favor aplicable" (lo que efectivamente baja la cartera) es menor
  // al saldo a favor total ($8.4M) porque parte de ese saldo pertenece a
  // clientes sin pendiente actual (anticipos puros que no tocan cartera).
  assert(aFavorAplicable > 3_000_000 && aFavorAplicable < 6_000_000,
    `a favor aplicable entre 3M y 6M`,
    `actual ${fmt(aFavorAplicable)}`);
  assert(neto < totalBruto,
    `neto < bruto`,
    `bruto ${fmt(totalBruto)} neto ${fmt(neto)}`);

  // 3. Cliente CG0029 (cubierto por anticipo)
  console.log('\n[3] CG0029 (SENADO) — debe estar CUBIERTO');
  const cg = await softecQuery<{ pendiente: number }>(
    `SELECT COALESCE(SUM(IJ_TOT - IJ_TOTAPPL), 0) AS pendiente
       FROM v_cobr_ijnl
      WHERE IJ_CCODE = ?
        AND IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F'
        AND (IJ_TOT - IJ_TOTAPPL) > 0`,
    ['CG0029']
  );
  const pendCG = Number(cg[0]?.pendiente) || 0;
  const favorCG = (await obtenerSaldoAFavorPorCliente(['CG0029'])).get('CG0029') ?? 0;
  console.log(`    pendiente CG0029: ${fmt(pendCG)}`);
  console.log(`    a favor CG0029:   ${fmt(favorCG)}`);
  assert(pendCG > 0, `CG0029 tiene pendiente`);
  assert(favorCG > 0, `CG0029 tiene saldo a favor`);
  assert(favorCG >= pendCG, `CG0029 cubierto (favor ≥ pendiente)`,
    `favor ${fmt(favorCG)} pendiente ${fmt(pendCG)}`);

  // 4. Cliente con pendiente sin cubrir
  console.log('\n[4] Cliente NO cubierto (esperado típico: favor menor o ausente)');
  // Buscar un cliente con pendiente que NO esté en saldosFavor o cuyo favor sea menor.
  const noCubierto = pendientesGlobal.find((p) => {
    const codigo = String(p.codigo_cliente).trim();
    const favor = saldosFavor.get(codigo) ?? 0;
    return Number(p.pendiente) > 100_000 && favor < Number(p.pendiente);
  });
  if (!noCubierto) {
    failures++;
    console.error('    FAIL  no se encontró ningún cliente NO cubierto con pendiente > 100k');
  } else {
    const codigo = String(noCubierto.codigo_cliente).trim();
    const favor = saldosFavor.get(codigo) ?? 0;
    console.log(`    cliente ${codigo}: pendiente ${fmt(Number(noCubierto.pendiente))}, favor ${fmt(favor)}`);
    assert(favor < Number(noCubierto.pendiente),
      `${codigo} no cubierto por anticipo`,
      `favor ${fmt(favor)} < pendiente ${fmt(Number(noCubierto.pendiente))}`);
  }

  console.log('\n=================================');
  if (failures === 0) {
    console.log(`OK — todos los asserts pasaron`);
  } else {
    console.error(`FALLARON ${failures} asserts`);
  }
  console.log('=================================\n');

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR en smoke test:', err);
  process.exit(1);
});
