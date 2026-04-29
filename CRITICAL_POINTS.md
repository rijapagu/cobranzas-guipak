# CRITICAL_POINTS.md — Puntos Críticos del Sistema
> **LEER ANTES DE CUALQUIER MODIFICACIÓN.**
> Cada cambio en el código debe verificar que estos puntos siguen intactos.
> Si una modificación rompe alguno de estos puntos, NO se hace el commit.

---

## ⛔ CP-01 — Softec es SOLO LECTURA

**Descripción:** La base de datos de Softec (ERP) nunca debe ser modificada desde este sistema.

**Implementación:**
- El usuario MySQL de Softec tiene permisos SOLO de SELECT
- La conexión en `lib/db/softec.ts` NO debe tener métodos de escritura
- Cualquier función que use `softecDb` solo puede llamar `.query()` con SELECT
- Los datos enriquecidos (teléfonos, emails adicionales) se guardan en `cobranzas_guipak`, NUNCA en Softec

**Verificación:**
```typescript
// ✅ CORRECTO
const result = await softecDb.query('SELECT * FROM ijnl WHERE ...');

// ❌ PROHIBIDO — nunca debe existir esto
await softecDb.query('UPDATE icust SET IC_EMAIL = ...');
await softecDb.query('INSERT INTO ...');
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

## Checklist antes de cada PR/commit

- [ ] ¿Algún query sobre `ijnl` omite `IJ_INVTORF = 'T'` o `IJ_TYPEDOC = 'IN'`? → **NO hacer commit**
- [ ] ¿Algún endpoint envía mensaje sin verificar `estado = 'APROBADO'`? → **NO hacer commit**
- [ ] ¿Alguna función escribe en Softec? → **NO hacer commit**
- [ ] ¿Se procesa automáticamente una cuenta bancaria desconocida? → **NO hacer commit**
- [ ] ¿Se genera mensaje para factura en disputa? → **NO hacer commit**
- [ ] ¿Se usa datos de Softec con caché de más de 4 horas para enviar? → **NO hacer commit**
- [ ] ¿La acción queda registrada en `cobranza_logs`? → Si no → **agregar antes del commit**

---

*Versión: 1.0 — Abril 2026*
