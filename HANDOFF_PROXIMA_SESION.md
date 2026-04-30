# HANDOFF — Próxima sesión

> **Documento de continuidad. Léelo completo antes de codear.**
> Última sesión cerrada: **30 abril 2026**
> Estado: Capa A + B + B+ + Plantillas conectadas + Evolution + Cron diario ✅ — En producción

---

## 📍 Estado actual al cierre (30-abr-2026)

### En producción funcionando ✅
- App: `https://cobros.sguipak.com`
- Bot Telegram: `@CobrosGuipakBot` en grupo "Cobros Guipak"
- Empuje matutino: agendado en Dokploy → corre **diario 8:00 AM AST** (12:00 UTC)
- WhatsApp via Evolution: número **8098536995** vinculado, webhook activo
- 22 plantillas de correo (4 categorías) conectadas al flujo

### Commits en esta sesión

| Commit | Descripción |
|---|---|
| `2208239` | feat(fase10): conectar plantillas al flujo de generación de correos |
| `5747c74` | fix(fase10): simplificar migración 012 para auto-runner |
| `75e305a` | fix(migrate): usar pool.query en lugar de execute para soportar DDL |
| `48341fe` | fix(whatsapp): soportar formato LID de WhatsApp en webhook |

---

## ✅ Lo que cerramos en la sesión 30-abr

### 1) Plantillas (22 modelos) en producción
- Migración `db/migrations/012_plantillas_22_modelos.sql` aplicada
- Columna `categoria` ENUM agregada (SECUENCIA, BUEN_CLIENTE, PROMESA_ROTA, ESTADO_CUENTA)
- 22 plantillas insertadas en orden cadencia: VERDE -3 → ROJO 60 días
- UI `/plantillas` con tabs por categoría
- `lib/templates/render.ts` — sustitución de `{{variables}}` con aliases retrocompat
- `lib/templates/seleccionar.ts` — lookup por segmento+día+categoría
- **Generar cola** (`app/api/cobranzas/generar-cola/route.ts`) usa enfoque A: render directo, fallback a Claude
- **Bot Telegram draft** (`lib/telegram/draft-correo.ts`) usa enfoque B: render + refinamiento opcional con Claude
- Migración runner del endpoint `/api/internal/admin/migrate` ahora usa `pool.query` (no prepared) para soportar DDL

### 2) EvolutionAPI conectado (problema mayor resuelto)
- Diagnóstico: instancia anterior estaba con `integration: EVOLUTION` (incorrecto)
- Borrada y recreada con `integration: WHATSAPP-BAILEYS`
- Imagen Evolution actualizada de `homolog v2.3.6 buggy` → `evoapicloud/evolution-api:homolog` working
- Número conectado: **18098536995** (Amel Aquino Flota)
- Webhook configurado: `https://cobros.sguipak.com/api/webhooks/whatsapp`
- Eventos suscritos: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `SEND_MESSAGE`
- Test envío UTF-8 (tildes, emojis): ✅ funcional desde Node fetch
- Test recepción: ✅ mensaje "Test Guipak" llegó correctamente

### 3) Webhook fix LID (formato nuevo de WhatsApp)
- WhatsApp introdujo Linked Identifier (LID): `remoteJid` viene como `XXXXXXX@lid` sin número
- El número real está en `key.remoteJidAlt`
- Helper `extraerNumero()` en `app/api/webhooks/whatsapp/route.ts` resuelve los dos formatos
- Mensajes LID sin `remoteJidAlt` resoluble se loguean como `WA_HUERFANO` para asignación manual
- 7/7 casos pasaron en tests locales

### 4) Cron empuje matutino agendado en Dokploy
- **Ubicación:** Dokploy → cobranzas-guipak → tab Schedules
- **Schedule:** `0 12 * * *` (12:00 UTC = 8:00 AM AST)
- **Shell:** `sh` (NO bash — el contenedor Alpine no tiene bash)
- **Command:**
  ```sh
  wget -qO- --post-data='' --header='x-internal-secret: c8021d7acd666dc798aac543d862b9bf4effce96e1391d88ce8b7d468bec1894' https://cobros.sguipak.com/api/internal/cron/empuje-matutino
  ```
- Validado manualmente con ▶️ Play: ✅ resumen llegó al grupo Telegram

---

## ⏳ Pendientes — orden recomendado

### 🔴 Alta prioridad

#### 1. Tareas / Calendario / Recordatorios (próximo gran feature)

Pedido por el usuario al cerrar sesión 30-abr. Necesitan crear y consultar tareas tipo:
- "Hoy llamar a Master Clean"
- "Mañana depositar cheque de Universidad por RD$50,000"
- "Cliente X dice que le llame el viernes"

**Diseño propuesto:**

**1.1 — Migración 013_cobranza_tareas.sql:**
```sql
CREATE TABLE cobranza_tareas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT NULL,
  tipo ENUM('LLAMAR','DEPOSITAR_CHEQUE','SEGUIMIENTO','DOCUMENTO','REUNION','OTRO') NOT NULL DEFAULT 'OTRO',
  fecha_vencimiento DATE NOT NULL,
  hora TIME NULL,
  -- Relacionada con cliente o factura (opcional)
  codigo_cliente VARCHAR(20) NULL,
  ij_inum INT NULL,
  -- Estado
  estado ENUM('PENDIENTE','EN_PROGRESO','HECHA','CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
  prioridad ENUM('BAJA','MEDIA','ALTA') NOT NULL DEFAULT 'MEDIA',
  -- Quién y cuándo
  asignada_a VARCHAR(100) NULL,           -- email del usuario o telegram_user_id
  creado_por VARCHAR(100) NOT NULL,
  -- Auto-generadas
  origen ENUM('MANUAL','ACUERDO_PAGO','CADENCIA') NOT NULL DEFAULT 'MANUAL',
  origen_ref VARCHAR(50) NULL,            -- ID del acuerdo/cadencia que la generó
  -- Auditoría
  completada_at DATETIME NULL,
  completada_por VARCHAR(100) NULL,
  notas_completado TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fecha_estado (fecha_vencimiento, estado),
  INDEX idx_cliente (codigo_cliente),
  INDEX idx_asignada (asignada_a, estado)
);
```

**1.2 — API + UI:**
- `GET/POST /api/cobranzas/tareas` — listar (con filtros fecha/estado/cliente), crear
- `GET/PUT/DELETE /api/cobranzas/tareas/[id]` — editar, completar, cancelar
- `app/(dashboard)/tareas/page.tsx`:
  - Vista calendario mensual (usar `antd Calendar`)
  - Vista lista del día con check para marcar como hecha
  - Form de crear/editar con select de cliente desde Softec

**1.3 — Bot Telegram con lenguaje natural:**

Agregar tools en `lib/telegram/tools.ts`:
- `crear_tarea(titulo, fecha, tipo?, cliente?, hora?)`
- `listar_tareas(rango: 'hoy'|'semana'|'mes')`
- `marcar_tarea_hecha(tarea_id, notas?)`

Comandos esperados del bot:
```
@CobrosGuipakBot recordame llamar a Master Clean el viernes a las 10
@CobrosGuipakBot mañana hay que depositar cheque de Universidad por 250,000
@CobrosGuipakBot qué tengo hoy
@CobrosGuipakBot mis tareas semana
```

Claude parsea fechas relativas ("viernes", "mañana", "el lunes 5") con prompt cuidadoso. Confirma antes de guardar.

**1.4 — Auto-tareas desde acuerdos:**

Cuando se registra un `cobranza_acuerdo` con `fecha_promesa`:
- Crear automáticamente una tarea tipo `SEGUIMIENTO`:
  - título: "Verificar pago prometido de [cliente]"
  - fecha_vencimiento: día siguiente al `fecha_promesa`
  - origen: `ACUERDO_PAGO`, origen_ref: ID del acuerdo

**1.5 — Integrar al empuje matutino:**

`lib/queue/jobs/empuje-matutino.ts` debe agregar sección al mensaje de Telegram:

```
📋 Tus tareas hoy (3):
• 09:00 — Llamar a Master Clean
• Verificar pago prometido de Universidad
• Depositar cheque de XX por RD$50,000

📋 Atrasadas (1):
• Llamar a Cliente Y (vencía ayer)
```

**Esfuerzo estimado:** ~2.5 horas de trabajo limpio.

#### 2. Bug: Settings de Evolution (UI) dan 500
- Endpoint `POST /settings/set/AsistenteGuipak` retorna 500 con error de Prisma `integrationSession.update`
- Probable bug del tag `homolog` que estamos usando
- Settings deseados: `rejectCall: true`, `groupsIgnore: true`, `msgCall` con respuesta automática
- **Workaround:** configurar manualmente desde la UI de Evolution (puede que sí funcione por panel)
- **Fix permanente:** subir a `evoapicloud/evolution-api:latest` cuando salga estable post-2.3.7

#### 3. WhatsApp del flujo de cobranzas usa Claude (no plantillas)
- `lib/claude/prompts.ts` genera mensaje WA con Claude
- Las 22 plantillas son solo email
- Si quieres plantillas para WA también, agregar columna `canal ENUM('EMAIL','WHATSAPP')` a `cobranza_plantillas_email` o crear tabla aparte `cobranza_plantillas_whatsapp`

### 🟡 Media prioridad

#### 4. Capa C — Bot pregunta datos faltantes al grupo
Ver detalle en sesión anterior. Función `validarDatosClienteCompletos(clienteId, canal)` + tool `pedir_dato_faltante(cliente_id, campo)`. Requiere `Privacy Mode` del bot deshabilitado en BotFather.

#### 5. Capa D — Cadencias automáticas worker BullMQ
Tabla `cobranza_cadencias` ya tiene 5 cadencias por defecto. Worker en `lib/queue/worker.ts` ya construido pero sin agendar. Si se quiere correr automático: levantar nuevo servicio Compose en Dokploy con `command: npm run worker`.

#### 6. UI Plantillas — mejoras nice-to-have
- Preview en vivo del correo con datos ficticios
- Botón "Test send" a tu propio email
- Duplicar plantilla
- Estadísticas de uso

### 🟢 Baja prioridad / largo plazo

#### 7. Capa E — Memoria semántica (3-6 meses)
#### 8. WhatsApp Cloud API oficial de Meta
- Ricardo lleva meses intentando sacar la verificación. Tema de Meta Business Manager:
  - Verificación de dominio
  - Verificación de identidad legal
  - Documentos del negocio
- Si se logra: cero riesgo de bans, plantillas pre-aprobadas, mejor entregabilidad

---

## 🐛 Issues conocidos pendientes

1. **`ANTHROPIC_API_KEY` shell pisa `.env.local` en dev local** — usar `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL` antes de `npm run dev`
2. **PowerShell 5.1 muy restringido** — usar Bash o Node directamente
3. **MASTER CLEAN no tiene email** — cliente 0000593 sin email. Agregar en Clientes si quieres email
4. **`.env.local` no se replicó al worktree** — al crear nuevo worktree, hay que copiar manualmente con `cp /e/IA/cobranzas-guipak/.env.local .env.local`
5. **Settings Evolution UI bug 500** — ver pendiente #2 arriba
6. **`syncFullHistory: false`** en Evolution — bien para arrancar, pero significa que mensajes anteriores al pareo no se importan

---

## 🛠️ Cómo levantar el entorno local

```bash
# 1. Containers (MySQL + Redis)
cd "E:\IA\cobranzas-guipak"
docker compose -f docker-compose.local.yml up -d

# 2. Verificar containers
docker compose -f docker-compose.local.yml ps

# 3. Copiar .env.local al worktree (si es nuevo)
cp .env.local .claude/worktrees/<nuevo-nombre>/.env.local

# 4. Dev server (¡importante: unset las env vars que pisan!)
cd .claude/worktrees/<nuevo-nombre>
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
npm run dev
```

App local en `http://localhost:3000`.

---

## 📂 Archivos clave de la sesión 30-abr

### Backend
- `db/migrations/012_plantillas_22_modelos.sql` — 22 plantillas + categoria
- `lib/templates/render.ts` — render de variables
- `lib/templates/seleccionar.ts` — selector por segmento/día/categoría
- `lib/db/cobranzas.ts` — agregada `cobranzasQueryRaw()` para DDL
- `app/api/internal/admin/migrate/route.ts` — usa `pool.query`

### API Routes
- `app/api/cobranzas/plantillas/route.ts` — sort por cadencia + categoria
- `app/api/cobranzas/plantillas/[id]/route.ts` — acepta categoria
- `app/api/cobranzas/generar-cola/route.ts` — enfoque A
- `app/api/webhooks/whatsapp/route.ts` — fix LID

### Bot
- `lib/telegram/draft-correo.ts` — enfoque B (render + refinamiento Claude)

### UI
- `app/(dashboard)/plantillas/page.tsx` — tabs por categoría, campo categoría en form

---

## 🔑 Credenciales clave (referencia rápida)

```
TELEGRAM_BOT_TOKEN=8517088210:AAGE8oph4xyGPF81KpAQ5KthyHCF8MeSFDw
TELEGRAM_CHAT_ID_GRUPO_COBROS=-5138505342
TELEGRAM_USER_RICARDO=7281538057
EVOLUTION_API_URL=https://evolutionapi.sguipak.com
EVOLUTION_API_KEY=LLYe7Cz+FQ5OIzQPVSAuzWvzzZ2EAGKJR1i+repbXyu70a6WbCzHmDzAyVDGK1aNXabdwjTWaRBhhjOAXGr83A==
EVOLUTION_INSTANCE=AsistenteGuipak
INTERNAL_CRON_SECRET=c8021d7acd666dc798aac543d862b9bf4effce96e1391d88ce8b7d468bec1894
EVOLUTION_NUMERO_VINCULADO=18098536995
```

---

## 🚀 Para retomar — prompt sugerido

> Lee `HANDOFF_PROXIMA_SESION.md` y `PROGRESS.md`. Estamos en Cobranzas Guipak, post-Fase 10.
>
> Lo que cerramos en la sesión 30-abr: 22 plantillas en prod, EvolutionAPI conectado, fix LID del webhook, cron empuje matutino agendado en Dokploy.
>
> Hoy quiero arrancar **Tareas y Calendario** (sección "Pendientes alta prioridad #1" del handoff) — el sistema de recordatorios y agenda.
>
> Antes de codear, levanta el entorno local y verifica que todo está OK. Luego repasamos el plan de la migración 013 + UI + bot integration.

---

*Última actualización: 30-abr-2026, sesión Opus 4.7 1M*
