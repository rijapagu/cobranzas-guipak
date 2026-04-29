# HANDOFF — Próxima sesión Fase 10

> **Documento de continuidad para retomar el trabajo de Fase 10.**
> Última sesión: 29 abril 2026
> Estado: Capa A + B + B+ + Plantillas + Manual ✅ — En producción

---

## 📍 Estado actual al cierre

### En producción funcionando ✅
- App: `https://cobros.sguipak.com`
- Bot Telegram: `@CobrosGuipakBot` en grupo "Cobros Guipak"
- Webhook configurado: `https://cobros.sguipak.com/api/webhooks/telegram`
- Empuje matutino endpoint: `POST /api/internal/cron/empuje-matutino` (sin agendar todavía)

### Tablas en DB (cobranzas_guipak)
- `cobranza_telegram_usuarios` (Ricardo registrado como supervisor)
- `cobranza_cadencias` (5 cadencias por defecto)
- `cobranza_factura_cadencia_estado`
- `cobranza_plantillas_email` (6 plantillas iniciales: 1er a 6to correo)

### Variables de entorno en Dokploy ✅
Todas configuradas. **Importante:** `ANTHROPIC_API_KEY` debe seguir presente — si se pierde, el bot falla con "no configurada".

---

## 🧪 Lo que Ricardo debe probar antes de la próxima sesión

1. **Plantillas** — Abrir `cobros.sguipak.com/plantillas`:
   - Ver las 6 plantillas pre-cargadas
   - Editar el contenido de alguna (asunto + cuerpo)
   - Probar el botón "Activa/Inactiva"
   - **Nota:** las plantillas aún NO están conectadas al flujo de generación (eso es próximo paso)

2. **Bot Telegram — propuesta de correo:**
   - En el grupo o en privado: `@CobrosGuipakBot genera correo para Master Clean`
   - Ver el draft + 3 botones inline
   - Probar ✅ Aprobar y enviar (Master Clean no tiene email → fallará con "SIN_EMAIL", esperado)
   - Probar con un cliente que SÍ tenga email registrado

3. **Bot — consultas naturales:**
   - `@CobrosGuipakBot estado de cobros hoy`
   - `@CobrosGuipakBot promesas vencidas`
   - `@CobrosGuipakBot busca el cliente Universidad`

4. **Manual:**
   - Leer `docs/MANUAL_USUARIO.md` (también disponible en repo)
   - Compartirlo con Daria

---

## ⏳ Pendientes concretos (en orden de prioridad)

### 🔴 Alta prioridad

#### 1. Conectar plantillas al flujo de generación
Actualmente:
- `lib/telegram/draft-correo.ts` y `app/api/cobranzas/generar-cola/route.ts` usan `lib/claude/prompts.ts` (prompts hardcoded en código)
- La sección Plantillas guarda en DB pero nadie las lee aún

**Lo que hay que hacer:**
1. Crear `lib/templates/render.ts` con función `renderPlantilla(plantillaId, ctx)` que reemplaza variables
2. Crear función `seleccionarPlantilla(segmento, diasVencido)` que escoge la plantilla activa apropiada de `cobranza_plantillas_email`
3. Modificar `lib/telegram/draft-correo.ts` para usar la plantilla seleccionada en lugar de Claude directo (pero seguir pasando por Claude para dar tono natural si es complejo)
4. Modificar `app/api/cobranzas/generar-cola/route.ts` igual
5. Si plantilla tiene `requiere_aprobacion=0`, marcar gestión como APROBADO directamente y enviar (Auto-send)

**Nota técnica:** dos enfoques posibles:
- **A) Reemplazar variables sin Claude** — más rápido, más predecible, pero menos personalizado
- **B) Pasar plantilla a Claude como template** — más natural pero más caro y lento

Recomendación: **A** para correos automáticos (1er, 2do aviso) y **B** para propuestas manuales del bot (donde Claude puede ajustar tono).

#### 2. Cron del empuje matutino
El endpoint existe pero no se dispara automáticamente. Opciones:
- **A)** Agregar cron job en Dokploy que llame `POST /api/internal/cron/empuje-matutino` con header `x-internal-secret` cada día a las 8 AM AST.
- **B)** Levantar el worker BullMQ como servicio separado en Dokploy. El worker ya está construido en `lib/queue/worker.ts` y usa `npm run worker`. Solo hay que crear un nuevo servicio Compose en Dokploy con `command: npm run worker`.

Recomendación: **A**, más simple. Configurar en Dokploy → Crons.

#### 3. Privacy mode del bot (para Capa C)
Si vamos a hacer Capa C (bot pregunta datos faltantes al grupo y la gente responde libremente), Ricardo necesita:
1. `@BotFather` → `/setprivacy` → `CobrosGuipakBot` → **Disable**
2. Sacar al bot del grupo
3. Re-agregarlo
4. Re-promoverlo a admin

Sin esto, el bot solo lee mensajes con `@mención` o `/comandos`.

### 🟡 Media prioridad

#### 4. Capa C — Captura interactiva de datos
Función `validarDatosClienteCompletos(clienteId, canal)` + tool `pedir_dato_faltante(cliente_id, campo)` que postea pregunta al grupo y procesa la respuesta. Ver `ROADMAP_FASE_10_AGENTE_PROACTIVO.md` Capa C.

#### 5. Capa D — Cadencias automáticas
Worker BullMQ horario que evalúa qué facturas necesitan próximo paso de cadencia y genera la gestión. Tabla `cobranza_cadencias` ya existe con 5 cadencias por defecto.

### 🟢 Baja prioridad / nice-to-have

#### 6. Mejoras al UI de Plantillas
- Preview en vivo del correo con datos ficticios
- Test de envío a tu propio email
- Duplicar plantilla
- Estadísticas de uso (cuántos correos usaron esta plantilla, tasa de respuesta)

#### 7. Capa E — Memoria semántica
Diferida 2-3 meses según roadmap original.

---

## 🐛 Issues conocidos pendientes

1. **`ANTHROPIC_API_KEY` shell pisa `.env.local` en dev local**
   - Si entras al worktree con Claude Code activo, `ANTHROPIC_API_KEY=""` está seteado en el shell.
   - Solución: `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL` antes de `npm run dev`.
   - Documentado en memoria.

2. **PowerShell 5.1 muy restringido**
   - No usar PowerShell para correr scripts. Usar CMD o Node directamente.

3. **MASTER CLEAN no tiene email**
   - Cliente ID 0000593 no tiene email registrado, los correos fallan con SIN_EMAIL.
   - No es bug, es data — agregar email en sección Clientes si se quiere gestionar por correo.

---

## 🛠️ Cómo levantar el entorno local mañana

```bash
# 1. Containers (MySQL + Redis)
cd "E:\IA\cobranzas-guipak"
docker compose -f docker-compose.local.yml up -d

# 2. Verificar containers
docker compose -f docker-compose.local.yml ps

# 3. Dev server (¡importante: unset las env vars que pisan!)
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
npm run dev

# 4. (Opcional) Worker BullMQ
npm run worker
```

App local en `http://localhost:3000`.

---

## 📂 Archivos clave creados en esta sesión

### Backend (lib/)
- `lib/queue/bullmq.ts` — cliente BullMQ
- `lib/queue/worker.ts` — worker para jobs programados
- `lib/queue/jobs/empuje-matutino.ts` — lógica del mensaje matutino
- `lib/telegram/client.ts` — cliente Telegraf
- `lib/telegram/auth.ts` — resolver telegram_user_id → usuario
- `lib/telegram/agent.ts` — agente Claude con tool use
- `lib/telegram/tools.ts` — 7 herramientas para el bot
- `lib/telegram/draft-correo.ts` — generar draft + insert en gestiones
- `lib/telegram/enviar-gestion.ts` — enviar correo aprobado

### API Routes
- `app/api/webhooks/telegram/route.ts` — webhook + callback handlers
- `app/api/internal/cron/empuje-matutino/route.ts` — cron endpoint
- `app/api/internal/admin/migrate/route.ts` — migration runner
- `app/api/cobranzas/plantillas/route.ts` — GET, POST plantillas
- `app/api/cobranzas/plantillas/[id]/route.ts` — GET, PUT, DELETE plantilla

### UI
- `app/(dashboard)/plantillas/page.tsx` — página completa de Plantillas
- `components/layout/Sidebar.tsx` — actualizado con entrada "Plantillas"

### Migrations
- `db/migrations/010_fase10_telegram_cadencias.sql`
- `db/migrations/011_plantillas_email.sql`

### Docs
- `docs/MANUAL_USUARIO.md` — manual completo del sistema
- `HANDOFF_PROXIMA_SESION.md` — este documento

---

## 🔑 Credenciales clave (referencia rápida)

```
TELEGRAM_BOT_TOKEN=8517088210:AAGE8oph4xyGPF81KpAQ5KthyHCF8MeSFDw
TELEGRAM_CHAT_ID_GRUPO_COBROS=-5138505342
TELEGRAM_USER_RICARDO=7281538057
EVOLUTION_INSTANCE=AsistenteGuipak
INTERNAL_CRON_SECRET=c8021d7acd666dc798aac543d862b9bf4effce96e1391d88ce8b7d468bec1894
```

(Las claves sensibles ya están en `.env.local` y en Dokploy.)

---

## 🚀 Para retomar mañana — prompt sugerido

> Lee `HANDOFF_PROXIMA_SESION.md` y `PROGRESS.md`. Estamos en Fase 10 de Cobranzas Guipak.
>
> Lo que hicimos ayer: Capa A (empuje matutino), Capa B (bot conversacional), Capa B+ (bot propone correos con botones de aprobación), sección Plantillas con 6 correos pre-cargados, manual de usuario completo.
>
> Hoy quiero hacer X (o "elige tú la prioridad alta"):
> - Conectar plantillas al flujo de generación de correos
> - Configurar cron diario del empuje matutino en Dokploy
> - Capa C: bot pregunta datos faltantes al grupo
> - Capa D: cadencias automáticas
>
> Antes de codear, levanta el entorno local y verifica que todo está OK como dejamos ayer.
