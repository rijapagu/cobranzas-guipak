# Prompt para continuar — Fase 3 Etapa 1 (scoping multi-tenant)

> Copiar y pegar lo de abajo en una sesión nueva de Claude Code en `D:\IA\cobranzas-guipak`.

---

Continúa la **Fase 3 Etapa 1** del proyecto SaaS (scoping `empresa_id` módulo por módulo). Lee primero `ROADMAP_FASE_3_SAAS.md` y `docs/AUDITORIA_COMPLETA_2026-06-11.md` (Parte 4) para el contexto.

## Estado actual (2026-06-12)

Las Fases 0, 1, 2 y 2b de la auditoría están completadas y desplegadas. De la Fase 3:

- **Etapa 0 ✅** (commit e207949): tabla `empresas` (Guipak = empresa 1), `empresa_id INT NOT NULL DEFAULT 1` + índice en las 25 tablas de negocio (migración 030, aplicada en producción), `empresa_id` en JWT/login (tokens viejos = empresa 1), helper `lib/tenant.ts`, modelo canónico + adaptador Softec en `lib/erp/`.
- **Etapa 1 EN CURSO** — módulos ya scoped y desplegados:
  - gestiones (commit 9fb2f92)
  - conversaciones + acuerdos + disputas (commit fb1a70d)
  - conciliación (commit 8377662)

## El patrón establecido (seguirlo igual)

1. **Rutas con sesión** → `import { empresaIdDeSesion } from '@/lib/tenant'` y `WHERE empresa_id = ?` con `empresaIdDeSesion(session)`.
2. **Flujos solo-Guipak** (bot Telegram, jobs de lib/queue, webhooks, lib/reportes) → `EMPRESA_GUIPAK` o `empresa_id = 1` explícito en el SQL (greppeable: la Etapa 4 los parametrizará).
3. **Accesos por id (PK global)** → guard de empresa solo en el SELECT inicial del flujo; los UPDATE posteriores por id quedan cubiertos.
4. **Funciones lib llamadas desde sesión Y desde jobs** → la empresa viaja como parámetro (ejemplos ya hechos: `procesarLinea(linea, empresaId)` en matcher, `pagosPorAplicar(codigo, empresaId)`).
5. **Portal público** → la empresa se resuelve DESDE el token (`cobranza_portal_tokens.empresa_id`), nunca de sesión.
6. **INSERTs** → siempre con `empresa_id` explícito en columnas y params.

## Módulos pendientes (en este orden, ~108 statements)

1. `cobranza_tareas` (~35 statements, 16 archivos) — rutas /api/cobranzas/tareas + tareas espejo en jobs (recordatorios-promesas, respuesta-cliente, sin-respuesta, cadencias, seguimiento de conciliación, auto-tareas) + tools del bot.
2. `cobranza_clientes_enriquecidos` (18) + `cobranza_contactos_cliente` (5) + `cobranza_cliente_inteligencia` (16) — ruta /api/cobranzas/clientes, lib/cobranzas/contactos.ts, inteligencia-clientes, pausas/no_contactar en varios flujos.
3. `cobranza_facturas_documentos` (17) — documentos, webhooks factura-escaneada, scan-drive, drafts.
4. `cobranza_plantillas_email` (11) + `cobranza_cadencias` (6) + `cobranza_factura_cadencia_estado` (4) — rutas de plantillas/cadencias + lib/templates/seleccionar.ts + job cadencias (upsertEstado).
5. Resto (24): `cobranza_portal_tokens` (generar-token), `cobranza_logs` (logAccion/logError podrían aceptar empresaId opcional), `cobranza_configuracion`, `cobranza_memoria_cliente`, `cobranza_supervisor_alertas`, `cobranza_telegram_usuarios`.

Para encontrar lo pendiente por tabla:
`grep -rn "FROM <tabla>\|INTO <tabla>\|UPDATE <tabla>" app lib --include="*.ts" | grep -v empresa_id`
(ojo: los statements multilinea pueden tener el empresa_id en la línea siguiente — verificar antes de tocar).

## Al terminar los módulos (cierre de Etapa 1)

1. Migración 031: convertir UNIQUE por-factura a compuestos — `cobranza_cadencias` UNIQUE (segmento, dia) → (empresa_id, segmento, dia); `cobranza_factura_cadencia_estado` PK factura_id → (empresa_id, factura_id); revisar `cobranza_cliente_inteligencia` y `cobranza_clientes_enriquecidos` si tienen UNIQUE por codigo_cliente.
2. **Test de aislamiento**: crear empresa 2 de prueba (INSERT en `empresas` + usuario con `empresa_id=2`), hacer login con ese usuario y verificar que dashboard/cartera/cola/conversaciones/disputas/conciliación/tareas devuelven TODO vacío (cero datos de Guipak). Documentar el resultado.

## Proceso de trabajo (igual que las sesiones anteriores)

- Por cada lote: editar → `npx tsc --noEmit` → `npx next build` → commit (mensaje `feat(saas): Fase 3 Etapa 1 - scoping modulo X`, con Co-Authored-By Claude) → `git push origin master` (Dokploy auto-despliega en ~2-3 min) → smoke test contra `https://cobros.sguipak.com` (login 200, APIs 401 sin auth).
- Si hay migración nueva: tras el deploy, `POST https://cobros.sguipak.com/api/internal/admin/migrate` con header `x-internal-secret` = `INTERNAL_ADMIN_SECRET` del `.env.local` (solo ejecuta archivos no registrados en `cobranza_migraciones`).
- Regla de oro intocable: ningún mensaje sale sin aprobación humana. Y nunca romper a Guipak: todo retrocompatible, cada commit deja producción funcionando.
