# Setup de desarrollo LOCAL en Robocop

> Stack local aislado de producción para iterar en el refactor router + tools narrow.
> NO toca el VPS de Hostinger. NO usa credenciales productivas.
> NO requiere Telegram (probamos vía web chat en localhost).

## Topología

```
┌──────────────────── Robocop (este PC) ─────────────────────┐
│                                                              │
│  ┌────────────────┐    ┌──────────┐    ┌─────────────────┐  │
│  │  npm run dev   │    │  MySQL   │    │  Redis          │  │
│  │  (Next.js)     │───→│  :3308   │    │  :6379          │  │
│  │  localhost:3000│    │ (Docker) │    │ (Docker)        │  │
│  └────────┬───────┘    └──────────┘    └─────────────────┘  │
│           │                                                  │
│           ▼                                                  │
│  ┌────────────────┐                                          │
│  │  Ollama        │                                          │
│  │  :11434        │                                          │
│  │  qwen2.5:14b   │                                          │
│  └────────────────┘                                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                                              ❌ No conecta al
                                                 VPS Hostinger
                                              ❌ No conecta a Softec
                                              ❌ No usa Telegram
```

## Pasos para levantar

### 1. Detener cualquier contenedor `cobranzas-guipak` viejo en Robocop

Desde Docker Desktop UI o:
```powershell
docker compose -f docker-compose.local.yml down
```

(Si existe un container `cobranzas-guipak` standalone de pruebas anteriores, eliminarlo desde la UI.)

### 2. Crear `.env.local` en `D:\IA\cobranzas-guipak\`

Copia el contenido de `LOCAL_DEV_ENV.template` (más abajo en este doc) a `.env.local`. **Solo valores de dev local — ningún token productivo.**

### 3. Levantar MySQL + Redis

```powershell
cd D:\IA\cobranzas-guipak
docker compose -f docker-compose.local.yml up -d
```

Espera ~20s a que MySQL inicialice.

Verificar:
```powershell
docker compose -f docker-compose.local.yml ps
```

Debe mostrar `cobranzas-mysql` y `cobranzas-redis` ambos como `running (healthy)`.

### 4. Aplicar migraciones

```powershell
cd D:\IA\cobranzas-guipak
npm install   # solo la primera vez
npm run migrate   # si existe, o el comando equivalente
```

(Verificar el comando real de migración en `package.json` o aplicar manualmente los SQLs de `db/migrations/`.)

### 5. Seed mínimo (opcional, recomendado)

Para probar el agente necesitas algunos clientes y facturas de prueba. Hay 3 opciones:

- **Opción A — mocks puros**: el refactor del router se puede probar SIN datos reales usando los `tool-mocks.ts` que ya armamos. El eval runner los usa. Para iterar fase 1-2 esto basta.
- **Opción B — seed sintético**: escribir un script que cree 5-10 clientes ficticios + facturas + tareas. Para fase 3 (test end-to-end).
- **Opción C — dump anonimizado de prod**: peligroso (PII), evitar a menos que sea estrictamente necesario.

Sugerencia: arrancar con A, luego B cuando lleguemos a fase 3.

### 6. Correr la app en modo dev

```powershell
cd D:\IA\cobranzas-guipak
npm run dev
```

App expuesta en `http://localhost:3000` con hot reload (cambios en el código → recargan sin rebuild).

### 7. Probar via web chat

Abrir navegador → `http://localhost:3000` → la app pide login. Crear un usuario admin local (script si existe, o INSERT manual a la DB).

Una vez dentro, usar el **chat web** integrado (mismo agent.ts, mismo prompt, mismas tools). NO necesita Telegram.

## Iteración rápida

Cuando edito el código (router, tools, prompt), la app recarga automáticamente. Para ver logs del agente:

```powershell
# En la misma ventana donde corre npm run dev, los console.log aparecen ahí
# Filtrar:
npm run dev 2>&1 | findstr "\[agent\]"
```

Ciclo objetivo: edito → guardo → 5s recarga → probar query en web chat → ver logs en terminal → ajustar.

## Plantilla del `.env.local` para dev

⚠️ **NO copiar credenciales de producción aquí**. Para dev solo necesitas lo siguiente:

```env
# --- Database local (Docker) ---
DB_COBRANZAS_HOST=localhost
DB_COBRANZAS_PORT=3308
DB_COBRANZAS_NAME=cobranzas_guipak
DB_COBRANZAS_USER=cobranzas_app
DB_COBRANZAS_PASS=cobranzas_pass_2026
DB_COBRANZAS_ROOT_PASS=cobranzas_root_2026

# --- Softec (opcional dev) ---
# Si no se setea, las tools que tocan Softec van a fallar (esperado).
# Para fase 1-2 del refactor no es necesario.
# DB_SOFTEC_HOST=
# DB_SOFTEC_PORT=
# DB_SOFTEC_NAME=
# DB_SOFTEC_USER=
# DB_SOFTEC_PASS=

# --- App ---
JWT_SECRET=dev-jwt-secret-cualquier-string-fijo
NEXT_PUBLIC_APP_URL=http://localhost:3000

# --- Redis local (Docker) ---
REDIS_HOST=localhost
REDIS_PORT=6379

# --- LLM ---
# Dev por defecto: Qwen local
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:14b-instruct-q4_K_M

# Opcional: si quieres comparar contra Haiku en dev, generar una key DEDICADA
# (no la de prod) en console.anthropic.com con límite bajo
# ANTHROPIC_API_KEY=

# --- No usados en dev ---
# TELEGRAM_BOT_TOKEN, EVOLUTION_*, SMTP_*, GOOGLE_*, INTERNAL_CRON_SECRET
# Dejarlos vacíos o no incluirlos. Esas funciones no se ejercitan en dev.
INTERNAL_CRON_SECRET=dev-cron-no-importa
```

## Workflow de cambios al refactor

1. Editar código (router.ts, tools.ts, agent-prompt.ts, agent.ts)
2. Probar en web chat local → ver logs en terminal
3. Si OK con el cambio puntual: commit + push
4. Si el cambio toca cosas core: probar varios queries antes de commitear
5. Push → Dokploy detecta y rebuilda PROD → tu canary o el grupo (según hayas configurado) lo prueba en real

## Cuándo conectar Softec

Para fase 1-2 (router + rename + descriptions): NO. Mocks bastan.

Para fase 3 (conectar router al agente + medir routing real): NO, sigue con mocks.

Para fase 4 (validación end-to-end en local): SÍ, conectar read-only via Tailscale.
- Si la IP `45.32.218.224` es alcanzable desde Robocop directamente, setear los DB_SOFTEC_* en `.env.local`.
- Si no, abrir un túnel SSH o usar Tailscale exit node desde el VPS.

## Rollback

Borrar el stack local sin afectar nada:
```powershell
docker compose -f docker-compose.local.yml down -v
```
(El `-v` también borra los volúmenes — DB y Redis se van al carajo. Si quieres conservar el seed, omite `-v`.)

Y volver a la otra PC donde tenías esta misma configuración corriendo. Cero impacto en Hostinger.
