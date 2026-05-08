// Smoke test del refactor: valida que las vistas v_cobr_* funcionan
// y que el guard endurecido no rompe queries legítimas.
//
// Uso: node scripts/smoke-test-softec.mjs
// Requiere: .env.local con credenciales de Softec.

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

const tests = [
  {
    name: 'v_cobr_ijnl COUNT',
    sql: 'SELECT COUNT(*) AS total FROM v_cobr_ijnl WHERE IJ_TYPEDOC = ?',
    params: ['IN'],
  },
  {
    name: 'v_cobr_icust COUNT activos',
    sql: 'SELECT COUNT(*) AS total FROM v_cobr_icust WHERE IC_STATUS = ?',
    params: ['A'],
  },
  {
    name: 'v_cobr_irjnl COUNT',
    sql: 'SELECT COUNT(*) AS total FROM v_cobr_irjnl',
    params: [],
  },
  {
    name: 'v_cobr_ijnl_pay COUNT',
    sql: 'SELECT COUNT(*) AS total FROM v_cobr_ijnl_pay',
    params: [],
  },
  {
    name: 'JOIN v_cobr_ijnl + v_cobr_icust (cartera vencida real)',
    sql: `SELECT COUNT(*) AS total
          FROM v_cobr_ijnl f
          INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
          WHERE f.IJ_TYPEDOC = 'IN'
            AND f.IJ_INVTORF = 'T'
            AND f.IJ_PAID = 'F'
            AND f.IJ_DUEDATE < CURDATE()
            AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0`,
    params: [],
  },
  {
    name: 'JOIN v_cobr_irjnl + v_cobr_ijnl_pay (estado de cuenta)',
    sql: `SELECT r.IR_RECNUM, p.IJ_DESCR
          FROM v_cobr_irjnl r
          LEFT JOIN v_cobr_ijnl_pay p ON p.IJ_LOCAL = r.IR_PLOCAL AND p.IJ_RECNUM = r.IR_RECNUM
          LIMIT 1`,
    params: [],
  },
];

let pass = 0;
let fail = 0;

for (const t of tests) {
  try {
    const start = Date.now();
    const [rows] = await pool.execute(t.sql, t.params);
    const ms = Date.now() - start;
    const sample = JSON.stringify(rows[0] ?? null).slice(0, 80);
    console.log(`  ✅ ${t.name}  (${ms}ms)  ${sample}`);
    pass++;
  } catch (err) {
    console.log(`  ❌ ${t.name}`);
    console.log(`     Error: ${err.message}`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} tests passed.`);

await pool.end();
process.exit(fail > 0 ? 1 : 0);
