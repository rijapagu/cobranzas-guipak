# CLAUDE.md — Sistema de Cobranzas Guipak
> **LEE ESTE ARCHIVO COMPLETO ANTES DE ESCRIBIR UNA SOLA LÍNEA DE CÓDIGO.**
> Luego lee SPEC.md, PROGRESS.md y CRITICAL_POINTS.md en ese orden.

---

## Qué es este proyecto

Sistema de cobranzas B2B para Suministros Guipak, S.R.L. — empresa distribuidora en República Dominicana. Es una aplicación web independiente inspirada en Moonflow.ai, integrada de solo lectura con el ERP interno Softec (MySQL).

**No es un módulo del CRM existente. Es una app separada.**

---

## Regla de oro

> **Ningún mensaje sale al cliente sin aprobación humana.**
> La IA propone. El supervisor humano decide.

Esto nunca cambia. No importa qué funcionalidad se esté desarrollando.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14+ (App Router) |
| Backend | Next.js API Routes |
| Base de datos propia | MySQL (Docker, contenedor separado) |
| ERP (solo lectura) | Softec MySQL — host: 31.97.131.17 |
| Automatización | N8N (instancia existente en Dokploy) |
| WhatsApp | Evolution API (instancia existente) |
| Email | SMTP / SendGrid |
| IA | Claude AI — modelo claude-sonnet-4-20250514 |
| Documentos | Google Drive API |
| Infraestructura | VPS srv869155 — Dokploy/Docker |
| CRM existente | Next.js CRM separado — integra via webhook |

---

## Estructura de carpetas del proyecto

```
/
├── app/
│   ├── (auth)/
│   ├── (dashboard)/
│   │   ├── cartera/
│   │   ├── cola-aprobacion/
│   │   ├── conciliacion/
│   │   ├── clientes/
│   │   ├── conversaciones/
│   │   ├── disputas/
│   │   ├── documentos/
│   │   └── reportes/
│   └── api/
│       ├── softec/          ← queries a Softec (solo lectura)
│       ├── cobranzas/       ← lógica de negocio
│       ├── whatsapp/        ← Evolution API webhooks
│       ├── email/           ← envío y recepción
│       ├── conciliacion/    ← conciliación bancaria
│       ├── drive/           ← Google Drive
│       └── webhooks/        ← webhooks entrantes (CRM, etc.)
├── components/
├── lib/
│   ├── db/
│   │   ├── softec.ts        ← conexión MySQL Softec (SOLO LECTURA)
│   │   └── cobranzas.ts     ← conexión MySQL propia
│   ├── claude/              ← prompts y llamadas a Claude AI
│   ├── evolution/           ← Evolution API client
│   └── drive/               ← Google Drive client
├── docs/                    ← esta carpeta
└── docker-compose.yml
```

---

## Dos bases de datos — nunca confundirlas

### DB 1 — Softec (SOLO LECTURA — NUNCA ESCRIBIR)
- Host: `45.32.218.224` (Vultr, MySQL 5.7.25)
- Base: `guipak`
- Usuario: `cobranzas_ro@31.97.131.17` — restringido por IP del VPS srv869155
- **PROHIBIDO cualquier INSERT, UPDATE, DELETE**
- La app **NO accede a tablas crudas**. Solo a vistas `v_cobr_*`:
  - `v_cobr_ijnl` (proyección segura de `ijnl`)
  - `v_cobr_icust` (proyección segura de `icust`)
  - `v_cobr_irjnl` (proyección segura de `irjnl`)
  - `v_cobr_ijnl_pay` (proyección segura de `ijnl_pay`)
- Setup del usuario y vistas: `scripts/setup-softec-cobranzas-readonly.sql`
- Ver CRITICAL_POINTS.md CP-01 para detalle de las 3 capas de defensa.

### DB 2 — Cobranzas (lectura y escritura)
- Host: localhost (Docker en mismo VPS)
- Base: cobranzas_guipak
- Tablas: ver DATABASE.md

---

## Flujo principal del sistema

```
1. N8N corre query de cartera vencida en Softec cada mañana
2. Claude AI segmenta clientes y genera mensajes personalizados
3. Mensajes van a cola de aprobación (NO se envían aún)
4. Supervisor revisa cola → Aprueba / Edita / Descarta / Escala
5. Solo mensajes aprobados se envían via Evolution API o SMTP
6. Respuestas de clientes llegan via webhook → Claude AI responde
7. Acuerdos de pago se registran en cobranzas_guipak
8. Conciliación bancaria valida pagos antes de gestionar
```

---

## Segmentación de riesgo

| Segmento | Días vencido | Tono |
|---|---|---|
| 🟢 VERDE | Vence en 1-5 días | Recordatorio amigable |
| 🟡 AMARILLO | Vencida 1-15 días | Urgencia moderada |
| 🟠 NARANJA | Vencida 16-30 días | Presión formal |
| 🔴 ROJO | Vencida 30+ días | Gestión intensa |

---

## Integración con CRM existente

El CRM envía un webhook a `/api/webhooks/factura-escaneada` cuando sube una factura a Google Drive:

```json
{
  "numero_factura": "IN-456",
  "ij_inum": 456,
  "codigo_cliente": "0000274",
  "google_drive_id": "1BxiM...",
  "url_pdf": "https://drive.google.com/...",
  "fecha_escaneo": "2026-04-09T10:00:00Z"
}
```

---

## Variables de entorno requeridas

```env
# Base de datos propia
DB_COBRANZAS_HOST=localhost
DB_COBRANZAS_PORT=3306
DB_COBRANZAS_NAME=cobranzas_guipak
DB_COBRANZAS_USER=
DB_COBRANZAS_PASS=

# Softec (SOLO LECTURA)
DB_SOFTEC_HOST=
DB_SOFTEC_PORT=3306
DB_SOFTEC_NAME=guipak
DB_SOFTEC_USER=
DB_SOFTEC_PASS=

# Claude AI
ANTHROPIC_API_KEY=

# Evolution API
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=

# Email
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Google Drive
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_FOLDER_ID=

# N8N
N8N_WEBHOOK_SECRET=

# App
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

---

## Convenciones de código

- TypeScript estricto en todo el proyecto
- Zod para validación de datos en API routes
- `lib/db/softec.ts` — NUNCA usar para escritura, solo SELECT
- Todos los errores deben loguearse en tabla `cobranza_logs`
- Fechas siempre en UTC, mostrar en America/Santo_Domingo
- Montos siempre como `number` — nunca `string`
- Prefijo `IJ_` = campos de Softec, no renombrar en queries

---

## Antes de cada sesión de trabajo

1. Lee `CLAUDE.md` (este archivo)
2. Lee `SPEC.md` — especificaciones completas
3. Lee `PROGRESS.md` — qué está hecho y qué sigue
4. Lee `CRITICAL_POINTS.md` — qué no se puede romper
5. Consulta `DATABASE.md` si trabajas con datos

---

*Versión: 1.0 — Abril 2026*
