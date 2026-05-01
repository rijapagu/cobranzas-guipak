# CHECKLIST — Sistema de Cobranzas Guipak

> **Vista única de qué está hecho y qué falta.**
> Para historia detallada → `PROGRESS.md`
> Para retomar trabajo → `HANDOFF_PROXIMA_SESION.md`
> Última actualización: **1 mayo 2026**

---

## 📊 Resumen ejecutivo

| Indicador | Valor |
|---|---|
| Fases completas | 9 de 10 (90%) |
| Fase 10 (Agente Proactivo) | ~85% |
| Sistema en producción | ✅ Sí |
| Listo para uso real diario | ⚠️ Falta validación end-to-end con clientes reales |
| Cobertura tests automatizados | 0% (solo pruebas manuales) |

---

## ✅ HECHO (production-ready)

### Infraestructura y deploy
- [x] App Next.js 16 desplegada en `https://cobros.sguipak.com`
- [x] MySQL propio en Dokploy con persistencia
- [x] Conexión Softec solo lectura (con guard runtime que rechaza writes)
- [x] Auto-deploy desde GitHub a master via Dokploy
- [x] HTTPS + Let's Encrypt
- [x] Auto-runner de migraciones (`/api/internal/admin/migrate`) idempotente
- [x] Dev local con Docker Compose (MySQL + Redis)

### Autenticación y permisos
- [x] Login JWT con cookies httpOnly
- [x] Roles: ADMIN, SUPERVISOR, COBRADOR
- [x] Usuario admin seed (`admin@guipak.com`)
- [x] Middleware de protección de rutas

### Módulo cartera vencida
- [x] Query Softec con segmentación (VERDE/AMARILLO/NARANJA/ROJO)
- [x] UI `/cartera` con filtros, búsqueda, totales
- [x] Detalle por cliente con historial de facturas
- [x] Pausa de cliente / no-contactar (`cobranza_clientes_enriquecidos`)

### Cola de aprobación + IA
- [x] Generación masiva de gestiones (`/api/cobranzas/generar-cola`)
- [x] Mensajes generados con Claude AI (`claude-sonnet-4-20250514`)
- [x] **22 plantillas de correo configurables** (4 categorías) ✨ *nuevo 30-abr*
- [x] Selector de plantilla por segmento+día+categoría
- [x] Render de variables (`{{cliente}}`, `{{numero_factura}}`, etc.) con aliases retrocompat
- [x] Aprobar / Editar / Descartar / Escalar desde UI
- [x] CP-02: ningún mensaje sale sin aprobación humana
- [x] CP-03: facturas con disputa activa se excluyen
- [x] CP-08: log de toda acción en `cobranza_logs`
- [x] CP-10: Claude solo genera texto, no envía

### WhatsApp (Evolution API)
- [x] Instancia `AsistenteGuipak` vinculada al **18098536995** ✨ *nuevo 30-abr*
- [x] `WHATSAPP-BAILEYS` integration (Evolution `homolog`)
- [x] Cliente `lib/evolution/client.ts` para envío
- [x] Webhook recibe mensajes entrantes
- [x] **Soporte LID (formato privacy WhatsApp)** ✨ *nuevo 30-abr*
- [x] UTF-8 correcto en envíos (tildes, emojis)
- [x] Auto-rechazo de mensajes propios (`fromMe: true`)
- [x] Filtro de status@broadcast

### Email (SMTP)
- [x] Cliente `lib/email/client.ts` con nodemailer
- [x] Endpoint `/api/cobranzas/configuracion/probar` para validar SMTP

### Bot Telegram (Capa A + B + B+ + Tareas)
- [x] Bot `@CobrosGuipakBot` en grupo "Cobros Guipak"
- [x] Webhook configurado: `/api/webhooks/telegram`
- [x] Auth por `telegram_user_id` → tabla `cobranza_telegram_usuarios`
- [x] Capa A: empuje matutino con resumen de cartera + tareas del día ✨ *act. 1-may*
- [x] Capa B: 7 herramientas (tool use) — buscar cliente, estado cobros, etc.
- [x] Capa B+: bot propone correos con botones de aprobación inline
- [x] Cron diario 8 AM AST agendado en Dokploy
- [x] **3 tools de tareas: crear_tarea, listar_tareas, marcar_tarea_hecha** ✨ *nuevo 1-may*
- [x] **Parseo de fechas relativas con tabla precomputada de 14 días** ✨ *nuevo 1-may*

### Tareas y Calendario (Fase 10 — extensión) ✨ *nuevo 1-may*
- [x] Migración 013: tabla `cobranza_tareas`
- [x] API `/api/cobranzas/tareas` (GET con filtros + POST)
- [x] API `/api/cobranzas/tareas/[id]` (GET/PUT/DELETE soft)
- [x] UI `/tareas` con vista calendario mensual + lista del día (locale es_ES)
- [x] Drawer crear/editar con DatePicker, TimePicker, tipo, prioridad, cliente
- [x] Bot Telegram crea/lista/marca hecha por lenguaje natural
- [x] Auto-tarea SEGUIMIENTO al día siguiente de toda fecha_prometida en acuerdos
  (idempotente; engachada en portal y procesar-respuesta)
- [x] Empuje matutino con secciones "Tus tareas hoy" y "Atrasadas"

### Documentación
- [x] CLAUDE.md (instrucciones para agentes)
- [x] SPEC.md (especificaciones)
- [x] PROGRESS.md (historia por fases)
- [x] CRITICAL_POINTS.md (10 invariantes)
- [x] DATABASE.md (schema)
- [x] HANDOFF_PROXIMA_SESION.md (continuidad)
- [x] docs/MANUAL_USUARIO.md (manual para usuarios finales)
- [x] CHECKLIST.md (este documento) ✨ *nuevo 30-abr*

### Conciliación bancaria (Fase 4)
- [x] Tabla `cobranza_conciliacion`
- [x] UI `/conciliacion`
- [x] CP-04: aprobado_x_conciliacion bloqueante para gestionar

### Portal del cliente (Fase 8)
- [x] Tokens firmados por cliente (`cobranza_portal_tokens`)
- [x] UI `/portal/[token]` con balance y comprobantes

---

## 🔴 PENDIENTE — Alta prioridad (siguiente sesión)

### Validación end-to-end con clientes reales (PRÓXIMA SESIÓN)
- [ ] Probar conversación completa: cliente real responde WA → cola → supervisor → cliente recibe
- [ ] Validar `cobranza_conversaciones` se actualiza con respuestas
- [ ] Validar `cobranza_acuerdos` se crea cuando cliente promete fecha en WA
- [ ] **Validar auto-tarea de seguimiento aparece al día siguiente del acuerdo**
- [ ] **Validar que el empuje matutino del día siguiente lista las tareas correctamente**
- [ ] UI `/conversaciones` mostrando hilos activos por cliente

### Slash commands del bot
- [ ] `/tareas`, `/hoy`, `/mañana`, `/semana` → atajos a `listar_tareas`
- [ ] Hoy responden "Comando no reconocido"

### Bug fixes pendientes
- [ ] Settings de Evolution UI (POST /settings/set/) devuelve 500 — workaround manual via UI Evolution
- [ ] UI para reasignar mensajes huérfanos LID (sin `remoteJidAlt`) a un cliente

---

## 🟡 PENDIENTE — Media prioridad (próximas 4-6 sesiones)

### Plantillas WhatsApp
- [ ] Decidir: agregar columna `canal` a `cobranza_plantillas_email` o crear `cobranza_plantillas_whatsapp` aparte
- [ ] Migrar generación WA del bot para usar plantillas
- [ ] UI mostrar/editar plantillas de WA

### Capa C — Bot pregunta datos faltantes al grupo
- [ ] Función `validarDatosClienteCompletos(clienteId, canal)`
- [ ] Tool `pedir_dato_faltante(cliente_id, campo)` que postea pregunta al grupo
- [ ] Procesador de respuesta libre del grupo (privacy mode bot deshabilitado)
- [ ] Persistir dato confirmado en `cobranza_clientes_enriquecidos`

### Capa D — Cadencias automáticas
- [ ] Worker BullMQ horario (`lib/queue/worker.ts` ya construido)
- [ ] Servicio Compose en Dokploy con `command: npm run worker`
- [ ] Lógica de evaluación: qué facturas necesitan próximo paso de cadencia
- [ ] Generar gestión automática + agregar a cola de aprobación

### Reportes y dashboard ejecutivo
- [ ] Cobrado este mes vs meta
- [ ] Cartera por segmento (gráfico evolutivo histórico)
- [ ] Top 10 morosos
- [ ] Efectividad por plantilla (% que generaron pago)
- [ ] Productividad por cobrador
- [ ] Export Excel / PDF de reportes

### Mejoras UI Plantillas
- [ ] Preview en vivo del correo con datos ficticios
- [ ] Botón "Test send" a propio email
- [ ] Duplicar plantilla
- [ ] Estadísticas de uso por plantilla

### Auto-deploy de Evolution
- [ ] Cuando salga `evoapicloud/evolution-api:latest` post-2.3.7, actualizar imagen en Dokploy
- [ ] Re-validar settings (`rejectCall`, `groupsIgnore`, `msgCall`)

---

## 🟢 PENDIENTE — Baja prioridad / largo plazo

### WhatsApp Cloud API oficial Meta
- [ ] Verificación de dominio en Meta Business Manager
- [ ] Verificación de identidad legal de Suministros Guipak (RNC, registros)
- [ ] Documentos legales del negocio
- [ ] Migrar de Evolution a Cloud API
- [ ] Templates pre-aprobados en Meta

### Capa E — Memoria semántica
- [ ] Embeddings de conversaciones históricas
- [ ] Vector store (pgvector / Qdrant)
- [ ] Bot recupera contexto histórico relevante por cliente

### Multi-usuario / roles avanzados
- [ ] Asignación de cartera por cobrador
- [ ] Permisos finos por rol
- [ ] KPIs individuales

### Sincronización bidireccional con Softec
- [ ] Definir qué se puede escribir en Softec (con super precaución)
- [ ] Reflejar acuerdos cumplidos
- [ ] Auditoría exhaustiva de toda escritura

### Conciliación bancaria automatizada
- [ ] Cargar archivo de banco (CSV/Excel)
- [ ] IA empareja transacciones con facturas
- [ ] Supervisor aprueba match

---

## 🔧 Deuda técnica

- [ ] Tests unitarios mínimos (Jest + Testing Library) — hoy hay 0
- [ ] Sentry o similar para error tracking en prod
- [ ] Backups automáticos del MySQL prod
- [ ] CI/CD con GitHub Actions: typecheck + lint en PR
- [ ] Verificar idempotencia del webhook (retries de Evolution)
- [ ] Documentar todos los Critical Points (CP-01 a CP-10) en código con comentarios

---

## 📅 Roadmap sugerido próximas 5 sesiones

| # | Sesión | Foco |
|---|---|---|
| 1 | Próxima | **Validación end-to-end WA con clientes reales** + UI conversaciones + auto-tareas en vivo |
| 2 | +1 | Slash commands bot + plantillas WhatsApp |
| 3 | +2 | Capa D — Cadencias automáticas (sistema empuja, no solo responde) |
| 4 | +3 | Reportes y dashboard ejecutivo |
| 5 | +4 | Iniciar camino Cloud API Meta en serio |

---

## 🎯 Definición de "production-grade"

El sistema estará **listo para entregar a Daria + cobradores sin tu intervención diaria** cuando:

- [x] App accesible y estable
- [x] WhatsApp operacional
- [x] Plantillas configurables
- [x] Bot Telegram para supervisor
- [x] **Tareas/calendario funcional** ✨ *cerrado 1-may*
- [ ] **Cadencias automáticas**
- [ ] **Reportes para gerencia**
- [ ] **Validado con clientes reales 1 semana sin issues mayores**
- [ ] Tests unitarios > 50% cobertura crítica
- [ ] Backups + monitoring activos

**Faltan ~4 puntos para llegar.** Ritmo actual: ~1 punto por sesión = **~4-5 semanas más**.

---

*Última actualización: 1-may-2026, sesión Sonnet 4.7 1M*
