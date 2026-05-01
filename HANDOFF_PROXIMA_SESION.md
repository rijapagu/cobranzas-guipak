# HANDOFF — Próxima sesión

> **Documento de continuidad. Léelo completo antes de codear.**
> Última sesión cerrada: **1 mayo 2026**
> Estado: Tareas y Calendario en producción ✅ — Sistema operativo end-to-end

---

## 📍 Estado actual al cierre (1-may-2026)

### En producción funcionando ✅
- App: `https://cobros.sguipak.com`
- Bot Telegram: `@CobrosGuipakBot` en grupo "Cobros Guipak"
- Empuje matutino: agendado en Dokploy → corre **diario 8:00 AM AST** (12:00 UTC)
- WhatsApp via Evolution: número **8098536995** vinculado, webhook activo
- 22 plantillas de correo (4 categorías) conectadas al flujo
- **Tareas y Calendario** ✨ *nuevo 1-may* — UI `/tareas`, bot crea/lista/marca hecha por NL,
  auto-tareas desde acuerdos de pago, integradas al empuje matutino

### Commits en esta sesión

| Commit | Descripción |
|---|---|
| `ed8c7b9` | feat(tareas): agregar sistema de tareas y calendario |
| `be3d652` | fix(tareas): evitar shift de timezone al renderizar fechas |
| `d7ba084` | fix(tareas): calendario en español + bot resuelve fechas relativas correctamente |

---

## ✅ Lo que cerramos en la sesión 1-may

### 1) Migración 013 + tabla `cobranza_tareas`
- Schema con tipo (LLAMAR/DEPOSITAR_CHEQUE/SEGUIMIENTO/DOCUMENTO/REUNION/OTRO)
- Estado (PENDIENTE/EN_PROGRESO/HECHA/CANCELADA), prioridad, asignación
- Origen (MANUAL/ACUERDO_PAGO/CADENCIA) + `origen_ref` para idempotencia
- Auditoría: `completada_at`, `completada_por`, `notas_completado`
- Aplicada en prod via `/api/internal/admin/migrate`

### 2) API CRUD `/api/cobranzas/tareas`
- `GET` con filtros: `desde`, `hasta`, `estado`, `cliente`, `asignada_a`, `origen`, `incluir_completadas`
- `POST` para crear (Zod validation, default `asignada_a` = sesión)
- `GET/PUT/DELETE /[id]` — PUT auto-sella `completada_at` cuando estado pasa a HECHA/CANCELADA
- DELETE es soft (estado → CANCELADA)
- Todas las acciones loggean en `cobranza_logs`

### 3) UI `/tareas`
- Vista calendario mensual antd (locale `es_ES`, dayjs `es`)
- Panel lateral "Tareas del día" con badge "Atrasadas (N)" arriba si hay
- Vista "Lista" alternativa
- Drawer crear/editar con DatePicker, TimePicker, Select de tipo/prioridad
- Acciones: Hecha / Editar / Cancelar
- Sidebar: nuevo item "Tareas" con icono 📅

### 4) Bot Telegram con 3 tools nuevas
- `crear_tarea(titulo, fecha_vencimiento, hora?, tipo?, codigo_cliente?, prioridad?)`
- `listar_tareas(rango: hoy|mañana|semana|atrasadas|todas, codigo_cliente?)`
- `marcar_tarea_hecha(tarea_id, notas?)`
- **Fix clave de fechas relativas**: en vez de pedirle a Claude que calcule
  ("viernes + 3 días"), el system prompt ahora inyecta una **tabla precomputada
  de los próximos 14 días** con su nombre en español. Claude solo hace lookup.
- Validado end-to-end: "el lunes" → lun 4 may, "pasado mañana" → dom 3 may,
  "en 3 días" → lun 4 may, "el viernes que viene" → vie 8 may.
- Resuelve clientes por nombre parcial automáticamente antes de crear tarea
  (ej. "llamar a Master Clean" → busca código `0000593` y lo asocia).

### 5) Auto-tareas desde acuerdos de pago
- Helper `lib/cobranzas/auto-tareas.ts` → `crearTareaSeguimientoAcuerdo()`
- Idempotente por `(origen='ACUERDO_PAGO', origen_ref=acuerdo_id)`
- Engachada en 2 sitios:
  - `app/api/portal/[token]/solicitar-acuerdo/route.ts` (acuerdos del portal cliente)
  - `app/api/cobranzas/procesar-respuesta/route.ts` (acuerdos detectados por IA en WA/email)
- Tarea SEGUIMIENTO al día siguiente de la `fecha_prometida`

### 6) Empuje matutino con tareas
- `lib/queue/jobs/empuje-matutino.ts` agrega 2 secciones nuevas:
  - "📋 Tus tareas hoy (N): • HH:MM — título"
  - "⏰ Atrasadas (N): • título *(vencía YYYY-MM-DD)*"
- Si no hay tareas, las secciones simplemente se omiten

### Bugs encontrados y corregidos en esta sesión
- 🐛 Timezone shift al renderizar fechas en calendario UI (cliente UTC-4 perdía un día)
  → fix tomando primeros 10 chars del string si ya viene `YYYY-MM-DD`
- 🐛 Bot ponía fechas en día equivocado ("lunes 5 mayo" cuando 5 mayo era martes)
  → fix con tabla precomputada de 14 días
- 🐛 Calendario en inglés (Sun Mon Tue) → fix con `ConfigProvider` + `dayjs/locale/es`

---

## ⏳ Pendientes — orden recomendado

### 🔴 Alta prioridad

#### 1. Validación end-to-end con clientes reales (próxima sesión sugerida)
- [ ] Probar conversación completa: cliente real responde WA → cae en cola → supervisor responde → cliente recibe
- [ ] Validar `cobranza_conversaciones` se actualiza con respuestas
- [ ] Validar `cobranza_acuerdos` se crea cuando cliente promete fecha en WA
  - Y validar que la auto-tarea de seguimiento aparece al día siguiente
- [ ] UI `/conversaciones` mostrando hilos activos por cliente
- [ ] Validar que el empuje matutino del día siguiente lista las tareas correctamente

#### 2. Slash command `/tareas` en bot
- Hoy si escribes `/tareas` el bot responde "Comando no reconocido"
- Agregar handler en `app/api/webhooks/telegram/route.ts` que mapea `/tareas` → `listar_tareas(rango: 'todas')`
- También `/hoy`, `/mañana`, `/semana` como atajos

#### 3. Bug: Settings de Evolution (UI) dan 500
- Endpoint `POST /settings/set/AsistenteGuipak` retorna 500 con error de Prisma
- Workaround: configurar manualmente desde la UI de Evolution
- Fix permanente: subir a `evoapicloud/evolution-api:latest` cuando salga estable post-2.3.7

#### 4. WhatsApp del flujo de cobranzas usa Claude (no plantillas)
- `lib/claude/prompts.ts` genera mensaje WA con Claude
- Las 22 plantillas son solo email
- Si quieres plantillas para WA: agregar columna `canal ENUM('EMAIL','WHATSAPP')` a `cobranza_plantillas_email`
  o crear tabla aparte `cobranza_plantillas_whatsapp`

### 🟡 Media prioridad

#### 5. Capa C — Bot pregunta datos faltantes al grupo
- Función `validarDatosClienteCompletos(clienteId, canal)` + tool `pedir_dato_faltante(cliente_id, campo)`
- Requiere `Privacy Mode` del bot deshabilitado en BotFather

#### 6. Capa D — Cadencias automáticas (worker BullMQ)
- Tabla `cobranza_cadencias` ya tiene 5 cadencias por defecto
- Worker en `lib/queue/worker.ts` ya construido pero sin agendar
- Si se quiere correr automático: levantar nuevo servicio Compose en Dokploy con `command: npm run worker`

#### 7. UI Tareas — mejoras nice-to-have
- [ ] Filtros: por tipo, por cliente, por asignado
- [ ] Vista semanal (no solo mensual)
- [ ] Notificación push 30 min antes de tarea con hora
- [ ] Recurrencia (ej. "todos los lunes a las 9 AM")
- [ ] Drag & drop para mover tarea de día

#### 8. UI Plantillas — mejoras nice-to-have
- Preview en vivo del correo con datos ficticios
- Botón "Test send" a tu propio email
- Duplicar plantilla
- Estadísticas de uso

#### 9. Reportes y dashboard ejecutivo
- Cobrado este mes vs meta
- Cartera por segmento (gráfico evolutivo histórico)
- Top 10 morosos
- Efectividad por plantilla (% que generaron pago)
- Productividad por cobrador
- Tareas completadas vs creadas (productividad operativa)

### 🟢 Baja prioridad / largo plazo

#### 10. Capa E — Memoria semántica (3-6 meses)
#### 11. WhatsApp Cloud API oficial de Meta
- Verificación de dominio + identidad legal en Meta Business Manager
- Migrar de Evolution a Cloud API (cero riesgo de bans, plantillas pre-aprobadas)

---

## 🐛 Issues conocidos pendientes

1. **`ANTHROPIC_API_KEY` shell pisa `.env.local` en dev local** — usar `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL` antes de `npm run dev`
2. **PowerShell 5.1 muy restringido** — usar Bash o Node directamente
3. **MASTER CLEAN no tiene email** — cliente 0000593 sin email. Agregar en Clientes si quieres email
4. **`.env.local` no se replicó al worktree** — al crear nuevo worktree, copiar manualmente con `cp /e/IA/cobranzas-guipak/.env.local .env.local`
5. **Settings Evolution UI bug 500** — ver pendiente #3 arriba
6. **`syncFullHistory: false`** en Evolution — bien para arrancar, pero significa que mensajes anteriores al pareo no se importan
7. **Slow filesystem en E:\ para dev server** — `next dev` se queda atorado compilando middleware en worktrees. Workaround: testear contra MySQL directo + typecheck + push a prod. El issue NO afecta al deploy ni a runtime — solo a `npm run dev` local.
8. **Slash commands del bot no implementados** — `/tareas`, `/hoy`, etc. responden "Comando no reconocido". Hay que escribir prosa.

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

App local en `http://localhost:3000` (o 3001 si 3000 está ocupado).

⚠️ Si el dev server se queda en "Compiling middleware...", probablemente sea el FS lento. Para validar cambios: aplica migración con `mysql` directo, corre `npx tsc --noEmit`, pushea a master y prueba en prod.

---

## 📂 Archivos clave de la sesión 1-may

### Backend
- `db/migrations/013_cobranza_tareas.sql` — tabla cobranza_tareas
- `lib/cobranzas/auto-tareas.ts` — helper idempotente para auto-tareas
- `app/api/cobranzas/tareas/route.ts` — GET (filtros), POST
- `app/api/cobranzas/tareas/[id]/route.ts` — GET/PUT/DELETE
- `app/api/portal/[token]/solicitar-acuerdo/route.ts` — engancha auto-tarea
- `app/api/cobranzas/procesar-respuesta/route.ts` — engancha auto-tarea

### Bot
- `lib/telegram/tools.ts` — 3 tools nuevas (crear_tarea, listar_tareas, marcar_tarea_hecha)
- `lib/telegram/agent.ts` — tabla precomputada de 14 días en system prompt

### UI
- `app/(dashboard)/tareas/page.tsx` — calendario, lista, drawer
- `components/layout/Sidebar.tsx` — item "Tareas"

### Empuje matutino
- `lib/queue/jobs/empuje-matutino.ts` — secciones "Tus tareas hoy" y "Atrasadas"

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

> Lee `HANDOFF_PROXIMA_SESION.md` y `CHECKLIST.md`. Estamos en Cobranzas Guipak, post-Tareas.
>
> Lo que cerramos en la sesión 1-may: sistema de Tareas y Calendario completo (migración 013, API CRUD, UI calendario en español, bot crea/lista/marca hecha por NL, auto-tareas desde acuerdos, integradas al empuje matutino).
>
> Hoy quiero arrancar **Validación end-to-end con clientes reales** (sección "Pendientes alta prioridad #1" del handoff) — probar el ciclo completo: cliente real responde WA → cola → supervisor → cliente recibe → si promete pago, se crea acuerdo + auto-tarea de seguimiento.

---

*Última actualización: 1-may-2026, sesión Sonnet 4.7 1M*
