# CRITICAL_POINTS.md — Puntos Críticos del Sistema
> **LEER ANTES DE CUALQUIER MODIFICACIÓN.**
> Cada cambio en el código debe verificar que estos puntos siguen intactos.
> Si una modificación rompe alguno de estos puntos, NO se hace el commit.

---

## ⛔ CP-01 — Softec es SOLO LECTURA

**Descripción:** La base de datos de Softec (ERP) nunca debe ser modificada desde este sistema.

**Defensa en profundidad — tres capas:**

1. **A nivel motor MySQL (la más fuerte):**
   - Usuario `cobranzas_ro@31.97.131.17` con `GRANT SELECT` solo sobre vistas `v_cobr_*`.
   - Restringido por IP — solo conecta desde el VPS srv869155.
   - No tiene acceso a tablas crudas (`ijnl`, `icust`, etc.).
   - Setup en: `scripts/setup-softec-cobranzas-readonly.sql`.

2. **A nivel de pool (`lib/db/softec.ts`):**
   - `multipleStatements: false` — bloquea inyección de queries múltiples.
   - No expone función de escritura (no hay `softecExecute`, solo `softecQuery`).

3. **A nivel de query (regex):**
   - Strip de comentarios SQL (`/* */`, `--`, `#`) antes de validar.
   - Solo se permiten queries que empiezan por `SELECT|WITH|SHOW|EXPLAIN|DESCRIBE`.
   - Rechaza si aparecen keywords de escritura (`INSERT|UPDATE|DELETE|CALL|LOAD|SET|...`)
     en cualquier punto del query.

**Implementación en código:**
- Las queries usan vistas `v_cobr_*`, NO las tablas crudas (`ijnl`, `icust`, `irjnl`, `ijnl_pay`).
- Los datos enriquecidos (teléfonos, emails adicionales) se guardan en `cobranzas_guipak`, NUNCA en Softec.

**Verificación:**
```typescript
// ✅ CORRECTO
const result = await softecQuery('SELECT * FROM v_cobr_ijnl WHERE ...');

// ❌ PROHIBIDO — la app no debe tocar tablas crudas
await softecQuery('SELECT * FROM ijnl WHERE ...');  // falla por ERROR 1142

// ❌ PROHIBIDO — el guard rechaza esto
await softecQuery('UPDATE v_cobr_icust SET IC_EMAIL = ...');
await softecQuery('/* comentario */ INSERT INTO ...');
```

**Consecuencia si se rompe:** Corrupción del ERP de producción de Guipak.

---

## ⛔ CP-02 — Ningún mensaje sale sin aprobación humana

**Descripción:** El sistema nunca envía mensajes a clientes sin que un supervisor haya aprobado explícitamente ese mensaje específico.

**Implementación:**
- La tabla `cobranza_gestiones` tiene campo `aprobado_por` (NOT NULL antes de enviar)
- El campo `estado` debe ser `'APROBADO'` antes de llamar a Evolution API o SMTP
- La API de envío (`/api/cobranzas/enviar`) debe verificar estado antes de ejecutar
- N8N nunca llama directamente a Evolution API — siempre pasa por la API del sistema

**Verificación:**
```typescript
// En /api/cobranzas/enviar — SIEMPRE verificar esto
const gestion = await db.query(
  'SELECT * FROM cobranza_gestiones WHERE id = ? AND estado = "APROBADO" AND aprobado_por IS NOT NULL',
  [id]
);
if (!gestion) throw new Error('Gestión no aprobada');
```

**Consecuencia si se rompe:** Mensajes no autorizados salen a clientes, daño a la relación comercial.

---

## ⛔ CP-03 — Facturas en disputa no se gestionan

**Descripción:** Una factura con disputa activa (estado `ABIERTA` o `EN_REVISIÓN`) no debe aparecer en la cola de cobranzas ni generar mensajes.

**Implementación:**
- El query de cartera vencida debe excluir facturas con disputa activa
- Al generar la cola de aprobación, verificar contra `cobranza_disputas`
- Al recibir un nuevo pago o mensaje sobre una factura en disputa, notificar al supervisor pero NO gestionar

**Verificación:**
```sql
-- Este JOIN debe estar SIEMPRE en el query de cartera activa
LEFT JOIN cobranza_disputas d
    ON d.ij_inum = f.IJ_INUM
    AND d.estado IN ('ABIERTA', 'EN_REVISION')
WHERE d.id IS NULL  -- excluir si tiene disputa activa
```

**Consecuencia si se rompe:** Cliente en disputa recibe presión de cobro, posible conflicto legal.

---

## ⛔ CP-04 — Facturas anuladas/canceladas excluidas siempre

**Descripción:** Las facturas con `IJ_INVTORF = 'V'` (canceladas) o `IJ_TYPEDOC != 'IN'` nunca deben aparecer en cobranzas.

**Implementación:**
- Todo query sobre `ijnl` SIEMPRE incluye `AND IJ_INVTORF = 'T'`
- Todo query sobre `ijnl` SIEMPRE incluye `AND IJ_TYPEDOC = 'IN'`
- No hay excepción a estas condiciones

**Verificación:**
```sql
-- SIEMPRE presente en cualquier SELECT sobre ijnl
WHERE IJ_TYPEDOC = 'IN'
AND   IJ_INVTORF = 'T'
AND   IJ_PAID = 'F'
AND   (IJ_TOT - IJ_TOTAPPL) > 0
```

**Consecuencia si se rompe:** Se cobra a clientes por facturas que no existen o ya fueron canceladas.

---

## ⛔ CP-05 — Cuentas bancarias nuevas requieren confirmación manual

**Descripción:** La primera vez que aparece una transferencia de una cuenta bancaria desconocida, SIEMPRE requiere que el supervisor la asigne manualmente a un cliente antes de procesar.

**Implementación:**
- El parser de extractos bancarios clasifica cuentas desconocidas como estado `'DESCONOCIDO'`
- Las entradas `'DESCONOCIDO'` NO se procesan automáticamente
- Solo después de que el supervisor confirma la asignación, el sistema aprende y puede proponer automáticamente
- El campo `confianza` en `cobranza_cuentas_aprendizaje` empieza en `'MANUAL'` y pasa a `'AUTO'` solo tras confirmación

**Verificación:**
```typescript
// Al procesar conciliación
if (cuenta.confianza === 'AUTO' && cuenta.veces_usado >= 1) {
  // Proponer automáticamente, pero mostrar para confirmación
} else {
  // Siempre requiere asignación manual
  return { estado: 'DESCONOCIDO', requiere_accion: true };
}
```

**Consecuencia si se rompe:** Pago asignado al cliente equivocado, error financiero.

---

## ⛔ CP-06 — Validación de saldo antes de gestionar

**Descripción:** Antes de generar cualquier mensaje de cobranza, el sistema SIEMPRE verifica el saldo actual en Softec, no usa datos cacheados de más de 4 horas.

**Implementación:**
- El campo `ultima_consulta_softec` en `cobranza_gestiones` no puede tener más de 4 horas
- Si el cache está vencido, re-consultar Softec antes de generar mensaje
- Si `(IJ_TOT - IJ_TOTAPPL) <= 0`, cancelar la gestión inmediatamente aunque ya estuviera en cola

**Verificación:**
```typescript
const horasCache = differenceInHours(new Date(), gestion.ultima_consulta_softec);
if (horasCache > 4) {
  const saldoActual = await consultarSaldoSoftec(ij_inum);
  if (saldoActual <= 0) {
    await cancelarGestion(gestion.id, 'FACTURA_PAGADA');
    return;
  }
}
```

**Consecuencia si se rompe:** Se cobra a un cliente que ya pagó — el peor error posible del sistema.

---

## ⛔ CP-07 — Tokens del portal de cliente son únicos y expiran

**Descripción:** Cada link del portal de autogestión tiene un token único por cliente y expira en 30 días.

**Implementación:**
- Token generado con `crypto.randomUUID()` + firma HMAC
- Guardado en `cobranza_portal_tokens` con `fecha_expiracion`
- Cada request al portal verifica que el token existe y no ha expirado
- Un token usado no se reutiliza para otro cliente

**Verificación:**
```typescript
const token = await db.query(
  'SELECT * FROM cobranza_portal_tokens WHERE token = ? AND fecha_expiracion > NOW() AND activo = 1',
  [tokenParam]
);
if (!token) return { status: 401, error: 'Token inválido o expirado' };
```

**Consecuencia si se rompe:** Un cliente puede ver facturas de otro cliente — violación de privacidad comercial.

---

## ⛔ CP-08 — Registro de toda acción en logs

**Descripción:** Cada acción del sistema (envío, aprobación, rechazo, conciliación, etc.) debe quedar registrada en `cobranza_logs` con usuario, timestamp y detalle.

**Implementación:**
- Middleware de logging en todas las API routes de acción
- Ninguna acción de escritura se hace sin escribir primero en `cobranza_logs`
- Los logs son append-only — nunca se borran ni modifican

**Verificación:**
```typescript
// Patrón obligatorio en cada acción
await db.query(
  'INSERT INTO cobranza_logs (usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?)',
  [userId, 'MENSAJE_APROBADO', 'gestion', gestionId, JSON.stringify(detalle), ip]
);
// Solo DESPUÉS del log, ejecutar la acción
await enviarMensaje(...);
```

**Consecuencia si se rompe:** Sin auditoría, imposible saber qué pasó ante un error o reclamo.

---

## ⚠️ CP-09 — Separación estricta de entornos DB

**Descripción:** Las dos conexiones de base de datos nunca se mezclan.

**Regla:**
- `softecDb` → solo para leer de Softec
- `cobranzasDb` → para leer y escribir en cobranzas_guipak
- Ninguna función recibe una conexión arbitraria — siempre usa el cliente correcto por nombre

---

## ⚠️ CP-10 — Claude AI no envía mensajes directamente

**Descripción:** Claude AI solo genera texto. Nunca tiene acceso directo a Evolution API ni a SMTP. Siempre devuelve texto al sistema, que lo pone en cola para aprobación humana.

**Implementación:**
- Las funciones en `lib/claude/` solo retornan `string` (el mensaje generado)
- Nunca importan ni llaman a `lib/evolution/` ni a funciones de email
- El flujo: Claude genera → sistema guarda en cola → supervisor aprueba → sistema envía

**Excepción permitida:** El bot de Telegram (`lib/telegram/agent.ts`) sí puede responder a usuarios internos en el grupo de cobros con texto generado por Claude. Esto NO contradice CP-02 porque los mensajes son al equipo interno, no a clientes.

---

## ⚠️ CP-11 — Identidad y autorización en Telegram (Fase 10)

**Descripción:** Todo mensaje recibido del bot de Telegram debe identificar y autorizar al usuario antes de responder.

**Implementación:**
- `lib/telegram/auth.ts` resuelve `telegram_user_id` → `usuario_id` interno via tabla `cobranza_telegram_usuarios`
- Si el usuario no está mapeado o está inactivo → bot responde "No estás autorizado" y registra el intento
- Acciones de rol Supervisor (aprobar montos > umbral, escalar legal) verifican `rol = 'supervisor'`
- En grupos: solo procesa mensajes del `TELEGRAM_CHAT_ID_GRUPO_COBROS` configurado
- En privado: solo procesa si el usuario está en la tabla de autorizados

**Verificación:**
```typescript
const auth = await resolverUsuarioTelegram(message.from.id);
if (!auth) {
  // No autorizado — responder y salir
  return;
}
```

---

## ⚠️ CP-12 — Auditoría de acciones por chat (Fase 10)

**Descripción:** Cada acción del bot que modifica DB debe registrar en `cobranza_logs` con trazabilidad completa.

**Implementación:**
- Webhook `/api/webhooks/telegram` registra cada query del bot:
  - `usuario_id` (resuelto desde `telegram_user_id`)
  - `accion`: `'BOT_TELEGRAM_QUERY'` o similar
  - `entidad`: `'telegram'`
  - `detalle`: JSON con `chat_id`, `message_id`, `texto` truncado a 500 chars, `telegram_user_id`
  - `ip`: `'telegram-webhook'`

**Consecuencia si se rompe:** No hay forma de auditar quién hizo qué consulta o acción desde el bot.

---

## ⚠️ CP-13 — JOIN factura↔pago por IR_PLOCAL/IR_PTYPDOC/IR_RECNUM (no IR_F*)

**Descripción:** Para cruzar un recibo (`ijnl_pay`) con sus aplicaciones (`irjnl`), usar las columnas que apuntan al **recibo**: `IR_PLOCAL`, `IR_PTYPDOC`, `IR_RECNUM`. No usar las columnas `IR_F*` (que apuntan a la factura) porque en Guipak vienen vacías/inconsistentes a nivel de pago.

**Implementación:**
```sql
LEFT JOIN v_cobr_irjnl r
    ON  r.IR_PLOCAL  = pay.IJ_LOCAL
    AND r.IR_PTYPDOC = pay.IJ_SINORIN
    AND r.IR_RECNUM  = pay.IJ_RECNUM
```

**Donde se aplica:** todo cálculo de "saldo a favor" del cliente y cualquier reporte que necesite saber cuánto de un recibo ya fue aplicado.

**Documentado en:** `lib/cobranzas/saldo-favor.ts` (JSDoc del helper).

**Consecuencia si se rompe:** el saldo a favor se calcula con datos inconsistentes (IR_F* a veces tiene NULL, a veces el número correcto). Resultado: aplicación parcial mal calculada, sobrecobros o subcobros aleatorios.

---

## ⚠️ CP-14 — No usar IJ_ONLPAID ni montos desglosados de recibos

**Descripción:** Para calcular "cuánto se aplicó a una factura" o "cuánto queda sin aplicar de un recibo", usar siempre `IR_AMTPAID` agregado de `v_cobr_irjnl`. **No usar** `IJ_ONLPAID` ni desglosados de `v_cobr_ijnl_pay` que no estén alineados con el JOIN de CP-13.

**Razón:** `IJ_ONLPAID` y otros campos a nivel `ijnl_pay` reportan totales que no siempre cuadran contra la suma real de aplicaciones — son metadata cacheada por Softec que se desincroniza con notas de crédito y aplicaciones reversadas.

**Patrón correcto:**
```sql
SELECT pay.IJ_TOT - IFNULL(ap.aplicado, 0) AS sin_aplicar
FROM v_cobr_ijnl_pay pay
LEFT JOIN (
  SELECT IR_PLOCAL, IR_PTYPDOC, IR_RECNUM, SUM(IR_AMTPAID) AS aplicado
  FROM v_cobr_irjnl
  GROUP BY IR_PLOCAL, IR_PTYPDOC, IR_RECNUM
) ap ON  ap.IR_PLOCAL=pay.IJ_LOCAL
     AND ap.IR_PTYPDOC=pay.IJ_SINORIN
     AND ap.IR_RECNUM=pay.IJ_RECNUM
```

**Documentado en:** `lib/cobranzas/saldo-favor.ts` (JSDoc del helper) y validado contra el endpoint `/api/cobranzas/clientes/[codigo]/estado-cuenta` el 8-may-2026.

**Consecuencia si se rompe:** el "saldo a favor" del cliente queda desfasado entre vistas; el helper, dashboard y portal reportan números distintos.

---

## ⛔ CP-15 — Restar saldo a favor del cliente en todo agregado de cartera; excluir cubiertos de cobranza

**Descripción:** Toda cifra de cartera vencida que se presente a un humano (dashboard, portal, reportes, bot, empuje matutino) debe descontar el "saldo a favor" del cliente (recibos sin aplicar a facturas). Si el saldo a favor cubre o supera el pendiente bruto del cliente, ese cliente **no debe recibir cobranza** — la acción correcta es que contabilidad aplique el anticipo.

**Decisión de producto (10-may-2026):** opción B — excluir de la cola de cobranza a los clientes con saldo a favor ≥ pendiente; sus facturas siguen visibles en cartera, marcadas con el badge "Cubierta por anticipo". Esto evita cobrar a clientes que ya pagaron de más.

**Evidencia (validada contra Softec producción 10-may-2026):**

| Métrica | Valor |
|---|---|
| Cartera bruta (sumando `IJ_TOT - IJ_TOTAPPL`) | **$31.45M** |
| Saldo a favor global (sumando recibos sin aplicar) | $8.43M |
| **Saldo a favor aplicable** (limitado al pendiente de cada cliente) | **$3.94M** |
| Cartera neta cobrable (bruto − aplicable) | **$27.51M** |
| Sobrecobro reportado al usuario | **14.6%** |
| **Clientes con saldo a favor ≥ pendiente** | **58** (esperado 57, tolerancia ±3) |

**Top casos validados:**

| Cliente | Pendiente | Saldo a favor | Estado |
|---|---|---|---|
| `CG0029` SENADO | $187,620 | $263,599 | Cubierto |
| Universidad Católica `0000997` | (parcial) | $1,313,414 | A favor parcial |
| Tribunal Constitucional | (parcial) | (significativo) | A favor parcial |
| MICM | (parcial) | (significativo) | A favor parcial |
| `SR0017` | (parcial) | $277,699 | A favor parcial |

**Fórmula recomendada:**

```typescript
saldo_neto = max(0, pendiente_bruto - saldo_a_favor);
cubierto_por_anticipo = saldo_a_favor >= pendiente_bruto && pendiente_bruto > 0;
```

**Helper canónico:** `lib/cobranzas/saldo-favor.ts`. Tres exports:
- `obtenerSaldoAFavorPorCliente(codigos?)` — `Map<codigo, monto_a_favor>`. Una sola query con sub-agregado por recibo (filtra recibos con `sin_aplicar > 0.01`).
- `ajustarSaldoCliente(saldoBruto, saldoFavor)` — calcula `saldo_neto` y `cubierto_por_anticipo`.
- `ajustarSaldoClientes(pendientesPorCliente)` — atajo combinado para listas.

**Fundamento técnico:** depende de CP-13 (JOIN correcto recibo↔aplicación) y CP-14 (no usar `IJ_ONLPAID` ni desglosados). Si se rompe alguno de esos, CP-15 también se rompe.

**14 superficies corregidas (10-11 may 2026):**

| # | Superficie | Commit |
|---|---|---|
| 1 | `/api/softec/cartera-vencida` | `336808c` |
| 2 | `/api/softec/resumen-segmentos` | `336808c` |
| 3 | `/api/cobranzas/dashboard` | `336808c` |
| 4 | `/api/cobranzas/clientes` | `336808c` |
| 5 | `/api/cobranzas/alertas` | `336808c` |
| 6 | `/api/cobranzas/reportes/cartera-excel` | `336808c` |
| 7 | `/api/cobranzas/reportes/estado-cuenta-excel` | `92be701` |
| 8 | `/api/portal/[token]` | `8602b97` |
| 9 | `/api/cobranzas/generar-cola` | `291eb6c` |
| 10 | bot Telegram tool `consultar_saldo_cliente` | `4fe33a3` |
| 11 | bot Telegram tool `estado_cobros_hoy` | `4fe33a3` |
| 12 | bot Telegram tool `buscar_cliente` | `4fe33a3` |
| 13 | bot Telegram tool `proponer_correo_cliente` (bloqueo CP-15) | `4fe33a3` |
| 14 | job `lib/queue/jobs/empuje-matutino.ts` (mensaje Telegram diario) | `4fe33a3` |

**UI:**
- Dashboard `/`: tres cards de cartera (bruta / a favor / neta). Commit `ed63e2c`.
- Cartera `/cartera`: fila opcional con totales globales si hay anticipos; columnas "A favor (cliente)" y "Neto (cliente)" en la tabla; badge "Cubierta por anticipo". Commit `ed63e2c`.
- Clientes `/clientes`: columna "Saldo Neto" como primaria (sorter default desc), columna "A favor" intermedia, badge "Cubierto por anticipo". Commit `ed63e2c`.
- Portal cliente: alert success/info con mensaje pre-formateado; resumen de 2 a 4 cards cuando hay anticipo. Commit `d7bcaee`.

**Smoke tests:**
- `scripts/test-saldo-favor.ts` — 22 asserts del helper contra Softec real.
- `scripts/test-saldo-favor-telegram.ts` — 10 asserts del flujo telegram + empuje matutino.

**Verificación al escribir código nuevo:**
```typescript
// ✅ CORRECTO — usar el helper
import { ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';
const ajuste = ajustarSaldoCliente(saldoBruto, saldoFavor);
mostrarAlUsuario(ajuste.saldo_neto);

// ❌ PROHIBIDO en agregados que se presenten al humano
const total = await softecQuery(`SELECT SUM(IJ_TOT - IJ_TOTAPPL) FROM v_cobr_ijnl ...`);
mostrarAlUsuario(total);  // ← sobrecobra ~14.6%
```

**Excepciones permitidas:** el bruto sigue siendo correcto y útil como:
- Cifra contable estándar (DSO se queda con bruto — métrica de la disciplina contable).
- Subtítulo discreto en cards/tablas cuando se quiere mostrar también la cifra bruta.
- Suma de "Saldo factura" a nivel de fila individual (saldo de la factura ≠ saldo del cliente).

**Consecuencia si se rompe:** se vuelven a sobrecobrar facturas a clientes que ya pagaron de más; el dashboard infla la cartera; el bot avisa de "$31M pendientes" cuando lo cobrable real es $27.5M; clientes cubiertos reciben correos de cobranza injustos y se quejan.

---

## Checklist antes de cada PR/commit

- [ ] ¿Algún query sobre `ijnl` omite `IJ_INVTORF = 'T'` o `IJ_TYPEDOC = 'IN'`? → **NO hacer commit** (CP-04)
- [ ] ¿Algún endpoint envía mensaje sin verificar `estado = 'APROBADO'`? → **NO hacer commit** (CP-02)
- [ ] ¿Alguna función escribe en Softec? → **NO hacer commit** (CP-01)
- [ ] ¿Se procesa automáticamente una cuenta bancaria desconocida? → **NO hacer commit** (CP-05)
- [ ] ¿Se genera mensaje para factura en disputa? → **NO hacer commit** (CP-03)
- [ ] ¿Se usa datos de Softec con caché de más de 4 horas para enviar? → **NO hacer commit** (CP-06)
- [ ] ¿La acción queda registrada en `cobranza_logs`? → Si no → **agregar antes del commit** (CP-08)
- [ ] ¿Algún cálculo de saldo cliente que se muestre al usuario suma `IJ_TOT - IJ_TOTAPPL` sin pasar por `ajustarSaldoCliente()` / `obtenerSaldoAFavorPorCliente()`? → **NO hacer commit** (CP-15)
- [ ] ¿Algún JOIN de recibo↔aplicación usa `IR_F*` en lugar de `IR_PLOCAL/IR_PTYPDOC/IR_RECNUM`? → **NO hacer commit** (CP-13)

---

*Versión: 1.1 — 11 Mayo 2026*
