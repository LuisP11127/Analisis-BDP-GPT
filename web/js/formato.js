// Textos que muestra la página: fechas en hora de Lima, porcentajes, cuotas, montos y nombres de los lados.

const ZONA = 'America/Lima';
const formatos = {
  fechaHora: new Intl.DateTimeFormat('es-PE', {
    timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }),
  hora: new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  fechaLarga: new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  fechaCorta: new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' }),
  soles: new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }),
};

// Una fecha AAAA-MM-DD se interpreta al mediodía de Lima para que no cambie de día.
const mediodia = (fecha) => new Date(`${fecha}T17:00:00Z`);

export const fechaHora = (iso) => formatos.fechaHora.format(new Date(iso));
export const hora = (iso) => formatos.hora.format(new Date(iso));
export const fechaLarga = (fecha) => formatos.fechaLarga.format(mediodia(fecha));
export const capitalizar = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);
export const fechaCorta = (fecha) => formatos.fechaCorta.format(mediodia(fecha));

/** 0.585 → "59%". */
export const porcentaje = (p) => `${Math.round(p * 100 + 1e-9)}%`;

export const cuota = (c) => c.toFixed(2);

export function soles(monto, { conSigno = false } = {}) {
  const texto = formatos.soles.format(Math.abs(monto));
  if (!conSigno || monto === 0) return monto < 0 ? `−${texto}` : texto;
  return monto > 0 ? `+${texto}` : `−${texto}`;
}

/** Número con signo para handicaps y diferencias: 3.5 → "+3.5", -3.5 → "-3.5". */
export const signo = (n) => (n > 0 ? `+${n}` : `${n}`);

/** Probabilidad del lado que recomienda una predicción. */
export const probLado = (prediccion) => (prediccion.lado === 'a' ? prediccion.prob_a : 1 - prediccion.prob_a);

/**
 * Nombre de un lado tal como se apuesta: "Más 2.5", "Sí", "Toros Muestra -3.5", "Leones Muestra".
 * `partido` necesita local y visitante con nombre; la línea es la del registro (en handicap, la del local).
 */
export function nombreLado(definicion, lado, partido, linea) {
  switch (definicion.tipo) {
    case 'mas_menos':
      return `${lado === 'a' ? definicion.lado_a : definicion.lado_b} ${linea}`;
    case 'handicap':
      return lado === 'a' ? `${partido.local.nombre} ${signo(linea)}` : `${partido.visitante.nombre} ${signo(-linea)}`;
    case 'ganador':
      return lado === 'a' ? partido.local.nombre : partido.visitante.nombre;
    default:
      return lado === 'a' ? definicion.lado_a : definicion.lado_b;
  }
}

const UNIDADES = {
  goles: ['gol', 'goles'],
  corners: ['corner', 'corners'],
  tarjetas: ['tarjeta', 'tarjetas'],
  tiros_al_arco: ['tiro al arco', 'tiros al arco'],
  remates: ['remate', 'remates'],
  puntos: ['punto', 'puntos'],
  carreras: ['carrera', 'carreras'],
};

/** Texto del valor real de un resultado: "3 goles", "Diferencia del local: +2", "Anotaron los dos". */
export function textoValorReal(definicion, registro) {
  const valor = registro.resultado.valor_real;
  if (definicion.tipo === 'si_no') return valor === 1 ? 'Anotaron los dos' : 'No anotaron los dos';
  if (definicion.tipo === 'handicap' || definicion.tipo === 'ganador') return `Diferencia del local: ${signo(valor)}`;
  if (definicion.por_jugador) {
    const nombre = nombreEstadisticaJugador(definicion, registro.estadistica_jugador).toLowerCase();
    return `${valor} (${nombre})`;
  }
  const [singular, plural] = UNIDADES[definicion.estadistica] ?? ['', ''];
  return `${valor} ${valor === 1 ? singular : plural}`.trim();
}

export function nombreEstadisticaJugador(definicion, codigo) {
  return definicion.estadisticas_jugador?.find((e) => e.codigo === codigo)?.nombre ?? codigo;
}

const FACTORES = {
  forma_reciente: 'Forma reciente',
  rival_concede: 'Lo que concede el rival',
  localia: 'Localía',
  promedio_liga: 'Promedio de la liga',
  arbitro: 'Árbitro',
  rivalidad: 'Rivalidad',
  bajas: 'Bajas',
  ritmo_juego: 'Ritmo de juego',
  ataque_local: 'Ataque del local',
  defensa_rival: 'Defensa del rival',
  descanso: 'Días de descanso',
  promedio_jugador: 'Promedio del jugador',
  minutos: 'Minutos en cancha',
  abridor_rival: 'Lanzador abridor rival',
  ofensiva: 'Ofensiva',
  bullpen: 'Bullpen',
};

export function nombreFactor(codigo) {
  if (FACTORES[codigo]) return FACTORES[codigo];
  const texto = codigo.replaceAll('_', ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Impacto de un factor visto desde el lado recomendado: "+5%" o "−3%". */
export function impactoHaciaLado(impacto, lado) {
  const valor = Math.round((lado === 'a' ? impacto : -impacto) * 100);
  if (valor === 0) return '0%';
  return valor > 0 ? `+${valor}%` : `−${Math.abs(valor)}%`;
}
