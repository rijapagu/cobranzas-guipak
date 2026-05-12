// Diagnóstico: impacto de filtrar DE/DC del cálculo de saldo a favor
// Compara: ANTES (RC+DE+DC) vs DESPUÉS (solo RC)
// Uso: node scripts/diagnostico-saldo-favor-fix.mjs

import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const pool = mysql.createPool({
  host: process.env.DB_SOFTEC_HOST,
  port: Number(process.env.DB_SOFTEC_PORT) || 3306,
  database: process.env.DB_SOFTEC_NAME || 'guipak',
  user: process.env.DB_SOFTEC_USER,
  password: process.env.DB_SOFTEC_PASS,
  connectionLimit: 2,
  connectTimeout: 10000,
  multipleStatements: false,
});

const saldoFavorQuery = (filtroSinorin) => `
  SELECT codigo_cliente, SUM(sin_aplicar) AS saldo_a_favor
  FROM (
    SELECT
      pay.IJ_CCODE AS codigo_cliente,
      (pay.IJ_TOT - IFNULL(ap.aplicado, 0)) AS sin_aplicar
    FROM v_cobr_ijnl_pay pay
    LEFT JOIN (
      SELECT IR_PLOCAL, IR_PTYPDOC, IR_RECNUM, SUM(IR_AMTPAID) AS aplicado
      FROM v_cobr_irjnl GROUP BY IR_PLOCAL, IR_PTYPDOC, IR_RECNUM
    ) ap ON ap.IR_PLOCAL = pay.IJ_LOCAL
        AND ap.IR_PTYPDOC = pay.IJ_SINORIN
        AND ap.IR_RECNUM = pay.IJ_RECNUM
    WHERE pay.IJ_CCODE IS NOT NULL ${filtroSinorin}
  ) recibos
  WHERE sin_aplicar > 0.01
  GROUP BY codigo_cliente
  HAVING saldo_a_favor > 0.01
`;

console.log('=== IMPACTO DEL FIX: excluir DE/DC del saldo a favor ===\n');

// ANTES: todos los tipos (RC, DE, DC)
const [antes] = await pool.query(saldoFavorQuery(''));
const antesMap = new Map(antes.map(r => [r.codigo_cliente, Number(r.saldo_a_favor)]));

// DESPUÉS: solo RC
const [despues] = await pool.query(saldoFavorQuery("AND pay.IJ_SINORIN = 'RC'"));
const despuesMap = new Map(despues.map(r => [r.codigo_cliente, Number(r.saldo_a_favor)]));

console.log(`Clientes con saldo a favor ANTES (RC+DE+DC): ${antesMap.size}`);
console.log(`Clientes con saldo a favor DESPUÉS (solo RC): ${despuesMap.size}`);
console.log(`Clientes que pierden saldo a favor: ${antesMap.size - despuesMap.size}\n`);

// Verificar CG0029 específicamente
console.log('--- CG0029 (SENADO) ---');
console.log(`  ANTES:   RD$${(antesMap.get('CG0029') || 0).toLocaleString()}`);
console.log(`  DESPUÉS: RD$${(despuesMap.get('CG0029') || 0).toLocaleString()}`);

// Cartera pendiente por cliente (para calcular "cubiertos")
const [cartera] = await pool.query(`
  SELECT IJ_CCODE AS codigo_cliente, SUM(IJ_TOT - IJ_TOTAPPL) AS pendiente
  FROM v_cobr_ijnl
  WHERE IJ_TYPEDOC = 'IN' AND IJ_INVTORF = 'T' AND IJ_PAID = 'F'
    AND (IJ_TOT - IJ_TOTAPPL) > 0
  GROUP BY IJ_CCODE
`);
const pendienteMap = new Map(cartera.map(r => [r.codigo_cliente, Number(r.pendiente)]));

// Contar "cubiertos" antes y después
let cubiertosAntes = 0, cubiertosRcOnly = 0;
for (const [cod, pend] of pendienteMap) {
  const favAntes = antesMap.get(cod) || 0;
  const favDespues = despuesMap.get(cod) || 0;
  if (favAntes >= pend && pend > 0) cubiertosAntes++;
  if (favDespues >= pend && pend > 0) cubiertosRcOnly++;
}

console.log(`\n--- Clientes "cubiertos por anticipo" ---`);
console.log(`  ANTES (RC+DE+DC): ${cubiertosAntes}`);
console.log(`  DESPUÉS (solo RC): ${cubiertosRcOnly}`);
console.log(`  Falsos positivos eliminados: ${cubiertosAntes - cubiertosRcOnly}`);

// Saldo a favor global
const totalAntes = [...antesMap.values()].reduce((a, b) => a + b, 0);
const totalDespues = [...despuesMap.values()].reduce((a, b) => a + b, 0);
console.log(`\n--- Saldo a favor global ---`);
console.log(`  ANTES:   RD$${totalAntes.toLocaleString()}`);
console.log(`  DESPUÉS: RD$${totalDespues.toLocaleString()}`);
console.log(`  Inflado por DE/DC: RD$${(totalAntes - totalDespues).toLocaleString()}`);

// Listar clientes que AÚN están cubiertos después del fix
if (cubiertosRcOnly > 0) {
  console.log(`\n--- Clientes AÚN cubiertos (solo RC, legítimos) ---`);
  const cubiertosLegitimos = [];
  for (const [cod, pend] of pendienteMap) {
    const fav = despuesMap.get(cod) || 0;
    if (fav >= pend && pend > 0) {
      cubiertosLegitimos.push({ codigo: cod, pendiente: pend, saldo_a_favor: fav });
    }
  }
  cubiertosLegitimos.sort((a, b) => b.saldo_a_favor - a.saldo_a_favor);
  console.table(cubiertosLegitimos.slice(0, 20));
}

// Listar los que eran falsos positivos
console.log(`\n--- Falsos positivos (eran "cubiertos" por retenciones DE) ---`);
const falsos = [];
for (const [cod, pend] of pendienteMap) {
  const favAntes = antesMap.get(cod) || 0;
  const favDespues = despuesMap.get(cod) || 0;
  if (favAntes >= pend && pend > 0 && favDespues < pend) {
    falsos.push({
      codigo: cod,
      pendiente: Math.round(pend),
      favor_antes: Math.round(favAntes),
      favor_rc_only: Math.round(favDespues),
    });
  }
}
falsos.sort((a, b) => b.pendiente - a.pendiente);
console.table(falsos.slice(0, 30));

await pool.end();
console.log('\n=== FIN ===');
