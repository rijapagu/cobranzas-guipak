/**
 * Suite de Test — Cobranzas Guipak.
 *
 * Runner único que ejecuta los scripts de prueba de `scripts/` y da un
 * resumen consolidado (N/M passed) con exit code apto para CI.
 *
 * Cada test es un script independiente que ya imprime su propio detalle y
 * termina con exit 0 (pasa) o != 0 (falla). Este runner los lanza como
 * procesos hijo, mide tiempo, aplica timeout y agrega el resultado.
 *
 * Uso:
 *   npm test                      → grupo OFFLINE (hermético, sin credenciales) [default]
 *   npm test -- --whatsapp        → solo el grupo whatsapp (Evolution)
 *   npm test -- --softec          → solo el grupo softec
 *   npm test -- --db              → solo el grupo db (DB cobranzas local)
 *   npm test -- --fixtures        → tests que leen datos locales en Extractos/
 *   npm test -- --integration     → todo lo que necesita un backend (no destructivo)
 *   npm test -- --manual          → EFECTOS SECUNDARIOS (escribe DB / envía mensajes reales)
 *   npm test -- --all             → absolutamente todo (incluye --manual)
 *   npm test -- --grep evolution  → filtra por subcadena del nombre (sobre todos los grupos)
 *   npm test -- --list            → lista los tests y sus grupos, sin ejecutar
 *   npm test -- --verbose         → muestra la salida completa de cada test en vivo
 *   npm test -- --timeout 90      → timeout por test en segundos (default 60)
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Registro de tests (clasificados por evidencia, no por suposición) --------
const TESTS = [
  // OFFLINE — hermético: sin red, sin DB, sin credenciales, sin efectos. CI-safe.
  { file: 'test-parser-extracto.ts',          grupo: 'offline',  desc: 'Parser de extractos (ExcelJS en memoria)' },
  { file: 'test-slim-saldo.mjs',              grupo: 'offline',  desc: 'Cálculo slim de saldo (datos inline)' },
  { file: 'smoke-test-guard.mjs',             grupo: 'offline',  desc: 'Guard anti-escritura a Softec (lógica)' },

  // FIXTURES — lee datos locales en Extractos/ (carpeta untracked, no en repo).
  { file: 'test-parser-banco-popular.mjs',    grupo: 'fixtures', desc: 'Parser extractos Banco Popular', necesita: 'Extractos/ local' },

  // WHATSAPP — necesita Evolution API alcanzable. NO envía (sin número).
  { file: 'smoke-test-evolution.mjs',         grupo: 'whatsapp', desc: 'WhatsApp: conexión, instancia, apikey, normalización', necesita: 'Evolution API' },

  // SOFTEC — necesita el ERP Softec (solo lectura, usuario IP-restringido).
  { file: 'smoke-test-softec.mjs',            grupo: 'softec',   desc: 'Vistas v_cobr_* del ERP (solo lectura)', necesita: 'Softec MySQL' },

  // DB — necesita la base cobranzas local (Docker, puerto 3308).
  { file: 'test-saldo-favor.ts',              grupo: 'db',       desc: 'Saldo a favor — lógica contra DB', necesita: 'DB cobranzas' },
  { file: 'test-saldo-favor-telegram.ts',     grupo: 'db',       desc: 'Saldo a favor (formato Telegram)', necesita: 'DB cobranzas' },

  // MANUAL — EFECTOS SECUNDARIOS. Nunca en CI; requiere opt-in explícito.
  { file: 'test-smtp.mjs',                    grupo: 'manual',   desc: 'Prueba de correo', efecto: 'ENVÍA un email real', necesita: 'SMTP' },
  { file: 'test-onboarding-empresa-demo.mjs', grupo: 'manual',   desc: 'Onboarding empresa demo', efecto: 'ESCRIBE en la DB', necesita: 'DB cobranzas' },
  { file: 'test-importar-cartera-empresa2.mjs', grupo: 'manual', desc: 'Importar cartera empresa 2', efecto: 'ESCRIBE en la DB', necesita: 'DB cobranzas' },
  { file: 'test-aislamiento-empresa2.mjs',    grupo: 'manual',   desc: 'Aislamiento multi-tenant', efecto: 'ESCRIBE en la DB', necesita: 'DB cobranzas' },
];

const GRUPOS_INTEGRACION = ['whatsapp', 'softec', 'db', 'fixtures'];
const TODOS_LOS_GRUPOS = [...new Set(TESTS.map((t) => t.grupo))];

// --- Parseo de argumentos -----------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
function valorDe(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const verbose = flags.has('--verbose');
const timeoutMs = Number(valorDe('--timeout', '60')) * 1000;

if (flags.has('--help')) {
  printAyuda();
  process.exit(0);
}
if (flags.has('--list')) {
  printList();
  process.exit(0);
}

// --- Selección de tests -------------------------------------------------------
let seleccion;
const grep = valorDe('--grep', null);
if (grep) {
  seleccion = TESTS.filter((t) => t.file.includes(grep) || t.grupo === grep);
} else {
  const grupos = new Set();
  if (flags.has('--all')) TODOS_LOS_GRUPOS.forEach((g) => grupos.add(g));
  if (flags.has('--integration')) GRUPOS_INTEGRACION.forEach((g) => grupos.add(g));
  for (const g of TODOS_LOS_GRUPOS) if (flags.has(`--${g}`)) grupos.add(g);
  if (grupos.size === 0) grupos.add('offline'); // default
  seleccion = TESTS.filter((t) => grupos.has(t.grupo));
}

if (seleccion.length === 0) {
  console.error('No hay tests que coincidan con la selección. Usa --list para ver los disponibles.');
  process.exit(1);
}

// --- Ejecución ----------------------------------------------------------------
function ejecutar(test) {
  return new Promise((resolve) => {
    const esTs = test.file.endsWith('.ts');
    const args = esTs ? ['--import', 'tsx', `scripts/${test.file}`] : [`scripts/${test.file}`];
    const t0 = Date.now();
    const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
    let out = '';
    let matado = false;
    const timer = setTimeout(() => {
      matado = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      out += d;
      if (verbose) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += d;
      if (verbose) process.stderr.write(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, ms: Date.now() - t0, timedOut: false, out: String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, ms: Date.now() - t0, timedOut: matado, out });
    });
  });
}

function ms(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

const ancho = Math.max(...seleccion.map((t) => t.file.length));
const gruposSel = [...new Set(seleccion.map((t) => t.grupo))];

console.log('╔══ Suite de Test — Cobranzas Guipak');
console.log(`║  grupo(s): ${gruposSel.join(', ')}   ·   ${seleccion.length} test(s)   ·   timeout ${timeoutMs / 1000}s/test`);
if (gruposSel.includes('manual')) {
  console.log('║  ⚠️  GRUPO MANUAL: estos tests ESCRIBEN en la DB o ENVÍAN mensajes reales.');
}
console.log('╚════════════════════════════════════════════════════════════');

let pass = 0;
const fallos = [];

for (const t of seleccion) {
  const efecto = t.efecto ? `  ⚠️ ${t.efecto}` : '';
  if (verbose) console.log(`\n── ${t.file} (${t.grupo})${efecto} ──`);
  const r = await ejecutar(t);
  const nombre = t.file.padEnd(ancho);
  if (r.code === 0) {
    console.log(`  ✅ ${t.grupo.padEnd(9)} ${nombre}  ${ms(r.ms)}`);
    pass++;
  } else {
    const motivo = r.timedOut ? `TIMEOUT (${timeoutMs / 1000}s)` : `exit ${r.code}`;
    console.log(`  ❌ ${t.grupo.padEnd(9)} ${nombre}  ${motivo}`);
    fallos.push({ test: t, r });
  }
}

// Detalle de fallos (salvo en --verbose, donde ya se vio todo en vivo)
if (fallos.length && !verbose) {
  console.log('\n── Detalle de fallos ──');
  for (const { test, r } of fallos) {
    console.log(`\n▼ ${test.file}${test.necesita ? `  (necesita: ${test.necesita})` : ''}`);
    const lineas = r.out.trim().split('\n');
    console.log(lineas.slice(-10).map((l) => '   ' + l).join('\n'));
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`${pass}/${seleccion.length} tests passed.`);
if (fallos.length) {
  const porInfra = fallos.filter((f) => f.test.necesita).map((f) => f.test.necesita);
  if (porInfra.length) {
    console.log(`Nota: algunos fallos pueden ser por backend no disponible (${[...new Set(porInfra)].join(', ')}), no por bug.`);
  }
}
process.exitCode = fallos.length ? 1 : 0;

// --- Helpers de impresión -----------------------------------------------------
function printList() {
  console.log('Tests registrados (por grupo):\n');
  for (const g of TODOS_LOS_GRUPOS) {
    const items = TESTS.filter((t) => t.grupo === g);
    const etiqueta =
      g === 'offline' ? ' (default de `npm test` — hermético, CI-safe)' :
      g === 'manual' ? ' (⚠️ efectos secundarios — solo con --manual/--all)' :
      GRUPOS_INTEGRACION.includes(g) ? ' (integración — necesita backend)' : '';
    console.log(`  [${g}]${etiqueta}`);
    for (const t of items) {
      const extra = [t.necesita && `necesita: ${t.necesita}`, t.efecto && `⚠️ ${t.efecto}`].filter(Boolean).join(' · ');
      console.log(`     • ${t.file.padEnd(34)} ${t.desc}${extra ? `  [${extra}]` : ''}`);
    }
    console.log('');
  }
  console.log('Ejecuta:  npm test            (offline)');
  console.log('          npm test -- --integration   |   --whatsapp | --softec | --db');
  console.log('          npm test -- --all     (incluye --manual: escribe DB / envía mensajes)');
}

function printAyuda() {
  console.log(`Suite de Test — Cobranzas Guipak

  npm test                  grupo offline (default, CI-safe)
  npm test -- --whatsapp     Evolution API (sin envío)
  npm test -- --softec       ERP Softec (solo lectura)
  npm test -- --db           DB cobranzas local
  npm test -- --fixtures     tests que leen Extractos/ local
  npm test -- --integration  todos los backends (no destructivo)
  npm test -- --manual       ⚠️ escribe DB / envía mensajes reales
  npm test -- --all          todo
  npm test -- --grep <txt>   filtra por nombre
  npm test -- --list         lista sin ejecutar
  npm test -- --verbose      salida completa en vivo
  npm test -- --timeout <s>  timeout por test (default 60s)`);
}
