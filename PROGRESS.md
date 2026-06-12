# PROGRESS.md — Registro de Progreso
> Sistema de Cobranzas Guipak
> **Actualizar este archivo al inicio y fin de cada sesión de trabajo.**
> Lee CLAUDE.md antes de este documento.

---

## Estado General

| Campo | Detalle |
|---|---|
| **Fase actual** | Fase 10 — Agente Proactivo Telegram ✅ COMPLETADA (Capas A+B+C+D) |
| **Próxima fase** | Validación end-to-end con clientes reales · Worker en Dokploy |
| **Última actualización** | 12 Mayo 2026 |
| **Progreso general** | ██████████ 100% |
| **Repo GitHub** | https://github.com/rijapagu/cobranzas-guipak (público) |
| **Producción** | https://cobros.sguipak.com |
| **VPS** | srv869155 — 31.97.131.17 (Dokploy) |

---

## Resumen de Fases

| # | Fase | Estado | % |
|---|---|---|---|
| 0 | Diseño y especificaciones | ✅ Completada | 100% |
| 1 | Fundación de datos (Softec) | ✅ Completada | 100% |
| 2 | Scaffolding app + Docker + Auth | ✅ Completada | 100% |
| 3 | Módulo cartera vencida (UI) | ✅ Completada | 100% |
| 4 | Conciliación bancaria | ✅ Completada | 100% |
| 5 | Cola de supervisión + IA | ✅ Completada | 100% |
| 6 | Envío real (WhatsApp + Email) | ✅ Completada | 100% |
| 7 | Agente IA respuestas entrantes | ✅ Completada | 100% |
| 8 | Portal cliente + Documentación | ✅ Completada | 100% |
| 9 | KPIs, alertas y refinamiento | ✅ Completada | 100% |
| 10 | Agente Proactivo Telegram (Capas A + B + C + D + Plantillas + Tareas) | ✅ Completada | 100% |

---

## ✅ Fase 0 — Diseño y Especificaciones (COMPLETADA)

### Logros
- Definición del problema y contexto de Guipak
- Stack tecnológico definido (Next.js, MySQL separado, VPS existente)
- 13 módulos del sistema diseñados
- Referencia: Moonflow.ai + competidores globales
- Decisión: app independiente (no módulo del CRM)
- Documentación inicial creada

---

## ✅ Fase 1 — Fundación de Datos (COMPLETADA)

### Logros
- DESCRIBE completo de `ijnl`, `ijnl_pay`, `irjnl`, `icust`, `icontacts`
- Query cartera vencida v1.1 validado: **614 facturas, RD$12.6M**
- DDL de 11 tablas propias diseñado
- Descubrimiento: `IJ_TYPEDOC = 'IN'` en Guipak

---

## ✅ Fase 2 — Scaffolding de la App (COMPLETADA)

### Logros
- Proyecto Next.js 16 + TypeScript + Ant Design + Tailwind
- Docker Compose: MySQL 8.0 (puerto 3308 local, 3847 producción)
- Autenticación JWT con cookies httpOnly
- Conexión Softec solo lectura con validación runtime (rechaza INSERT/UPDATE/DELETE)
- Conexión cobranzas_guipak lectura/escritura + logAccion()
- Layout dashboard con Sidebar (9 módulos) + Header con usuario
- Página de login con Ant Design
- 8 páginas placeholder de módulos
- Deploy en Dokploy (Compose) con autodeploy desde GitHub

### Arquitectura de deploy
- **Servicio Compose**: `cobranzas-guipak` en Dokploy
- **DB MySQL separada**: `cobranzas-mysql` en Dokploy (12 tablas + usuario admin seed)
- **Internal Host DB**: `automatizacion-cobranzasmysql-u52l8d:3306`
- **Dominio**: `cobros.sguipak.com` (HTTPS + Let's Encrypt)
- **Credenciales admin**: admin@guipak.com / Admin2026!

---

## ✅ Fase 3 — Módulo Cartera Vencida (COMPLETADA)

### Logros
- 3 API Routes: cartera-vencida (con filtros), resumen-segmentos, estado-cuenta/[cliente]
- Cross-DB resuelto en 2 pasos (query Softec + filtro disputas en app)
- 6 componentes: SegmentoTag, ContactoIndicadores, ResumenCards, FiltrosCartera, TablaCartera, DetalleFactura
- Modo mock con 35 facturas y 10 clientes dominicanos ficticios
- Filtros: segmento, búsqueda, vendedor, días, monto
- Tabla con ordenamiento, paginación, drawer de detalle

---

## ✅ Fase 4 — Conciliación Bancaria (COMPLETADA)

### Logros
- Parser de extractos Excel/CSV con detección automática de columnas
- Motor de matching: monto exacto + fecha ±3 días contra Softec irjnl
- Sistema de aprendizaje de cuentas bancarias (CP-05 cumplido)
  - Primera vez → DESCONOCIDO → asignación manual
  - Segunda vez → propone automáticamente
- 4 API Routes: cargar, resultados, aprobar, asignar-cliente
- 5 componentes: CargadorExtracto (drag&drop), ResumenConciliacion, TablaConciliacion (tabs por estado), DrawerTransaccion, SelectorCliente
- Verificado: cuenta aprendida se reconoce en cargas posteriores

---

## ✅ Fase 5 — Cola de Supervisión + IA (COMPLETADA)

### Logros
- Integración con Claude AI (claude-sonnet-4-20250514) para generación de mensajes
- 4 tonos de mensaje por segmento (verde/amarillo/naranja/rojo)
- Prompts para WhatsApp (max 300 chars) + Email (formato profesional)
- 5 API Routes: generar-cola, cola-aprobacion, aprobar, descartar, escalar
- 5 componentes: PreviewWhatsApp (burbuja), PreviewEmail, ResumenCola, TablaColaAprobacion, DrawerAprobacion
- Acciones: Aprobar / Editar y Aprobar / Descartar (con motivo) / Escalar / Pausar Cliente
- CP-02 cumplido: todo mensaje pasa por aprobación humana
- CP-08 cumplido: toda acción registrada en cobranza_logs
- Mock si no hay ANTHROPIC_API_KEY

---

## ✅ Fase 6 — Envío Real WhatsApp + Email (COMPLETADA)

### Logros
- Cliente Evolution API (`lib/evolution/client.ts`) con normalización de teléfonos RD
- Cliente SMTP (`lib/email/sender.ts`) con nodemailer
- API de envío `/api/cobranzas/gestiones/[id]/enviar` con:
  - CP-02: Verifica estado APROBADO + aprobado_por NOT NULL
  - CP-06: Valida saldo en Softec si cache > 4 horas (cancela si pagada)
  - Registro en cobranza_conversaciones por cada canal
  - Manejo de errores → estado FALLIDO
- Webhook WhatsApp `/api/webhooks/whatsapp` para delivery status (ENTREGADO/LEÍDO/FALLIDO)
- UI actualizada: botón "Enviar Ahora" post-aprobación, tabs de estado, envío batch
- Mock si no hay EVOLUTION_API_KEY o SMTP_HOST

---

## ✅ Fase 7 — Agente IA Respuestas Entrantes (COMPLETADA)

### Logros
- Prompt de respuesta que clasifica intención: PROMESA_PAGO, DISPUTA, SOLICITUD_INFO, AGRADECIMIENTO, OTRO
- Claude analiza mensaje del cliente + contexto (historial, saldo, acuerdos previos)
- Auto-registro de acuerdos de pago en cobranza_acuerdos (capturado_por_ia=1)
- Auto-creación de disputas en cobranza_disputas (estado=ABIERTA)
- Respuesta generada va a cola de aprobación (CP-02 cumplido)
- Webhook actualizado para procesar messages.upsert de Evolution API
- Página /conversaciones con vista de chat (burbujas enviado/recibido)
- Componentes: ChatView, ListaConversaciones
- API de conversaciones con agrupación por cliente
- Verificado: "haré el pago viernes" → PROMESA_PAGO, "error en el monto" → DISPUTA + disputa en DB

---

## ✅ Fase 8 — Portal Cliente + Documentación (COMPLETADA)

### Logros
- Webhook `/api/webhooks/factura-escaneada` — recibe datos del CRM, registra PDF en DB
- Google Drive client `lib/drive/client.ts` — getFileInfo, verifyPdf, mock si sin credenciales
- Portal `/portal/[token]` — vista pública de facturas pendientes del cliente
  - CP-07 cumplido: token único con HMAC, expiración 30 días
  - Muestra: facturas, saldos, PDFs descargables, acuerdos activos
  - Solicitud de acuerdo de pago desde el portal
- API de generación de tokens `/api/cobranzas/portal/generar-token`
  - Desactiva tokens previos del mismo cliente
  - Genera URL para compartir con el cliente
- Página `/documentos` — gestión documental completa
  - Lista documentos con búsqueda
  - Estadísticas: total, CRM webhook, manual
  - Vinculación manual de PDF (Google Drive ID)
  - Actualización automática de gestiones con tiene_pdf
- Página `/clientes` — enriquecimiento de datos
  - Cruza datos Softec con cobranza_clientes_enriquecidos
  - Filtros: sin email, sin WhatsApp, sin contacto, pausados
  - Edición de datos enriquecidos (email, WhatsApp, contacto, canal preferido)
  - Generación de link del portal desde la tabla de clientes
  - CP-01 cumplido: datos enriquecidos solo en DB propia, nunca en Softec

---

## ✅ Fase 9 — KPIs, Alertas y Refinamiento (COMPLETADA)

### Logros
- Dashboard dinámico con KPIs reales:
  - Cartera total vencida + total facturas + total clientes
  - DSO calculado: (CxC / Ventas 90 días) × 90
  - Distribución por segmento con barras de progreso
  - Top 10 clientes con mayor saldo vencido
  - Efectividad canales (WhatsApp vs Email — tasa de respuesta)
  - Acuerdos de pago: pendientes, cumplidos, incumplidos + tasa cumplimiento
  - Gestiones del día: generadas, enviadas
  - Alertas en vivo: promesas vencidas, pendientes aprobación, clientes sin contacto
- Alertas internas (`/api/cobranzas/alertas`):
  - Promesas de pago vencidas sin cumplir (con días de retraso)
  - Gestiones escaladas pendientes
  - Pagos en conciliación sin registrar (POR_APLICAR)
  - Facturas con 30+ días sin gestión (3+ facturas por cliente)
  - Badge en Header con contador de alertas de alta prioridad
- Reportes exportables a Excel:
  - Cartera vencida completa (17 columnas, todos los datos)
  - Historial de gestiones por período (con selector de fechas)
  - Estado de cuenta por cliente (facturas pendientes)
  - CP-08 cumplido: cada descarga registrada en logs

---

## 🟢 Fase 10 — Agente Proactivo Telegram (EN CURSO)

### ✅ Capa A — Empuje matutino (COMPLETADA)
- Redis 7 Alpine como servicio en docker-compose (production + local)
- BullMQ cliente con job repetible programado a 8:00 AM AST (12:00 UTC)
- Worker en `lib/queue/worker.ts` (correrlo con `npm run worker`)
- Cliente Telegraf en `lib/telegram/client.ts`
- Endpoint `POST /api/internal/cron/empuje-matutino` (auth `INTERNAL_CRON_SECRET`)
- Job consulta DB directamente (no llama a APIs internas que requieren auth)
- Mensaje formateado en HTML con cartera vencida, segmentos, alertas, link a la app
- ✅ Verificado en producción: mensaje llega al grupo "Cobros Guipak"

### ✅ Capa B — Bot conversacional (COMPLETADA)
- Webhook `/api/webhooks/telegram` recibe updates de Telegram
- Cliente Telegraf compartido con Capa A
- Auth via tabla `cobranza_telegram_usuarios` (Ricardo = supervisor)
- Agente Claude (claude-sonnet-4-5-20250929) con tool use
- 6 herramientas implementadas:
  1. `consultar_saldo_cliente` — aging detallado por código o nombre
  2. `estado_cobros_hoy` — resumen ad-hoc
  3. `listar_pendientes_aprobacion` — mensajes esperando aprobación
  4. `listar_promesas_vencidas` — promesas con días de retraso
  5. `historial_conversaciones_cliente` — últimas conversaciones
  6. `buscar_cliente` — búsqueda por nombre o código
- Comandos rápidos: `/start`, `/help`, `/estado`
- En grupo: solo procesa mensajes con mención `@CobrosGuipakBot` o `/comandos`
- En privado: procesa todo (con auth)
- Audit log en `cobranza_logs` (CP-10)
- ✅ Tests pasando: usuario no autorizado, grupo no autorizado, grupo autorizado con/sin mención

### ✅ Capa B+ — Bot propone correos con aprobación inline (COMPLETADA)
- Tool `proponer_correo_cliente` que genera draft y lo deja PENDIENTE en cobranza_gestiones
- Webhook detecta `<gestion-pendiente id="N"/>` y reemplaza por botones inline
- 3 acciones por botón:
  - ✅ **Aprobar y enviar** — actualiza estado, llama a `enviarGestion()` (CP-02 + CP-06 cumplidos)
  - ✏️ **Editar** — link al cola de aprobación en la app
  - ❌ **Descartar** — marca DESCARTADO con motivo
- Lógica de envío en `lib/telegram/enviar-gestion.ts` reusa `lib/email/sender.ts` de Fase 6
- Bloqueos: factura en disputa, cliente pausado, gestión ya pendiente

### ✅ Sección Plantillas (COMPLETADA)
- Tabla `cobranza_plantillas_email` con 6 plantillas iniciales:
  - 1er aviso VERDE (-3 días) — Recordatorio amigable
  - 2do aviso AMARILLO (+7 días) — Vencimiento moderado
  - 3er aviso NARANJA (+20 días) — Cobranza formal
  - 4to aviso ROJO (+35 días) — Última oportunidad
  - 5to aviso ROJO (+60 días) — Pre-legal
  - 6to aviso ROJO (+90 días) — Notificación legal
- Variables: `{{cliente}}`, `{{contacto}}`, `{{factura}}`, `{{ncf}}`, `{{monto}}`, `{{dias_vencido}}`, `{{fecha_vencimiento}}`
- 5 niveles de tono: AMIGABLE / MODERADO / FORMAL / FIRME / LEGAL
- Página `/plantillas` con tabla, drawer editor (Configuración + Contenido)
- Toggle activa/inactiva, soft-delete
- Toggle de aprobación: Manual (cola) o Auto (envío directo)
- API CRUD `/api/cobranzas/plantillas` con auth de SUPERVISOR/ADMIN
- Sidebar: nueva entrada "Plantillas"

### ✅ Manual de usuario (COMPLETADA)
- `docs/MANUAL_USUARIO.md` completo con tour por la app, bot Telegram, flujo diario sugerido, FAQ
- Estilo amigable para Daria + Ricardo

### ✅ Migration runner (BONUS)
- Endpoint `POST /api/internal/admin/migrate` ejecuta SQL idempotente
- Strip line comments antes de split por `;`
- Reporta cantidad de statements ejecutados por archivo

### ✅ Capa C — Captura interactiva de datos (COMPLETADA)
- Tool `guardar_dato_cliente` — guarda email/WhatsApp/contacto desde el bot (sin tocar Softec, CP-01)
- Tool `listar_clientes_sin_datos(faltante, limite)` — lista clientes de la cartera vencida con email o WhatsApp faltante, ordenados por saldo neto desc
- System prompt instruye al bot para preguntar el email cuando falta al generar un draft
- Bot puede completar datos proactivamente o en respuesta a preguntas del supervisor

### ✅ Capa D — Cadencias automáticas (COMPLETADA)
- `lib/queue/jobs/cadencias.ts` — worker horario evalúa cada factura contra `cobranza_cadencias`
- Protección anti-flood: primer run en factura con >30 días → fast-forward sin gestión
- Respeta CP-02 (aprobación), CP-03 (disputas), CP-15 (cubiertos por anticipo)
- `app/api/internal/cron/cadencias-horarias` — endpoint con INTERNAL_CRON_SECRET
- `app/api/cobranzas/cadencias` — CRUD completo para configurar cadencias
- `app/(dashboard)/cadencias/page.tsx` — UI con tabla, toggle activa/inactiva, "Ejecutar ahora"
- `lib/queue/bullmq.ts` — `scheduleCadenciasHorarias()` cron `0 * * * *`
- Tool bot `estado_cadencias` — el bot puede reportar estado: facturas con cadencia, último run, gestiones generadas
- Migrations: 010 (tablas), 014 (mejoras estado)

### 🔮 Capa E — Memoria semántica (DIFERIDA 2-3 meses)

### Tablas nuevas creadas (migration 010)
- `cobranza_telegram_usuarios` — mapeo telegram_user_id ↔ usuario interno + rol
- `cobranza_cadencias` — config de cadencias por segmento + 5 cadencias por defecto
- `cobranza_factura_cadencia_estado` — estado de cadencia por factura

### Variables de entorno nuevas
```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID_GRUPO_COBROS=-5138505342
TELEGRAM_USER_RICARDO=7281538057
REDIS_HOST=cobranzas-redis
REDIS_PORT=6379
INTERNAL_CRON_SECRET=...
```

### Setup local de desarrollo
- `docker-compose.local.yml` levanta MySQL (3308) + Redis (6379)
- `npm run dev` levanta Next.js
- `npm run worker` levanta BullMQ worker (cuando se necesite)
- Migration: `docker exec -i ... mysql ... < db/migrations/010_*.sql`

### Próximos pasos para continuar Fase 10
1. **Privacy mode del bot** — actualmente activo. Para que el bot vea todos los mensajes del grupo (necesario para Capa C), Ricardo debe ir a `@BotFather` → `/setprivacy` → `CobrosGuipakBot` → **Disable** → sacar y re-agregar el bot al grupo.
2. **Capa C — Datos faltantes** — función `validarDatosClienteCompletos()`, tool `pedir_dato_faltante()`.
3. **Capa D — Cadencias** — worker BullMQ horario que evalúa próximo paso por factura, UI de configuración.
4. **Worker en producción** — actualmente el cron del empuje matutino se dispara via Dokploy cron (a configurar) o llamada manual al endpoint. Falta levantar el worker BullMQ como servicio aparte en Dokploy.

---

## 🔲 Pendientes

| # | Pendiente | Estado |
|---|---|---|
| 1 | **WhatsApp (Evolution API)** — falta API Key + nombre instancia | ⏳ Ricardo decide cuándo activar |
| 2 | **Webhook CRM → Cobranzas** — el CRM debe enviar POST a `https://cobros.sguipak.com/api/webhooks/factura-escaneada` | ⏳ Desarrollo CRM |
| 3 | ~~Disputas — página funcional completa~~ | ✅ Completado (13-may-2026) |
| 4 | **N8N workflow** — generar cola de cobranza automática cada mañana | ⏳ Pendiente configuración (cadencias BullMQ lo cubre) |
| 5 | ~~Reporte diario por email — resumen automático al supervisor~~ | ✅ Completado (13-may-2026) |
| 6 | ~~Campañas/cadencias~~ | ✅ Completado (Capa D Fase 10) |
| 7 | ~~Banco(s) principal(es) de Guipak para conciliación~~ | ✅ Banco Popular confirmado |
| 8 | ~~Formato extractos bancarios reales~~ | ✅ CSV Banco Popular implementado |
| 9 | ~~Verificación end-to-end WhatsApp — ciclo completo~~ | ✅ Completado (13-may-2026) |
| 10 | ~~Worker BullMQ en producción — servicio Dokploy~~ | ✅ Completado (13-may-2026) |

## ✅ Credenciales Configuradas (Producción + Local)

| # | Servicio | Estado | Verificado |
|---|---|---|---|
| 1 | Softec MySQL (solo lectura) | ✅ 45.32.218.224 — user: softec | 636 facturas, 225 clientes, RD$13.1M |
| 2 | Claude AI (Anthropic) | ✅ sk-ant-api03-... | Responde OK |
| 3 | SMTP Email | ✅ mail.guipak.com:465 | cobros@guipak.com |
| 4 | Google Drive API | ✅ OAuth 2.0 + refresh token | 5 archivos visibles, carpeta Facturas ID configurado |
| 5 | WhatsApp (Evolution API) | ✅ Configurado y verificado | evolutionapi.sguipak.com — instancia AsistenteGuipak activa |
| 6 | Dokploy (producción) | ✅ 27 variables configuradas | cobros.sguipak.com |

---

## 📝 Log de Sesiones

### Sesión 1 — Marzo 2026
- Definición completa del proyecto y stack
- 13 módulos diseñados
- Decisión de app independiente

### Sesión 2 — Abril 2026 (temprano)
- Análisis de Softec, queries validados
- DDL de 11 tablas diseñado
- Documentación técnica completa
- **Fases 0 y 1 cerradas**

### Sesión 3 — 10 Abril 2026
- **Fase 2**: Scaffolding completo (Next.js 16, Ant Design, Docker, JWT auth, middleware)
- **Fase 3**: Cartera vencida (3 APIs, 6 componentes, filtros, mock data)
- **Fase 4**: Conciliación bancaria (parser Excel, matching, aprendizaje cuentas)
- **Fase 5**: Cola supervisión + IA (Claude AI genera mensajes, 4 tonos, 5 acciones)
- **Fase 6**: Envío real (Evolution API + SMTP, CP-02/CP-06, webhook delivery)
- **Fase 7**: Agente IA respuestas (clasificación intención, auto-acuerdos, auto-disputas)
- **Deploy**: Repo GitHub público, Dokploy Compose, cobros.sguipak.com en producción
- **6 fases completadas en una sesión**

### Sesión 4 — 11 Abril 2026 (hoy)
- **Fase 8**: Portal cliente + Documentación + Enriquecimiento de datos
  - Webhook factura-escaneada + Google Drive client
  - Portal autogestión `/portal/[token]` con tokens HMAC + expiración 30 días (CP-07)
  - Solicitud de acuerdos de pago desde el portal
  - Página /documentos con vinculación manual y por webhook CRM
  - Página /clientes con enriquecimiento progresivo y generación de tokens
- **Fase 9**: Dashboard KPIs + Reportes + Alertas
  - Dashboard dinámico con DSO, segmentos, top clientes, efectividad canales
  - 3 reportes Excel exportables (cartera, gestiones, estado de cuenta)
  - Sistema de alertas internas (promesas vencidas, escalados, pagos sin registrar)
  - Badge de alertas en Header
- **Página /configuracion**: formularios para cada integración + botones de prueba
- **Credenciales configuradas y verificadas**:
  - Softec MySQL: 636 facturas vencidas, 225 clientes, RD$13.1M cartera real
  - Claude AI: API key validada, responde OK
  - SMTP: mail.guipak.com:465 configurado
  - Google Drive: OAuth 2.0 conectado, carpeta Guipak/Facturas identificada
  - Dokploy: 27 variables de entorno en producción
- **Fix**: MySQL devuelve decimales como strings → convertir con Number() en dashboard
- **9 fases completadas — sistema en producción con datos reales**

---

## 📊 Estadísticas del Proyecto

| Métrica | Valor |
|---|---|
| Archivos TypeScript | 70+ |
| API Routes | 34 |
| Componentes React | 28+ |
| Tablas MySQL | 12 |
| Líneas de código | ~21,000 |
| Commits en GitHub | 10 |

---

## 🐛 Issues Conocidos

| # | Descripción | Prioridad | Estado |
|---|---|---|---|
| 1 | Mayoría de clientes sin email en Softec | Alta | En proceso (enriquecimiento progresivo) |
| 2 | JOIN cross-DB (disputas) resuelto en 2 pasos | Media | ✅ Implementado |
| 3 | Facturas desde 2018 en cartera | Baja | Pendiente decisión de negocio |
| 4 | `IJ_NCFNUM = 0` en facturas antiguas | Baja | Manejar en UI como "Sin NCF" |
| 5 | Unicode \u00XX en archivos — tildes | Baja | ✅ Corregido |
| 6 | Next.js 16 depreca middleware → proxy | Info | No afecta funcionalidad |

---

## 💡 Mejoras Futuras (Backlog v2.0)

- Llamadas telefónicas automatizadas (Twilio o similar)
- Pasarela de pagos en portal cliente
- Scoring crediticio por historial de pagos
- App móvil para el equipo de cobros
- Multi-empresa (otras empresas del grupo)
- Integración directa con banco via API
- Módulo de gestión de vendedores (comisiones)
- Integración con DGII para validación de NCF

---

*Versión: 5.0 — 13 Mayo 2026*

---

## Sesión 1 Mayo 2026 — Tareas y Calendario

### Entregado ✅
- **Migración 013** `cobranza_tareas`: schema con tipo/estado/prioridad/origen, asignación, auditoría de cierre. Aplicada en prod.
- **API CRUD `/api/cobranzas/tareas`**: GET con filtros (rango fecha, estado, cliente, asignado, origen), POST, GET/PUT/DELETE por ID. PUT auto-sella `completada_at` cuando estado pasa a HECHA/CANCELADA. DELETE soft.
- **UI `/tareas`**: vista calendario mensual antd (locale es_ES, dayjs es), panel "Tareas del día", banner "Atrasadas (N)", vista lista alternativa, drawer crear/editar.
- **Bot Telegram con 3 tools nuevas** (`crear_tarea`, `listar_tareas`, `marcar_tarea_hecha`). Resuelve clientes por nombre parcial automáticamente. Todas las acciones loggean en `cobranza_logs`.
- **Tabla precomputada de 14 días en system prompt** — eliminó el bug de aritmética de fechas en Claude. Validado: "el lunes" → lun 4 may, "pasado mañana" → dom 3 may, "en 3 días" → lun 4 may, "el viernes que viene" → vie 8 may.
- **Auto-tareas SEGUIMIENTO** al día siguiente de toda `fecha_prometida` en acuerdos. Helper `lib/cobranzas/auto-tareas.ts` idempotente por `(origen, origen_ref)`. Engachada en portal (`/api/portal/[token]/solicitar-acuerdo`) y procesar-respuesta IA.
- **Empuje matutino** ahora incluye secciones "📋 Tus tareas hoy (N)" y "⏰ Atrasadas (N)".

### Bugs encontrados y corregidos
| Commit | Bug | Fix |
|---|---|---|
| `be3d652` | Calendario UI mostraba tareas un día antes (cliente UTC-4 perdía día al parsear ISO Z) | Tomar primeros 10 chars del string si ya viene `YYYY-MM-DD` |
| `d7ba084` | Bot ponía "lunes 5 mayo" cuando 5 mayo era martes | Tabla precomputada de 14 días en system prompt + ConfigProvider con locale es_ES |

### Commits
- `ed8c7b9` feat(tareas): agregar sistema de tareas y calendario
- `be3d652` fix(tareas): evitar shift de timezone al renderizar fechas en calendario
- `d7ba084` fix(tareas): calendario en español + bot resuelve fechas relativas correctamente

### Próximo
**Validación end-to-end con clientes reales** — probar ciclo: cliente WA → cola → supervisor → cliente recibe → si promete pago, valida que se cree el acuerdo + auto-tarea de seguimiento + que aparezca en empuje matutino del día siguiente.

---

## Sesión 10-11 Mayo 2026 — Hallazgo del bug saldo a favor + fix CP-15

### El bug

Mientras se revisaba la cartera del 10-may, se detectó que ningún endpoint
del sistema descontaba los **recibos sin aplicar** del saldo del cliente.
Resultado: la cartera reportada al usuario, al bot y al cliente final
sumaba `IJ_TOT - IJ_TOTAPPL` por factura y nunca restaba el saldo a favor
que el cliente ya había entregado (recibos en `ijnl_pay` que no estaban
aplicados a facturas via `irjnl`).

### Dimensión global (validada contra Softec producción 10-may-2026)

| Métrica | Valor |
|---|---|
| Cartera bruta | $31.45M |
| Saldo a favor global | $8.43M |
| Saldo a favor aplicable (limitado al pendiente de cada cliente) | $3.94M |
| Cartera neta cobrable | $27.51M |
| Sobrecobro reportado al usuario | **14.6%** |
| Clientes con saldo a favor ≥ pendiente bruto | **58** (esperado 57, tolerancia ±3) |

Top casos: SENADO (`CG0029`) cubierto ($263k a favor vs $187k pendiente);
Universidad Católica (`0000997`) con $1.31M a favor que reducía
parcialmente su pendiente; Tribunal Constitucional, MICM, `SR0017` con
anticipos significativos. Para el operador, ver casos completos en
`CRITICAL_POINTS.md` CP-15.

### Decisión de producto

**Opción B (confirmada por el usuario):** excluir de la cola de cobranza a
los 58 clientes con saldo a favor ≥ pendiente; sus facturas quedan
visibles en cartera, marcadas con el badge "Cubierta por anticipo". La
acción correcta para estos clientes no es cobrar — es que contabilidad
aplique el anticipo. El bot bloquea automáticamente la generación de
drafts de correo para ellos.

### Helper central

`lib/cobranzas/saldo-favor.ts` — 3 exports:
- `obtenerSaldoAFavorPorCliente(codigos?)` — `Map<codigo, monto>`.
- `ajustarSaldoCliente(saldoBruto, saldoFavor)` — calcula neto / cubierto.
- `ajustarSaldoClientes(pendientesPorCliente)` — atajo combinado.

Apoyado en CP-13 (JOIN recibo↔aplicación por `IR_PLOCAL/IR_PTYPDOC/IR_RECNUM`, no por `IR_F*`) y CP-14 (no usar `IJ_ONLPAID` ni desglosados; sumar `IR_AMTPAID` agregado).

### Los 8 commits del fix

| # | Commit | Descripción |
|---|---|---|
| 1 | `8db0eed` | `feat(cobranzas): helper saldo-favor por cliente (CP-15)` — helper + tipos + smoke `test-saldo-favor.ts` (22 asserts). |
| 2 | `336808c` | `fix(cobranzas-api): aplicar saldo a favor en endpoints de cartera y dashboard (CP-15)` — 6 endpoints (cartera-vencida, resumen-segmentos, dashboard, clientes, alertas, cartera-excel). |
| 3 | `8602b97` | `fix(portal): mostrar saldo neto y mensaje claro cuando hay anticipos (CP-15)` — portal cliente backend con mensaje pre-formateado. |
| 4 | `291eb6c` | `fix(cobranzas-cola): excluir clientes con saldo a favor que cubre pendiente (CP-15)` — opción B en `/api/cobranzas/generar-cola`. |
| 5 | `4fe33a3` | `fix(telegram): bot y empuje matutino reportan saldo neto, bloquean cobranza a cubiertos (CP-15)` — 3 tools del bot + bloqueo en `proponer_correo_cliente` + empuje matutino. Smoke `test-saldo-favor-telegram.ts` (10 asserts). |
| 6 | `92be701` | `fix(reportes): estado-cuenta Excel incluye saldo a favor y neto (CP-15)` — 3 columnas nuevas + segunda hoja "Resumen". |
| 7 | `ed63e2c` | `feat(ui-cobranzas): mostrar saldo neto y badge cubierto por anticipo (CP-15)` — dashboard 3 cards, ResumenCards, tabla cartera, lista clientes. |
| 8 | `d7bcaee` | `feat(portal-ui): vista clara con bruto/a favor/neto y mensaje (CP-15)` — portal UI con Alert + 4 cards. |

### Pantallas tocadas (UI)

| Superficie | Cambio |
|---|---|
| Dashboard `/` | Fila superior con 3 cards (bruta / a favor / neta). KPIs secundarios bajan a segunda fila. Top 10 ordenado por saldo neto. |
| `/cartera` + `ResumenCards` | Fila opcional con totales globales si hay anticipos; tabla con 2 columnas nuevas (a favor, neto) y badge "Cubierta por anticipo". |
| `/clientes` | Columna "Saldo Neto" como primaria; sorter default desc; tag bajo el monto cuando está cubierto. |
| Portal `/portal/[token]` | Alert success/info; resumen de 2 a 4 cards cuando hay anticipo. |

### 14 superficies del backend cubiertas

(Lista completa en CP-15 de `CRITICAL_POINTS.md`.) Endpoints HTTP: 9.
Tools del bot: 4. Job de empuje matutino: 1.

### Limitación de validación visual

El preview server arrancó sin errores (`Next.js Ready in 15.8s`, compiló
`/login` en 33.7s — Issue #7 FS lento confirmado). Las pantallas internas
están detrás del login y no había credenciales en el entorno de la
sesión; el portal requiere un token HMAC del que tampoco hay datos. La
verificación visual de los nuevos componentes con datos reales queda
para el usuario en su entorno local (ver `PENDIENTE_USUARIO.md`).

La lógica está cubierta por:
- `tsc --noEmit` limpio después de cada commit.
- 32 asserts agregados entre los dos smoke tests contra Softec real.
- Los datos crudos del bug (bruto $31.45M, a favor $8.43M, neto $27.51M,
  58 cubiertos, sobrecobro 14.6%) reproducidos por el smoke.

### Próximo

Pendiente del usuario después del próximo deploy local con sesión válida:
validar las 4 pantallas, confirmar que la cola excluye a los 58 clientes
cubiertos, confirmar que el empuje matutino muestra neto, y verificar el
portal con un cliente cubierto. Detalle completo en
`PENDIENTE_USUARIO.md`.

---

## Sesión 11-Mayo-2026 (sesión 2) — Mejoras UX + Prompt editable + Envío manual facturas

### Completado

#### Memoria Capa 1 + WhatsApp + PDF (de sesión anterior, desplegado)
- Tabla `cobranza_memoria_cliente` — memoria estructurada por cliente
- Bot tools: `consultar_memoria_cliente`, `guardar_memoria_cliente`
- `proponer_whatsapp_cliente` — propuestas WhatsApp con misma cola de aprobación
- `downloadPdfBuffer()` — descarga PDF de Google Drive
- Adjunto PDF automático en emails de cobranza (best-effort)
- Link PDF en mensajes WhatsApp
- Inyección de memoria en refinamiento de mensajes

#### Widget Asistente en Dashboard
- Componente `AsistenteChat.tsx` — chat flotante bottom-right
- Misma IA que el bot de Telegram (reusa `procesarMensajeBot`)
- Cards de gestiones pendientes con botones Aprobar/Descartar inline
- Auto-carga pendientes al abrir, badge con contador
- Acciones rápidas: Estado, Pendientes, Limpiar
- API: `POST /api/cobranzas/asistente/chat`

#### Correcciones UI
- Widget renombrado "Simpre" → **"Asistente"**
- Icono cambiado `RobotOutlined` → **`MessageOutlined`** (chat)
- Reportes: búsqueda Estado de Cuenta ahora acepta **nombre o código** (AutoComplete con API)

#### Prompt del agente editable desde Configuración
- Tabla `cobranza_configuracion` — key-value para settings persistentes
- API: `GET/PUT /api/cobranzas/configuracion/prompt` (ADMIN only)
- Sección "Prompt del Agente (IA)" en página Configuración
- Editor monoespaciado con contador de caracteres
- Botón "Resetear a predeterminado"
- `agent.ts` lee prompt desde DB, fallback al hardcoded

#### Envío manual de facturas PDF (Feature C)
- Botón "Enviar" en tabla de Gestión Documental
- Modal con selector Email/WhatsApp + destinatario
- API: `POST /api/cobranzas/documentos/enviar`
- Email: descarga PDF de Drive y lo adjunta
- WhatsApp: envía mensaje con link al PDF

#### Migraciones ejecutadas en producción
- `016_configuracion.sql` — tabla `cobranza_configuracion` ✅
- `015_memoria_cliente.sql` — tabla `cobranza_memoria_cliente` ✅

### Archivos nuevos/modificados
- `lib/db/configuracion.ts` — helper getConfig/setConfig
- `app/api/cobranzas/configuracion/prompt/route.ts` — API prompt
- `app/api/cobranzas/documentos/enviar/route.ts` — API envío manual
- `app/api/cobranzas/asistente/chat/route.ts` — API chat web
- `components/asistente/AsistenteChat.tsx` — widget chat
- `lib/telegram/draft-whatsapp.ts` — propuestas WhatsApp
- `lib/telegram/agent.ts` — prompt dinámico desde DB
- `lib/telegram/tools.ts` — 3 tools nuevos (WhatsApp, memoria)
- `lib/telegram/enviar-gestion.ts` — envío WhatsApp + PDF adjunto
- `lib/drive/client.ts` — downloadPdfBuffer()
- `lib/email/sender.ts` — EmailAttachment support
- `app/(dashboard)/configuracion/page.tsx` — sección prompt
- `app/(dashboard)/documentos/page.tsx` — botón enviar
- `app/(dashboard)/reportes/page.tsx` — AutoComplete nombre
- `app/(dashboard)/layout.tsx` — AsistenteChat integrado
- `db/migrations/015_memoria_cliente.sql`
- `db/migrations/016_configuracion.sql`

---

## Sesión 12-Mayo-2026 — Conciliación mejorada + Multi-recibo + Seguimiento Telegram

### Completado

#### Conciliación bancaria — eliminación selectiva
- DELETE `/api/conciliacion/resultados` ahora filtra por `archivo_origen` (no borra toda la tabla)
- UI: dropdown de archivos cargados con cantidad de registros
- Popconfirm de seguridad antes de eliminar

#### Multi-recibo (libramientos del gobierno)
- Algoritmo subset-sum con backtracking para encontrar combinaciones de recibos RC que sumen al monto del banco
- Tabla hijo `cobranza_conciliacion_detalle` para registrar el desglose (FK a conciliacion con ON DELETE CASCADE)
- Migración 018 aplicada en producción
- UI: DrawerTransacción muestra tabla de desglose; TablaConciliación muestra tag "N clientes" en columna cliente
- Verificado: depósito RD$183,472.36 del gobierno correctamente dividido entre 2 clientes

#### Seguimiento de DESCONOCIDO y CHEQUE_DEVUELTO
- `lib/conciliacion/seguimiento.ts` — 4 funciones:
  - `crearTareasConciliacion()`: crea tareas idempotentes para cada DESCONOCIDO (MEDIA) y CHEQUE_DEVUELTO (ALTA)
  - `notificarConciliacionDesdeBD()`: notificación Telegram con estadísticas reales
  - `verificarDesconocidos()`: re-corre matcher, auto-concilia + cierra tarea + notifica
  - `recordatorioChequesDevueltos()`: recordatorio cada 3 días para cheques sin resolver
- Migración 019: ENUM expandido en `cobranza_tareas` (tipo += CHEQUE_DEVUELTO, origen += CONCILIACION)
- Cron: `POST /api/internal/cron/conciliacion-seguimiento` (L-V 10am RD = `0 14 * * 1-5` UTC)
- Configurado en Dokploy

#### Tool del agente Telegram
- `estado_conciliacion` — consulta estadísticas por estado, tareas pendientes, últimas 3 cargas
- System prompt del agente actualizado con sección CONCILIACIÓN BANCARIA

#### Fix /tareas
- CHEQUE_DEVUELTO y CONCILIACION agregados a tipos y orígenes en page.tsx

### Resultados verificados en producción
- 55 conciliadas, 6 desconocidas, 3 cheques devueltos
- 9 tareas de seguimiento creadas automáticamente
- Notificación Telegram recibida en grupo "Cobros Guipak"
- Página de tareas muestra todas las tareas de conciliación

### Archivos nuevos/modificados
- `lib/conciliacion/seguimiento.ts` — NEW (~294 líneas)
- `app/api/internal/cron/conciliacion-seguimiento/route.ts` — NEW
- `app/api/conciliacion/resultados/route.ts` — DELETE selectivo + lista archivos
- `app/api/conciliacion/cargar/route.ts` — multi-recibo + seguimiento
- `app/(dashboard)/conciliacion/page.tsx` — dropdown archivos, Popconfirm
- `components/conciliacion/DrawerTransaccion.tsx` — desglose libramiento
- `components/conciliacion/TablaConciliacion.tsx` — tag multi-cliente
- `components/conciliacion/CargadorExtracto.tsx` — acepta .txt
- `lib/conciliacion/matcher.ts` — subset-sum + exports
- `lib/types/conciliacion.ts` — ConciliacionDetalle, es_multi
- `lib/telegram/tools.ts` — tool estado_conciliacion
- `lib/telegram/agent.ts` — sección conciliación en prompt
- `app/(dashboard)/tareas/page.tsx` — CHEQUE_DEVUELTO + CONCILIACION
- `db/migrations/017_conciliacion_cheque_devuelto.sql`
- `db/migrations/018_conciliacion_detalle.sql`
- `db/migrations/019_tareas_conciliacion.sql`

---

## Sesión 13-Mayo-2026 — Disputas + WhatsApp + Worker + Reporte Diario

### Completado

#### Módulo de Disputas (funcional completo)
- **`app/api/cobranzas/disputas/route.ts`** — GET con filtros (estado, búsqueda, rango fechas), batch lookup de nombres en Softec `v_cobr_icust`; POST crea disputa + log CP-08
- **`app/api/cobranzas/disputas/[id]/route.ts`** — GET detalle completo (disputa + cliente Softec + factura Softec + últimas 50 entradas del log); PUT transiciones de estado con máquina de estados: ABIERTA→EN_REVISION/ANULADA, EN_REVISION→RESUELTA(requiere `resolucion`)/ANULADA, RESUELTA/ANULADA inmutables
- **`app/(dashboard)/disputas/page.tsx`** — reemplaza placeholder con: 4 cards de estado clickeables como filtro, tabla con search + selector estado + DateRangePicker, Drawer con Descriptions + Timeline, DrawerFooter contextual (botones según estado actual), Modal resolución/anulación, Modal nueva disputa con alerta CP-03

#### WhatsApp verificado
- API Key global de Evolution API configurada en Dokploy (instancia AsistenteGuipak)
- Ciclo completo verificado: sendText → delivery → read → webhook → procesarMensajeBot → respuesta IA
- Normalización de teléfonos RD (10 dígitos → `1809…@s.whatsapp.net`)
- Manejo de formato LID para números con privacidad Meta

#### Worker BullMQ como servicio Dokploy
- **`Dockerfile.worker`** — imagen Node 20 Alpine con tsx, sin Next.js standalone; `CMD ["npm", "run", "worker"]`
- **`docker-compose.yml`** — servicio `cobranzas-worker` con `depends_on: cobranzas-redis`
- **`lib/queue/bullmq.ts`** — `scheduleReporteDiario()` cron `30 12 * * 1-5` (8:30 AM AST L-V)
- **`lib/queue/worker.ts`** — handler para `JOBS.REPORTE_DIARIO`

#### Reporte diario por email
- **`lib/reportes/reporte-diario.ts`** — HTML completo: header, cartera por segmento con barras de progreso, 6 tipos de alerta, top 8 clientes por saldo neto, stats de gestiones, CTA a la app; asunto incluye ⚠️ cuando hay alertas urgentes
- **`lib/email/sender.ts`** — 5to parámetro opcional `htmlBody?: string` (retrocompatible con 3 llamadores existentes)
- **`app/api/internal/cron/reporte-diario/route.ts`** — POST autenticado con `x-cron-secret: INTERNAL_CRON_SECRET`; llamar via Dokploy cron `0 12 * * 1-5`

### Pruebas locales (todos pasaron ✅)
| Test | Resultado |
|---|---|
| `GET /api/cobranzas/disputas` | ✅ `{"disputas":[],"por_estado":{}}` |
| `POST /api/cobranzas/disputas` | ✅ `{"ok":true,"id":1}` |
| `GET /api/cobranzas/disputas/1` | ✅ Detalle + cliente Softec (MAWREN COMERCIAL) + log |
| `PUT` ABIERTA→EN_REVISION | ✅ |
| `PUT` EN_REVISION→RESUELTA | ✅ (requiere `resolucion`) |
| `PUT` RESUELTA→cualquier | ✅ Rechazado 400 |
| `POST /api/internal/cron/reporte-diario` | ✅ Llega a SMTP, falla por credenciales dev (code path OK) |
| `npm run worker` (con REDIS_HOST=localhost) | ✅ 3 jobs BullMQ programados |
| TypeScript `tsc --noEmit` | ✅ 0 errores |

### Pendiente en Dokploy (configuración manual)
- Agregar env var `REPORT_EMAIL=<email_supervisor>` (si distinto de `SMTP_USER`)
- Configurar cron HTTP Dokploy: `POST https://cobros.sguipak.com/api/internal/cron/reporte-diario` schedule `0 12 * * 1-5` header `x-cron-secret`
- Verificar que `cobranzas-worker` sube correctamente en el próximo deploy

### Archivos nuevos/modificados
- `app/api/cobranzas/disputas/route.ts` — NEW
- `app/api/cobranzas/disputas/[id]/route.ts` — NEW
- `app/(dashboard)/disputas/page.tsx` — reemplazó placeholder
- `app/api/internal/cron/reporte-diario/route.ts` — NEW
- `lib/reportes/reporte-diario.ts` — NEW
- `lib/email/sender.ts` — 5to param htmlBody opcional
- `lib/queue/bullmq.ts` — REPORTE_DIARIO job + scheduleReporteDiario()
- `lib/queue/worker.ts` — handler REPORTE_DIARIO
- `Dockerfile.worker` — NEW
- `docker-compose.yml` — servicio cobranzas-worker

---

## Sesión 13-Mayo-2026 (sesión 2) — Supervisor IA con memoria de elefante

### Completado

#### Arquitectura de 4 Capas para inteligencia de clientes
- **Capa 1 — Redis sesión:** estado por chat con TTL 4h (`lib/redis/client.ts`, `lib/telegram/session.ts`)
- **Capa 2 — Tabla pre-computada:** `cobranza_cliente_inteligencia` con score 0-100, aging buckets, tendencia, cumplimiento promesas, acciones recomendadas
- **Capa 3 — Algoritmo de scoring:** job BullMQ nocturno 1AM AST, reglas puras sin IA (`lib/queue/jobs/inteligencia-clientes.ts`)
- **Capa 4 — Claude comunica:** lee datos pre-computados, nunca calcula
- Migración 021 aplicada en producción — 271 clientes procesados, 0 errores

#### Fórmula del Score (0-100)
- Mora promedio: 0-35 pts (>90d=35, >60d=25, >30d=15, >15d=5)
- Tendencia vs anterior: 0-20 pts
- Cumplimiento promesas 90d: 0-30 pts (<30%=30, <50%=20, <70%=10)
- Volumen deuda neta: 0-15 pts (>500k=15, >200k=10, >50k=5)

#### Niveles: VERDE (0-30), AMARILLO (31-45), ROJO (46-75), CRITICO (76-100)
- Cada nivel tiene acción recomendada para crédito, ventas y cobranza

#### Tools del agente nuevos
- `obtener_perfil_riesgo_cliente` — perfil completo desde tabla inteligencia
- `analizar_riesgo_cartera` — reporte portafolio: distribución, críticos, empeorando

#### Correos consolidados
- `proponerCorreoCliente()` reescrita — ya no genera correo por 1 factura sino correo consolidado cubriendo TODA la deuda del cliente (LIMIT 50 facturas)
- Claude genera email con detalle de facturas, saldo neto, tono por segmento, firma departamental

#### Fix códigos alfanuméricos (ej. RV0003)
- Búsqueda de clientes ahora usa `(c.IC_NAME LIKE ? OR c.IC_CODE = ?)` para términos no numéricos
- Corregido en: `draft-correo.ts`, `draft-whatsapp.ts`, `tools.ts`

#### Conversaciones page — nombre + búsqueda
- API: `LEFT JOIN cobranza_cliente_inteligencia` para obtener `nombre_cliente`
- ListaConversaciones: barra de búsqueda por nombre/código, muestra ambos
- Chat title: `código · nombre` del cliente seleccionado

#### Fix envío email desde Telegram
- `enviar-gestion.ts` ahora valida `result.status === 'failed'` antes de marcar ENVIADO
- Antes: siempre marcaba como ENVIADO sin importar si SMTP fallaba

### Bugs encontrados y corregidos
| Bug | Fix |
|---|---|
| `proponerCorreoCliente` devolvía "sin facturas" para código RV0003 | Búsqueda con `IC_NAME LIKE ? OR IC_CODE = ?` |
| Correo de cobranza cubría solo 1 factura ($1,548) en vez de toda la deuda ($61,764) | Reescritura: query sin LIMIT 1, correo consolidado |
| Endpoint inteligencia-clientes devolvía 401 | Usaba CRON_SECRET en vez de INTERNAL_CRON_SECRET |
| Conversaciones vacías tras agregar LEFT JOIN | `GROUP BY c.codigo_cliente, ci.nombre_cliente` → solo `GROUP BY c.codigo_cliente` |
| Email "enviado" sin realmente enviarse | Validar `result.status` antes de marcar ENVIADO en BD |

### Archivos nuevos
- `db/migrations/021_cliente_inteligencia.sql`
- `lib/redis/client.ts`
- `lib/telegram/session.ts`
- `lib/queue/jobs/inteligencia-clientes.ts`
- `app/api/internal/cron/inteligencia-clientes/route.ts`

### Archivos modificados
- `lib/telegram/tools.ts` — 2 tools nuevos + fix búsqueda alfanumérica
- `lib/telegram/agent.ts` — sesión Redis + perfil riesgo en system prompt
- `lib/telegram/draft-correo.ts` — correo consolidado + fix alfanumérico
- `lib/telegram/draft-whatsapp.ts` — fix alfanumérico
- `lib/telegram/enviar-gestion.ts` — validar resultado SMTP
- `lib/queue/bullmq.ts` — job inteligencia-clientes programado
- `lib/queue/worker.ts` — handler inteligencia-clientes
- `app/api/cobranzas/conversaciones/route.ts` — LEFT JOIN + fix GROUP BY
- `components/conversaciones/ListaConversaciones.tsx` — búsqueda + nombre
- `app/(dashboard)/conversaciones/page.tsx` — nombre_cliente en título

### Pendiente
- **SMTP email**: credenciales configuradas en Dokploy (mail.guipak.com:465, cobros@guipak.com, CobrosGuipak2022) — contraseña actualizada en cPanel, por verificar entrega real
- **Verificar Conversaciones page** post-deploy con datos reales

## Sesión 12-Junio-2026 — Fase 3 Etapa 1 COMPLETADA (scoping multi-tenant)

### Lotes de scoping empresa_id (cierran los ~108 statements pendientes)
| Lote | Commit | Contenido |
|---|---|---|
| tareas | 7f076d5 | rutas /tareas, tareas espejo en 7 jobs, conciliación, bot |
| clientes | d0c0e06 | enriquecidos, contactos (empresaId param), inteligencia |
| documentos | 9ef62ca | rutas, webhook CRM, scan-drive, portal, drafts |
| plantillas+cadencias | 4a7229b | seleccionar.ts con empresaId param, rutas, job, estado |
| resto | e6d36f8 | portal tokens, configuracion (param), memoria, alertas, telegram, logs |

### Cierre de etapa
- **Migración 031** (3298436): UNIQUE compuestos `(empresa_id, clave natural)` en
  cadencias, factura_cadencia_estado (PK), cliente_inteligencia, clientes_enriquecidos,
  memoria_cliente, telegram_memoria_equipo, facturas_documentos, cuentas_aprendizaje,
  configuracion (PK). `portal_tokens.token` y `telegram_usuarios.telegram_user_id`
  se quedan globales a propósito. Aplicada en producción sin errores.
- **Migración 032** (cdedd87): empresa 2 de prueba + usuario `prueba@empresa2.test`.
- **Guards ERP** (ad75647): rutas que leen Softec (dashboard, clientes, cartera-vencida,
  resumen-segmentos, estado-cuenta x2, reportes excel x2, generar-cola,
  verificar-depositos, alertas) devuelven vacío para empresa != 1 hasta Etapa 2 (lib/erp).
- **Test de aislamiento**: `scripts/test-aislamiento-empresa2.mjs` — login empresa 2 y
  verifica 0 registros en tareas/cola/conversaciones/disputas/documentos/plantillas/
  cadencias/clientes/conciliación/cartera/segmentos/alertas + dashboard en cero.

### Bugs de producción encontrados por el test (y corregidos en ad75647)
| Bug | Causa | Fix |
|---|---|---|
| GET /api/cobranzas/documentos 500 | alias `manual` es palabra reservada en el MySQL de producción | backticks al alias |
| GET /api/cobranzas/conversaciones (resumen) 500 desde fb1a70d | Illegal mix of collations: inteligencia (utf8mb4_unicode_ci) vs conversaciones (utf8mb4_0900_ai_ci) | COLLATE explícito en el JOIN |
| supervisor-promesas: mismo mix de collations + join sin empresa | ídem | COLLATE + `i.empresa_id = 1` |
| Resumen de conversaciones 500 tras la migración 031 | el UNIQUE compuesto rompió la dependencia funcional de `ci.nombre_cliente` con only_full_group_by | `MAX(ci.nombre_cliente)` (44ead33) |

### Pendiente (Etapa 2)
- Adaptador CSV + `adaptadorParaEmpresa` leyendo `empresas.erp_tipo`; reemplazar los
  guards `!== EMPRESA_GUIPAK` de las rutas Softec por el adaptador.
- Desactivar usuario de prueba cuando ya no haga falta:
  `UPDATE usuarios SET activo=0 WHERE empresa_id=2;`

## Sesión 12-Junio-2026 (sesión 2) — Fase 3 Etapa 2: adaptador CSV funcionando

### Hecho (commit a8501a9 + migración 033 aplicada)
- **Staging de cartera importada**: `erp_cartera_facturas` + `erp_cartera_clientes`
  (UNIQUE compuestos por empresa, collation 0900_ai_ci para evitar el mix).
- **csvAdapter** (`lib/erp/csv.ts`): sirve el snapshot importado en el modelo
  canónico. CP-06 degradado: `saldoFactura` = último saldo importado.
- **adaptadorParaEmpresa** ahora es async: lee `empresas.erp_tipo` (cache 60s,
  fail-safe Guipak→Softec) y `invalidarCacheErp()` tras importar.
- **POST /api/erp/importar-cartera**: multipart (facturas CSV + clientes CSV
  opcional), parser con comillas/BOM/;, fechas YYYY-MM-DD o DD/MM/YYYY,
  validación fila a fila, rechaza >20% filas malas, reemplaza el snapshot.
- **lib/erp/compat.ts**: canónico → `FacturaVencida` (CP-03 disputas incluido)
  para que las empresas CSV usen las mismas páginas sin tocar frontend.
- **Rutas migradas al adaptador** (Guipak/Softec intacto): cartera-vencida,
  resumen-segmentos, clientes, dashboard. CP-15 y DSO siguen solo-Softec.
- **Test E2E**: `scripts/test-importar-cartera-empresa2.mjs` → FLUJO CSV OK
  (14/14: importación, segmentación ROJO/AMARILLO/VERDE, cruce de contactos,
  agregados de clientes y dashboard).

### Pendiente Etapa 2 (próximas sesiones)
- Rutas restantes para modo CSV: estado-cuenta x2, reportes excel x2,
  generar-cola (hoy devuelven vacío/409 vía guard `EMPRESA_GUIPAK`).
- Mover las ~83 queries `softecQuery` de rutas/jobs Guipak detrás del
  softecAdapter (mecánico; los jobs pueden esperar a la Etapa 4).
- Frontend: dejar de usar nombres `IJ_*` (migrar tipos al modelo canónico).
- UI de importación de cartera (página /configuracion o /cartera para subir
  el CSV; hoy solo API).

## Sesión 12-Junio-2026 (sesión 3) — Etapa 2: ciclo completo para empresas CSV

### Hecho (commit 289f4d6)
- **generar-cola en modo CSV**: empresas sin ERP generan gestiones con IA desde
  su cartera importada (mismo pipeline: CP-03 disputas, gestiones activas,
  pausados; CP-15 sigue solo-Softec). Verificado en producción: 2 gestiones
  PENDIENTES generadas por Claude para la empresa 2 (ROJO canal AMBOS).
- **estado-cuenta-cliente** y **reportes Excel** (cartera + estado de cuenta)
  por adaptador ERP. `estado-cuenta/[cliente]` (pagos) conserva el guard: el
  snapshot CSV no trae historial de pagos.
- **UI de importación**: `/configuracion/importar-cartera` (antd) — facturas.csv
  requerido + clientes.csv opcional, formato documentado en pantalla, detalle
  de filas con error.

### El ciclo SaaS completo ya funciona para un tenant CSV
importar CSV → cartera/dashboard/clientes/segmentos → generar cola con IA →
cola de aprobación. La regla de oro intacta: nada se envía sin aprobación.

### Pendiente Etapa 2
- Mover las ~83 `softecQuery` de rutas/jobs Guipak detrás del softecAdapter.
- Frontend sin `IJ_*` (tipos canónicos).
- Link de navegación a importar-cartera (hoy solo por URL; encaja con la
  Etapa 3 cuando haya configuración por empresa visible en la UI).
- Envío real para tenants CSV depende de Etapa 3 (SMTP/WhatsApp por empresa).
