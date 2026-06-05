/**
 * Compuerta de horario para la capa conversacional (time-share de la GPU única).
 *
 * Dos bots comparten la RTX 5070 de Robocop y NO deben pelear por VRAM:
 *   - Asistente (Qwen)      → atiende en HORARIO LABORAL (para el equipo).
 *   - Supervisor (deepseek) → atiende FUERA de horario laboral (estratégico, CEO).
 *
 * `enHorarioLaboral()` decide en qué franja estamos. La zona horaria es AST
 * (America/Santo_Domingo, UTC-4 sin DST) aunque el server corra en UTC (Dokploy):
 * usamos Intl con timeZone para no depender del reloj del contenedor.
 *
 * Ventanas (configurables por env, formato "HH:MM"):
 *   HORARIO_LV_INICIO  default 07:30   HORARIO_LV_FIN  default 18:00   (Lun–Vie)
 *   HORARIO_SAB_INICIO default 08:00   HORARIO_SAB_FIN default 13:00   (Sábado)
 *   Domingo: siempre fuera de horario laboral.
 *   HORARIO_TZ default 'America/Santo_Domingo'.
 */

const TZ = process.env.HORARIO_TZ || 'America/Santo_Domingo';

interface HorarioConfig {
  lvIni: number;
  lvFin: number;
  sabIni: number;
  sabFin: number;
}

function hhmmToMin(s: string | undefined, def: number): number {
  if (!s) return def;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return def;
  const min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return Number.isFinite(min) && min >= 0 && min <= 24 * 60 ? min : def;
}

function getConfig(): HorarioConfig {
  return {
    lvIni: hhmmToMin(process.env.HORARIO_LV_INICIO, 7 * 60 + 30),
    lvFin: hhmmToMin(process.env.HORARIO_LV_FIN, 18 * 60),
    sabIni: hhmmToMin(process.env.HORARIO_SAB_INICIO, 8 * 60),
    sabFin: hhmmToMin(process.env.HORARIO_SAB_FIN, 13 * 60),
  };
}

/** Día de la semana (0=Dom..6=Sáb) y minutos del día, ambos en AST. */
function partesAST(now: Date): { dow: number; minutos: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = wdMap[get('weekday')] ?? 0;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24 || Number.isNaN(hour)) hour = 0; // algunos runtimes dan '24' a medianoche
  const minute = parseInt(get('minute'), 10) || 0;
  return { dow, minutos: hour * 60 + minute };
}

/**
 * ¿Estamos en horario laboral (ventana del Asistente)? El Supervisor atiende
 * justo en el complemento (cuando esto es false).
 */
export function enHorarioLaboral(now: Date = new Date()): boolean {
  const c = getConfig();
  const { dow, minutos } = partesAST(now);
  if (dow >= 1 && dow <= 5) return minutos >= c.lvIni && minutos < c.lvFin;
  if (dow === 6) return minutos >= c.sabIni && minutos < c.sabFin;
  return false; // domingo
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/** Texto legible de la ventana laboral, para los mensajes de "fuera de horario". */
export function descripcionHorarioLaboral(): string {
  const c = getConfig();
  return `L-V ${minToHHMM(c.lvIni)}–${minToHHMM(c.lvFin)}, Sáb ${minToHHMM(c.sabIni)}–${minToHHMM(c.sabFin)}`;
}
