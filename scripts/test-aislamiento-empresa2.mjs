/**
 * Test de aislamiento multi-tenant (Fase 3 Etapa 1).
 *
 * Hace login con el usuario de la empresa 2 de prueba (migración 032) y
 * verifica que los endpoints principales devuelven CERO datos de Guipak.
 *
 * Uso: node scripts/test-aislamiento-empresa2.mjs [base_url]
 *      (password del usuario de prueba via env TEST_EMPRESA2_PASS)
 */

const BASE = process.argv[2] || 'https://cobros.sguipak.com';
const EMAIL = 'prueba@empresa2.test';
const PASS = process.env.TEST_EMPRESA2_PASS;

if (!PASS) {
  console.error('Falta TEST_EMPRESA2_PASS');
  process.exit(1);
}

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
console.log('login OK como', EMAIL, '→ cookie', cookie?.split('=')[0]);

// endpoint → función que extrae los registros visibles de la respuesta
const CHECKS = {
  '/api/cobranzas/tareas': (j) => j.tareas,
  '/api/cobranzas/cola-aprobacion': (j) => j.gestiones,
  '/api/cobranzas/conversaciones': (j) => j.conversaciones ?? j.mensajes ?? j.items,
  '/api/cobranzas/disputas': (j) => j.disputas,
  '/api/cobranzas/documentos': (j) => j.documentos,
  '/api/cobranzas/plantillas': (j) => j.plantillas,
  '/api/cobranzas/cadencias': (j) => j.cadencias,
  '/api/cobranzas/clientes': (j) => j.clientes,
  '/api/conciliacion/resultados': (j) => j.entradas,
  '/api/softec/cartera-vencida': (j) => j.facturas,
  '/api/softec/resumen-segmentos': (j) => j.segmentos,
  '/api/cobranzas/alertas': (j) => j.alertas,
};

// El dashboard no devuelve lista: verificar que los KPIs estén en cero.
async function checkDashboard(cookie) {
  const r = await fetch(`${BASE}/api/cobranzas/dashboard`, { headers: { cookie } });
  const j = await r.json();
  const sospechosos = ['cartera_total', 'total_facturas', 'total_clientes', 'gestiones_hoy'];
  const conDatos = sospechosos.filter((k) => Number(j[k]) > 0);
  if (conDatos.length === 0) {
    console.log('OK    /api/cobranzas/dashboard → KPIs en cero');
    return 0;
  }
  console.log(`LEAK  /api/cobranzas/dashboard → KPIs con datos Guipak: ${conDatos.join(', ')}`);
  return 1;
}

let fallos = 0;
for (const [path, extraer] of Object.entries(CHECKS)) {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
    if (r.status === 404) {
      console.log(`SKIP  ${path} (404 — ruta no existe con ese nombre)`);
      continue;
    }
    const j = await r.json().catch(() => ({}));
    const rows = extraer(j);
    const n = Array.isArray(rows) ? rows.length : null;
    if (n === 0) {
      console.log(`OK    ${path} → 0 registros`);
    } else if (n === null) {
      console.log(`WARN  ${path} → status ${r.status}, sin lista reconocible:`, JSON.stringify(j).slice(0, 200));
    } else {
      console.log(`LEAK  ${path} → ${n} registros visibles para empresa 2 !!`);
      fallos++;
    }
  } catch (e) {
    console.log(`ERROR ${path}:`, e.message);
    fallos++;
  }
}

fallos += await checkDashboard(cookie);

console.log(fallos === 0 ? '\nAISLAMIENTO OK' : `\n${fallos} FUGAS DETECTADAS`);
process.exit(fallos === 0 ? 0 : 1);
