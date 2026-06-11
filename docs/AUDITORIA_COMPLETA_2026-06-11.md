# Auditoría completa — Sistema de Cobranzas Guipak
**Fecha:** 11 de junio de 2026
**Alcance:** seguridad, correctitud de código, cumplimiento funcional vs. especificación, y preparación para escala/SaaS.
**Método:** 4 auditorías paralelas de solo lectura sobre todo el código (`app/`, `lib/`, `db/`, `docker/`, configuración). `tsc --noEmit` pasa sin errores; ESLint solo reporta 2 errores menores.

---

## VEREDICTO GENERAL

| Pregunta | Respuesta |
|---|---|
| ¿Tiene errores de programación? | Sí — 3 críticos, 6 altos, 9 medios (detalle abajo). TypeScript compila limpio; los bugs son de lógica. |
| ¿Hace lo que debe hacer? | En su mayoría sí. La regla de oro se cumple PARCIALMENTE (2 grietas). 4 funcionalidades están rotas o no implementadas. |
| ¿La pueden hackear? | **Sí, hoy es hackeable con esfuerzo bajo.** 5 hallazgos críticos de seguridad. NO es seguro tenerla expuesta a internet en su estado actual. |
| ¿Sirve como base SaaS para 1000 usuarios? | Para 1000 usuarios de Guipak: casi, con 3 fixes baratos. Como SaaS multi-empresa: **no sin una reestructuración profunda** (cero multi-tenancy, ERP acoplado en 51 archivos, integraciones mono-empresa). |

---

# PARTE 1 — SEGURIDAD

## CRÍTICOS (corregir antes de cualquier otra cosa)

### S-C1. Bypass de autenticación con un punto en la URL
`middleware.ts:17` — `pathname.includes('.')` deja pasar sin auth cualquier ruta que contenga un punto. Una petición a `/api/.../algo.` evade el chequeo de cookie. Eliminar esa condición; permitir solo extensiones estáticas conocidas.

### S-C2. El middleware no valida el token, solo que exista
`middleware.ts:23-28` — cualquier valor en la cookie `cobranzas_token` (p. ej. `cobranzas_token=x`) pasa. Las páginas del dashboard dependen solo del middleware. Verificar la firma JWT en el middleware con `jose` (compatible con Edge runtime).

### S-C3. JWT_SECRET con fallback público hardcodeado
`lib/auth/jwt.ts:3` — `process.env.JWT_SECRET || 'dev-secret-fallback'`. Si la env var falta, cualquiera puede forjar un JWT de ADMIN. Eliminar el fallback, fallar al arrancar si no hay secreto, rotar el secreto actual.

### S-C4. `procesar-respuesta` abierto a internet sin ningún secreto
`middleware.ts:3` + `app/api/cobranzas/procesar-respuesta/route.ts` — cualquiera puede: inundar la cola con acuerdos/disputas falsos, gastar presupuesto de Claude (DoS económico), e inyectar prompts. Además su fallback (ver bug B-C2) atribuye los mensajes al primer cliente de la tabla.

### S-C5. Webhooks sin validación de firma — permite aprobar y ENVIAR mensajes reales
- `app/api/webhooks/telegram/route.ts` y `telegram-supervisor`: no validan `X-Telegram-Bot-Api-Secret-Token`. La "identidad" es el `from.id` del payload, falsificable. Un POST forjado con `{"callback_query":{"from":{"id":7281538057},"data":"aprobar:123"}}` aprueba y envía la gestión 123 al cliente real — **rompe la regla de oro desde internet**. El ID del supervisor está en el repo (`db/migrations/010_...sql:21` y `.env.example:54`).
- `app/api/webhooks/factura-escaneada/route.ts`: no valida el `N8N_WEBHOOK_SECRET` documentado. Permite inyectar `url_pdf` maliciosas que luego se envían a clientes por WhatsApp.
- `app/api/webhooks/whatsapp/route.ts`: acepta payloads de Evolution falsos.

## ALTOS

- **S-A1.** `app/api/internal/admin/migrate/route.ts` ejecuta SQL crudo protegido solo por el mismo `INTERNAL_CRON_SECRET` que comparten 16 endpoints. Si `INTERNAL_CRON_SECRET` está vacío en el entorno, un header vacío **pasa la validación** (`'' !== ''` → false). Usar secreto dedicado, rechazar secreto vacío, idealmente quitar el endpoint en producción.
- **S-A2.** Comparación de secretos no timing-safe en los 16 endpoints `internal/**` (usar `crypto.timingSafeEqual`).
- **S-A3.** `app/api/softec/estado-cuenta/[cliente]/route.ts` no llama a `getSession()` — combinado con S-C1, expone historial financiero de cualquier cliente. Toda ruta API debería validar sesión por sí misma.
- **S-A4.** Portal público (`/api/portal/[token]`) sin rate limiting; tokens de 30 días enviados en claro por WhatsApp/email; `solicitar-acuerdo` ilimitado.
- **S-A5.** `xlsx@0.18.5` tiene CVEs sin parche en npm (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS) y procesa archivos subidos por usuarios en `conciliacion/cargar`. Migrar a `exceljs` o a la build parcheada de SheetJS.

## MEDIOS

- **S-M1.** Passwords plausibles en `.env.example` (`cobranzas_pass_2026`) — si se copiaron a producción, rotarlas.
- **S-M2.** Sin protección CSRF en mutaciones (cookie `sameSite: 'lax'`, sin token CSRF ni check de Origin).
- **S-M3.** Varios endpoints devuelven `error.message` crudo (estructura de tablas, SQL) — p. ej. `migrate`, `asistente/chat`, webhook telegram.
- **S-M4.** Flag `secure` de la cookie depende de `NODE_ENV` — frágil.

## Lo que está BIEN en seguridad (verificado)

- **Sin inyección SQL**: todas las queries usan prepared statements con `?`; los pocos template literals interpolan solo claves fijas del código.
- Guard de solo-lectura de Softec sólido (3 capas: whitelist SELECT, blacklist de escritura, `multipleStatements:false`).
- Contraseñas de usuarios con bcrypt.
- `.env.local` en `.gitignore` y nunca commiteado al historial.
- No hay secretos hardcodeados en el código (excepto el fallback de JWT).

---

# PARTE 2 — BUGS DE PROGRAMACIÓN

## CRÍTICOS

### B-C1. Webhook Telegram permite aprobar+enviar sin autenticación
(= S-C5; es a la vez fallo de seguridad y bug funcional.)

### B-C2. Mensajes de números desconocidos se atribuyen al "primer cliente" de la tabla
`app/api/cobranzas/procesar-respuesta/route.ts:197-204` — fallback "mock" que quedó en producción: WhatsApp de un número no registrado se registra como conversación de un cliente arbitrario, y la IA puede insertar **acuerdos de pago y disputas a nombre de un cliente que no escribió nada**. Corrupción directa de datos financieros.

### B-C3. Doble envío por condición de carrera
`app/api/cobranzas/gestiones/[id]/enviar/route.ts:55-192` y `lib/telegram/enviar-gestion.ts:40-75` — patrón SELECT→validar→enviar→UPDATE sin transición atómica. Doble clic en "Enviar", o aprobación simultánea web+Telegram, o timeout en canal 'AMBOS' ⇒ el cliente recibe el cobro dos veces. Fix: `UPDATE ... SET estado='ENVIANDO' WHERE id=? AND estado IN ('APROBADO','EDITADO')` y verificar `affectedRows=1` antes de enviar.

## ALTOS

- **B-A1. Detección anti-fuga de depósitos rota.** `app/api/conciliacion/verificar-depositos/route.ts:78,91,107-120` — `String(fecha).substring(0,10)` sobre un objeto `Date` produce `"Wed Jun 10"`, no `"2026-06-10"`; las claves nunca matchean ⇒ todo sale `SIN_DEPOSITO` (falsas alarmas permanentes). Además el lazo de offsets cuenta el día exacto 3 veces. La función de seguridad más importante de conciliación no funciona.
- **B-A2. Re-verificación automática de depósitos DESCONOCIDOS nunca concilia.** `lib/conciliacion/seguimiento.ts:174` → `lib/conciliacion/matcher.ts:94,145` — mismo bug de formato de fecha pasado a `DATEDIFF` ⇒ siempre NULL ⇒ nunca matchea.
- **B-A3. `enviarWhatsApp` devuelve éxito falso si faltan credenciales.** `lib/evolution/client.ts:24-30` — retorna `{status:'sent', messageId:'mock_wa_...'}` sin enviar nada. Si una env var se pierde en un deploy, todas las gestiones se marcan ENVIADO y nadie recibe nada, silenciosamente.
- **B-A4. `parseFloat` sobre montos con separador de miles.** `lib/utils/parser-extracto.ts:46`, `lib/utils/parser-banco-popular.ts:54,107` — `parseFloat("1,234.56") === 1`: un depósito de RD$1,234.56 entra a conciliación como RD$1.00. El split de CSV tampoco maneja campos entrecomillados.
- **B-A5. Cargar el mismo extracto dos veces duplica todos los registros.** `app/api/conciliacion/cargar/route.ts:50-107` — sin verificación de duplicados.
- **B-A6. Crons muertos por enum incorrecto.** `docker/init.sql:73` define `direccion ENUM('ENVIADO','RECIBIDO')` pero `lib/queue/jobs/respuesta-cliente.ts:72,97` y `sin-respuesta.ts:112` filtran por `'ENTRANTE'/'SALIENTE'` ⇒ "mensajes esperando respuesta" nunca crea tareas y "sin respuesta" crea tareas aunque el cliente SÍ respondió.

## MEDIOS

- **B-M1.** Gestiones duplicadas: la exclusión en `generar-cola/route.ts:47-51` y `cadencias.ts:313-318` solo mira estado `PENDIENTE`; una factura con gestión APROBADO aún no enviada recibe una segunda gestión ⇒ doble cobro el mismo día.
- **B-M2.** Cadencias ignoran el campo `segmento` del paso (`lib/queue/jobs/cadencias.ts:215-217`): una cadencia de ROJO se aplica a facturas AMARILLO.
- **B-M3.** Cadencias con `requiere_aprobacion=0` crean gestiones auto-APROBADAS (`cadencias.ts:311,372`, `aprobado_por='cadencias-auto'`) — el seed por defecto (`db/migrations/010:39`) trae la VERDE así. Nadie humano vio el texto; un "enviar" posterior las despacha. Viola la regla de oro.
- **B-M4.** `enviar-gestion.ts:136` guarda el messageId de WhatsApp en la columna `email_message_id` ⇒ estados ENTREGADO/LEIDO nunca se actualizan para envíos desde Telegram. Y canal 'AMBOS' solo envía email (línea 102): la mitad WhatsApp jamás sale.
- **B-M5.** Scoring de riesgo: tendencia calculada comparando score parcial (0-35) contra score completo anterior (0-100), y `score_anterior` guarda el de dos noches atrás (`lib/queue/jobs/inteligencia-clientes.ts:84-98,326-327`) ⇒ subestima riesgo hasta 20 puntos; SUSPENDER/NO_VENDER se activan tarde.
- **B-M6.** Estados `CUMPLIDO`/`INCUMPLIDO` de acuerdos **no se escriben nunca** (grep completo: solo INSERTs con 'PENDIENTE') ⇒ KPIs de acuerdos siempre 0, tasa de cumplimiento de promesas siempre 100% en el scoring, rama de `supervisor-promesas.ts:140` es código muerto.
- **B-M7.** Conciliación multi-recibo (`matcher.ts:138-179`) combina recibos de **clientes distintos** y marca CONCILIADO automático sin revisión humana — una coincidencia aritmética casual asigna el depósito al cliente equivocado.
- **B-M8.** `documentos/enviar/route.ts:80,92` ignora el resultado de envío: reporta "enviado" con SMTP caído.
- **B-M9.** Webhook WhatsApp sin deduplicación por `key.id` (Telegram sí la tiene): reintentos de Evolution pueden crear conversaciones y acuerdos duplicados.

## BAJOS

- `reporte-diario` valida header `x-cron-secret`; los otros 13 crons usan `x-internal-secret` (inconsistencia → 401 silencioso).
- Crons sin lock de solapamiento ante ejecuciones concurrentes.
- `new Date("YYYY-MM-DD")` + `getDate()` en `lib/utils/formato.ts:24-28` y `lib/templates/render.ts:46-53`: funciona solo porque el server corre en UTC; en TZ Santo Domingo mostraría un día antes.
- `conciliacion/cargar/route.ts:42`: `fecha_extracto` = fecha de carga, no la del extracto.
- Fallback mock de Claude (`lib/claude/prompts.ts:197-228`): si la API falla, registra disputas reales por keyword matching sin IA.

## Lo que está BIEN en el código (verificado)

- TypeScript compila sin errores; tipado estricto.
- `lib/horario.ts` maneja timezone correctamente con `Intl`.
- `lib/cobranzas/saldo-favor.ts`, `recordatorios-promesas`, `aplicar-anticipos`: bien construidos e idempotentes.
- Umbrales de segmentación consistentes en las ~8 copias (aunque duplicados).
- Idempotencia del webhook Telegram por `update_id` en Redis bien hecha.

---

# PARTE 3 — ¿HACE LO QUE DEBE HACER? (vs. SPEC/CRITICAL_POINTS)

| Regla | Veredicto |
|---|---|
| Regla de oro / CP-02 (aprobación humana) | **CUMPLE PARCIAL** — grietas: cadencias `requiere_aprobacion=0` y webhook Telegram falsificable |
| CP-01 Softec solo lectura + vistas `v_cobr_*` | **CUMPLE** (0 usos de tablas crudas) |
| CP-03 disputas no se gestionan | CUMPLE PARCIAL — `lib/telegram/draft-correo.ts` nunca consulta `cobranza_disputas`; el correo consolidado puede incluir facturas en disputa |
| CP-04 anuladas excluidas | CUMPLE |
| CP-05 cuentas bancarias nuevas → confirmación manual | CUMPLE PARCIAL — `matcher.ts:243-248` inserta cuentas nuevas con `confianza='AUTO'` directo |
| CP-06 validación saldo ≤4h antes de enviar | CUMPLE |
| CP-07 tokens portal únicos con expiración | CUMPLE |
| CP-08 todo logueado | CUMPLE PARCIAL — acciones sí; los ERRORES van a console.error, no a `cobranza_logs` como exige CLAUDE.md |
| CP-09/10/12 | CUMPLEN |
| CP-11 auth Telegram | PARCIAL (identidad falsificable sin secret token) |
| CP-13/14/15 saldo a favor | CUMPLEN |
| Segmentación 4 colores | PARCIAL — **VERDE preventivo ("vence en 1-5 días") NO IMPLEMENTADO**: todos los pipelines exigen factura ya vencida; las plantillas VERDE existen pero ningún flujo las dispara |
| Flujo paso 8 (conciliación valida antes de gestionar) | PARCIAL — la conciliación informa (alertas/tareas) pero NO bloquea el envío; la "validación doble" de SPEC §2.3 no existe como compuerta |

### Divergencias documentación ↔ código

- SPEC Módulo 10 "Campañas especiales": NO IMPLEMENTADO.
- SPEC Módulo 4 "escalar si no responde": implementado pero roto (bug B-A6).
- SPEC Módulo 5 "aprobar POR_APLICAR → notificar para registrar en Softec": solo marca CONCILIADO, no notifica ni crea tarea.
- PROGRESS dice plantillas con "envío directo": ese flag no se usa en ningún flujo.
- CLAUDE.md describe N8N como motor del flujo matutino; fue sustituido por BullMQ y la doc no se actualizó.
- CLAUDE.md dice usuario Softec `cobranzas_ro`; PROGRESS:341 sugiere que producción usa `user: softec` — verificar, porque anularía la capa 1 de defensa de CP-01.
- Bug funcional adicional: `generar-cola/route.ts:55` — un cliente con `no_contactar=1` pero sin `pausa_hasta` **sí entra a la cola** (cadencias lo hace bien).

---

# PARTE 4 — ESCALABILIDAD Y SAAS

## ¿Aguanta 1000 usuarios (de Guipak)?

Casi — la capa web es stateless y replicable, pero hay 3 cuellos de botella:
1. **Pools de conexión minúsculos**: Softec `connectionLimit: 5` (`lib/db/softec.ts:23`), propia `10` (`lib/db/cobranzas.ts:15`). Fix barato.
2. **Dashboard sin cache**: ~10 queries por request, varias agregando toda la cartera del ERP (`app/api/cobranzas/dashboard/route.ts:52-314`). Cachear en Redis (ya existe) 1-5 min.
3. **Sin paginación** en cartera-vencida, cola-aprobacion, clientes — devuelven tablas completas.
4. **El más grave**: la IA depende de un gateway LLM local con cola serial de concurrencia 1 y timeouts de 240s (`lib/llm/gateway.ts:5-7,50-56`); `generar-cola` hace hasta 20 llamadas a Claude EN SERIE dentro del request HTTP. Para escala: volver a API cloud y mover la generación al worker BullMQ.

## ¿Sirve como base SaaS multi-empresa?

**No sin reestructuración profunda.** El activo real es la lógica de negocio (flujo de aprobación, cadencias, conciliación, supervisor proactivo). Las brechas:

| Brecha | Esfuerzo |
|---|---|
| Pools + cache dashboard + paginación | Bajo |
| Réplicas horizontales del web (ya es stateless, estado en Redis/MySQL ✓) | Bajo |
| Endurecer auth (S-C1..C3, tenant en JWT, roles por organización) | Medio |
| Logs estructurados, observabilidad, herramienta de migraciones (hoy: SQL numerado aplicado por endpoint HTTP) | Medio |
| Parametrizar los 4 jobs BullMQ + 14 crons HTTP por tenant; subir concurrencia del worker | Medio-Alto |
| `tenant_id` en las ~28 tablas (hoy: CERO noción de tenant) + reescribir todos los WHERE | Alto |
| Extraer hardcodes de Guipak: prompts de IA firmados "Suministros Guipak" (`lib/claude/prompts.ts`), chat ID personal del CEO `7281538057` como fallback (`supervisor-alertas.ts:152` etc.), `cobros@guipak.com`, `@CobrosGuipakBot`, dominio `cobros.sguipak.com`, branding UI, parser específico de Banco Popular | Alto |
| Abstraer el ERP: columnas `IJ_*` aparecen en **51 archivos / 639 ocurrencias**, incluyendo componentes React y el esquema de la DB propia (`cobranza_gestiones.ij_inum`). Cada cliente SaaS tendría otro ERP ⇒ se necesita modelo de dominio canónico + adaptadores | **Alto (la más cara)** |
| Credenciales de integraciones por tenant (hoy: UN número de WhatsApp, UN SMTP, UN bot Telegram, todo en env vars globales) | Alto |

Lo positivo verificado: sin estado en memoria que rompa con réplicas (idempotencia en Redis, sesiones en MySQL, pools module-level), worker BullMQ separado, Docker multi-stage correcto, índices razonables en la DB propia.

---

# PLAN DE ACCIÓN PRIORIZADO

## Fase 0 — Esta semana (seguridad explotable desde internet)
1. Eliminar fallback `'dev-secret-fallback'` de `lib/auth/jwt.ts` y rotar JWT_SECRET (S-C3).
2. Middleware: quitar `includes('.')` y validar el JWT con `jose` (S-C1, S-C2).
3. Secret token en webhooks Telegram (`setWebhook` + validar header) (S-C5).
4. Secreto compartido en `factura-escaneada` (el `N8N_WEBHOOK_SECRET` ya documentado) y validación de origen en webhook WhatsApp.
5. Cerrar `procesar-respuesta` (sacarlo de PUBLIC_PATHS; el webhook WhatsApp debe llamar la función directamente, no por HTTP) y **eliminar el fallback "primer cliente"** (S-C4 + B-C2).
6. Proteger/retirar `internal/admin/migrate`; rechazar `INTERNAL_CRON_SECRET` vacío; comparación timing-safe (S-A1, S-A2).

## Fase 1 — Próximas 2 semanas (dinero y datos correctos)
7. Transición de estado atómica en enviar/aprobar (B-C3) y exclusión de duplicados incluyendo APROBADO/EDITADO (B-M1).
8. Arreglar formato de fechas en conciliación (B-A1, B-A2) — la detección anti-fuga hoy no funciona.
9. Parser de montos robusto (quitar comas antes de parseFloat, CSV con comillas) (B-A4) + dedup de extractos (B-A5).
10. `enviarWhatsApp` debe fallar, no simular éxito (B-A3); `documentos/enviar` debe reportar fallos (B-M8).
11. Corregir enum `direccion` o los filtros de los crons (B-A6).
12. Cadencias: respetar `segmento`, y decidir política sobre `requiere_aprobacion=0` (recomendado: eliminarla y documentar) (B-M2, B-M3).
13. Canal 'AMBOS' y columna de messageId en `enviar-gestion.ts` (B-M4).
14. Escribir estados CUMPLIDO/INCUMPLIDO de acuerdos (B-M6) y corregir scoring (B-M5).

## Fase 2 — Mes 1-2 (robustez y funcionalidad faltante)
15. Implementar VERDE preventivo (facturas por vencer) — está especificado y tiene plantillas, pero ningún flujo lo dispara.
16. Conciliación multi-recibo: restringir a un solo cliente o requerir aprobación humana (B-M7).
17. Compuerta de "validación doble" (Softec + conciliación) antes de enviar, como dice SPEC §2.3.
18. Rate limiting en portal y login; CSRF (Origin check); errores genéricos al cliente.
19. Loguear errores en `cobranza_logs`; reemplazar `xlsx` por `exceljs`.
20. Pools de conexión, cache de dashboard en Redis, paginación.

## Fase 3 — Si decides comercializar como SaaS (proyecto de 3-6 meses)
21. Diseñar modelo de dominio canónico (Factura/Cliente/Pago) y adaptador de ERP; desacoplar `IJ_*` del frontend y de la DB propia.
22. `tenant_id` en todo el esquema + scoping de queries + tenant en JWT.
23. Config y credenciales por tenant (WhatsApp/SMTP/Telegram/branding/prompts) — la tabla `cobranza_configuracion` es la semilla natural.
24. Jobs por tenant, worker escalable, IA por API cloud con cuotas por tenant.
25. Observabilidad (logs estructurados, Sentry/OTel), migraciones con herramienta, CI con `tsc`+lint+tests.
