# PROGRESS.md — Registro de Progreso
> Sistema de Cobranzas Guipak
> **Actualizar este archivo al inicio y fin de cada sesión de trabajo.**
> Lee CLAUDE.md antes de este documento.

---

## Estado General

| Campo | Detalle |
|---|---|
| **Fase actual** | Fase 9 — KPIs, Alertas y Reportes ✅ |
| **Próxima fase** | Refinamiento + Credenciales reales |
| **Última actualización** | 11 Abril 2026 |
| **Progreso general** | ██████████ 95% |
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
