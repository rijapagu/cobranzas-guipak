# Manual de Usuario — Sistema de Cobranzas Guipak

> **Para el equipo de cobros de Suministros Guipak, S.R.L.**
> Versión 1.0 · Abril 2026

---

## 📍 Cómo entrar

**App web:** [https://cobros.sguipak.com](https://cobros.sguipak.com)

Te logeas con tu correo y contraseña que te dio Ricardo. La sesión queda guardada en el navegador, no tienes que volver a entrar cada vez.

**Bot de Telegram:** `@CobrosGuipakBot`
- En el grupo "Cobros Guipak" — menciónalo: `@CobrosGuipakBot ¿cuánto debe X cliente?`
- En privado — abre el bot y escríbele directo (sin mención)

---

## 🌟 La idea principal en 3 líneas

1. **Softec es la fuente de verdad** — la cartera, las facturas y los pagos vienen de ahí. Esta app no modifica Softec, solo lo lee.
2. **Tú decides, la IA propone** — la IA redacta correos y sugiere acciones, pero ningún correo sale al cliente sin tu aprobación.
3. **Todo queda registrado** — quién aprobó qué, cuándo se envió, quién pagó cuándo. Auditoría completa.

---

## 🗺️ Tour por la app

### 1. Dashboard

La pantalla principal cuando entras. Te muestra de un vistazo:

- **Cartera total vencida** y cuántas facturas son
- **DSO** (Days Sales Outstanding) — cuántos días en promedio se demora el cliente en pagarte. Más bajo = mejor.
- **Distribución por segmento** (verde/amarillo/naranja/rojo)
- **Top 10 clientes** con mayor saldo vencido
- **Efectividad por canal** — qué tasa de respuesta tienen WhatsApp vs Email
- **Acuerdos** — pendientes, cumplidos, incumplidos
- **Alertas en vivo** — promesas vencidas, mensajes pendientes de aprobar, clientes sin contacto

> 💡 **Lo primero al llegar cada mañana:** revisa este dashboard. Te dice dónde está el problema.

---

### 2. Cartera Vencida

La lista completa de facturas pendientes. Aquí filtras por:
- Segmento (verde/amarillo/naranja/rojo)
- Vendedor
- Días vencido
- Monto
- Búsqueda libre por cliente o factura

**Click en una fila** → se abre el detalle con datos del cliente, historial de pagos y opciones.

**Segmentación de riesgo:**
| Color | Días | Acción típica |
|---|---|---|
| 🟢 VERDE | Vence en 1-5 días | Recordatorio amigable |
| 🟡 AMARILLO | Vencida 1-15 días | Aviso, urgencia moderada |
| 🟠 NARANJA | Vencida 16-30 días | Cobranza formal |
| 🔴 ROJO | Vencida 30+ días | Gestión intensa, posible legal |

---

### 3. Cola de Aprobación

**Acá pasa la magia.** Cada mensaje que la IA propone (recordatorios, respuestas a clientes, etc.) cae aquí esperando tu visto bueno.

Por cada mensaje verás:
- Cliente, factura, monto, días vencido
- **Preview de WhatsApp** (con burbuja como si fuera el celular)
- **Preview de Email** (asunto + cuerpo)
- Indicadores: ¿tiene PDF? ¿tiene contacto registrado?

**Tus 5 acciones:**
| Botón | Qué hace |
|---|---|
| ✅ **Aprobar** | Aprueba tal cual y prepara para envío |
| ✏️ **Editar y Aprobar** | Modificas el texto antes de aprobar |
| ❌ **Descartar** | No se envía. Te pide motivo. |
| ⏩ **Escalar** | Marca para gestión gerencial (Ricardo) |
| ⏸️ **Pausar cliente** | No gestionar a este cliente por X días |

> ⚠️ **Regla de oro:** ningún correo o WhatsApp sale al cliente sin que alguien lo apruebe en esta cola. Si la IA se confunde, tú lo cachas aquí.

---

### 4. Conciliación Bancaria

Cuando el banco te manda el extracto, lo subes aquí (Excel o CSV). El sistema lo cruza contra Softec y clasifica cada movimiento:

- ✅ **Conciliado** — el pago coincide con un registro en Softec, todo bien.
- ⚠️ **Por aplicar** — entró plata al banco pero no está registrada en Softec. **Acción:** notificar a contabilidad.
- ❓ **Desconocido** — no sabemos qué cliente lo envió. **Acción:** asignar manualmente.

**El sistema aprende.** La primera vez que llega una transferencia de cuenta `XXXX-1234`, le asignas el cliente. La próxima vez, lo propone solo. Tú confirmas o corriges.

> 🔒 **Nunca se aplica un pago automáticamente la primera vez.** Siempre requiere confirmación manual.

---

### 5. Clientes

Vista de todos los clientes con cartera, enriquecida con datos que **tú agregas** (la app no modifica Softec).

**Para qué sirve:**
- Cliente sin email en Softec → agregas el email aquí
- Cliente sin WhatsApp → idem
- Cliente sin contacto de cobros → idem
- Pausar gestión de un cliente por X días (vacaciones, acuerdo en proceso, etc.)
- Marcar "no contactar" con motivo (caso especial)

**Generar link del portal del cliente:**
Cada cliente puede tener un link único (válido 30 días) para que él mismo vea sus facturas pendientes y descargue PDFs.

---

### 6. Conversaciones

Historial completo de WhatsApp y Email con cada cliente. Como un chat de WhatsApp, pero tú no respondes directo desde aquí — las respuestas las propone la IA y tú las apruebas en la cola.

Útil para:
- Ver qué le dijiste y qué te dijo el cliente
- Detectar promesas de pago (la IA las marca automáticamente)
- Ver disputas registradas

---

### 7. Disputas

Cuando un cliente reclama una factura ("no es mi monto", "no recibí la mercancía", etc.), se registra aquí.

**Estados:**
- `ABIERTA` — el cliente reportó el problema
- `EN_REVISIÓN` — el equipo lo está analizando
- `RESUELTA` — cerrada con resolución
- `ANULADA` — la factura se anuló

> 🚨 **Importante:** una factura con disputa **ABIERTA** o **EN_REVISIÓN** **NO se gestiona** desde el sistema. No le mandas correos hasta resolver la disputa.

---

### 8. Documentos

Aquí están las facturas escaneadas (PDF firmado/sellado del cliente).

- Cuando el equipo de CRM sube una factura a Drive, **se vincula automáticamente** acá.
- También puedes subir manualmente: pones el ID de Google Drive y listo.
- Los correos de cobranza incluyen automáticamente el link al PDF si está vinculado.

---

### 9. Reportes

3 reportes exportables a Excel:

1. **Cartera vencida completa** — todas las facturas con todos los datos
2. **Historial de gestiones** — qué se hizo en un período (filtras por fechas)
3. **Estado de cuenta por cliente** — facturas pendientes de un cliente específico

---

### 10. Plantillas (NUEVO 🆕)

**Aquí controlas qué dicen los correos de cobranza.** El sistema usa estas plantillas para que la IA las personalice con los datos de cada cliente.

**Plantillas iniciales:**

| # | Nombre | Cuándo se aplica | Tono |
|---|---|---|---|
| 1 | Recordatorio amigable | 3 días antes de vencer | AMIGABLE |
| 2 | Vencimiento moderado | 7 días vencida | MODERADO |
| 3 | Cobranza formal | 20 días vencida | FORMAL |
| 4 | Cobranza intensa (última oportunidad) | 35 días vencida | FIRME |
| 5 | Pre-legal | 60 días vencida | LEGAL |
| 6 | Notificación legal | 90 días vencida | LEGAL |

**Variables que se reemplazan automáticamente:**
- `{{cliente}}` → nombre del cliente
- `{{contacto}}` → contacto de cobros del cliente
- `{{factura}}` → número de factura
- `{{ncf}}` → NCF fiscal
- `{{monto}}` → saldo pendiente con formato RD$
- `{{dias_vencido}}` → cuántos días lleva vencida
- `{{fecha_vencimiento}}` → fecha de vencimiento

**Cómo editar una plantilla:**
1. Click en el ícono de lápiz en la fila
2. Pestaña "Configuración" — ajustas segmento, días, tono, si requiere aprobación
3. Pestaña "Contenido del correo" — cambias asunto y cuerpo
4. Click en una variable de las cajitas para insertarla en el cuerpo

**Aprobación automática vs manual:**
- **Manual** (recomendado) — el correo va a la cola de aprobación.
- **Auto** — se envía sin pasar por la cola. Solo activarlo en la plantilla #1 (amigable, bajo riesgo).

> 💡 **Tip:** prueba cambios en una plantilla y mírala en acción mañana cuando se genere la cola del día.

---

### 11. Configuración

Variables del sistema y prueba de conexiones (Softec, Claude, Evolution, SMTP, Drive).

---

## 🤖 Cómo usar el bot de Telegram

El bot es tu **asistente de cobros en el celular**.

### Comandos rápidos

| Comando | Qué hace |
|---|---|
| `/start` | Saludo + guía rápida |
| `/help` | Lista de comandos |
| `/estado` | Resumen del día (cartera, alertas, pendientes) |

### Lenguaje natural — pregunta lo que quieras

Ejemplos reales:

```
@CobrosGuipakBot ¿cuánto debe Master Clean?
```
→ Te muestra todas las facturas pendientes con días vencidos y total.

```
@CobrosGuipakBot estado de cobros hoy
```
→ Resumen rápido: cartera total, distribución, alertas activas.

```
@CobrosGuipakBot qué hay pendiente de aprobar
```
→ Lista los mensajes en la cola.

```
@CobrosGuipakBot promesas vencidas
```
→ Clientes que prometieron pagar y no cumplieron.

```
@CobrosGuipakBot busca el cliente Universidad
```
→ Te lista clientes que coincidan + saldo de cada uno.

```
@CobrosGuipakBot historial Universidad Catolica
```
→ Últimas conversaciones con ese cliente.

### 🆕 Generar correo desde Telegram

```
@CobrosGuipakBot genera correo para Master Clean
```

El bot:
1. Selecciona la factura más urgente del cliente
2. Genera el draft del correo
3. Te lo muestra en pantalla
4. Te da **3 botones**:
   - ✅ **Aprobar y enviar** — manda el correo inmediatamente
   - ✏️ **Editar** — abre la cola en la app para que edites
   - ❌ **Descartar** — no se envía

**Reglas que el bot respeta:**
- ❌ No genera correos para clientes sin facturas vencidas
- ❌ No genera correos para clientes con disputa abierta
- ❌ No genera correos para clientes pausados
- ❌ Si ya hay un correo pendiente para esa factura, te lo dice (no duplica)

### Empuje matutino diario

Cada mañana a las **8:00 AM** el bot manda al grupo un resumen automático:
- Cartera vencida total
- Distribución por segmento
- Alertas activas
- Mensajes pendientes de aprobación
- Promesas que vencen hoy

Lo lees mientras te tomas el café, ya tienes el plan del día.

---

## 📅 Flujo diario sugerido (rutina recomendada)

### 🌅 Mañana (8:30 AM)
1. Lees el **mensaje matutino del bot** en Telegram
2. Abres el **Dashboard** → ¿hay alertas críticas?
3. Vas a **Cola de Aprobación** → revisas y apruebas/descartas mensajes
4. Vas a **Conciliación** → si hubo extracto bancario nuevo, lo procesas

### ☀️ Durante el día
- **Mensajes entrantes** (cliente respondió por WhatsApp/Email): la IA los procesa automáticamente y propone respuesta. Apruebas en la cola.
- **Promesas de pago** (cliente dijo "pago el viernes"): la IA las detecta y registra. Tú confirmas.
- **Disputas** (cliente reclama): la IA crea entrada. Tú la trabajas con el equipo.

### 🌆 Tarde (cierre del día)
1. Vas a **Reportes** → si necesitas exportar algo (cartera del día, gestiones)
2. Si quedó algo escalado, lo trabajas con Ricardo
3. Plan para mañana: ¿qué clientes priorizar?

---

## 🚨 Cosas que NUNCA debes hacer

1. **Editar Softec desde aquí.** Imposible — la conexión es solo lectura. Pero ni intentarlo.
2. **Aprobar un mensaje sin leerlo.** La IA es buena pero no perfecta. Lee siempre.
3. **Aplicar un pago de cuenta bancaria desconocida sin confirmar.** Te puede asignar al cliente equivocado.
4. **Generar mensajes para facturas en disputa.** El sistema te lo bloquea, pero no le hagas trampa.
5. **Cambiar la plantilla de "Notificación legal" a Auto.** Esa siempre debe ser revisada antes de salir.

---

## ❓ Preguntas frecuentes

### El cliente dice que ya pagó pero el sistema le sigue mandando recordatorios

→ Probablemente el pago aún no está aplicado en Softec. Revisa **Conciliación** → si el pago está en "Por aplicar", avisa a contabilidad para que lo aplique. Mientras tanto, **Pausa al cliente** desde la sección Clientes para que no le sigan llegando correos.

### Le mandé un correo a un cliente y rebotó

→ Ve a **Clientes** → busca el cliente → revisa su email registrado en Softec. Si está mal, agrégale el correcto en "datos enriquecidos" (no se modifica Softec). Próximo correo usará el nuevo.

### Quiero cambiar el tono de los correos

→ Ve a **Plantillas** → editas la plantilla del segmento → cambias asunto y cuerpo → guardas. Los próximos correos generados usan el nuevo texto.

### El bot no responde en el grupo

→ Asegúrate de mencionarlo: `@CobrosGuipakBot tu pregunta`. Sin la mención no responde para no llenar el grupo.

### Daria entró al grupo pero el bot dice "no autorizado"

→ Pídele a Ricardo que la agregue a la tabla `cobranza_telegram_usuarios`. Necesita su user_id de Telegram (el bot lo muestra cuando ella escribe).

### Necesito generar un reporte que no está en Reportes

→ Avisa a Ricardo. Si es algo recurrente, lo agregamos al sistema.

---

## 📞 Soporte

- **Bugs / problemas técnicos:** Ricardo Padrón
- **Dudas de cobranza / negocio:** equipo de cobros internamente
- **Dudas del bot Telegram:** mensaje privado al bot con `/help`

---

*Última actualización: 29 abril 2026*
*Versión del sistema: Fase 10 — Capa A + B + Plantillas*
