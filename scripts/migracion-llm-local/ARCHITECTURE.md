# Refactor del Agente Cobros — Router + Tools Narrow

> **Estado:** Fase 1 implementada (rama `feature/refactor-tools-narrow`, 7 commits). Fases 2-5 pendientes.
> **Fecha original:** 2026-05-19. **Actualizado:** 2026-05-20 con findings del research técnico.
> **Origen:** Tras 4 iteraciones de prompt fallidas para Qwen 14B con 22 tools, Ricardo identificó que el problema es arquitectónico, no de tuning. Este doc captura la arquitectura objetivo.
> **Referencia técnica:** ver [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md) para detalle sobre tool calling con LLMs locales (formato, esquemas, parámetros Ollama, BFCL benchmarks).

---

## 1. Problema actual

El bot expone **22 tools simultáneamente** al LLM en cada turno. Haiku 4.5 lo maneja sin problemas. Modelos open source ≤14B se confunden:

- Eligen tools incorrectas (saldo → contactos)
- Inventan argumentos (`codigo_cliente: "0001234"` cuando no se mencionó)
- Llaman múltiples tools paralelas "por si acaso"
- A veces drift de idioma (Qwen → chino)

Lección: **superficie de tools es el bottleneck, no la capacidad del modelo**.

---

## 2. Arquitectura objetivo

```
User msg
   │
   ▼
┌─────────────────┐
│  Router         │  Reglas + keywords (sin LLM al inicio)
│  (intent class) │  Output: { contexto: "consulta_cliente", entidades: { cliente: "Padron" } }
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Context loader │  Carga solo las 3-6 tools del contexto + system prompt narrow
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM            │  Qwen14B / Hermes8B / Haiku — switch por contexto si hace falta
│  (tool calling) │  Recibe MENÚ ESTRECHO, no 22 tools
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Tool executor  │  Código TS deterministic — mismo de hoy
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Communicator   │  LLM redacta respuesta natural con el resultado
│  (sin tools)    │
└────────┬────────┘
         │
         ▼
   Respuesta usuario
```

**Patrón estándar de la industria** (LangGraph, OpenAI Assistants, Anthropic Workbench): Planner / Executor / Communicator. Cada rol con menú estrecho.

---

## 3. Mapa de contextos

7 contextos. Cada uno expone solo lo necesario.

### A. `consulta_cliente` — Lectura sobre un cliente específico

**Keywords de routing:** `saldo`, `debe`, `deuda`, `cuánto`, `aging`, `facturas`, `factura de`, `cliente X` (sin verbo de acción)

**Tools (5):**
- `buscar_cliente`
- `consultar_saldo_cliente`
- `consultar_perfil_riesgo_cliente` (renombrar `obtener_perfil_riesgo_cliente`)
- `consultar_contactos_cliente` (renombrar `obtener_contactos_cliente`, modo resumen)
- `consultar_historial_conversaciones` (renombrar `historial_conversaciones_cliente`)

### B. `gestion_cobranza` — Generar drafts de mensaje

**Keywords:** `correo`, `email`, `whatsapp`, `propón`, `redacta`, `envía`, `gestiona`, `mensaje a`

**Tools (5):**
- `buscar_cliente`
- `consultar_contactos_cliente_detalle` (incluye fuente de cada contacto)
- `proponer_correo_cobranza_cliente` (renombrar `proponer_correo_cliente`)
- `proponer_whatsapp_cobranza_cliente` (renombrar `proponer_whatsapp_cliente`)
- `listar_plantillas_email`

### C. `tareas` — Calendario del equipo

**Keywords:** `tarea`, `recuérdame`, `agenda`, `anota`, `lunes/martes/...`, `mañana`, `llamar a`, `hecho`, `completado`

**Tools (3):**
- `crear_tarea_recordatorio` (renombrar `crear_tarea`)
- `listar_tareas_pendientes` (renombrar `listar_tareas`)
- `marcar_tarea_completada` (renombrar `marcar_tarea_hecha`)

### D. `vista_general` — Sin cliente específico

**Keywords:** `estado del día`, `cómo vamos`, `resumen`, `dashboard`, `cartera`, `qué hay`, `pendiente` (sin nombre), `promesas`, `cadencias`, `conciliación`

**Tools (7):**
- `resumen_estado_cobros_hoy` (renombrar `estado_cobros_hoy`)
- `listar_mensajes_pendientes_aprobacion` (renombrar `listar_pendientes_aprobacion`)
- `listar_promesas_pago_incumplidas` (renombrar `listar_promesas_vencidas`)
- `resumen_riesgo_cartera` (renombrar `analizar_riesgo_cartera`)
- `listar_clientes_con_datos_faltantes` (renombrar `listar_clientes_sin_datos`)
- `resumen_cadencias_automaticas` (renombrar `estado_cadencias`)
- `resumen_conciliacion_bancaria` (renombrar `estado_conciliacion`)

### E. `memoria` — Notas sobre clientes

**Keywords:** `memoria`, `recuerda que`, `sabes que`, `suele`, `siempre paga`, `mejor por`

**Tools (3):**
- `consultar_notas_cliente` (renombrar `consultar_memoria_cliente`)
- `guardar_patron_pago_cliente` (split de `guardar_memoria_cliente`)
- `guardar_canal_efectivo_cliente` (split de `guardar_memoria_cliente`)

### F. `datos_contacto` — Completar datos faltantes

**Keywords:** `el email de X es`, `el whatsapp de X es`, `agregar email`, `el contacto es`

**Tools (3):**
- `guardar_email_cliente` (split de `guardar_dato_cliente` campo=email)
- `guardar_whatsapp_cliente` (split de `guardar_dato_cliente` campo=whatsapp)
- `guardar_contacto_cobros_cliente` (split de `guardar_dato_cliente` campo=contacto_cobros)

### G. `meta` — Memoria del equipo, instrucciones

**Keywords:** `recuerda mi preferencia`, `de ahora en adelante`, `anota para el equipo`

**Tools (1):**
- `guardar_preferencia_equipo` (renombrar `guardar_memoria_equipo`)

### Total: 27 tools "lógicas" después del split, pero el modelo nunca ve más de **5-7 simultáneas** en un turno.

---

## 4. Renombrado y división — tabla completa

| Original | Nuevo | Justificación |
|---|---|---|
| `obtener_perfil_riesgo_cliente` | `consultar_perfil_riesgo_cliente` | Coherencia: lecturas empiezan con `consultar_` |
| `obtener_contactos_cliente` | `consultar_contactos_cliente` | Idem |
| `historial_conversaciones_cliente` | `consultar_historial_conversaciones` | Idem |
| `proponer_correo_cliente` | `proponer_correo_cobranza_cliente` | Aclarar el dominio (cobranza, no cualquier correo) |
| `proponer_whatsapp_cliente` | `proponer_whatsapp_cobranza_cliente` | Idem |
| `crear_tarea` | `crear_tarea_recordatorio` | Explícito |
| `listar_tareas` | `listar_tareas_pendientes` | Aclarar default |
| `marcar_tarea_hecha` | `marcar_tarea_completada` | Lenguaje formal consistente |
| `estado_cobros_hoy` | `resumen_estado_cobros_hoy` | Verbo claro |
| `listar_pendientes_aprobacion` | `listar_mensajes_pendientes_aprobacion` | Sustantivo claro |
| `listar_promesas_vencidas` | `listar_promesas_pago_incumplidas` | Claridad terminológica |
| `analizar_riesgo_cartera` | `resumen_riesgo_cartera` | Es resumen, no análisis dinámico |
| `listar_clientes_sin_datos` | `listar_clientes_con_datos_faltantes` | Eufemismo más exacto |
| `estado_cadencias` | `resumen_cadencias_automaticas` | Idem |
| `estado_conciliacion` | `resumen_conciliacion_bancaria` | Idem |
| `consultar_memoria_cliente` | `consultar_notas_cliente` | "Notas" más natural que "memoria" |
| `guardar_memoria_cliente` (multi-campo) | Dividir en `guardar_patron_pago_cliente`, `guardar_canal_efectivo_cliente`, `guardar_nota_libre_cliente`, etc. | Intención explícita por tool |
| `guardar_dato_cliente` (multi-campo) | Dividir en `guardar_email_cliente`, `guardar_whatsapp_cliente`, `guardar_contacto_cobros_cliente` | Intención explícita |
| `guardar_memoria_equipo` | `guardar_preferencia_equipo` | Más específico |
| `listar_plantillas` | `listar_plantillas_email` | Aclarar tipo |
| `consultar_saldo_cliente` | (sin cambio) | Ya es explícito |
| `buscar_cliente` | (sin cambio) | Ya es explícito |

---

## 5. Estilo de descripciones

**Antes (corto, abstracto):**
```
proponer_correo_cliente: "Genera un draft de correo de cobranza para un cliente y lo deja en cola PENDIENTE de aprobación."
```

**Después (verbose, orientado a USO):**
```
proponer_correo_cobranza_cliente:
  Cuándo usar: cuando el usuario diga "propón un correo a X", "redacta email para X",
    "envíale a X", "mándale a X" — siempre mensaje a un cliente específico para cobrar.
  Qué hace: genera un draft basado en el aging del cliente, su perfil de riesgo, y
    la plantilla más adecuada por segmento. NO envía el correo — lo deja en cola
    PENDIENTE para aprobación humana.
  Devuelve: { gestion_id, cliente, saldo_neto, asunto, preview, destinatario_email }
    O un error con motivo: SIN_FACTURAS_VENCIDAS, CLIENTE_PAUSADO, etc.
  Pre-condiciones: antes de llamarla, usar consultar_contactos_cliente_detalle para
    saber qué email destino usar.
  NO usar si: el usuario solo está consultando el saldo o pidiendo información —
    eso es consultar_saldo_cliente, no esta tool.
```

Cada tool con la misma estructura: **Cuándo usar / Qué hace / Devuelve / Pre-condiciones / NO usar si**. Esto absorbe el routing del prompt — la decisión la toma el modelo leyendo descripciones, no leyendo reglas separadas.

---

## 6. Router — opciones (actualizado 2026-05-20)

Implementación: función `routeIntent(texto: string, sesionActiva: SesionChat | null): { contexto, entidades }`.

### 6.1. Tres estrategias posibles

| Estrategia | Latencia | Determinismo | Esfuerzo setup | Recomendado para Cobros |
|---|---|---|---|---|
| **Embeddings + cosine similarity** (`nomic-embed-text`) | ~30-50 ms | Alto | Medio (requiere 10-20 queries-ejemplo por contexto) | **Sí — opción primaria** |
| LLM pequeño (qwen2.5:3b o qwen-fast) | ~150-300 ms | Medio | Bajo (solo system prompt) | Alternativa si embeddings no escala |
| Reglas/regex puras | <1 ms | Total | Alto (mantener reglas en sync) | First-pass + fallback a embeddings |

**Decisión post-research:** **embeddings + cosine** como router primario. `nomic-embed-text` ya está en stack, sub-50ms, cero alucinación. Las reglas/regex se pueden usar como aceleración para queries triviales obvias (ej. detección de código de cliente).

### 6.2. Estrategia inicial detallada (embeddings)

```typescript
type Contexto = 'consulta_cliente' | 'gestion_cobranza' | 'tareas' | 'vista_general'
              | 'memoria' | 'datos_contacto' | 'meta' | 'ambiguo';

const REGLAS: Array<{ patrones: RegExp[]; contexto: Contexto; prioridad: number }> = [
  // gestion_cobranza tiene prioridad sobre consulta_cliente
  // porque la palabra "cliente" puede aparecer en ambos
  {
    patrones: [/\b(propón|redacta|env[ií]a|mándale|gestiona)\b.+(correo|email|whatsapp|mensaje)/i],
    contexto: 'gestion_cobranza',
    prioridad: 100,
  },
  {
    patrones: [/\b(saldo|debe|deuda|cu[aá]nto|aging|facturas? de)\b/i],
    contexto: 'consulta_cliente',
    prioridad: 90,
  },
  {
    patrones: [/\b(tarea|recu[eé]rdame|ag[eé]ndame|an[oó]ta(lo)?|llamar a|el (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo) )\b/i],
    contexto: 'tareas',
    prioridad: 90,
  },
  {
    patrones: [/\b(c[oó]mo vamos|estado del d[ií]a|resumen|c[oó]mo (va|est[aá]) la cartera|dashboard|qu[eé] hay (por|pendiente))\b/i],
    contexto: 'vista_general',
    prioridad: 80,
  },
  // ... etc
];
```

**Fallback**: si ningún match supera el threshold de cosine (ej. <0.7), contexto = `consulta_cliente` (el más común) PLUS warning en logs. Después de unos días, esos casos se vuelven nuevos ejemplos.

### 6.3. Pseudocódigo del router con embeddings

```typescript
import { embeddingsClient } from '@/lib/ollama/embeddings';

type Contexto = 'consulta_cliente' | 'gestion_cobranza' | 'tareas' | 'vista_general'
              | 'memoria' | 'datos_contacto' | 'meta' | 'ambiguo';

// Pre-computado al boot: vectores de los ejemplos por contexto
const EJEMPLOS: Record<Contexto, string[]> = {
  consulta_cliente: [
    'cuánto debe Industria Padron',
    'saldo de Acme Corp',
    'aging del cliente 0000274',
    // ... 10-20 ejemplos por contexto
  ],
  gestion_cobranza: [
    'propón un correo a Padron',
    'mándale un whatsapp al 0000274',
    // ...
  ],
  // ...
};

const EMBEDDINGS_CACHE: Record<Contexto, number[][]> = {} as any; // precalcular al boot

export async function routeIntent(texto: string): Promise<{ contexto: Contexto; score: number }> {
  const queryVec = await embeddingsClient.embed(texto);

  let best: { contexto: Contexto; score: number } = { contexto: 'ambiguo', score: 0 };
  for (const [ctx, vectors] of Object.entries(EMBEDDINGS_CACHE)) {
    for (const v of vectors) {
      const sim = cosineSimilarity(queryVec, v);
      if (sim > best.score) best = { contexto: ctx as Contexto, score: sim };
    }
  }

  if (best.score < 0.7) {
    console.warn('[router] low confidence', { texto, best });
    return { contexto: 'consulta_cliente', score: best.score }; // fallback
  }
  return best;
}
```

**Evolución futura**: si embeddings no separa bien queries muy ambiguas (ej. "Padron" sin verbo), añadir un mini-LLM router (qwen2.5:3b) como tiebreaker cuando el delta entre top-1 y top-2 sea pequeño.

---

## 7. Estrategia de modelos (actualizada 2026-05-20)

> **Cambio importante respecto al spec original:** el research técnico identificó **xLAM-2-8b-fc-r** (Salesforce, fine-tune de Llama 3.1 8B sobre 60K samples function calling) como **top-1 entre modelos ≤8B en BFCL v3** (~0.78). Es mejor candidato que Hermes 3 8B para nuestro caso. Plan: A/B test pronto contra Qwen 14B usando el eval-runner existente. Ver §7 del [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md) para protocolo.

| Rol | Candidato 1 | Candidato 2 | Por qué |
|---|---|---|---|
| Router | `nomic-embed-text` + cosine similarity | qwen2.5:3b dedicado | Embeddings: sub-50ms, determinista, cero alucinación. Ya está en stack. |
| Tool calling / agente | **xLAM-2-8b-fc-r** (a evaluar) | Qwen 2.5 14B (actual) | xLAM: top BFCL sub-8B + cabe en 5GB Q4 + ~40% menos latencia |
| Communicator (respuesta natural) | Qwen 2.5 14B Instruct | xLAM si gana eval | Mejor español. Puede coexistir con xLAM como agente. |
| Reasoning complejo (futuro: análisis de cartera) | DeepSeek R1 14B | — | Chain-of-thought visible. **NO usar para tool calling directo** — el `<think>` rompe el parser. |
| Fallback | Anthropic Haiku 4.5 | — | Cascada de fallback nivel 2. **Solo prod**, en dev local validamos con LLMs locales. |

**Criterio de cambio de modelo principal:**
- xLAM ≥95% del score de Qwen 14B con menor latencia → candidato a default.
- 80-95% → Qwen sigue default, xLAM disponible para canary.
- <80% → descartar xLAM.

**Modelos a descargar (en orden de prioridad):**
- `ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:Q4_K_M` (5GB) — para el A/B test
- (opcional) `ollama pull hermes3:8b` (4.7GB) — alternativa si xLAM falla
- (opcional) Qwen 3 14B — para multi-turn mejorado

VRAM total disponible: 12GB compartido con YOLO. Restricción según [feedback_vram_budget](https://example.local) en memoria: Q4_K_M, num_parallel=1, max_loaded_models=1.

---

## 8. Fases de implementación (revisado 2026-05-20)

### 8.1. Resumen por impacto/esfuerzo

| # | Cambio | Impacto | Esfuerzo | Estado |
|---|---|---|---|---|
| **1** | **Fase 1 — Renames + splits + descripciones verbose** | Alto (base para router) | 1 sesión | ✓ Completa (rama `feature/refactor-tools-narrow`, 7 commits) |
| **2** | **Pulir descripciones >200 tokens** de la Fase 1 | Medio | 2-3 horas | Pendiente |
| **3** | **Quick wins Ollama** (parallel_tool_calls + temperature + num_ctx + sin streaming) | Alto | 1 hora | Pendiente |
| **4** | **Defensive parsing** de `<tool_call>` leaked en `content` | Medio | 4 horas | Pendiente |
| **5** | **Fase 2 — Router con `nomic-embed-text` + embeddings** | **Máximo** (resuelve ~70% de síntomas) | 2-3 días | Pendiente |
| **6** | **Fase 3 — Conectar router al agente + filtrar TOOLS** | Alto | 1 día | Pendiente |
| **7** | **Validación + retry + fallback estructurado a Haiku** | Alto | 1-2 días | Pendiente |
| **8** | **A/B test xLAM-2-8b vs Qwen 14B** en eval-runner | Potencial alto | 1-2 días | Pendiente |
| **9** | **Fase 4 — Canary + medición de routing accuracy** | Alto | 1-2 días | Pendiente |
| **10** | **Fase 5 — Rollout progresivo** | Alto | Días-semanas | Pendiente |

**Orden recomendado para próxima sesión:** #3 (quick wins, 1h) → #5 (router) → #6 (conectar) → #7 (fallback) → #8 (eval xLAM en paralelo).

### 8.2. Detalle de fases

#### Fase 1 — Renombrar y dividir tools ✓ COMPLETA

Rama: `feature/refactor-tools-narrow`. 7 commits con sub-fases A-G:
- A: consulta_cliente (5 tools — 3 renames + 2 sin rename, descripciones verbose)
- B: tareas (3 renames)
- C: vista_general (7 renames)
- D: gestion_cobranza (3 renames + 1 split detalle)
- G: meta (1 rename)
- F: datos_contacto (split `guardar_dato_cliente` → 3 tools narrow)
- E: memoria + fix bug §11 (rename + split + columna `updated_at`)

Aliases temporales en switch por 1 release. TypeCheck verde después de cada sub-fase.

**Validación end-to-end:** ver §13.

#### Fase 1.5 — Quick wins Ollama (1 hora, IMPACTO ALTO)

Tres cambios en el cliente TS donde se construye el request a Ollama:

```ts
{
  parallel_tool_calls: false,  // Qwen ≤14B paraleliza "por si acaso"
  temperature: 0.2,            // Reduce alucinación de field names
  stream: false,               // Streaming fragmenta el XML del tool call
  options: {
    num_ctx: 16384,            // Default Ollama es 2048 — con 25 tools NO ALCANZA
    top_p: 0.8,
    top_k: 20,
    repeat_penalty: 1.05,
  },
}
```

Ver §6 del [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md) para tabla completa de parámetros.

#### Fase 2 — Router con embeddings (2-3 días)

`lib/telegram/router.ts` con `routeIntent(texto)` que usa `nomic-embed-text` + cosine similarity (ver §6.3).

Pre-requisito: armar el seed set de queries-ejemplo por contexto (10-20 ejemplos × 7 contextos = 70-140 frases). Usar el export del historial (`cobranza_telegram_historial`) categorizando manualmente.

Tests unitarios contra ese seed. NO se conecta al agente todavía.

#### Fase 3 — Conectar router al agente (1 día)

En `agent.ts`, después de cargar historial:
1. Llamar `routeIntent(texto)`.
2. Filtrar `TOOLS` global según el contexto resuelto (mapping `Contexto → string[]` con los nombres de tools por contexto).
3. Pasar al LLM solo el subset (≤7 tools).
4. Log: `[router] contexto=X score=Y tools=[a,b,c]`.

#### Fase 3.5 — Validación + retry + fallback (1-2 días)

Cascada de 3 niveles (ver §15):

1. **Local:** Qwen + tools narrow → si tool call no valida (Zod) → 1 retry con feedback estructurado.
2. **Escalación:** Haiku con el mismo contexto.
3. **Abort:** "no pude procesar, pasame más contexto".

#### Fase 4 — Canary + medición (1-2 días)

`CANARY_CHAT_IDS` en Dokploy con Ricardo + 1-2 chats de prueba. Banco de 30-60 queries reales. Métricas:
- % routing correcto (vs categorización manual).
- % tool correcto en T1.
- # turnos hasta resolver.
- Latencia p50/p95.
- Errores de tool execution.

**Criterio de éxito:** Qwen 14B + router + tools narrow → ≥85% del nivel de Haiku con 22 tools.

#### Fase 4.5 — A/B test xLAM-2-8b vs Qwen 14B (1-2 días, en paralelo a Fase 4)

Ver §7 del [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md) para protocolo completo.

#### Fase 5 — Rollout progresivo (días-semanas)

- Si canary va bien por 1 semana, extender a grupo.
- Mantener Haiku como fallback explícito (LLM_PROVIDER=anthropic en .env).
- Documentar el cambio para el equipo.

---

## 9. Testing

### Banco de queries
Reusar el TSV exportado de `cobranza_telegram_historial` (62 queries reales). Categorizar manualmente cada una con su contexto esperado. Luego correr el eval-runner ajustado para medir:

- % routing correcto (contexto del router == contexto esperado)
- % tool correcto en T1 (LLM elige bien dentro del contexto)
- # turnos hasta resolver
- Latencia
- Errores de tools (idealmente 0 después del fix de `ultima_actualizacion`)

### Comparación
Mismo banco contra:
- Haiku con tools narrow + router (referencia top)
- Qwen 14B con tools narrow + router (objetivo soberanía)
- Hermes 8B con tools narrow + router (alternativa si Qwen falla)

Cualquier modelo local que llegue a **≥90% del nivel de Haiku** se considera viable.

---

## 10. Rollback

En cualquier momento del rollout:
- **Quitar canary**: borrar `CANARY_CHAT_IDS` en Dokploy → 0% tráfico al canary
- **Volver al agente legacy**: si la nueva arquitectura tiene un bug grave, `git revert` del commit que conecta el router + redeploy. Producción vuelve a Haiku con 22 tools, comportamiento de hoy.
- **Fase 1 (renombrados)**: rollback más complejo porque toca tools.ts. Mantener aliases por 1 release mitiga esto.

---

## 11. Cosas adyacentes que toca arreglar

Detectadas durante la migración:

- ✓ **Bug `ultima_actualizacion` ARREGLADO** (sub-fase E del refactor, commit `136ee94`). La columna real es `updated_at` (migración `015_memoria_cliente.sql`). El SELECT en `consultarMemoriaCliente` fue corregido.
- **Logs verbose temporales**: en `agent.ts` tenemos `console.error('[agent][...]')` con args y resultados. Útil durante el rollout, remover una vez estabilice. **Pendiente.**
- **Idioma drift en Qwen**: parcheado con `RESPONDE SIEMPRE EN ESPAÑOL`, pero en validación de 2026-05-20 (TEST 1) Qwen respondió en inglés. Conviene aplicar técnica primacy+recency descrita en §5.1 del [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md). **Mejora pendiente.**
- **Descripciones verbose >200 tokens**: el research recomienda 50-150 tokens por descripción. Las sub-fases A-G generaron algunas descripciones que pasan ese límite. **Auditar y comprimir las largas (2-3 horas).**

---

## 12. Decisiones tomadas

Sesión 2026-05-20:

1. ✓ **Aliases por 1 release** (no break clean) — todos los renames mantienen el nombre viejo en el switch como fall-through case.
2. ✓ **Empezamos por consulta_cliente** (sub-fase A).
3. ✓ **Qwen primero** — Hermes 3 8B no descargado todavía. El research sugiere **xLAM-2-8b-fc-r** como mejor candidato si Qwen sigue fallando post-router.
4. ✓ **Router con embeddings** (cambio respecto al spec original que decía "regex primero"). `nomic-embed-text` ya está en stack.

## 13. Hallazgos de la validación end-to-end (sesión 2026-05-20)

Tras completar las 7 sub-fases (A-G) de Fase 1, se hicieron smoke tests contra Qwen 2.5 14B local.

### TEST 1 — vista_general (estado del día) ✓

Mensaje: `"¿Cómo va el día hoy? Dame el resumen del estado de cobros."`
Qwen llamó: `resumen_cadencias_automaticas` + `resumen_conciliacion_bancaria` (nombres nuevos), ambas ejecutaron con datos reales.
**Pendiente:** no llamó `resumen_estado_cobros_hoy` que sería la más obvia para la query. Es un caso de descripción no suficientemente atractiva para el modelo.
**Side note:** Qwen respondió en INGLÉS (drift de idioma observado).

### TEST 2 — tareas (crear) ❌ MAL ROUTING

Mensaje: `"Recuérdame llamar a Industria Padron el viernes a las 10am."`
Qwen llamó: `guardar_preferencia_equipo` (contexto meta) en vez de `crear_tarea_recordatorio` (contexto tareas).
**Resultado:** la tarea NO se creó. La entrada quedó como preferencia errónea (limpiada del DB).
**Causa:** ambas tools mencionan "recuérdame" en su `Cuándo usar`. Qwen con 25 tools simultáneas no separa "preferencia abstracta" de "tarea con fecha".

### Diagnóstico

**No es un bug del refactor.** Es el problema arquitectónico subyacente que motiva toda la Fase 2 (router). El §3 del [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md) lo confirma:
- LongFuncEval mide 30-50% degradación de accuracy con 20-25 tools en modelos 8B clase.
- BFCL v3 recomienda <10 tools simultáneas para ≤14B.
- Qwen 2.5 14B Q4 tiene umbral práctico de 8-10 tools.

**El refactor está mecánicamente bien:**
- Tools nuevas se invocan por nombre nuevo (no `obtener_*`).
- Handlers ejecutan correctamente.
- Aliases del switch funcionan para historial in-flight.

**Lo que cierra el caso:** Fase 2 (router) que filtra contextos antes de pasar tools al LLM. Después de eso, Qwen solo verá 3-5 tools del contexto correcto y el TEST 2 debería pasar.

## 14. Configuración Ollama recomendada

Resumen ejecutivo. Detalle completo en §6 del [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md).

```ts
const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
  method: 'POST',
  body: JSON.stringify({
    model: 'qwen2.5:14b-instruct-q4_K_M',
    messages,
    tools: filteredToolsForContext, // ← post-router, no las 25
    parallel_tool_calls: false,
    temperature: 0.2,
    top_p: 0.8,
    stream: false,
    options: {
      num_ctx: 16384,
      num_predict: 1024,
      top_k: 20,
      repeat_penalty: 1.05,
    },
  }),
});
```

**Razones (resumen):**
- `parallel_tool_calls: false` — Qwen ≤14B paraleliza "por si acaso".
- `temperature: 0.2` (vs 0.7 default) — reduce alucinación de field names.
- `num_ctx: 16384` (vs 2048 default Ollama) — con 25 tools NO ALCANZA el default.
- `stream: false` — streaming fragmenta el `<tool_call>` XML.

**Limitaciones Ollama conocidas:**
- `tool_choice` no soportado. Workaround: pasar solo la tool deseada en `tools: []`.
- `logit_bias` no soportado (anclar idioma a nivel logits no es viable).

## 15. Cascada de fallback (3 niveles)

```
[Nivel 1 — Local]
  Qwen 2.5 14B con tools narrow del contexto (post-router)
    │
    │ Tool call no valida contra schema Zod?
    ▼
  1 retry con feedback estructurado al LLM:
    "El campo X esperaba formato Y, recibió Z. Reintentá."
    │
    │ Falla el retry?
    ▼
[Nivel 2 — Escalación]
  Anthropic Haiku 4.5 con el mismo contexto
    (LLM_PROVIDER=anthropic temporal, solo prod, no dev local)
    │
    │ Falla Haiku?
    ▼
[Nivel 3 — Abort]
  Devolver al usuario: "no pude procesar tu solicitud, pasame más contexto"
  NUNCA inventar la respuesta.
```

**Anti-patrón:** retry infinito en Nivel 1. Modelos ≤14B colapsan en loops — siguen produciendo el mismo error. Máximo 1 retry, luego escalar.

**En dev local:** Nivel 2 NO aplica (decisión [feedback_dev_solo_llms_locales](https://example.local) — dev solo con LLMs locales). Si Nivel 1 falla en dev, ir directo a Nivel 3 con log explícito.

## 16. Histórico de cambios al doc

- 2026-05-19: versión inicial. Spec del refactor router + tools narrow.
- 2026-05-20: actualización con findings del research técnico. Cambios principales:
  - §6 actualizado: router con embeddings como opción primaria (vs regex original).
  - §7 actualizado: xLAM-2-8b-fc-r introducido como mejor candidato sub-8B.
  - §8 reescrito: nueva tabla de fases por impacto/esfuerzo. Fase 1 marcada como completa.
  - §11 actualizado: bug `ultima_actualizacion` marcado arreglado.
  - §13 nuevo: hallazgos de validación end-to-end.
  - §14 nuevo: configuración Ollama recomendada.
  - §15 nuevo: cascada de fallback de 3 niveles.
  - Referencias cruzadas a [LLM_BEST_PRACTICES.md](LLM_BEST_PRACTICES.md) (nueva referencia técnica).
