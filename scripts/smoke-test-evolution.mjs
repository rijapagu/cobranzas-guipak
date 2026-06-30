// Smoke test de Evolution API (WhatsApp).
// Valida que la instancia configurada responde, que el apikey es correcto,
// que la instancia está CONECTADA, y que la normalización de teléfono (RD)
// se comporta igual que lib/evolution/client.ts.
//
// Uso:
//   node scripts/smoke-test-evolution.mjs                 → solo verificación (NO envía)
//   node scripts/smoke-test-evolution.mjs 8098536995      → además envía un WhatsApp real a ese número
//   node scripts/smoke-test-evolution.mjs 8098536995 "Hola, prueba"
//
// También acepta TEST_WHATSAPP_TO en el entorno en vez del argumento.
// Requiere: .env.local con EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE.

import { readFileSync } from 'node:fs';

// --- Cargar .env.local (sin pisar variables ya presentes en el entorno) ---
try {
  const env = readFileSync('.env.local', 'utf8');
  for (const raw of env.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  console.error('No se pudo leer .env.local — corre el script desde la raíz del proyecto.');
  process.exit(1);
}

const URL = process.env.EVOLUTION_API_URL;
const KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE;

const TARGET = process.argv[2] || process.env.TEST_WHATSAPP_TO || '';
const MENSAJE =
  process.argv[3] ||
  `🤖 Smoke test Cobranzas Guipak — ${new Date().toISOString()}. Si recibes esto, Evolution API funciona.`;

console.log('=== Smoke test Evolution API ===');
console.log(`  URL:      ${URL}`);
console.log(`  Instance: ${INSTANCE}`);
console.log(`  Apikey:   ${KEY ? KEY.slice(0, 8) + '…(' + KEY.length + ' chars)' : '(ausente)'}`);
console.log('');

let pass = 0;
let fail = 0;

function ok(name, extra = '') {
  console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`);
  pass++;
}
function ko(name, err) {
  console.log(`  ❌ ${name}`);
  if (err) console.log(`     ${err}`);
  fail++;
}

// --- Replica EXACTA de limpiarTelefono() en lib/evolution/client.ts ---
function limpiarTelefono(telefono) {
  let num = telefono.replace(/[^0-9]/g, '');
  if (/^(809|829|849)/.test(num) && num.length === 10) num = '1' + num;
  if (num.length === 10 && !num.startsWith('1')) num = '1' + num;
  return num;
}

async function evoFetch(path, init = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    // `connection: close` evita que undici deje un socket keep-alive ocioso:
    // ese socket dispara el assert UV_HANDLE_CLOSING de libuv al salir en
    // Windows (exit 0xC0000409), sobre todo cuando el proceso corre como hijo
    // del runner con stdout en pipe.
    headers: { 'Content-Type': 'application/json', apikey: KEY, connection: 'close', ...(init.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no-JSON */
  }
  return { res, text, json };
}

// --- TEST 0: config presente ---
if (URL && KEY && INSTANCE) {
  ok('Config presente (URL + APIKEY + INSTANCE)');
} else {
  ko('Config presente', 'Falta EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE en .env.local');
  console.log('\nAbortando: sin config no se puede probar nada.');
  process.exit(1);
}

// --- TEST 1: normalización de teléfono (offline, no toca la red) ---
{
  const casos = [
    ['8098536995', '18098536995'],
    ['809-853-6995', '18098536995'],
    ['18098536995', '18098536995'],
    ['+1 (829) 555 1234', '18295551234'],
    ['849 555 1234', '18495551234'],
  ];
  const malos = casos.filter(([entrada, esperado]) => limpiarTelefono(entrada) !== esperado);
  if (malos.length === 0) {
    ok('limpiarTelefono() normaliza números RD', `(${casos.length} casos)`);
  } else {
    ko('limpiarTelefono()', `fallaron: ${malos.map(([e]) => e).join(', ')}`);
  }
}

// --- TEST 2: estado de conexión de la instancia (valida apikey + que esté "open") ---
let instanciaConectada = false;
try {
  const { res, json, text } = await evoFetch(`/instance/connectionState/${INSTANCE}`);
  if (res.status === 401 || res.status === 403) {
    ko('connectionState', `apikey rechazado (HTTP ${res.status}). ¿Actualizaste EVOLUTION_API_KEY?`);
  } else if (!res.ok) {
    ko('connectionState', `HTTP ${res.status}: ${text.slice(0, 120)}`);
  } else {
    const state = json?.instance?.state || json?.state || 'desconocido';
    instanciaConectada = state === 'open';
    if (instanciaConectada) ok('Instancia CONECTADA', `(state=${state})`);
    else ko('Instancia NO conectada', `state=${state} — re-escanea el QR en Evolution`);
  }
} catch (err) {
  ko('connectionState', err.message);
}

// --- TEST 3: fetchInstances (informativo — algunas instalaciones exigen apikey GLOBAL aquí) ---
try {
  const { res, json, text } = await evoFetch(`/instance/fetchInstances`);
  if (res.ok && Array.isArray(json)) {
    const yo = json.find((i) => (i.name || i.instance?.instanceName) === INSTANCE);
    ok('fetchInstances responde', `(${json.length} instancia(s)${yo ? ', incluye la nuestra' : ''})`);
  } else if (res.status === 401 || res.status === 403) {
    // No es fallo crítico: el apikey de instancia no siempre lista todas las instancias.
    console.log(`  ⚠️  fetchInstances rechazó el apikey (HTTP ${res.status}) — normal si usas el apikey de instancia y no el global. No bloquea.`);
  } else {
    console.log(`  ⚠️  fetchInstances HTTP ${res.status}: ${text.slice(0, 100)} (no bloquea)`);
  }
} catch (err) {
  console.log(`  ⚠️  fetchInstances error: ${err.message} (no bloquea)`);
}

// --- TEST 4: envío real (SOLO si se pasó un número objetivo) ---
if (!TARGET) {
  console.log('\n  ⏭️  Envío real OMITIDO (no pasaste número). Para probar end-to-end:');
  console.log('       node scripts/smoke-test-evolution.mjs <numero>');
} else if (!instanciaConectada) {
  ko('Envío real', 'instancia no conectada — no se intenta enviar');
} else {
  const numero = limpiarTelefono(TARGET);
  console.log(`\n  → Enviando WhatsApp real a ${numero} ...`);
  try {
    const { res, json, text } = await evoFetch(`/message/sendText/${INSTANCE}`, {
      method: 'POST',
      body: JSON.stringify({ number: numero, text: MENSAJE }),
    });
    if (res.ok) {
      const id = json?.key?.id || json?.messageId || '(sin id)';
      ok('Envío real', `messageId=${id} — revisa el WhatsApp de ${numero}`);
    } else {
      ko('Envío real', `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    ko('Envío real', err.message);
  }
}

console.log(`\n${pass}/${pass + fail} tests passed.`);
// No usar process.exit() aquí: undici (fetch) mantiene sockets keep-alive y, en
// Windows, forzar la salida provoca "Assertion failed: UV_HANDLE_CLOSING".
// Fijar exitCode y dejar que el event loop drene da una salida limpia.
process.exitCode = fail > 0 ? 1 : 0;
