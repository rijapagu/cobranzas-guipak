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
