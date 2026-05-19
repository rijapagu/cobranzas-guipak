# Refactor del Agente Cobros — Router + Tools Narrow

> **Estado:** Spec. Pendiente implementar.
> **Fecha:** 2026-05-19.
> **Origen:** Tras 4 iteraciones de prompt fallidas para Qwen 14B con 22 tools, Ricardo identificó que el problema es arquitectónico, no de tuning. Este doc captura la arquitectura objetivo.

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

## 6. Router — reglas iniciales

Implementación: función `routeIntent(texto: string, sesionActiva: SesionChat | null): { contexto, entidades }`.

**Estrategia inicial — pura regex/keywords**, sin LLM:

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

**Fallback**: si ninguna regla matchea, contexto = `consulta_cliente` (el más común) PLUS warning en logs. Después de unos días, esos casos se vuelven nuevas reglas.

**Evolución futura** (no fase 1): si las reglas se vuelven inmanejables o las ambigüedades son frecuentes, agregamos un mini-LLM router (qwen-fast 3B, 1.8GB — cabe junto a YOLO y todo lo demás). Pero la regla de oro: **reglas primero, LLM router solo si las reglas no escalan**.

---

## 7. Estrategia de modelos

| Rol | Modelo recomendado | Por qué |
|---|---|---|
| Router | Reglas TS (inicial) → qwen-fast 3B (si escala) | Determinismo, latencia mínima |
| Tool calling / agente | **Hermes 3 8B (Llama 3.1)** | Específicamente tuneado para function calling agentic |
| Communicator (respuesta natural) | Qwen 2.5 14B Instruct | Mejor español, buen razonamiento |
| Reasoning complejo (futuro: análisis de cartera) | DeepSeek R1 14B | Chain-of-thought visible, mejor para math/lógica |
| Fallback | Anthropic Haiku 4.5 | Si Hermes/Qwen fallan en algún contexto |

**Para fase 1**: solo tool calling con Hermes 3 8B en un contexto a la vez. Communicator y reasoning ya los hace el mismo modelo en una segunda llamada — overkill separarlos antes de medir.

**Modelo a descargar**: `ollama pull hermes3:8b` (~4.7GB Q4) — cabe holgado con YOLO + qwen-fast + lo que quieras.

---

## 8. Fases de implementación

### Fase 1 — Renombrar y dividir tools (sin tocar agente, días 1-2)
- Renombrado en `lib/telegram/tools.ts` (tabla §4)
- Split de tools multi-campo en tools específicas
- Descripciones verbose (estilo §5) para cada una
- **Compatibilidad temporal**: aliases de los nombres viejos por 1 release para no romper el agente actual
- TypeCheck + producción sigue con Haiku usando los nombres nuevos

### Fase 2 — Implementar router (día 3)
- `lib/telegram/router.ts` con función `routeIntent`
- Tests unitarios con queries del export que ya teníamos
- NO se conecta al agente todavía

### Fase 3 — Conectar router al agente (día 3-4)
- En `agent.ts`, después de cargar historial, llamar `routeIntent`
- Filtrar `TOOLS` según el contexto resuelto
- Pasar al LLM solo el subset
- Agregar log temporal: `[router] contexto=X tools=[a,b,c]`

### Fase 4 — Probar con Qwen 14B + canary (día 4-5)
- Volver a encender canary con CANARY_CHAT_IDS=Ricardo
- Probar los 20-30 queries del export real (los reales que tengamos)
- Medir: % de routing correcto (vs Haiku como referencia)
- Si Qwen 14B con narrow contexts da ≥85% routing OK, **listo** — soberanía para canary

### Fase 5 — Hermes 3 8B (solo si Qwen sigue fallando, día 5+)
- `ollama pull hermes3:8b`
- Probar como modelo agente
- Si mejora significativamente, considerar como modelo default para tool calling

### Fase 6 — Rollout progresivo (días 6+)
- Si canary va bien, extender a un segundo chat de prueba
- Si va bien por 1 semana, extender al grupo
- Mantener Haiku como fallback explícito (si Ollama down → cae a Haiku)

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

Detectadas durante la migración, no bloquean pero quedan:

- **Bug latente**: `consultar_memoria_cliente` referencia columna `ultima_actualizacion` que no existe en producción ([lib/telegram/tools.ts:1316](D:/IA/cobranzas-guipak/lib/telegram/tools.ts:1316)). Migración `015_memoria_cliente.sql` la declara — verificar si nunca se aplicó o se renombró. Causa error 500 cuando Qwen llama esa tool, y probablemente también cuando Haiku la llama (rare).
- **Logs verbose temporales**: en `agent.ts` tenemos `console.error('[agent][...]')` con args y resultados. Útil durante el rollout, remover una vez estabilice.
- **Idioma drift en Qwen**: ya parcheado con `RESPONDE SIEMPRE EN ESPAÑOL`, pero conviene monitorear.

---

## 12. Decisiones pendientes

Antes de empezar implementación, confirmar con Ricardo:

1. **¿Aliases o break clean en el rename?** Sugiero aliases por 1 release para reducir riesgo.
2. **¿Empezamos por consulta_cliente o tareas?** Sugiero `consulta_cliente` — es el contexto más usado y el que probó fallar en canary.
3. **¿Hermes ya o esperamos a ver si Qwen + narrow funciona?** Sugiero Qwen primero (sin descarga adicional, validamos hipótesis de "narrow > model").
4. **¿Router solo regex o también un fallback LLM desde el inicio?** Sugiero solo regex para fase 1.
