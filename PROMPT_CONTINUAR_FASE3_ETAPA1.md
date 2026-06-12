# Fase 3 Etapa 1 — COMPLETADA (2026-06-12)

> Este archivo era el prompt de continuación de la Etapa 1. La etapa quedó
> cerrada y verificada; se conserva como registro. Para continuar el SaaS,
> arrancar la **Etapa 2** (ver abajo).

## Qué quedó hecho (todo desplegado en producción)

- 5 lotes de scoping `empresa_id` (~108 statements): tareas (7f076d5),
  clientes (d0c0e06), documentos (9ef62ca), plantillas+cadencias (4a7229b),
  resto (e6d36f8).
- Migración 031 aplicada: UNIQUE/PK compuestos `(empresa_id, clave natural)` en
  cadencias, factura_cadencia_estado, cliente_inteligencia, clientes_enriquecidos,
  memoria_cliente, telegram_memoria_equipo, facturas_documentos,
  cuentas_aprendizaje y configuracion. `portal_tokens.token` y
  `telegram_usuarios.telegram_user_id` siguen globales a propósito.
- Migración 032: empresa 2 de prueba + usuario `prueba@empresa2.test`.
- Guards ERP (ad75647): las rutas que leen Softec devuelven vacío para
  empresa != 1 — greppeable con `EMPRESA_GUIPAK`, la Etapa 2 los reemplaza.
- Test de aislamiento: `scripts/test-aislamiento-empresa2.mjs` → AISLAMIENTO OK
  (13 endpoints en cero para la empresa 2).
- Bugs de producción corregidos de paso: alias `manual` reservado (documentos 500),
  collations mezcladas en joins contra cliente_inteligencia (conversaciones 500
  desde fb1a70d, supervisor-promesas).

## Prompt para la próxima sesión (Etapa 2)

Continúa la **Fase 3 Etapa 2** del proyecto SaaS: origen de cartera por empresa.
Lee primero `ROADMAP_FASE_3_SAAS.md` (Etapa 2) y `lib/erp/` (modelo canónico +
adaptador Softec ya existentes, Etapa 0).

1. Implementar `csvAdapter` en `lib/erp/` (import de cartera por archivo CSV/Excel
   subido por la empresa) y persistencia propia de esa cartera.
2. `adaptadorParaEmpresa(empresaId)` debe leer `empresas.erp_tipo` de la BD
   (hoy hardcodea Guipak→Softec, resto→nulo).
3. Reemplazar los guards `empresaIdDeSesion(session) !== EMPRESA_GUIPAK` de las
   rutas Softec (grep `EMPRESA_GUIPAK` en `app/api`) por el adaptador canónico:
   dashboard, clientes, cartera-vencida, resumen-segmentos, estado-cuenta x2,
   reportes excel x2, generar-cola, verificar-depositos, alertas.
4. Test de aislamiento de regresión: `TEST_EMPRESA2_PASS=<pass> node
   scripts/test-aislamiento-empresa2.mjs` debe seguir en AISLAMIENTO OK.

Proceso igual que siempre: tsc → build → commit → push (Dokploy auto-despliega
~2-3 min) → smoke test. Migraciones: POST /api/internal/admin/migrate con
`x-internal-secret`. Regla de oro intocable: ningún mensaje sale sin aprobación
humana; nunca romper a Guipak.

Cuando la empresa 2 de prueba ya no haga falta:
`UPDATE usuarios SET activo=0 WHERE empresa_id=2;`
