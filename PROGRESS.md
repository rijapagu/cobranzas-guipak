# PROGRESS.md — Registro de Progreso
> Sistema de Cobranzas Guipak
> **Actualizar este archivo al inicio y fin de cada sesión de trabajo.**
> Lee CLAUDE.md antes de este documento.

---

## Estado General

| Campo | Detalle |
|---|---|
| **Fase actual** | Fase 10 — Agente Proactivo Telegram (Capa A + B + Plantillas + Tareas ✅) |
| **Próxima fase** | Validación end-to-end con clientes reales + Capa C/D |
| **Última actualización** | 1 Mayo 2026 |
| **Progreso general** | ██████████ 98% |
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
| 10 | Agente Proactivo Telegram (Capa A + B + Plantillas + Tareas) | 🟢 En curso | 85% |

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

### ⏳ Capa C — Captura interactiva de datos (PENDIENTE)
### ⏳ Capa D — Cadencias automáticas (PENDIENTE)
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
| 3 | **Disputas** — página funcional completa (actualmente placeholder) | ⏳ Pendiente desarrollo |
| 4 | **N8N workflow** — generar cola de cobranza automática cada mañana | ⏳ Pendiente configuración |
| 5 | **Reporte diario por email** — resumen automático al supervisor | ⏳ Pendiente desarrollo |
| 6 | **Campañas/cadencias** — contacto cada X días por segmento | ⏳ Pendiente desarrollo |
| 7 | Banco(s) principal(es) de Guipak para conciliación | ⏳ Ricardo |
| 8 | Formato extractos bancarios reales (Excel/PDF) | ⏳ Ricardo |

## ✅ Credenciales Configuradas (Producción + Local)

| # | Servicio | Estado | Verificado |
|---|---|---|---|
| 1 | Softec MySQL (solo lectura) | ✅ 45.32.218.224 — user: softec | 636 facturas, 225 clientes, RD$13.1M |
| 2 | Claude AI (Anthropic) | ✅ sk-ant-api03-... | Responde OK |
| 3 | SMTP Email | ✅ mail.guipak.com:465 | cobros@guipak.com |
| 4 | Google Drive API | ✅ OAuth 2.0 + refresh token | 5 archivos visibles, carpeta Facturas ID configurado |
| 5 | WhatsApp (Evolution API) | ⏳ URL configurada, falta API Key | evolutionapi.sguipak.com |
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

*Versión: 4.0 — 11 Abril 2026*

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
