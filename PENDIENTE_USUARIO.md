# PENDIENTE_USUARIO.md — Acciones manuales pendientes

> Acciones que requieren validación humana, credenciales, acceso a
> producción o decisiones de negocio que no pueden automatizarse.
> Mantener este archivo corto y actual — borrar items cuando se cumplan.

---

## Validación visual post-fix CP-15 (sesión 11-may-2026)

### ✅ Validado localmente (11-may-2026)

| Pantalla | Resultado |
|---|---|
| Dashboard `/` | ✅ Cartera Bruta RD$30.5M / Saldo a Favor RD$3.9M / Neta RD$26.6M. Top 10 ordenado por "Saldo Neto". |
| Cartera `/cartera` | ✅ 3 cards globales, columnas "A favor (cliente)" y "Neto (cliente)", badge "Cubierta por anticipo" en clientes cubiertos, neto RD$0.00 en cubiertos. |
| Clientes `/clientes` | ✅ 262 clientes live, columnas "A Favor" y "Saldo Neto", 58 marcados `cubierto_por_anticipo=true`. |
| Portal SENADO `CG0029` | ✅ Alert "Saldo cubierto por anticipo", 4 cards, "Saldo a Pagar: RD$0.00 — Cubierto por tus anticipos". |

### ⏳ Pendiente — validar en producción

- [ ] **Cola de cobranza** — correr el job (manual o esperar cron). Log debe decir
  `[generar-cola] X clientes excluidos por saldo a favor (CP-15)` con X ≈ 58 (±3).

- [ ] **Empuje matutino Telegram** — primer empuje post-deploy (8:00 AM AST) debe mostrar:
  ```
  Cartera vencida (bruta): RD$...
  Saldo a favor (anticipos): RD$...
  Cartera neta (cobrable): RD$...
  ```

- [ ] **Bot Telegram** — probar dos casos:
  - `"saldo de SENADO"` → debe responder con `cubierto_por_anticipo: true`,
    saldo neto en cero, saldo a favor ≈ RD$263,599.
  - `"préparame un correo para SENADO"` → debe responder con motivo
    `CLIENTE_CUBIERTO_POR_ANTICIPO`, NO debe crear gestión.

---

## Capa C — Privacy mode del bot (acción en BotFather)

Para que el bot vea todos los mensajes del grupo sin mención (necesario para
la captura interactiva de datos de la Capa C), Ricardo debe:

1. Ir a `@BotFather` en Telegram.
2. Enviar `/setprivacy`.
3. Seleccionar `@CobrosGuipakBot`.
4. Elegir **Disable**.
5. Sacar el bot del grupo "Cobros Guipak" y volverlo a agregar.

Sin esto, el bot solo responde cuando se le menciona o se usan comandos.

---

## Capa D — Cadencias automáticas

- [ ] Aplicar migration `014_cadencias_estado_mejoras.sql` en producción:
  ```bash
  docker exec -i <contenedor-mysql-prod> mysql -u<user> -p<pass> cobranzas_guipak \
    < db/migrations/014_cadencias_estado_mejoras.sql
  ```

- [ ] Configurar el endpoint de cadencias en el cron de Dokploy (cada hora):
  ```
  URL: https://cobros.sguipak.com/api/internal/cron/cadencias-horarias
  Method: POST
  Header: Authorization: Bearer <INTERNAL_CRON_SECRET>
  Schedule: 0 * * * *
  ```
  O alternativamente, levantar el worker BullMQ en Dokploy (ya tiene el job
  programado una vez que el worker arranca).

- [ ] Primera ejecución: revisar logs. El worker aplica protección anti-flood
  en el primer run por factura (fast-forward), así que NO generará cientos de
  gestiones. Confirmar en el log: `[cadencias] N facturas evaluadas, M pasos
  aplicados, K fast-forward`.

- [ ] Revisar la página `/cadencias` en producción y ajustar la configuración
  según el criterio del equipo (días, acciones por segmento).

---

## Acciones operativas

- [ ] **WhatsApp Evolution API** — falta API Key + nombre de instancia
  (evolutionapi.sguipak.com).
- [ ] **Webhook CRM → Cobranzas** — el CRM debe enviar POST a
  `https://cobros.sguipak.com/api/webhooks/factura-escaneada`.
- [ ] **Banco(s) de Guipak** — confirmar bancos principales para conciliación.
- [ ] **Formato extractos bancarios** — enviar ejemplos reales (Excel/PDF).

---

## ✅ Migraciones ejecutadas en producción (11-may-2026 sesión 2)

- [x] `015_memoria_cliente.sql` — tabla `cobranza_memoria_cliente` (vía terminal Dokploy)
- [x] `016_configuracion.sql` — tabla `cobranza_configuracion` (vía terminal Dokploy)
- [x] Prompt del agente guardado desde la UI de Configuración

---

## Funcionalidades nuevas desplegadas (11-may-2026 sesión 2)

- [x] Widget "Asistente" en dashboard (chat flotante con aprobación inline)
- [x] Prompt del agente editable en Configuración (ADMIN only)
- [x] Envío manual de facturas PDF desde Gestión Documental
- [x] Búsqueda por nombre de cliente en Reportes
- [x] Memoria Capa 1 del bot (consultar/guardar info comportamental)
- [x] Propuestas WhatsApp desde el bot
- [x] PDF adjunto automático en emails de cobranza

---

## Notas técnicas menores

- **`.claude/settings.local.json` modificado, sin commitear:** permisos locales
  aprobados durante las sesiones 10-11 may. Si limpias el worktree o cambias
  de máquina, los permisos se vuelven a pedir.
- **Issue #7 (FS lento en E:\):** `next dev` arranca pero compilar páginas tarda.
  No bloqueante para validar lógica, sí ralentiza la validación visual.
