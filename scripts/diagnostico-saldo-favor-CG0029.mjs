// Diagnóstico: ¿de dónde sale el saldo a favor de RD$263,599 para CG0029 (SENADO)?
// El ERP muestra balance $187,619.13 SIN saldo a favor.
// Uso: node scripts/diagnostico-saldo-favor-CG0029.mjs

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

console.log('=== DIAGNÓSTICO SALDO A FAVOR CG0029 (SENADO) ===\n');

// 1. Facturas pendientes (lo que el ERP muestra)
console.log('--- 1. Facturas pendientes (v_cobr_ijnl) ---');
const [facturas] = await pool.query(`
  SELECT IJ_LOCAL, IJ_SINORIN, IJ_INUM, IJ_TYPEDOC, IJ_INVTORF,
         IJ_TOT, IJ_TOTAPPL, (IJ_TOT - IJ_TOTAPPL) AS pendiente,
         IJ_PAID, IJ_CCODE, IJ_DATE, IJ_DUEDATE
  FROM v_cobr_ijnl
  WHERE IJ_CCODE = 'CG0029'
  ORDER BY IJ_DATE DESC
`);
console.table(facturas);

// 2. TODOS los recibos/pagos (v_cobr_ijnl_pay) — ¿cuáles hay?
console.log('\n--- 2. Recibos/pagos en v_cobr_ijnl_pay ---');
const [pagos] = await pool.query(`
  SELECT *
  FROM v_cobr_ijnl_pay
  WHERE IJ_CCODE = 'CG0029'
  ORDER BY IJ_DATE DESC
`);
console.log(`Total recibos para CG0029: ${pagos.length}`);
console.table(pagos);

// 3. Aplicaciones (v_cobr_irjnl) para esos recibos
if (pagos.length > 0) {
  console.log('\n--- 3. Aplicaciones (v_cobr_irjnl) para esos recibos ---');
  const [aplicaciones] = await pool.query(`
    SELECT r.IR_PLOCAL, r.IR_PTYPDOC, r.IR_RECNUM,
           r.IR_FLOCAL, r.IR_FTYPDOC, r.IR_FINUM,
           r.IR_AMTPAID
    FROM v_cobr_irjnl r
    INNER JOIN v_cobr_ijnl_pay pay
      ON  r.IR_PLOCAL  = pay.IJ_LOCAL
      AND r.IR_PTYPDOC = pay.IJ_SINORIN
      AND r.IR_RECNUM  = pay.IJ_RECNUM
    WHERE pay.IJ_CCODE = 'CG0029'
  `);
  console.log(`Total aplicaciones: ${aplicaciones.length}`);
  console.table(aplicaciones);

  // 4. Cálculo del saldo a favor (replica la query del helper)
  console.log('\n--- 4. Cálculo saldo a favor (misma lógica que el helper) ---');
  const [saldoFavor] = await pool.query(`
    SELECT
      codigo_cliente,
      SUM(sin_aplicar) AS saldo_a_favor
    FROM (
      SELECT
        pay.IJ_CCODE                            AS codigo_cliente,
        pay.IJ_LOCAL, pay.IJ_SINORIN, pay.IJ_RECNUM,
        pay.IJ_TOT                              AS total_recibo,
        IFNULL(ap.aplicado, 0)                  AS total_aplicado,
        (pay.IJ_TOT - IFNULL(ap.aplicado, 0))   AS sin_aplicar
      FROM v_cobr_ijnl_pay pay
      LEFT JOIN (
        SELECT
          r.IR_PLOCAL,
          r.IR_PTYPDOC,
          r.IR_RECNUM,
          SUM(r.IR_AMTPAID) AS aplicado
        FROM v_cobr_irjnl r
        GROUP BY r.IR_PLOCAL, r.IR_PTYPDOC, r.IR_RECNUM
      ) ap
        ON  ap.IR_PLOCAL  = pay.IJ_LOCAL
        AND ap.IR_PTYPDOC = pay.IJ_SINORIN
        AND ap.IR_RECNUM  = pay.IJ_RECNUM
      WHERE pay.IJ_CCODE = 'CG0029'
    ) recibos
    WHERE sin_aplicar > 0.01
    GROUP BY codigo_cliente
  `);
  console.log('Saldo a favor calculado:');
  console.table(saldoFavor);

  // 5. Detalle: cada recibo con su "sin_aplicar"
  console.log('\n--- 5. Detalle por recibo: total vs aplicado ---');
  const [detalle] = await pool.query(`
    SELECT
      pay.IJ_LOCAL, pay.IJ_SINORIN, pay.IJ_RECNUM,
      pay.IJ_TOT                              AS total_recibo,
      IFNULL(ap.aplicado, 0)                  AS total_aplicado,
      (pay.IJ_TOT - IFNULL(ap.aplicado, 0))   AS sin_aplicar,
      pay.IJ_DATE
    FROM v_cobr_ijnl_pay pay
    LEFT JOIN (
      SELECT
        r.IR_PLOCAL,
        r.IR_PTYPDOC,
        r.IR_RECNUM,
        SUM(r.IR_AMTPAID) AS aplicado
      FROM v_cobr_irjnl r
      GROUP BY r.IR_PLOCAL, r.IR_PTYPDOC, r.IR_RECNUM
    ) ap
      ON  ap.IR_PLOCAL  = pay.IJ_LOCAL
      AND ap.IR_PTYPDOC = pay.IJ_SINORIN
      AND ap.IR_RECNUM  = pay.IJ_RECNUM
    WHERE pay.IJ_CCODE = 'CG0029'
    ORDER BY sin_aplicar DESC
  `);
  console.table(detalle);
}

await pool.end();
console.log('\n=== FIN DIAGNÓSTICO ===');
