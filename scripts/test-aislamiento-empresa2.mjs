/**
 * Test de aislamiento multi-tenant (Fase 3).
 *
 * Hace login con el usuario de la empresa 2 de prueba (migración 032) y
 * verifica que los endpoints solo muestran DATOS PROPIOS de la empresa 2:
 * sus clientes de prueba usan códigos CLI-* (cartera CSV importada por
 * scripts/test-importar-cartera-empresa2.mjs) — cualquier código distinto
 * o un monto del tamaño de la cartera Guipak es una fuga.
 *
 * Uso: TEST_EMPRESA2_PASS=<pass> node scripts/test-aislamiento-empresa2.mjs [base_url]
 * Ojo: rate limit de login 10 intentos / 15 min por IP.
 */

const BASE = process.argv[2] || 'https://cobros.sguipak.com';
const EMAIL = 'prueba@empresa2.test';
const PASS = process.env.TEST_EMPRESA2_PASS;

if (!PASS) {
  console.error('Falta TEST_EMPRESA2_PASS');
  process.exit(1);
}

// Los datos de prueba de la empresa 2 usan este prefijo de cliente.
const esPropio = (codigo) => typeof codigo === 'string' && codigo.startsWith('CLI-');

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
if (!login.ok) {
  console.error('LOGIN FALLÓ:', login.status, await login.text());
  process.exit(1);
}
const cookie = login.headers.get('set-cookie')?.split(';')[0];
console.log('login OK como', EMAIL);

// endpoint → { extraer filas, campo con el código de cliente }
const CHECKS = {
  '/api/cobranzas/tareas': { rows: (j) => j.tareas, codigo: 'codigo_cliente' },
  '/api/cobranzas/cola-aprobacion': { rows: (j) => j.gestiones, codigo: 'codigo_cliente' },
  '/api/cobranzas/conversaciones': { rows: (j) => j.conversaciones, codigo: 'codigo_cliente' },
  '/api/cobranzas/disputas': { rows: (j) => j.disputas, codigo: 'codigo_cliente' },
  '/api/cobranzas/documentos': { rows: (j) => j.documentos, codigo: 'codigo_cliente' },
  '/api/cobranzas/plantillas': { rows: (j) => j.plantillas, codigo: null },
  '/api/cobranzas/cadencias': { rows: (j) => j.cadencias, codigo: null },
  '/api/cobranzas/clientes': { rows: (j) => j.clientes, codigo: 'codigo_cliente' },
  '/api/conciliacion/resultados': { rows: (j) => j.entradas, codigo: 'codigo_cliente' },
  '/api/softec/cartera-vencida': { rows: (j) => j.facturas, codigo: 'codigo_cliente' },
  '/api/cobranzas/alertas': { rows: (j) => j.alertas, codigo: 'codigo_cliente' },
};

let fallos = 0;
const check = (cond, msg) => {
  console.log(cond ? `OK    ${msg}` : `FALLO ${msg}`);
  if (!cond) fallos++;
};

for (const [path, cfg] of Object.entries(CHECKS)) {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
    const j = await r.json().catch(() => ({}));
    const rows = cfg.rows(j);
    if (!Array.isArray(rows)) {
      console.log(`WARN  ${path} → status ${r.status}, sin lista reconocible:`, JSON.stringify(j).slice(0, 150));
      fallos++;
      continue;
    }
    const ajenos = cfg.codigo
      ? rows.filter((x) => x[cfg.codigo] != null && !esPropio(String(x[cfg.codigo]).trim()))
      : [];
    check(
      ajenos.length === 0,
      `${path} → ${rows.length} registro(s), ${ajenos.length} ajeno(s)${ajenos[0] ? ` (ej: ${ajenos[0][cfg.codigo]})` : ''}`
    );
  } catch (e) {
    console.log(`ERROR ${path}:`, e.message);
    fallos++;
  }
}

// Resumen de segmentos: el total debe ser el de la cartera de prueba (~miles),
// jamás del orden de la cartera Guipak (decenas de millones).
const seg = await (await fetch(`${BASE}/api/softec/resumen-segmentos`, { headers: { cookie } })).json();
check(Number(seg.total_cartera) < 1_000_000, `segmentos: total_cartera ${seg.total_cartera} es de la empresa 2 (< 1M)`);

// Dashboard: KPIs del tamaño de la cartera de prueba + top clientes propios.
const dash = await (await fetch(`${BASE}/api/cobranzas/dashboard?refresh=1`, { headers: { cookie } })).json();
check(Number(dash.cartera_total) < 1_000_000, `dashboard: cartera_total ${dash.cartera_total} es de la empresa 2 (< 1M)`);
const topAjenos = (dash.top_clientes || []).filter((c) => !esPropio(String(c.codigo)));
check(topAjenos.length === 0, `dashboard: top_clientes sin códigos ajenos (${topAjenos.length})`);

console.log(fallos === 0 ? '\nAISLAMIENTO OK' : `\n${fallos} FUGAS DETECTADAS`);
process.exit(fallos === 0 ? 0 : 1);
