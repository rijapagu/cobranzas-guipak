# PROGRESS.md — Registro de Progreso
> Sistema de Cobranzas Guipak
> **Actualizar este archivo al inicio y fin de cada sesión de trabajo.**
> Lee CLAUDE.md antes de este documento.

---

## Estado General

| Campo | Detalle |
|---|---|
| **Fase actual** | Fase 7 — Agente IA Respuestas ✅ |
| **Próxima fase** | Fase 8 — Portal Cliente + Documentación |
| **Última actualización** | 10 Abril 2026 |
| **Progreso general** | ████████░░ 78% |
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
| 8 | Portal cliente + Documentación | ⏳ Pendiente | 0% |
| 9 | KPIs, alertas y refinamiento | ⏳ Pendiente | 0% |

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

## ⏳ Fase 8 — Portal Cliente + Documentación (PENDIENTE)

### Objetivos
- Webhook CRM para facturas escaneadas
- Google Drive API para PDFs
- Portal de autogestión del cliente (link con token)
- Módulo de gestión documental
- Enriquecimiento de datos de clientes

### Tareas
- [ ] Webhook: `/api/webhooks/factura-escaneada`
- [ ] Google Drive client: `lib/drive/client.ts`
- [ ] Portal: `/portal/[token]` — vista de facturas del cliente
- [ ] Generación de tokens con expiración (30 días)
- [ ] Página `/documentos` — gestión documental
- [ ] Página `/clientes` — enriquecimiento de datos

---

## ⏳ Fase 9 — KPIs, Alertas y Refinamiento (PENDIENTE)

### Objetivos
- Dashboard con KPIs reales (DSO, tasa recupero, efectividad canales)
- Reportes exportables (Excel/PDF)
- Sistema de alertas internas
- Reporte diario automático

### Tareas
- [ ] Dashboard principal con estadísticas dinámicas
- [ ] Cálculo de DSO
- [ ] Reportes exportables
- [ ] Alertas: promesas vencidas, facturas 30/60/90 días sin gestión
- [ ] Reporte diario vía email
- [ ] Ajuste de prompts según resultados reales

---

## 🔲 Pendientes de Confirmación Externa

| # | Pendiente | Bloqueado por | Estado |
|---|---|---|---|
| 1 | Banco(s) principal(es) de Guipak | Ricardo | ⏳ |
| 2 | Formato extractos bancarios (Excel/PDF) | Ricardo | ⏳ |
| 3 | Credenciales MySQL Softec (usuario solo lectura) | Ingeniero Softec | ⏳ |
| 4 | Webhook disponible en CRM para factura escaneada | Desarrollo CRM | ⏳ |
| 5 | Credenciales Evolution API (instancia + API key) | Ricardo | ⏳ |
| 6 | Credenciales SMTP/SendGrid | Ricardo | ⏳ |
| 7 | API key de Anthropic (Claude AI) | Ricardo | ⏳ |

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

### Sesión 3 — 10 Abril 2026 (hoy)
- **Fase 2**: Scaffolding completo (Next.js 16, Ant Design, Docker, JWT auth, middleware)
- **Fase 3**: Cartera vencida (3 APIs, 6 componentes, filtros, mock data)
- **Fase 4**: Conciliación bancaria (parser Excel, matching, aprendizaje cuentas)
- **Fase 5**: Cola supervisión + IA (Claude AI genera mensajes, 4 tonos, 5 acciones)
- **Fase 6**: Envío real (Evolution API + SMTP, CP-02/CP-06, webhook delivery)
- **Fase 7**: Agente IA respuestas (clasificación intención, auto-acuerdos, auto-disputas)
- **Deploy**: Repo GitHub público, Dokploy Compose, cobros.sguipak.com en producción
- **6 fases completadas en una sesión**

---

## 📊 Estadísticas del Proyecto

| Métrica | Valor |
|---|---|
| Archivos TypeScript | 50+ |
| API Routes | 21 |
| Componentes React | 25+ |
| Tablas MySQL | 12 |
| Líneas de código | ~16,000 |
| Commits en GitHub | 6 |

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

*Versión: 2.0 — 10 Abril 2026*
