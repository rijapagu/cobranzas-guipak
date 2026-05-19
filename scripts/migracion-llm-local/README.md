# Migración LLM local — Agente Cobros

> **Objetivo:** Migrar Cobros de Claude (Haiku 4.5 + Sonnet 4) a LLMs locales (Qwen2.5 7B/14B en Robocop) por soberanía de datos.
> **Estado:** Fase A — Evaluación lado-a-lado, sin tocar producción.
> **Iniciado:** 2026-05-19.

## Topología decidida

```
Telegram → VPS srv869155 (Next.js + BullMQ + Redis) ──cloudflared──▶ Robocop (Ollama 11434)
                                                                      ├─ qwen2.5:7b  (diurno, con YOLO)
                                                                      └─ qwen2.5:14b (nocturno / sin YOLO)
```

## Fases

| Fase | Status | Descripción |
|---|---|---|
| A.1 | 🟡 En curso | Export queries reales de cobranza_telegram_historial |
| A.2 | ⏳ | Adapter lib/llm/ (anthropic + ollama) |
| A.3 | ⏳ | Script de evaluación 3-way (Haiku / Qwen 7B / Qwen 14B) |
| A.4 | ⏳ | Decisión go/no-go con números reales |
| B.1 | ⏳ | Cloudflare Tunnel Robocop → VPS |
| B.2 | ⏳ | Feature flag LLM_PROVIDER + canary |
| B.3 | ⏳ | Switch progresivo Haiku → Qwen |

## Criterios mínimos para pasar a Fase B (sujeto a revisión)

- Tool correcto en primer turno: **≥ 85%**
- JSON válido en `lib/claude/client.ts` (cobranza msgs): **≥ 95%**
- Latencia p95 end-to-end: **< 15 s**
- Cero alucinaciones de datos en spot-check de 10 conversaciones largas

## Archivos en esta carpeta

- `01_export_queries.sql` — el SQL puro (documentación / si tienes cliente mysql)
- `01_export_queries.mjs` — **úsalo desde el contenedor app** (sin cliente mysql): `node 01_export_queries.mjs > /tmp/queries_export.tsv`
- (próximos) `02_anonimizar.mjs`, `03_eval_runner.mjs`, etc.

## Cómo correr el export desde el VPS

El contenedor `cobranzas-guipak` no tiene cliente `mysql` (es Alpine slim). Usar el script Node que reusa `mysql2` ya instalado:

```bash
# 1. Entrar al contenedor app (no al redis ni worker)
docker ps | grep cobranzas-guipak
docker exec -it <container_id> sh

# 2. Dentro del contenedor — ya tiene las env vars DB_COBRANZAS_*
cd /app   # o donde esté el código (depende de cómo Dokploy lo monte)
node scripts/migracion-llm-local/01_export_queries.mjs > /tmp/queries_export.tsv
exit

# 3. En el host del VPS, copiar el archivo fuera
docker cp <container_id>:/tmp/queries_export.tsv ./queries_export.tsv

# 4. Pasarlo a Robocop (desde el VPS o desde Robocop con scp)
scp queries_export.tsv ricardo@robocop:D:/IA/cobranzas-guipak/scripts/migracion-llm-local/
```
