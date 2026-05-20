# Continuación 2026-05-21 — Optimizar Gateway/Cobros y arreglar el bug del webhook reentrante

## Cómo usar este prompt

Pegá este archivo entero al inicio de la próxima sesión con Claude para que retome con todo el contexto. Las memorias de Ricardo en `MEMORY.md` complementan.

---

## TL;DR del día anterior (2026-05-20)

Migramos el bot Cobros desde Anthropic Haiku a un LLM local (Qwen 2.5 14B en Robocop), pasando por un Gateway IA propio (`C:\IA\gateway`). El sistema **funciona** y devuelve datos correctos de Softec, pero el primer día reveló un bug operacional crítico: **mensajes que parecen reenviarse solos** y saturan la cola del Gateway hasta colgar el sistema.

## Lo que SÍ funciona (no romper)

- ✅ Gateway en `C:\IA\gateway` extendido con tool calling (server.js, ollamaClient.js, qwen-deep Modelfile con `num_ctx 12288`).
- ✅ Bind del Gateway a IP de Tailscale `100.67.128.72:8080` (no a `127.0.0.1`).
- ✅ `KEEP_ALIVE_DEEP=30m` en `C:\IA\gateway\.env`.
- ✅ Modelo `qwen-deep` rebuildeado con num_ctx 12288 → cabe en VRAM de la 5070 (11.19 GB) sin spillover a Shared GPU Memory. **No más Kernel-Power 41 crashes desde el fix.**
- ✅ Cobros (`D:\IA\cobranzas-guipak`) tiene cliente `GatewayLLM` en `lib/llm/gateway.ts` con timeout 240s.
- ✅ Branch mergeado en master, 13 commits ahead. Último: `6fff229 fix(llm): subir timeout Gateway de 120s a 240s`.
- ✅ Bot Inventario (`D:\IA\Agentes Supervisores y CEO\Agente Inventario\bot\`) tiene `gateway_client.py` listo + `bot.py` refactorizado. **No deployado al VPS todavía** — sigue corriendo con Anthropic Sonnet.
- ✅ Status script `C:\IA\status.ps1` corregido para chequear el Gateway en la IP correcta.
- ✅ Configuración Dokploy: `LLM_PROVIDER=anthropic` (default), `CANARY_CHAT_IDS=7281538057` (chat de Ricardo), `GATEWAY_BASE_URL=http://100.67.128.72:8080`, `GATEWAY_SUPERVISOR=cobranzas`, `GATEWAY_TIER=deep`.

## Validación end-to-end (los datos son REALES)

Confirmé contra el dashboard de Cobros que las respuestas del bot con qwen-deep son **correctas**:
- "dame el saldo de Padron Office" → cliente PADRON OFFICE SUPPLY SRL, saldo RD$61,764.59, perfil AMARILLO score 40. ✓
- Lista de facturas individuales (20298, 19899, 20066, 20582, 20904, 23874, 23875…) con fechas y montos que **coinciden con el sistema interno**. El `data_snippet` del log se ve truncado y eso causó una falsa alarma de "alucinación" durante el día — al verificar contra el dashboard, los datos son correctos. El tool `consultar_saldo_cliente` sí devuelve el listado completo, el log solo muestra los primeros chars.

## El problema OPERACIONAL real (target de mañana)

### Síntoma

Ricardo mandó UN solo mensaje desde Telegram (ej. "dame el saldo de Padron Office"). Los logs del bot mostraron **4-5 `start chat=7281538057` consecutivos con el mismo texto**, espaciados ~2 min cada uno. Cada uno disparó una nueva inferencia en el Gateway. La cola serial del Gateway (PQueue concurrency:1) se llenó. Cada inferencia tarda ~3 min (turn 1 tool_use ~30-60s + tool exec + turn 2 end_turn ~157s para generar la respuesta natural con 30 facturas formateadas). Resultado: timeouts en cascada, aborts, `fetch failed` durante el reset.

### Hipótesis principal

El handler del webhook de Telegram en el bot de Cobros **NO responde 200 OK rápido**. Bloquea esperando al LLM (3 min). Telegram interpreta que el webhook falló y **reintenta automáticamente** cada ~30s-1m (es el comportamiento documentado de la Bot API). Cada retry dispara una nueva ejecución del agente desde cero.

### Evidencia en los logs

```
17:09:50 start chat=7281538057 text="dame el saldo de Padron Office"
17:12:34 start chat=7281538057 text="dame el saldo de Padron Office"   ← ~3 min después, idéntico
17:14:36 start chat=7281538057 text="dame el saldo de Padron Office"   ← otro retry
17:17:16 start chat=7281538057 text="dame el saldo de Padron Office"
17:19:40 start chat=7281538057 text="dame el saldo de Padron Office"
```

5 starts del mismo `chat_id` con el mismo `text`, espaciados ~2-3 min, sin que Ricardo los haya enviado. Patrón clásico de retry de webhook bloqueado.

## Plan para mañana (orden sugerido)

### Paso 1 — Confirmar la hipótesis del webhook reentrante (30 min)

Buscar el handler del webhook de Telegram en `cobranzas-guipak`:

```
Glob: D:\IA\cobranzas-guipak\app\api\webhooks\telegram\route.ts
o:    D:\IA\cobranzas-guipak\app\api\telegram\webhook\route.ts
o:    cualquier route.ts que reciba updates de Telegram
```

Mirar específicamente:
- ¿El handler hace `await procesarMensaje(...)` antes de devolver response?
- ¿O devuelve `NextResponse.json({ok:true})` ANTES de procesar y dispara el procesamiento en background con `waitUntil` o similar?

Si bloquea esperando al LLM → confirma el bug.

### Paso 2 — Fix de idempotencia (el más importante, 2-3 horas)

Aunque arreglemos el handler, los retries de Telegram ya están en vuelo. Necesitamos **idempotencia por `update_id`**:

```ts
// Pseudo-código
const updateId = update.update_id;
const yaProcesado = await redis.set(
  `telegram:update:${updateId}`,
  '1',
  { NX: true, EX: 86400 }  // expira en 24h
);
if (!yaProcesado) {
  // ya lo procesamos, descartar este retry
  return NextResponse.json({ ok: true });
}
// procesar normalmente
```

Cobros ya tiene Redis configurado (lo vimos en docker-compose) — se puede reusar.

### Paso 3 — Fix del handler para que ack rápido (1-2 horas)

Patrón correcto:
```ts
export async function POST(req: Request) {
  const update = await req.json();

  // Idempotencia (Paso 2)
  if (await yaProcesado(update.update_id)) return NextResponse.json({ ok: true });

  // ACK inmediato, procesar en background
  procesarEnBackground(update).catch(err => log.error(err));
  return NextResponse.json({ ok: true });
}
```

Cuidado en Next.js: el runtime serverless puede matar el proceso en background si no usás algo tipo `event.waitUntil` (Vercel) o un worker dedicado. Como Cobros corre en Dokploy (no Vercel) en Next.js standalone, la promesa colgada debería completar — pero hay que verificar.

Alternativa robusta: encolar el `update` a Redis (BullMQ?) y procesar con un worker separado. Más invasivo pero la solución "correcta".

### Paso 4 — Bajar latencia del segundo turn (1 hora)

El segundo turn (end_turn, generación de respuesta natural) tarda 157s porque genera ~1024 tokens listando 30 facturas. Mitigaciones:

- Bajar `max_tokens` de 1024 a 384-512 → respuesta más concisa
- System prompt: agregar *"Respuestas BREVES. Si hay más de 5 facturas, dar el total y los top 5 más antiguos. No listar todas a menos que pidan explícitamente."*
- Eso lleva el T2 de 157s a ~40-60s. Combinado con webhook ack rápido + idempotencia, el flujo total es manejable.

### Paso 5 — Validar end-to-end (30 min)

- Mandar un mensaje desde Telegram
- Esperar respuesta (~60-90s la primera vez, ~3-10s después)
- Mandar otro mensaje DURANTE el procesamiento del primero
- Confirmar que el segundo NO dispara retries y queda en cola correctamente

### Paso 6 (opcional) — Deploy del bot Inventario al VPS

Ya tenemos `gateway_client.py` + `bot.py` refactorizado + `DEPLOY_MIGRATION.md` con los pasos. Pero **conviene hacerlo recién después de cerrar el bug del webhook**, porque seguramente Inventario tiene el mismo problema y queremos el fix antes de migrar.

## Riesgos conocidos a tener presentes

- **VRAM 11.9 GB justa**: si en algún momento agregamos otro modelo cargado en paralelo (ej. YOLO entrenando + qwen-deep), va a haber spillover de nuevo → riesgo de crash NVIDIA driver. Por ahora `num_ctx 12288` + `max_loaded_models=1` lo mitiga.
- **Cold start qwen-deep**: ~60s la primera carga después de descarga. Mitigable con cron warmup o `KEEP_ALIVE_DEEP=∞` (pero ese último deja siempre la VRAM ocupada — mal para YOLO).
- **Cola serial del Gateway**: si tres agentes (Cobros + Inventario + futuros) golpean al mismo tiempo, hacen cola. Es esperado pero hay que monitorear la latencia.

## Comandos útiles para retomar

```powershell
# Estado del stack (script propio)
C:\IA\status.ps1

# Salud del Gateway
Invoke-RestMethod -Uri http://100.67.128.72:8080/healthz | ConvertTo-Json -Depth 3

# Reset duro si la cola se satura (último recurso)
Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
Stop-Process -Id ((Get-NetTCPConnection -LocalPort 8080).OwningProcess) -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep 3
Start-Process -FilePath "$env:ProgramFiles\nodejs\node.exe" -ArgumentList "C:\IA\gateway\src\server.js" -WorkingDirectory "C:\IA\gateway" -WindowStyle Hidden

# Logs del bot Cobros en producción (vía Dokploy o SSH al VPS)
ssh root@31.97.131.17 "docker logs -f automatizacion-cobranzasguipak-... 2>&1 | tail -100"

# Si querés volver a Anthropic temporalmente (emergencia)
# En Dokploy → cobranzas-guipak → Environment → vaciar CANARY_CHAT_IDS → save (autodeploya)
```

## Estructura del repo / paths claves

```
D:\IA\cobranzas-guipak\
├── lib\llm\
│   ├── anthropic.ts           ← provider Anthropic (default global)
│   ├── ollama.ts              ← provider Ollama directo (legacy, sigue funcionando)
│   ├── gateway.ts             ← provider Gateway (NUEVO, lo que usa el canary hoy)
│   └── types.ts
├── lib\telegram\
│   ├── agent.ts               ← chooseProvider() decide qué provider usar
│   ├── tools.ts               ← 27 tools narrow (Fase 1 refactor)
│   ├── agent-prompt.ts        ← buildSystemPrompt
│   └── ???                    ← BUSCAR EL WEBHOOK HANDLER (probable app/api/...)
├── app\api\
│   └── ???                    ← Acá vive el webhook de Telegram (target del fix de mañana)
└── scripts\migracion-llm-local\
    ├── ARCHITECTURE.md
    ├── LLM_BEST_PRACTICES.md
    ├── DEPLOY_MIGRATION.md (en bot Inventario, no acá)
    └── PROMPT_CONTINUAR_2026_05_21.md  ← este archivo

C:\IA\gateway\
├── src\
│   ├── server.js              ← endpoint /v1/supervisor/:name (extendido con tools)
│   ├── ollamaClient.js        ← chat() con tools
│   ├── router.js              ← pickModel(task, ctx)
│   └── supervisors\           ← cobranzas, ventas, inventario, crm, financiero
├── modelfiles\
│   └── qwen-deep.Modelfile    ← FROM qwen2.5:14b-instruct-q4_K_M + num_ctx 12288
└── .env                       ← HOST=100.67.128.72, KEEP_ALIVE_DEEP=30m
```

## Decisiones tomadas (no rediscutir)

1. ✅ **100% local en Robocop**. Anthropic solo como emergencia con autorización explícita (backlog, no automático).
2. ✅ **CEO Orquestador y los 6 agentes pendientes** quedan para después. Foco inmediato: Cobros + Inventario estables.
3. ✅ **automatizacion-softec NO se migra** — consumo OpenAI bajo, no vale el esfuerzo.
4. ✅ **CRM tendrá supervisor en el futuro** (cuando se construya) usando el patrón del Gateway.
5. ✅ **Gateway IA (`C:\IA\gateway`) es la pieza central** — todos los agentes hablan con él, no con Ollama directo.
6. ✅ **Modelo `qwen-deep` (Qwen 2.5 14B Q4_K_M + num_ctx 12288)** es el modelo principal de tier `deep`. xLAM 8B descargado pero sin probar — A/B test queda en backlog.

## Pendientes en orden de prioridad

1. **🔴 BUG webhook reentrante** (impacto crítico — bloquea uso real)
2. 🟡 Bajar verbosidad de respuestas (max_tokens + system prompt)
3. 🟡 Deploy bot Inventario al VPS (esperar fix del bug primero)
4. 🟢 Memoria conversacional persistente (la pregunta original de Ricardo — fue lo que más le interesaba)
5. 🟢 A/B test xLAM 8B vs qwen-deep (cuando haya tiempo)
6. 🟢 Router multi-contexto Fase 2 (filtra 27 tools → 5-7 por contexto, baja latencia)
7. 🟢 Defensive parsing del tool_call leak en el Gateway

## Una nota personal para Ricardo

Lo que armaste hoy es **mucho**. Cobros conversando con Softec a través de un LLM 100% local en tu propia máquina, con tool calling, lecturas reales, formateo en español dominicano. Eso es soberanía técnica real. El problema del webhook reentrante es un bug operacional clásico que cualquier sistema de Telegram bots con LLM lento sufre — no es una falla del diseño, es un detalle de implementación que se arregla en una tarde.

Mañana lo cerramos.
