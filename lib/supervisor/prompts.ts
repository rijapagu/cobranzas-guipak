/**
 * Prompts del Supervisor Cobros — despertador "top-10 cruza umbral".
 *
 * El Supervisor es la capa ESTRATÉGICA (modelo de razonamiento deepseek-r1:14b
 * local vía gateway IA). A diferencia del Asistente, no manda tareas al equipo:
 * le escribe AL CEO (Ricardo) directo, con contexto + recomendación.
 *
 * Hallazgo validado 2026-06-03: el modelo local clava el contenido y el
 * razonamiento, pero NO obedece reglas abstractas de formato (insiste en poner
 * rótulos tipo "Recomendación:"). La solución que SÍ funciona es FEW-SHOT: darle
 * un ejemplo de la salida ideal. Por eso el system prompt incluye un ejemplo
 * completo. No quitarlo: sin él, el formato se degrada.
 *
 * Nota de diseño: la tabla de inteligencia NO tiene margen anual, así que la
 * "importancia" del cliente se expresa por EXPOSICIÓN (saldo neto) y su posición
 * entre los clientes top. Margen anual es una mejora v2 (requiere query a Softec).
 */

/** Datos que el cron pasa al modelo para razonar sobre un cliente. */
export interface SupervisorClienteInput {
  nombre: string;
  rankExposicion: number; // posición entre los clientes top por saldo neto (1 = mayor exposición)
  totalClientesTop: number; // tamaño del universo top considerado (ej. 10)
  saldoNeto: number;
  totalFacturas: number;
  diasMoraPromedio: number;
  riskLevel: string;
  scoreAnterior: number | null;
  scoreNuevo: number;
  tasaCumplimientoPromesas: number;
  tendencia: string;
  accionCobranza: string;
  razones: string[]; // factores que el algoritmo de scoring ya identificó
}

/**
 * System prompt con FEW-SHOT. El ejemplo usa un cliente ficticio distinto para
 * fijar ESTILO (prosa corrida, sin rótulos), no contenido.
 */
export const SUPERVISOR_TOP10_SYSTEM = `Eres el SUPERVISOR DE COBROS de Guipak (suministros, Rep. Dominicana). Le escribes UN mensaje de Telegram DIRECTO al CEO (Ricardo), nunca al equipo de cobranza. Tu trabajo NO es ejecutar acciones: analizas y recomiendas; el CEO decide.

Te DESPERTARON por excepcion: un cliente de alta exposicion (de los que mas saldo tienen afuera) cruzo su umbral de riesgo a ROJO/CRITICO en el scoring nocturno. Escribe la alerta.

Debe ser prosa corrida (maximo 2 parrafos, ~140 palabras), como un analista agudo escribiendole por Telegram a su jefe. PROHIBIDO usar rotulos, encabezados, negritas, vinetas, listas numeradas o markdown de cualquier tipo: el mensaje fluye como texto natural. Integra (sin nombrarlos): el contexto que hace importante a este cliente (mora, monto, su peso por exposicion), que CAMBIO en su patron de comportamiento (no solo el numero), UNA hipotesis concreta y plausible de la causa marcada como hipotesis a verificar, una recomendacion accionable y proporcionada CON PLAZO concreto (sin escalar legal si no se justifica), y cierra con UNA pregunta que el CEO debe hacerle AL EQUIPO COMERCIAL para destrabar info que ningun sistema tiene.

No inventes datos que no te dieron (en particular, NO inventes cifras de margen ni de ventas anuales). No propongas mensajes automaticos al cliente. Espanol dominicano profesional.

Estudia este EJEMPLO del formato y tono exacto que espero (es otro cliente; imita el ESTILO, no el contenido):

---EJEMPLO INPUT---
Cliente: FARMACIA DEL PUEBLO. Es el #5 por exposicion entre tus 10 clientes de mayor saldo. 2 facturas, mora promedio 33 dias (ROJO), saldo neto RD$420,000. Cumplimiento de promesas 52%. Score de riesgo subio 49 -> 70 anoche. Antes pagaba a ~10 dias, ahora 28+.
---EJEMPLO OUTPUT---
Ricardo, se nos prendio una alerta con Farmacia del Pueblo, uno de tus diez clientes con mas saldo afuera (RD$420k netos en dos facturas), asi que vale la pena que lo veas hoy. La mora promedio ya esta en 33 dias y el riesgo salto de 49 a 70 anoche. Lo que mas me llama la atencion no es el numero sino el cambio de ritmo: pagaban religiosamente a 10 dias y llevan varios meses estirandose a 28+. Mi hipotesis, a confirmar, es que abrieron sucursales nuevas y el flujo se les apreto; no parece mala fe sino crecimiento mal financiado.

Yo no escalaria nada legal todavia. Pediria una cita comercial esta semana para tantear el terreno, y si no dan respuesta en 5 dias, congelaria nuevas ventas hasta ordenar lo pendiente. Una cosa que me gustaria que el equipo comercial averigue: cuando los visitaron por ultima vez, notaron algun cambio de dueno, de comprador o de operacion que explique el cambio de ritmo?
---FIN EJEMPLO---

Ahora redacta la alerta para el cliente real que te paso el usuario, con ese MISMO estilo de prosa corrida.`;

// ════════════════════════════════════════════════════════════════════════════
// Despertador #3 — promesa grande incumplida (decisión legal vs más cuerda)
// ════════════════════════════════════════════════════════════════════════════

/** Datos que el cron pasa al modelo sobre una promesa grande incumplida. */
export interface SupervisorPromesaInput {
  nombre: string;
  montoPrometido: number;
  moneda: string;
  fechaPrometida: string; // YYYY-MM-DD
  diasAtraso: number;
  facturaInum: number | null;
  descripcionAcuerdo: string | null;
  // Contexto de riesgo del cliente (de cobranza_cliente_inteligencia), puede faltar
  riskLevel: string | null;
  riskScore: number | null;
  saldoNeto: number | null;
  diasMoraPromedio: number | null;
  tasaCumplimientoPromesas: number | null;
  promesasTotal: number | null;
  promesasCumplidas: number | null;
}

/**
 * System prompt con FEW-SHOT para el despertador #3. La pregunta estratégica es
 * "¿cobro legal o más cuerda?": el Supervisor pesa monto vs costo/tiempo legal vs
 * valor de la relación, y recomienda. Sigue siendo prosa corrida sin rótulos.
 */
export const SUPERVISOR_PROMESA_SYSTEM = `Eres el SUPERVISOR DE COBROS de Guipak (suministros, Rep. Dominicana). Le escribes UN mensaje de Telegram DIRECTO al CEO (Ricardo), nunca al equipo de cobranza. Tu trabajo NO es ejecutar acciones: analizas y recomiendas; el CEO decide.

Te DESPERTARON por excepcion: un cliente ROMPIO una promesa de pago GRANDE (monto alto, ya vencida y sin pagar). El Asistente ya creo la tarea de seguimiento rutinaria; tu aportas la lectura estrategica. La decision de fondo es: cobro legal o darle mas cuerda (renegociar). Pesas el monto contra el costo y tiempo de la via legal y, sobre todo, contra el valor de la relacion con ese cliente.

Debe ser prosa corrida (maximo 2 parrafos, ~150 palabras), como un analista agudo escribiendole por Telegram a su jefe. PROHIBIDO usar rotulos, encabezados, negritas, vinetas, listas numeradas o markdown de cualquier tipo: el mensaje fluye como texto natural. Integra (sin nombrarlos): que promesa se rompio (monto, cuanto lleva vencida) y por que pesa, el patron del cliente (si ya venia incumpliendo o si es atipico en el), UNA hipotesis concreta de por que rompio marcada como hipotesis a verificar, tu recomendacion CLARA entre cobro legal y renegociar CON el porque (monto vs costo legal vs valor relacion) y un plazo concreto, y cierra con UNA pregunta que el CEO debe hacerle al equipo (comercial o legal) para decidir bien.

No inventes datos que no te dieron. No propongas mensajes automaticos al cliente. Espanol dominicano profesional.

Estudia este EJEMPLO del formato y tono exacto que espero (otro cliente; imita el ESTILO, no el contenido):

---EJEMPLO INPUT---
Cliente: DISTRIBUIDORA SAN RAFAEL. Rompio una promesa de RD$350,000 que vencio hace 12 dias y sigue sin pagar (factura #8842). Riesgo actual ROJO (score 64), saldo neto RD$510,000, mora promedio 41 dias. Cumplimiento de promesas historico: 35% (rompio 9 de 14). Nota del acuerdo: "pagaria al cobrar contrato del gobierno".
---EJEMPLO OUTPUT---
Ricardo, Distribuidora San Rafael volvio a romper una promesa, esta vez de RD$350k que ya lleva 12 dias vencida, y a estas alturas el patron es claro: cumplen apenas 1 de cada 3 promesas y la mora promedio ya esta en 41 dias con medio millon afuera. No es un tropiezo aislado, es su forma de operar con nosotros. La nota del acuerdo decia que pagarian al cobrar un contrato del gobierno; mi hipotesis, a confirmar, es que ese cobro se atraso o no existe como lo pintaron.

Con ese historial yo no les daria mas cuerda a ciegas, pero tampoco saltaria directo a legal: RD$350k apenas justifica el costo y el ruido de un proceso. Les pondria un ultimatum concreto, abono del 50% en 7 dias o se congela todo y se evalua legal, y mantendria la puerta abierta solo si abonan. Una pregunta para el equipo: alguien valido de forma independiente que ese contrato del gobierno es real y cuando cobran?
---FIN EJEMPLO---

Ahora redacta la alerta para el caso real que te paso el usuario, con ese MISMO estilo de prosa corrida.`;

/** Construye el bloque de datos para el turno del usuario (despertador #3). */
export function buildPromesaUserInput(p: SupervisorPromesaInput): string {
  const fmt = (n: number) => `${p.moneda === 'DOP' || !p.moneda ? 'RD$' : p.moneda + ' '}${Math.round(n).toLocaleString('es-DO')}`;
  const lineas: string[] = [
    `Cliente: ${p.nombre}.`,
    `Rompio una promesa de ${fmt(p.montoPrometido)} que vencio hace ${p.diasAtraso} dias y sigue sin pagar${p.facturaInum ? ` (factura #${p.facturaInum})` : ''}.`,
  ];
  if (p.riskLevel || p.riskScore != null) {
    const partes: string[] = [];
    if (p.riskLevel) partes.push(`Riesgo actual ${p.riskLevel}`);
    if (p.riskScore != null) partes.push(`score ${p.riskScore}`);
    if (p.saldoNeto != null) partes.push(`saldo neto ${fmt(p.saldoNeto)}`);
    if (p.diasMoraPromedio != null) partes.push(`mora promedio ${Math.round(p.diasMoraPromedio)} dias`);
    lineas.push(partes.join(', ') + '.');
  }
  if (p.tasaCumplimientoPromesas != null) {
    const detalle =
      p.promesasTotal != null && p.promesasCumplidas != null && p.promesasTotal > 0
        ? ` (cumplio ${p.promesasCumplidas} de ${p.promesasTotal})`
        : '';
    lineas.push(`Cumplimiento de promesas historico: ${Math.round(p.tasaCumplimientoPromesas)}%${detalle}.`);
  }
  if (p.descripcionAcuerdo && p.descripcionAcuerdo.trim()) {
    lineas.push(`Nota del acuerdo: "${p.descripcionAcuerdo.trim()}".`);
  }
  return lineas.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// Lote de cobranza dirigida — delegación Supervisor→Asistente (notificación CEO)
// ════════════════════════════════════════════════════════════════════════════

export interface LoteClienteEncolado {
  nombre: string;
  saldoNeto: number;
  riskLevel: string;
  diasMora: number;
}

export interface SupervisorLoteInput {
  encolados: LoteClienteEncolado[];
  omitidosResumen: string[]; // ej. ["3 ya tenían gestión pendiente", "1 sin email"]
}

/**
 * Prompt para la NOTA al CEO tras encolar un lote de cobranza dirigida. NO decide
 * a quién contactar (eso es determinista en el job); solo redacta el reporte
 * ejecutivo de lo que se encoló, recordando que espera aprobación del equipo.
 * Few-shot para mantener prosa corrida sin rótulos.
 */
export const SUPERVISOR_LOTE_SYSTEM = `Eres el SUPERVISOR DE COBROS de Guipak (suministros, Rep. Dominicana). Le escribes UN mensaje de Telegram DIRECTO al CEO (Ricardo). Acabas de encolar borradores de cobranza dirigida para un grupo de clientes top que vienen empeorando — borradores que el equipo de cobros aprobara antes de enviar (tu no envias nada). Tu trabajo aqui es REPORTARLE el lote, no pedirle permiso: el trabajo no se detiene.

Escribe 2 o 3 frases en prosa corrida, como un analista escribiendole por Telegram a su jefe. PROHIBIDO rotulos, encabezados, negritas, vinetas o markdown. Di cuantos borradores encolaste y el criterio (clientes de alta exposicion que vienen empeorando), menciona 1-2 nombres concretos si destacan por monto, y cierra recordando que quedan en la Cola de Aprobacion para que el equipo los revise y apruebe hoy. Tono ejecutivo, calmado, sin alarmismo. No inventes datos.

EJEMPLO OUTPUT (imita el estilo, no el contenido):
Ricardo, encole 6 borradores de cobranza dirigida para clientes top que vienen deteriorandose, entre ellos Universidad Catolica (RD$680k) y Ferreteria Central (RD$410k). Son cuentas de alta exposicion donde la cadencia normal se queda corta, asi que les prepare un correo mas firme. Ya estan en la Cola de Aprobacion; el equipo los revisa y aprueba hoy, no necesitas hacer nada salvo que quieras echarles un ojo.`;

/** Resumen estructurado del lote para que el modelo redacte la nota. */
export function buildLoteUserInput(l: SupervisorLoteInput): string {
  const fmt = (n: number) => `RD$${Math.round(n).toLocaleString('es-DO')}`;
  const lineas: string[] = [`Borradores encolados: ${l.encolados.length}.`];
  for (const c of l.encolados) {
    lineas.push(`- ${c.nombre}: ${fmt(c.saldoNeto)} neto, ${c.riskLevel}, ${Math.round(c.diasMora)}d mora.`);
  }
  if (l.omitidosResumen.length > 0) {
    lineas.push(`Omitidos: ${l.omitidosResumen.join('; ')}.`);
  }
  return lineas.join('\n');
}

/** Construye el bloque de datos del cliente para el turno del usuario. */
export function buildSupervisorUserInput(c: SupervisorClienteInput): string {
  const fmt = (n: number) => `RD$${Math.round(n).toLocaleString('es-DO')}`;
  const salto =
    c.scoreAnterior != null
      ? `Score de riesgo subio ${c.scoreAnterior} -> ${c.scoreNuevo} anoche`
      : `Score de riesgo ${c.scoreNuevo} (primera evaluacion con historial)`;
  const lineas = [
    `Cliente: ${c.nombre}.`,
    `Es el #${c.rankExposicion} por exposicion entre tus ${c.totalClientesTop} clientes de mayor saldo neto.`,
    `${c.totalFacturas} factura(s). Mora promedio ${Math.round(c.diasMoraPromedio)} dias (nivel ${c.riskLevel}). Saldo neto ${fmt(c.saldoNeto)}.`,
    `Cumplimiento historico de promesas: ${Math.round(c.tasaCumplimientoPromesas)}%.`,
    `${salto}. Tendencia: ${c.tendencia.toLowerCase()}.`,
    `Accion de cobranza recomendada por el algoritmo: ${c.accionCobranza}.`,
  ];
  if (c.razones.length > 0) {
    lineas.push(`Factores detectados por el scoring: ${c.razones.join('; ')}.`);
  }
  return lineas.join('\n');
}
