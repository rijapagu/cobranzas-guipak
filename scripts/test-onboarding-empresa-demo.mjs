/**
 * E2E del onboarding de un tenant (Fase 3 Etapa 3) — el playbook del alta:
 *   1. POST /api/internal/admin/empresas (alta empresa + admin)
 *   2. login del admin
 *   3. PUT configuración (identidad + SMTP + WhatsApp)
 *   4. importar cartera CSV
 *   5. generar cola → la gestión firma con la identidad del tenant
 *   6. aprobar + enviar → el envío usa el SMTP del TENANT (host dummy →
 *      falla con error del tenant, no con el SMTP de Guipak)
 *
 * Uso: INTERNAL_ADMIN_SECRET=... node scripts/test-onboarding-empresa-demo.mjs [base_url]
 */

import fs from 'node:fs';

const BASE = process.argv[2] || 'https://cobros.sguipak.com';
const SECRET = process.env.INTERNAL_ADMIN_SECRET
  || fs.readFileSync('.env.local', 'utf8').match(/INTERNAL_ADMIN_SECRET=(.*)/)?.[1]?.trim();
if (!SECRET) { console.error('Falta INTERNAL_ADMIN_SECRET'); process.exit(1); }

const ADMIN_EMAIL = 'admin@demo-lunes.test';
const ADMIN_PASS = 'Demo-Lunes-2026!Seguro';

let fallos = 0;
const check = (c, m) => { console.log(c ? `OK    ${m}` : `FALLO ${m}`); if (!c) fallos++; };

// 1. Alta (idempotente: si el slug ya existe, seguimos con login)
const alta = await fetch(`${BASE}/api/internal/admin/empresas`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-internal-secret': SECRET },
  body: JSON.stringify({
    nombre: 'Empresa Demo Lunes, S.R.L.',
    slug: 'demo-lunes',
    erp_tipo: 'CSV',
    admin_email: ADMIN_EMAIL,
    admin_nombre: 'Admin Demo',
    admin_password: ADMIN_PASS,
  }),
});
const altaJson = await alta.json();
if (alta.status === 409) {
  console.log('alta: empresa ya existía (409) — continuando con login');
} else {
  check(alta.ok && altaJson.empresa_id > 0, `alta de empresa (status ${alta.status}, id ${altaJson.empresa_id})`);
}

// 2. Login del admin del tenant
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
});
check(login.ok, `login admin tenant (${login.status})`);
if (!login.ok) process.exit(1);
const cookie = login.headers.get('set-cookie').split(';')[0];

// 3. Configurar identidad + SMTP dummy + WhatsApp dummy
const putCfg = await fetch(`${BASE}/api/cobranzas/configuracion/empresa`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    identidad: {
      nombre: 'Empresa Demo Lunes, S.R.L.',
      alias: 'Demo Lunes',
      firma: 'Departamento de Cobranzas\nEmpresa Demo Lunes, S.R.L.',
    },
    smtp: {
      host: 'smtp.demo-lunes.invalid',
      port: 465,
      user: 'cobros@demo-lunes.test',
      pass: 'secreta-smtp-demo',
      from: 'cobros@demo-lunes.test',
      nombreRemitente: 'Cobros Demo Lunes',
    },
    evolution: {
      url: 'https://evolution.demo-lunes.invalid',
      apikey: 'apikey-demo',
      instance: 'DemoLunes',
    },
  }),
});
const cfgJson = await putCfg.json();
check(putCfg.ok, `guardar configuración (${putCfg.status})`);
check(cfgJson.config?.smtp?.hasPassword === true && cfgJson.config?.evolution?.hasApikey === true,
  'config: secretos guardados sin exponerse');
check(JSON.stringify(cfgJson).includes('secreta-smtp-demo') === false, 'config: la respuesta NO contiene la contraseña en claro');

// 4. Importar cartera (1 factura vencida con email para canal EMAIL)
const hoy = new Date();
const dias = (n) => new Date(hoy.getTime() + n * 86400000).toISOString().slice(0, 10);
const csvFacturas = [
  'numero,codigo_cliente,nombre_cliente,total,saldo_pendiente,fecha_vencimiento',
  `7001,DEMO-001,Cliente Demo Uno,4000.00,4000.00,${dias(-20)}`,
].join('\n');
const csvClientes = [
  'codigo,nombre,email',
  'DEMO-001,Cliente Demo Uno,pagos@clientedemo.test',
].join('\n');
const form = new FormData();
form.append('facturas', new File([csvFacturas], 'facturas.csv', { type: 'text/csv' }));
form.append('clientes', new File([csvClientes], 'clientes.csv', { type: 'text/csv' }));
const imp = await fetch(`${BASE}/api/erp/importar-cartera`, { method: 'POST', headers: { cookie }, body: form });
const impJson = await imp.json();
check(imp.ok && impJson.facturas_importadas === 1, `importar cartera (${imp.status}, ${impJson.facturas_importadas} facturas)`);

// 5. Generar cola → identidad del tenant en el mensaje
const gc = await (await fetch(`${BASE}/api/cobranzas/generar-cola`, { method: 'POST', headers: { cookie } })).json();
check(gc.generadas >= 1, `generar-cola (${gc.generadas} gestiones)`);
const cola = await (await fetch(`${BASE}/api/cobranzas/cola-aprobacion`, { headers: { cookie } })).json();
const gestion = cola.gestiones?.find((g) => g.codigo_cliente === 'DEMO-001');
check(!!gestion, 'gestión DEMO-001 en cola');
const textoGestion = `${gestion?.mensaje_propuesto_email || ''} ${gestion?.mensaje_propuesto_wa || ''}`;
check(/demo lunes/i.test(textoGestion), 'mensaje firmado con la identidad del tenant ("Demo Lunes")');
check(!/guipak/i.test(textoGestion), 'mensaje SIN mención a Guipak');

// 6. Aprobar + enviar → debe usar el SMTP del tenant (host .invalid → falla
//    con error de conexión, lo que PRUEBA que no usó el SMTP de Guipak).
if (gestion) {
  const ap = await fetch(`${BASE}/api/cobranzas/gestiones/${gestion.id}/aprobar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({}),
  });
  check(ap.ok, `aprobar gestión (${ap.status})`);
  const env = await fetch(`${BASE}/api/cobranzas/gestiones/${gestion.id}/enviar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({}),
  });
  const envJson = await env.json().catch(() => ({}));
  const texto = JSON.stringify(envJson);
  console.log('  enviar →', env.status, texto.slice(0, 180));
  // La ruta responde 200 con estado FALLIDO cuando el canal no entrega.
  check(envJson.estado === 'FALLIDO' || !env.ok, 'envío NO entregado (SMTP dummy del tenant, esperado)');
  check(envJson.email_message_id == null, 'sin message id (no salió por el SMTP de Guipak)');
}

console.log(fallos === 0 ? '\nONBOARDING OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
