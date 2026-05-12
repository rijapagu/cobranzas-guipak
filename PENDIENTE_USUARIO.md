# PENDIENTE_USUARIO.md — Acciones manuales pendientes

> Acciones que requieren validación humana, credenciales, acceso a
> producción o decisiones de negocio que no pueden automatizarse.
> Mantener este archivo corto y actual — borrar items cuando se cumplan.

---

## ✅ HECHO SESIÓN 12-MAY-2026

- [x] Header inconsistencia corregida: `cadencias-horarias` ahora usa `x-internal-secret`
      igual que `empuje-matutino`. Commit en master.

---

## 1. Migración 014 en producción (REQUERIDO para cadencias automáticas)

**En Dokploy → cobranzas-mysql → Open Terminal:**

```bash
mysql -uroot -p cobranzas_guipak <<'SQL'
ALTER TABLE cobranza_factura_cadencia_estado
  ADD COLUMN IF NOT EXISTS ultimo_dia_aplicado INT NULL
    COMMENT 'Copia del dia_desde_vencimiento del último paso aplicado para queries rápidos',
  ADD COLUMN IF NOT EXISTS omitir_pasos_previos TINYINT(1) DEFAULT 0
    COMMENT '1 = primer run hizo fast-forward; los pasos anteriores no generan gestion';
SQL
```

Si pide contraseña, la encontrás en Dokploy → Variables de entorno del servicio `cobranzas-mysql` (campo `MYSQL_ROOT_PASSWORD`).

**Verificar:** `DESCRIBE cobranza_factura_cadencia_estado;` debe mostrar las 2 columnas nuevas.

---

## 2. Configurar cron de cadencias en Dokploy (cada hora)

**En Dokploy → cobranzas-guipak → Scheduled Jobs (o via N8N):**

```
URL:    https://cobros.sguipak.com/api/internal/cron/cadencias-horarias
Method: POST
Header: x-internal-secret: <valor de INTERNAL_CRON_SECRET en Dokploy>
Cron:   0 * * * *   (cada hora en punto)
```

**El valor de `INTERNAL_CRON_SECRET`** está en Dokploy → cobranzas-guipak → Variables de entorno.

Primera ejecución: revisar logs. Debe aparecer:
```
[cadencias] N facturas evaluadas, M pasos aplicados, K fast-forward
```

En el primer run, K = casi todas las facturas (fast-forward anti-flood). Es normal.

---

## 3. Privacy mode del bot Telegram (para Capa C)

Para que el bot vea todos los mensajes del grupo sin mención (necesario para la
captura interactiva de datos de la Capa C), Ricardo debe:

1. Ir a `@BotFather` en Telegram.
2. Enviar `/setprivacy`.
3. Seleccionar `@CobrosGuipakBot`.
4. Elegir **Disable**.
5. **Sacar el bot del grupo "Cobros Guipak" y volverlo a agregar** (obligatorio para que el cambio tome efecto).

Sin esto, el bot solo responde cuando se le menciona o se usan comandos.

---

## 4. Pruebas del bot en producción

Enviar estos mensajes al grupo `Cobros Guipak` (con `@CobrosGuipakBot`):

| Mensaje | Resultado esperado |
|---|---|
| `@CobrosGuipakBot saldo de SENADO` | Responde con `cubierto por anticipo = sí`, saldo neto RD$0, saldo a favor ≈ RD$263,599 |
| `@CobrosGuipakBot prepárame correo para SENADO` | Rechaza con `CLIENTE_CUBIERTO_POR_ANTICIPO`, NO crea gestión |
| Abrir https://cobros.sguipak.com → botón "Asistente" (bottom-right) | Widget chat aparece, responde preguntas como el bot Telegram |

---

## 5. Webhook CRM → Cobranzas (configurar en el CRM)

El endpoint ya está listo en producción. Solo necesita configurarse en el CRM:

```
URL:    https://cobros.sguipak.com/api/webhooks/factura-escaneada
Method: POST
Content-Type: application/json

Body:
{
  "numero_factura": "IN-456",
  "ij_inum": 456,
  "codigo_cliente": "0000274",
  "google_drive_id": "1BxiMxxxxxxxxxxxxxxxx",
  "url_pdf": "https://drive.google.com/file/d/1BxiM.../view",
  "fecha_escaneo": "2026-05-12T10:00:00Z"
}
```

**Campos requeridos:** `ij_inum`, `codigo_cliente`, `google_drive_id`.
**Respuesta 200:** `{ "ok": true, "mensaje": "Documento registrado", "ij_inum": 456 }`

---

## 6. Validación cola de cobranza (CP-15)

- [ ] **Cola de cobranza** — correr el job (Telegram: `@CobrosGuipakBot estado de cadencias` o esperar cron).
  Log debe decir `[generar-cola] X clientes excluidos por saldo a favor (CP-15)` con X ≈ 58 (±3).

- [ ] **Empuje matutino Telegram** — próximo empuje (8:00 AM AST) debe mostrar:
  ```
  Cartera vencida (bruta): RD$...
  Saldo a favor (anticipos): RD$...
  Cartera neta (cobrable): RD$...
  ```

---

## Acciones operativas pendientes

- [ ] **WhatsApp Evolution API** — falta API Key + nombre de instancia (evolutionapi.sguipak.com).
- [ ] **Banco(s) de Guipak** — confirmar bancos principales para conciliación.
- [ ] **Formato extractos bancarios** — enviar ejemplos reales (Excel/PDF).
- [ ] **Revisar `/cadencias`** — ajustar días y acciones por segmento según criterio del equipo.

---

## ✅ Migraciones ejecutadas en producción

- [x] `010_fase10_telegram_cadencias.sql`
- [x] `011_plantillas_email.sql`
- [x] `012_plantillas_22_modelos.sql`
- [x] `013_cobranza_tareas.sql`
- [x] `015_memoria_cliente.sql` — tabla `cobranza_memoria_cliente` (11-may-2026)
- [x] `016_configuracion.sql` — tabla `cobranza_configuracion` (11-may-2026)
- [ ] `014_cadencias_estado_mejoras.sql` — **PENDIENTE** (instrucciones en sección 1)

---

## Funcionalidades activas en producción

- [x] Widget "Asistente" en dashboard (chat flotante con aprobación inline)
- [x] Prompt del agente editable en Configuración (ADMIN only)
- [x] Envío manual de facturas PDF desde Gestión Documental
- [x] Búsqueda por nombre de cliente en Reportes
- [x] Memoria Capa 1 del bot (consultar/guardar info comportamental)
- [x] Propuestas WhatsApp desde el bot
- [x] PDF adjunto automático en emails de cobranza
- [x] Saldo a favor descontado en toda la UI (CP-15)
- [x] Badge "Cubierta por anticipo" para 58 clientes cubiertos

---

## Notas técnicas

- **`.claude/settings.local.json` modificado, sin commitear:** permisos locales aprobados durante sesiones. Si limpias el worktree o cambias de máquina, los permisos se vuelven a pedir.
- **Issue #7 (FS lento en E:\):** `next dev` arranca pero compilar páginas tarda. No bloqueante para validar lógica.
