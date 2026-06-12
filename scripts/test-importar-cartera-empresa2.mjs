/**
 * Test E2E del flujo CSV (Fase 3 Etapa 2): importa una cartera de prueba para
 * la empresa 2 y verifica que cartera/segmentos/clientes/dashboard la sirven.
 *
 * Uso: TEST_EMPRESA2_PASS=<pass> node scripts/test-importar-cartera-empresa2.mjs [base_url]
 * Ojo: el login tiene rate limit de 10 intentos / 15 min por IP.
 */

const BASE = process.argv[2] || 'https://cobros.sguipak.com';
const PASS = process.env.TEST_EMPRESA2_PASS;
if (!PASS) { console.error('Falta TEST_EMPRESA2_PASS'); process.exit(1); }

const hoy = new Date();
const dias = (n) => {
  const d = new Date(hoy.getTime() + n * 86400000);
  return d.toISOString().slice(0, 10);
};

// 3 facturas: ROJO (40d vencida), AMARILLO (10d), VERDE (vence en 3d)
const csvFacturas = [
  'numero,codigo_cliente,nombre_cliente,total,saldo_pendiente,fecha_vencimiento,fecha_emision,ncf,moneda',
  `9001,CLI-001,"Comercial Prueba, SRL",10000.00,8500.50,${dias(-40)},${dias(-70)},B0100000001,DOP`,
  `9002,CLI-001,"Comercial Prueba, SRL",5000.00,5000.00,${dias(-10)},${dias(-40)},B0100000002,DOP`,
  `9003,CLI-002,Distribuidora Demo,2500.00,2500.00,${dias(3)},${dias(-27)},B0100000003,DOP`,
].join('\n');

const csvClientes = [
  'codigo,nombre,rnc,email,telefono,contacto_cobros,vendedor',
  'CLI-001,"Comercial Prueba, SRL",101000001,pagos@comercialprueba.test,8095550001,Depto CxP,V01',
  'CLI-002,Distribuidora Demo,101000002,,8095550002,,V02',
].join('\n');

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'prueba@empresa2.test', password: PASS }),
});
if (!login.ok) { console.error('LOGIN FALLÓ:', login.status, await login.text()); process.exit(1); }
const cookie = login.headers.get('set-cookie').split(';')[0];
console.log('login OK');

// Importar
const form = new FormData();
form.append('facturas', new File([csvFacturas], 'facturas.csv', { type: 'text/csv' }));
form.append('clientes', new File([csvClientes], 'clientes.csv', { type: 'text/csv' }));
const imp = await fetch(`${BASE}/api/erp/importar-cartera`, {
  method: 'POST',
  headers: { cookie },
  body: form,
});
const impJson = await imp.json();
console.log('importar:', imp.status, JSON.stringify(impJson));
if (!imp.ok || impJson.facturas_importadas !== 3) {
  console.error('IMPORTACIÓN FALLÓ');
  process.exit(1);
}

let fallos = 0;
const check = (cond, msg) => {
  console.log(cond ? `OK    ${msg}` : `FALLO ${msg}`);
  if (!cond) fallos++;
};

// Cartera
const cart = await (await fetch(`${BASE}/api/softec/cartera-vencida`, { headers: { cookie } })).json();
check(cart.total === 3, `cartera: 3 facturas (vino ${cart.total})`);
const f9001 = cart.facturas?.find((f) => f.numero_interno === 9001);
check(!!f9001 && f9001.segmento_riesgo === 'ROJO' && Number(f9001.saldo_pendiente) === 8500.5,
  'cartera: factura 9001 ROJO con saldo 8500.50');
check(cart.facturas?.find((f) => f.numero_interno === 9003)?.segmento_riesgo === 'VERDE',
  'cartera: factura 9003 por vencer = VERDE');
check(f9001?.email === 'pagos@comercialprueba.test', 'cartera: email del cliente cruzado');

// Segmentos (solo vencidas: 9001 ROJO + 9002 AMARILLO)
const seg = await (await fetch(`${BASE}/api/softec/resumen-segmentos`, { headers: { cookie } })).json();
check(seg.total_facturas === 2, `segmentos: 2 vencidas (vino ${seg.total_facturas})`);
check(seg.segmentos?.some((s) => s.segmento === 'ROJO' && s.num_facturas === 1), 'segmentos: 1 ROJO');
check(Number(seg.total_cartera) === 13500.5, `segmentos: total 13500.50 (vino ${seg.total_cartera})`);

// Clientes
const cli = await (await fetch(`${BASE}/api/cobranzas/clientes`, { headers: { cookie } })).json();
check(cli.total === 2, `clientes: 2 (vino ${cli.total})`);
const cli1 = cli.clientes?.find((c) => c.codigo_cliente === 'CLI-001');
check(!!cli1 && Number(cli1.saldo_total) === 13500.5 && cli1.total_facturas_pendientes === 2,
  'clientes: CLI-001 con 2 facturas y saldo 13500.50');

// Dashboard
const dash = await (await fetch(`${BASE}/api/cobranzas/dashboard?refresh=1`, { headers: { cookie } })).json();
check(Number(dash.cartera_total) === 16000.5, `dashboard: cartera_total 16000.50 (vino ${dash.cartera_total})`);
check(dash.total_facturas === 3 && dash.total_clientes === 2, 'dashboard: 3 facturas / 2 clientes');
check(dash.top_clientes?.[0]?.codigo === 'CLI-001', 'dashboard: top cliente CLI-001');
check(dash.modo === 'live', `dashboard: modo live (vino ${dash.modo})`);

console.log(fallos === 0 ? '\nFLUJO CSV OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
