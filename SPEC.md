# SPEC.md — Especificaciones Técnicas
> Sistema de Cobranzas Guipak v1.0
> Lee CLAUDE.md antes de este documento.

---

## 1. Contexto del Negocio

Guipak es una distribuidora en República Dominicana. Sus clientes son empresas (B2B). El proceso de cobranza actualmente es manual, lo que genera:
- Clientes contactados que ya pagaron
- Sin seguimiento estructurado por antigüedad
- Sin trazabilidad de conversaciones ni acuerdos
- Conciliación bancaria manual y propensa a errores

El sistema replica el modelo de Moonflow.ai pero integrado directamente con Softec, sin pagar SaaS externo.

---

## 2. Principios de Diseño

1. **Supervisión humana siempre** — ningún mensaje sale sin aprobación
2. **Softec es solo lectura** — el ERP nunca se modifica desde este sistema
3. **Validación doble** — Softec + conciliación bancaria antes de cobrar
4. **Enriquecimiento progresivo** — los datos de clientes se completan con el uso
5. **Trazabilidad total** — cada acción queda registrada con usuario y timestamp

---

## 3. Módulos del Sistema

### Módulo 1 — Gestión de Cartera
**Descripción:** Vista central de todas las facturas vencidas con segmentación por riesgo.

**Funcionalidades:**
- Consulta diaria automática a Softec vía N8N
- Clasificación por segmento (VERDE/AMARILLO/NARANJA/ROJO)
- Aging report por cliente y por factura
- Filtros: por segmento, por cliente, por vendedor, por monto, por días vencido
- Vista de historial de pagos del cliente
- Indicador de si la factura tiene PDF vinculado
- Indicador de si el cliente tiene WhatsApp / Email registrado
- Alerta cuando cliente no tiene datos de contacto

**Datos que muestra por factura:**
- Código y nombre del cliente
- NCF fiscal
- Fecha emisión / vencimiento / días vencido
- Subtotal + ITBIS + Total
- Total pagado / Saldo pendiente
- Moneda (DOP/USD) y tasa de cambio
- Vendedor asignado
- Último pago registrado
- Segmento de riesgo
- Contacto de cobros (`IC_ARCONTC`)

---

### Módulo 2 — Comunicaciones Automatizadas
**Descripción:** Generación automática de mensajes personalizados por Claude AI.

**Canales:**
- WhatsApp via Evolution API (teléfono de `IC_PHONE` o `IC_PHONE2`)
- Email via SMTP (email de `IC_EMAIL` o `icontacts`)

**Lógica de canal:**
```
¿Tiene teléfono? → WhatsApp disponible
¿Tiene email?    → Email disponible
¿Tiene ambos?    → WhatsApp primero, Email como respaldo
¿No tiene nada?  → Alerta para gestión manual
```

**Tipos de mensaje:**
- Recordatorio preventivo (vence en 1-5 días)
- Aviso de vencimiento (día 0)
- Seguimiento 15 días vencido
- Seguimiento 30 días vencido
- Gestión intensa 30+ días
- Campaña especial (configurable)

**Personalización por mensaje:**
- Nombre del cliente / contacto de cobros
- Número de factura / NCF
- Monto exacto con moneda
- Fecha de vencimiento
- Días vencidos
- Link al PDF de la factura (si está documentada)
- Tono ajustado al segmento de riesgo

---

### Módulo 3 — Cola de Supervisión
**Descripción:** Bandeja donde el supervisor aprueba o rechaza cada mensaje antes de enviarlo.

**Vista por item:**
- Cliente | Segmento | Canal | Factura | Monto | Días vencido
- Mensaje propuesto por IA (preview WhatsApp + Email)
- Indicadores: ¿tiene PDF? ¿tiene contacto de cobros?
- Historial de gestiones anteriores a ese cliente

**Acciones disponibles:**
- ✅ Aprobar → enviar inmediatamente
- ✏️ Editar → modificar mensaje y aprobar
- ❌ Descartar → no enviar, registrar motivo
- ⏩ Escalar → marcar para gestión manual/gerencial
- ⏸️ Pausar cliente → no gestionar por X días

**Registro:**
- Quién aprobó / rechazó
- Timestamp de la acción
- Mensaje final enviado (puede diferir del propuesto)

---

### Módulo 4 — Agente IA de Cobranzas
**Descripción:** Claude AI gestiona respuestas entrantes de clientes.

**Flujo:**
1. Cliente responde por WhatsApp o Email
2. N8N captura el webhook y llama a la API del sistema
3. Sistema busca contexto: deuda actual, historial, acuerdos previos
4. Claude AI genera respuesta contextual
5. Respuesta va a cola de aprobación (no se envía automáticamente)
6. Supervisor aprueba → se envía

**Contexto que recibe Claude:**
- Saldo pendiente actual (de Softec)
- Historial de mensajes de esta conversación
- Acuerdos de pago previos registrados
- Segmento de riesgo actual
- Instrucciones de tono por segmento

**Registro automático:**
- Si el cliente dice que pagará en fecha X → registrar en `cobranza_acuerdos`
- Si el cliente disputa → crear entrada en `cobranza_disputas`
- Si el cliente no responde → escalar automáticamente después de N días

---

### Módulo 5 — Conciliación Bancaria Inteligente
**Descripción:** El supervisor carga el extracto bancario y el sistema lo compara contra Softec.

**Flujo:**
1. Supervisor carga extracto (Excel o PDF)
2. N8N / API parsea cada línea del extracto
3. Sistema compara contra `irjnl` de Softec por monto + fecha ± 3 días
4. Clasifica cada línea:
   - ✅ **Conciliado** — coincide con registro en Softec
   - ⚠️ **Por aplicar** — entrada bancaria sin registro en Softec
   - ❓ **Desconocido** — origen no identificado
5. Supervisor acciona:
   - "Por aplicar" → aprueba con un clic → N8N notifica al equipo de cobros para registrar en Softec
   - "Desconocido" → asigna a cliente → sistema aprende

**Sistema de aprendizaje:**
- Primera vez que llega transferencia de cuenta X → supervisor asigna a cliente Y
- Sistema guarda: cuenta_origen → cliente en `cobranza_cuentas_aprendizaje`
- Próxima vez → propone automáticamente el mismo cliente con confianza alta
- Supervisor confirma o corrige

---

### Módulo 6 — Portal de Autogestión del Cliente
**Descripción:** Link único por cliente para ver sus facturas pendientes.

**Funcionalidades:**
- Ver facturas pendientes con monto y fecha vencimiento
- Descargar PDF de cada factura
- Ver estado de cuenta
- Solicitar acuerdo de pago (envía alerta al supervisor)

**Seguridad:**
- Link con token único por cliente, expira en 30 días
- No requiere password — acceso por token en URL
- No permite modificar nada, solo lectura + solicitud

---

### Módulo 7 — Gestión Documental
**Descripción:** Vinculación de facturas escaneadas (PDF firmado/sellado) a cada factura en Softec.

**Flujo de entrada (desde CRM):**
1. CRM sube factura escaneada a Google Drive
2. CRM dispara webhook a `/api/webhooks/factura-escaneada`
3. Sistema registra en `cobranza_facturas_documentos`:
   - `ij_inum` (número interno Softec)
   - `codigo_cliente`
   - `google_drive_id`
   - `url_pdf`
   - `fecha_escaneo`
4. Factura queda marcada como "documentada"

**Uso en cobranzas:**
- Mensajes de cobranza incluyen link al PDF automáticamente
- Supervisor puede ver PDF desde la cola de aprobación
- En disputas, se puede acceder al PDF firmado en segundos

**Pantalla de gestión documental:**
- Buscar factura por número o cliente
- Ver si tiene PDF vinculado
- Subida manual si el CRM no lo envió
- Historial de versiones del documento

---

### Módulo 8 — Gestión de Disputas
**Descripción:** Registro y seguimiento de facturas que el cliente disputa.

**Estados de una disputa:**
- `ABIERTA` — cliente reportó un problema
- `EN_REVISIÓN` — equipo interno está analizando
- `RESUELTA` — disputa cerrada con resolución
- `ANULADA` — se anuló la factura

**Regla crítica:** Mientras una factura tiene disputa `ABIERTA` o `EN_REVISIÓN`, NO aparece en la cola de cobranzas.

**Registro por disputa:**
- Factura, cliente, monto disputado
- Motivo de la disputa (texto libre)
- Quién la registró y cuándo
- Conversación interna del equipo
- Resolución final con aprobación del supervisor

---

### Módulo 9 — Dashboard y KPIs
**KPIs principales:**
- **DSO** (Days Sales Outstanding) = (Cuentas por cobrar / Ventas totales) × Días del período
- Cartera total vencida (monto y cantidad de facturas)
- Distribución por segmento (AMARILLO/NARANJA/ROJO)
- Tasa de recupero por segmento
- Efectividad WhatsApp vs Email (tasa de respuesta)
- Promesas de pago: registradas vs cumplidas
- Clientes sin datos de contacto (para enriquecimiento)
- Top 10 clientes con mayor saldo vencido

**Reportes exportables:**
- Cartera vencida completa (Excel)
- Estado de cuenta por cliente (PDF)
- Historial de gestiones del período

---

### Módulo 10 — Flujos y Campañas
**Cadencias por segmento (configurables):**
- AMARILLO: contacto cada 5 días
- NARANJA: contacto cada 3 días
- ROJO: contacto cada día

**Campañas especiales:**
- Cierre de mes (últimos 3 días del mes)
- Cierre de trimestre
- Personalizada (configurable por fecha y segmento)

**Controles por cliente:**
- Pausar gestión (con fecha de reanudación)
- Cambiar segmento manualmente
- Marcar como "no contactar" con motivo

---

### Módulo 11 — Alertas y Notificaciones Internas
**Alertas automáticas al supervisor:**
- Cliente prometió pagar en fecha X
- Promesa de pago vencida sin cumplir
- Cliente entró en cartera vencida por primera vez
- Factura lleva 30/60/90 días vencida sin gestión
- Pago bancario detectado sin registrar en Softec

**Reporte diario (email automático):**
- Resumen de cartera por segmento
- Acciones pendientes de aprobación
- Promesas que vencen hoy
- Nuevas facturas que entraron en mora

---

### Módulo 12 — Enriquecimiento de Datos de Clientes
**Descripción:** Completar datos faltantes de clientes progresivamente.

**Flujos de enriquecimiento:**
- Al aprobar un mensaje sin teléfono → solicitar teléfono antes de enviar
- Al aprobar un mensaje sin email → solicitar email antes de enviar
- Vista de clientes con datos incompletos para completar en lote

**Almacenamiento:**
- Datos adicionales se guardan en `cobranza_clientes_enriquecidos`
- No se modifican los datos en Softec (solo lectura)
- El sistema prioriza: Softec → datos enriquecidos locales

---

### Módulo 13 — Registro de Comunicaciones (Email como log)
**Descripción:** Cada acción del sistema queda registrada como log de email/comunicación.

**Registro por acción:**
- Tipo: `WHATSAPP_ENVIADO` / `EMAIL_ENVIADO` / `RESPUESTA_RECIBIDA` / `ACUERDO_REGISTRADO` / `DISPUTA_CREADA` / etc.
- Cliente, factura, canal
- Contenido del mensaje
- Usuario que aprobó
- Timestamp
- Estado: `ENVIADO` / `ENTREGADO` / `LEÍDO` / `RESPONDIDO` / `FALLIDO`

---

## 4. Integraciones Externas

| Sistema | Tipo | Endpoints clave |
|---|---|---|
| Softec MySQL | Solo lectura SELECT | Ver DATABASE.md |
| Evolution API | POST envío, webhook recepción | `/message/sendText`, webhook entrante |
| SMTP | Salida | Nodemailer / SendGrid SDK |
| Google Drive | Lectura/escritura | Drive API v3 |
| CRM Guipak | Webhook entrante | `/api/webhooks/factura-escaneada` |
| N8N | Calls a API propia | Scheduler + HTTP requests |
| Claude AI | API Anthropic | `/v1/messages` |

---

## 5. Reglas de Negocio Críticas

Ver `CRITICAL_POINTS.md` para la lista completa con detalles de implementación.

Resumen:
1. Ningún mensaje sale sin aprobación humana
2. Softec es solo lectura — nunca escribir
3. Facturas en disputa no se gestionan
4. Validación doble antes de cobrar (Softec + banco)
5. Cuentas bancarias nuevas requieren asignación manual la primera vez
6. Facturas anuladas (`IJ_INVTORF = 'V'`) excluidas siempre

---

## 6. Fuera de Alcance v1.0

- Llamadas telefónicas automatizadas
- Pasarela de pagos online
- Módulo de scoring crediticio
- App móvil nativa
- Multi-empresa
- Integración directa con banco (solo carga manual de extractos)

---

*Versión: 1.0 — Abril 2026*
