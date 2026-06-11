# ROADMAP Fase 3 — Comercialización SaaS multi-empresa

> Decisiones tomadas con Ricardo el 2026-06-11:
> 1. **Tenancy híbrido**: schema compartido con `empresa_id` por defecto + opción
>    de base de datos dedicada para clientes premium.
> 2. **Datos de cartera**: modelo canónico de dominio alimentado por adaptadores —
>    adaptador Softec (primer ERP) + importación CSV/Excel para clientes sin ERP.
> 3. **Estrategia**: mismo repo, cambios incrementales retrocompatibles.
>    Guipak = empresa #1; cada commit deja producción funcionando.

## Principios

- **Nunca romper a Guipak.** Toda columna nueva lleva `DEFAULT 1` (empresa Guipak);
  todo código nuevo funciona sin configuración nueva.
- **La regla de oro se hereda**: ningún mensaje sale sin aprobación humana,
  en ninguna empresa.
- Las migraciones se aplican vía `POST /api/internal/admin/migrate`
  (registro en `cobranza_migraciones`).

## Etapas

### Etapa 0 — Cimientos (✅ iniciada 2026-06-11)
- [x] Tabla `empresas` (plan, modo_datos COMPARTIDA/DEDICADA, erp_tipo, config JSON).
- [x] `empresa_id INT NOT NULL DEFAULT 1` + índice en las 24 tablas de negocio
  (migración 030). Guipak = empresa 1.
- [x] `empresa_id` en el JWT y la sesión (tokens viejos → empresa 1).
- [x] Helper `lib/tenant.ts` (empresa de la sesión, fail-safe a Guipak).
- [x] Esqueleto del modelo canónico y la interfaz de adaptador ERP (`lib/erp/`).

### Etapa 1 — Scoping de lectura/escritura (la más laboriosa)
- [ ] Añadir `WHERE empresa_id = ?` a todas las queries de `cobranza_*`
  (ir módulo por módulo: gestiones → conversaciones → acuerdos → disputas →
  conciliación → tareas → plantillas → cadencias → logs).
- [ ] Todos los INSERT escriben `empresa_id` explícito (hoy los cubre el DEFAULT).
- [ ] Tests de aislamiento: un usuario de empresa 2 jamás ve datos de empresa 1.

### Etapa 2 — Adaptador ERP + importación CSV
- [ ] Implementar `ErpAdapter` completo para Softec (mover las ~83 queries de
  `softecQuery` detrás del adaptador, módulo por módulo).
- [ ] Adaptador CSV: el cliente sube su cartera (facturas pendientes + clientes)
  a tablas de staging propias (`cartera_facturas`, `cartera_clientes` con empresa_id).
- [ ] Resolver adaptador por `empresas.erp_tipo`; CP-06 (validar saldo) degrada
  con gracia en modo CSV (advertencia en vez de bloqueo).
- [ ] El frontend deja de usar nombres `IJ_*` (renombrar tipos al modelo canónico).

### Etapa 3 — Configuración e integraciones por empresa
- [ ] Extraer hardcodes Guipak a `empresas.config` / tabla de credenciales cifradas:
  prompts de IA (nombre de empresa, firma), remitente SMTP, instancia Evolution
  (un número de WhatsApp por empresa), bots/chats de Telegram, branding del portal
  y la UI, parser de banco (Banco Popular hoy; por-empresa mañana).
- [ ] Eliminar fallbacks personales (chat ID `7281538057` en supervisor-*).
- [ ] Dominio por tenant o subpath (`app.tucobranza.com/<slug>` o subdominios).

### Etapa 4 — Jobs multi-tenant
- [ ] Parametrizar los 4 jobs BullMQ y 14 crons HTTP por empresa (loop sobre
  empresas activas; horarios por zona horaria de la empresa).
- [ ] Subir concurrencia del worker; colas con prioridad por plan.
- [ ] IA por API cloud (Anthropic) con presupuesto/cuota por empresa
  (el gateway LLM local de GPU única no escala a N tenants).

### Etapa 5 — Modo DB dedicada (premium)
- [ ] `empresas.modo_datos='DEDICADA'` + credenciales de DB propias (cifradas).
- [ ] Resolver pool por empresa en `lib/db/cobranzas.ts` (cache de pools).
- [ ] Migraciones aplicadas a la flota (loop sobre DBs dedicadas).

### Etapa 6 — Producto
- [ ] Onboarding self-service (alta de empresa, primer usuario admin, asistente
  de configuración) + facturación (planes ESTANDAR/PREMIUM).
- [ ] Roles por empresa (el ADMIN de empresa 2 administra solo su empresa);
  superadmin global para soporte.
- [ ] Observabilidad por tenant (logs con empresa_id, métricas, límites de uso).

## Riesgos conocidos
- Etapa 1 es mecánica pero extensa: hacerla módulo por módulo con verificación
  en producción entre commits.
- `cobranza_factura_cadencia_estado.factura_id` y los `ij_inum` son únicos
  POR ERP — al haber N empresas, las claves pasan a ser (empresa_id, factura).
  La migración 030 ya prepara los índices; los UNIQUE se ajustan en Etapa 1.
- El portal público y los webhooks resuelven empresa por token/credencial,
  no por sesión — diseñar en Etapa 2/3.
