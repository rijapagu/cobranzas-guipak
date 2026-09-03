/**
 * Coherencia entre el prompt del agente y las tools reales de tools.ts.
 *
 * Dos chequeos:
 *  1. Ningún NOMBRE_VIEJO (tool renombrada o retirada) aparece en ningún
 *     bloque del prompt — el bug real que motivó este test: el prompt seguía
 *     citando estado_cobros_hoy/listar_tareas/... meses después del rename.
 *  2. Toda tool que existe HOY en TOOLS aparece al menos una vez en
 *     CONOCIMIENTO_APP — si agregas una tool y se te olvida documentarla ahí,
 *     esto lo atrapa antes de que el usuario pregunte "¿qué puedes hacer?" y
 *     el asistente no sepa que existe.
 *
 * No toca DB: importar tools.ts solo crea el pool mysql2 (lazy — no conecta
 * hasta el primer query), así que es seguro en el grupo offline.
 *
 * Uso: npx tsx scripts/test-prompt-tools.ts
 */
import { TOOLS } from '../lib/telegram/tools';
import {
  PROMPT_TONO_BASE,
  REGLAS_OPERATIVAS,
  ROUTING_HINT_LOCAL,
  FLUJOS_OPERACIONALES,
} from '../lib/telegram/agent-prompt';
import { CONOCIMIENTO_APP } from '../lib/telegram/conocimiento-app';

let failures = 0;
function assert(cond: boolean, label: string, detalle?: string) {
  if (cond) {
    console.log(`  OK    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detalle ? ' — ' + detalle : ''}`);
  }
}

const BLOQUES: { nombre: string; texto: string }[] = [
  { nombre: 'PROMPT_TONO_BASE', texto: PROMPT_TONO_BASE },
  { nombre: 'REGLAS_OPERATIVAS', texto: REGLAS_OPERATIVAS },
  { nombre: 'ROUTING_HINT_LOCAL', texto: ROUTING_HINT_LOCAL },
  { nombre: 'CONOCIMIENTO_APP', texto: CONOCIMIENTO_APP },
  { nombre: 'FLUJOS_OPERACIONALES', texto: FLUJOS_OPERACIONALES },
];

/** Whole-word match — "_" cuenta como carácter de palabra, así que \b ya alcanza. */
function apareceComoPalabra(texto: string, nombre: string): boolean {
  return new RegExp(`\\b${nombre}\\b`).test(texto);
}

// Nombres que YA NO son una tool publicada: quedaron como alias deprecados en
// el switch de ejecutarTool (tools.ts), o se retiraron del todo. Si alguno
// aparece en un bloque de prompt es un resto de un rename viejo.
const NOMBRES_VIEJOS = [
  'estado_cobros_hoy',
  'listar_pendientes_aprobacion',
  'listar_promesas_vencidas',
  'historial_conversaciones_cliente',
  'crear_tarea',
  'listar_tareas',
  'marcar_tarea_hecha',
  'proponer_correo_cliente',
  'listar_plantillas',
  'obtener_contactos_cliente',
  'guardar_dato_cliente',
  'listar_clientes_sin_datos',
  'estado_cadencias',
  'estado_conciliacion',
  'proponer_whatsapp_cliente',
  'consultar_memoria_cliente',
  'guardar_memoria_cliente',
  'guardar_memoria_equipo',
  'obtener_perfil_riesgo_cliente',
  'analizar_riesgo_cartera',
];

function main() {
  console.log('\n=== TEST coherencia prompt <-> tools.ts ===\n');

  const nombresReales = TOOLS.map((t) => t.name);
  console.log(`TOOLS reales: ${nombresReales.length}\n`);
  assert(nombresReales.length > 0, 'TOOLS no está vacío (el import de tools.ts funcionó)');

  console.log('\n[1] Ningún nombre viejo en ningún bloque del prompt');
  for (const viejo of NOMBRES_VIEJOS) {
    for (const bloque of BLOQUES) {
      assert(
        !apareceComoPalabra(bloque.texto, viejo),
        `"${viejo}" no aparece en ${bloque.nombre}`
      );
    }
  }

  console.log('\n[2] Toda tool de TOOLS aparece al menos una vez en CONOCIMIENTO_APP');
  for (const nombre of nombresReales) {
    assert(apareceComoPalabra(CONOCIMIENTO_APP, nombre), `${nombre} está documentada`);
  }

  console.log();
  if (failures === 0) {
    console.log('=== TODOS OK ===');
    process.exit(0);
  } else {
    console.error(`=== ${failures} ASSERT(S) FALLARON ===`);
    process.exit(1);
  }
}

main();
