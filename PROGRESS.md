# PROGRESS.md — Registro de Progreso
> Sistema de Cobranzas Guipak
> **Actualizar este archivo al inicio y fin de cada sesión de trabajo.**
> Lee CLAUDE.md antes de este documento.

---

## Estado General

| Campo | Detalle |
|---|---|
| **Fase actual** | Fase 1 — Fundación de Datos ✅ |
| **Próxima fase** | Fase 2 — Scaffolding de la App |
| **Última actualización** | Abril 2026 |
| **Progreso general** | ███░░░░░░░ 20% |

---

## Resumen de Fases

| # | Fase | Estado | % |
|---|---|---|---|
| 0 | Diseño y especificaciones | ✅ Completada | 100% |
| 1 | Fundación de datos (Softec) | ✅ Completada | 100% |
| 2 | Scaffolding app + Docker + Auth | ⏳ Pendiente | 0% |
| 3 | Módulo cartera vencida (UI) | ⏳ Pendiente | 0% |
| 4 | Conciliación bancaria | ⏳ Pendiente | 0% |
| 5 | Cola de supervisión + IA | ⏳ Pendiente | 0% |
| 6 | Envío real (WhatsApp + Email) | ⏳ Pendiente | 0% |
| 7 | Agente IA respuestas entrantes | ⏳ Pendiente | 0% |
| 8 | Portal cliente + Documentación | ⏳ Pendiente | 0% |
| 9 | KPIs, alertas y refinamiento | ⏳ Pendiente | 0% |

---

## ✅ Fase 0 — Diseño y Especificaciones (COMPLETADA)

### Logros
- Definición del problema y contexto de Guipak
- Stack tecnológico definido (Next.js, MySQL separado, VPS existente)
- 13 módulos del sistema diseñados
- Referencia: Moonflow.ai + competidores globales (Upflow, Kolleno, Chaser, Gaviti, HighRadius)
- Decisión: app independiente (no módulo del CRM)
- Módulo documental integrado con CRM via webhook
- Módulo de conciliación bancaria con aprendizaje de cuentas
- Documentación inicial creada

### Decisiones tomadas
| Decisión | Opción | Razón |
|---|---|---|
| Frontend | Next.js 14 App Router | Consistencia con CRM existente |
| Infraestructura | Mismo VPS via Dokploy | Aprovecha infraestructura existente |
| Base de datos | MySQL separado (Docker) | Aislamiento del ERP Softec |
| Modo operación | Híbrido supervisado | Confianza gradual, seguridad ante errores |
| Canales v1.0 | WhatsApp + Email | Mayor penetración, infra disponible |
| Documentos | Google Drive + webhook CRM | CRM ya tiene el flujo de escaneo |

---

## ✅ Fase 1 — Fundación de Datos (COMPLETADA)

### Logros
- DESCRIBE completo de `ijnl` (238 campos), `ijnl_pay` (114 campos), `irjnl` (43 campos)
- DESCRIBE completo de `icust` (maestro de clientes) e `icontacts`
- Mapeado de relaciones entre las 3 tablas principales
- Descubrimiento de valores reales en Softec Guipak:
  - `IJ_TYPEDOC = 'IN'` (no 'FR'/'FC' como en el estándar Softec)
  - `IJ_INVTORF`: `'T'`=factura, `'V'`=cancelada, `'C'`=nota crédito
  - `IJ_PAID = 'F'` para pendientes (Softec lo mantiene automáticamente)
  - `IJ_STATUS = 'A'` = aplicada parcialmente (NO es anulada)
- Query cartera vencida v1.1 construido, probado y validado
- Resultado validado: **614 facturas vencidas, RD$12,596,173.34**
- Query de estado de cuenta por cliente/factura construido
- Query de resumen por segmento para dashboard construido
- Tabla `icust` mapeada: email en `IC_EMAIL`, teléfono en `IC_PHONE`, contacto cobros en `IC_ARCONTC`
- Problema identificado: mayoría de clientes sin email registrado → estrategia de enriquecimiento progresivo definida
- DDL completo de 11 tablas propias del sistema diseñado
- Documentación técnica completa generada (CLAUDE.md, SPEC.md, CRITICAL_POINTS.md, DATABASE.md)

### Hallazgos importantes
1. `IJ_TYPEDOC` en Guipak usa `'IN'` en lugar del estándar `'FR'`/`'FC'`
2. El JOIN con `cobranza_disputas` (tabla propia) requiere implementación en dos pasos o federated tables, ya que están en DBs diferentes
3. Clientes con facturas muy antiguas (2018): hay deuda de más de 7 años en cartera
4. Cliente `0000642` tiene 32 facturas vencidas hace 1,202 días — posible caso especial

---

## ⏳ Fase 2 — Scaffolding de la App (PENDIENTE)

### Objetivos
- Crear proyecto Next.js 14 con App Router
- Configurar Docker Compose (app + MySQL propio)
- Crear configuración Dokploy para el VPS
- Implementar autenticación (NextAuth)
- Crear las 11 tablas MySQL de `cobranzas_guipak`
- Implementar conexiones a ambas DBs (`softecDb` + `cobranzasDb`)
- Estructura de carpetas base
- Variables de entorno

### Tareas
- [ ] `npx create-next-app@latest cobranzas-guipak --typescript`
- [ ] Configurar `docker-compose.yml` con MySQL + App
- [ ] Configurar Dokploy en VPS srv869155
- [ ] Implementar NextAuth con credenciales
- [ ] Crear `lib/db/softec.ts` (SOLO LECTURA)
- [ ] Crear `lib/db/cobranzas.ts` (lectura/escritura)
- [ ] Ejecutar DDL de las 11 tablas en `cobranzas_guipak`
- [ ] Crear layout base (sidebar + header)
- [ ] Crear página de login
- [ ] Variables de entorno `.env.local` y `.env.example`

### Entregable
> App Next.js corriendo en Dokploy, conectada a ambas DBs, con login funcional

---

## ⏳ Fase 3 — Módulo Cartera Vencida (PENDIENTE)

### Objetivos
- Vista principal de cartera vencida consultando Softec en tiempo real
- Filtros y segmentación visual
- Vista de detalle por cliente

### Tareas
- [ ] API Route: `/api/softec/cartera-vencida` (query v1.1)
- [ ] API Route: `/api/softec/estado-cuenta/[cliente]/[factura]`
- [ ] Página: `/cartera` — tabla con filtros
- [ ] Componente: `SegmentoRiesgoBadge` (colores por segmento)
- [ ] Componente: `AgingReport` — distribución por días vencido
- [ ] Componente: `ClienteCard` — resumen por cliente con todas sus facturas
- [ ] Indicadores: ¿tiene PDF?, ¿tiene WhatsApp?, ¿tiene email?
- [ ] Alerta: clientes sin datos de contacto
- [ ] Filtros: segmento, cliente, vendedor, monto min/max, días vencido

### Entregable
> Supervisor puede ver toda la cartera vencida con segmentación visual clara

---

## ⏳ Fase 4 — Conciliación Bancaria (PENDIENTE)

### Objetivos
- Supervisor carga extracto bancario
- Sistema compara contra Softec
- Aprendizaje de cuentas bancarias

### Tareas
- [ ] Parser de extracto Excel (xlsx)
- [ ] Parser de extracto PDF (si aplica)
- [ ] API Route: `/api/conciliacion/cargar`
- [ ] API Route: `/api/conciliacion/aprobar/[id]`
- [ ] API Route: `/api/conciliacion/asignar-cliente/[id]`
- [ ] Lógica de matching: monto + fecha ±3 días contra `irjnl`
- [ ] Página: `/conciliacion` — tres columnas (Conciliado/Por aplicar/Desconocido)
- [ ] Sistema de aprendizaje: `cobranza_cuentas_aprendizaje`
- [ ] Confirmar banco(s) principal(es) de Guipak
- [ ] Confirmar formato exacto de extractos bancarios

### Bloqueado por
- [ ] Confirmar banco(s) y formato de extractos con Ricardo

### Entregable
> Supervisor puede conciliar el extracto bancario diariamente en < 10 minutos

---

## ⏳ Fase 5 — Cola de Supervisión + IA (PENDIENTE)

### Objetivos
- N8N corre segmentador diariamente
- Claude AI genera mensajes personalizados
- Cola de aprobación en UI

### Tareas
- [ ] Workflow N8N: trigger diario → query cartera → API del sistema
- [ ] API Route: `/api/cobranzas/generar-cola`
- [ ] Prompts Claude AI por segmento (4 tonos diferentes)
- [ ] Generación de mensajes WhatsApp + Email por factura
- [ ] Página: `/cola-aprobacion` — lista de mensajes pendientes
- [ ] Acciones: Aprobar / Editar / Descartar / Escalar / Pausar
- [ ] Preview de mensaje antes de aprobar
- [ ] Validación de saldo Softec antes de mostrar en cola
- [ ] Registro en `cobranza_gestiones` y `cobranza_logs`

### Entregable
> Supervisor ve cada mañana mensajes listos para aprobar o editar

---

## ⏳ Fase 6 — Envío Real WhatsApp + Email (PENDIENTE)

### Tareas
- [ ] `lib/evolution/client.ts` — Evolution API client
- [ ] `lib/email/sender.ts` — SMTP/SendGrid client
- [ ] API Route: `/api/cobranzas/enviar/[gestion_id]`
- [ ] Verificación de estado `'APROBADO'` antes de enviar (CP-02)
- [ ] Validación final de saldo Softec antes de enviar (CP-06)
- [ ] Inclusión automática de link PDF si factura está documentada
- [ ] Registro en `cobranza_conversaciones`
- [ ] Manejo de errores: número inválido, email rebotado, timeout
- [ ] Webhook Evolution API: `/api/webhooks/whatsapp`

### Entregable
> Sistema enviando cobranzas reales con registro completo

---

## ⏳ Fase 7 — Agente IA Respuestas Entrantes (PENDIENTE)

### Tareas
- [ ] Webhook Evolution API para mensajes entrantes
- [ ] Webhook Email para respuestas entrantes
- [ ] Contexto completo por conversación para Claude AI
- [ ] Detección de promesas de pago → `cobranza_acuerdos`
- [ ] Detección de disputas → `cobranza_disputas`
- [ ] Escalado automático al supervisor
- [ ] Alertas: promesa registrada, promesa vencida

### Entregable
> Sistema bidireccional: envía y gestiona respuestas de clientes

---

## ⏳ Fase 8 — Portal Cliente + Documentación (PENDIENTE)

### Tareas
- [ ] Webhook entrante desde CRM: `/api/webhooks/factura-escaneada`
- [ ] Almacenamiento en `cobranza_facturas_documentos`
- [ ] Google Drive API client: `lib/drive/client.ts`
- [ ] Módulo de gestión documental: `/documentos`
- [ ] Portal cliente: `/portal/[token]`
- [ ] Generación de tokens únicos con expiración
- [ ] Módulo enriquecimiento de clientes: `/clientes/enriquecimiento`

---

## ⏳ Fase 9 — KPIs, Alertas y Refinamiento (PENDIENTE)

### Tareas
- [ ] Dashboard principal con KPIs
- [ ] Cálculo de DSO
- [ ] Reportes exportables (Excel/PDF)
- [ ] Sistema de alertas internas
- [ ] Reporte diario automático vía email
- [ ] Documentación técnica para el equipo
- [ ] Ajuste de prompts Claude según resultados reales

---

## 🔲 Pendientes de Confirmación Externa

| # | Pendiente | Bloqueado por | Estado |
|---|---|---|---|
| 1 | Banco(s) principal(es) de Guipak | Ricardo | ⏳ |
| 2 | Formato extractos bancarios (Excel/PDF) | Ricardo | ⏳ |
| 3 | Credenciales MySQL Softec (usuario solo lectura) | Ingeniero Softec | ⏳ |
| 4 | Webhook disponible en CRM para factura escaneada | Desarrollo CRM | ⏳ |
| 5 | Credenciales Evolution API | Ricardo | ⏳ |
| 6 | Credenciales SMTP/SendGrid | Ricardo | ⏳ |

---

## 📝 Log de Sesiones

### Sesión 1 — Marzo 2026
- Definición completa del proyecto y stack
- 13 módulos diseñados
- Decisión de app independiente

### Sesión 2 — Abril 2026
- Análisis de índices de `ijnl`, `ijnl_pay`, `irjnl`
- Recepción y análisis de DESCRIBE de las 3 tablas
- Descubrimiento de valores reales Softec Guipak (`IJ_TYPEDOC = 'IN'`)
- Query cartera vencida construido, probado y validado (614 facturas, RD$12.6M)
- Mapeado de `icust` e `icontacts`
- Problema de emails vacíos → estrategia de enriquecimiento progresivo
- DDL de 11 tablas propias diseñado
- Documentación técnica completa generada (5 archivos .md)
- **Fase 0 y Fase 1 cerradas**

---

## 🐛 Issues Conocidos

| # | Descripción | Prioridad | Estado |
|---|---|---|---|
| 1 | Mayoría de clientes sin email en Softec | Alta | En proceso (enriquecimiento progresivo) |
| 2 | JOIN con `cobranza_disputas` requiere implementación en 2 pasos (DBs separadas) | Media | Pendiente implementación |
| 3 | Facturas desde 2018 en cartera — posible necesidad de filtro de antigüedad máxima | Baja | Pendiente decisión de negocio |
| 4 | `IJ_NCFNUM = 0` en facturas antiguas — NCF no disponible | Baja | Manejar en UI como "Sin NCF" |

---

## 💡 Mejoras Futuras (Backlog v2.0)

- Llamadas telefónicas automatizadas (Twilio o similar)
- Pasarela de pagos en portal cliente
- Scoring crediticio por historial de pagos
- App móvil para el equipo de cobros
- Multi-empresa (otras empresas del grupo)
- Integración directa con banco via API (actualmente carga manual)
- Módulo de gestión de vendedores (comisiones sobre recupero)
- Integración con DGII para validación de NCF en tiempo real

---

*Versión: 1.1 — Abril 2026*
