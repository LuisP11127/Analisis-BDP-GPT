// Sofascore: qué se le pide y cómo se convierten sus respuestas al formato del proyecto (docs/FORMATO_DATOS.md).
// Las direcciones y los campos salen de una muestra real de www.sofascore.com (HAR del 10 y 11 de octubre
// de 2026). Por ahora solo fútbol: básquet y béisbol necesitan su propia muestra.
//
// Las funciones de conversión no hacen pedidos. Las de carga reciben `obtener(ruta)`, que devuelve
// { estado, datos } con datos null cuando Sofascore responde 404, así se pueden probar sin la extensión.

import { fechaLocal } from '../../../comun/rutas.js';

export const FUENTE = 'sofascore';

/** Deportes con muestra: código del proyecto → código de Sofascore. */
export const DEPORTES = { futbol: 'football' };

/** Partidos anteriores de cada equipo que se leen para la previa: los últimos 10 en la misma condición. */
export const CANTIDAD_ULTIMOS = 10;
const PAGINAS_POR_EQUIPO = 2;
const PAGINAS_DE_TORNEOS = 60;

// Zona horaria de Lima (UTC−5) en segundos, como la usa Sofascore en timezoneEventCount.
const ZONA_LIMA = '-18000';
const LADOS = ['local', 'visitante'];

export const RUTAS = {
  ligasFijas: (pais, deporte) => `/api/v1/config/default-unique-tournaments/${pais}/${DEPORTES[deporte]}`,
  torneosDelDia: (deporte, fecha, pagina) => `/api/v1/sport/${DEPORTES[deporte]}/scheduled-tournaments/${fecha}/page/${pagina}`,
  partidosDeLiga: (liga, fecha) => `/api/v1/unique-tournament/${liga}/scheduled-events/${fecha}`,
  partido: (id) => `/api/v1/event/${id}`,
  estadisticas: (id) => `/api/v1/event/${id}/statistics`,
  incidencias: (id) => `/api/v1/event/${id}/incidents`,
  alineaciones: (id) => `/api/v1/event/${id}/lineups`,
  tabla: (torneo, temporada) => `/api/v1/tournament/${torneo}/season/${temporada}/standings/total`,
  ultimosDelEquipo: (equipo, pagina) => `/api/v1/team/${equipo}/events/last/${pagina}`,
};

/** Rutas cuya respuesta no cambia durante la sesión: estadísticas e incidencias de partidos terminados. */
export const rutaFija = (ruta) => /^\/api\/v1\/event\/\d+\/(statistics|incidents)$/.test(ruta);

// Estados de Sofascore (status.type). En la muestra aparecieron notstarted, finished y canceled
// (este último con la descripción "Abandoned"). inprogress, postponed e interrupted no aparecieron:
// si Sofascore usa otro nombre, el partido queda como programado o en juego según la hora.
const ESTADOS = {
  notstarted: 'programado',
  inprogress: 'en_juego',
  finished: 'finalizado',
  postponed: 'aplazado',
  canceled: 'cancelado',
  interrupted: 'suspendido',
};

// Estadísticas por período (ALL, 1ST y 2ND) → campos del formato. En Sofascore "totalShotsOnGoal" es el
// total de remates y "shotsOnGoal" los tiros al arco.
const CONTEOS = {
  cornerKicks: 'corners',
  shotsOnGoal: 'tiros_al_arco',
  totalShotsOnGoal: 'remates',
  fouls: 'faltas',
  offsides: 'fueras_de_juego',
};

// Tarjetas de las incidencias. En la muestra solo hubo amarillas ("yellow"); "yellowRed" (segunda
// amarilla) y "red" siguen los nombres que Sofascore usa en sus estadísticas (yellowRedCards, redCards)
// y falta confirmarlos con un partido que tenga rojas. Con una clase desconocida, las tarjetas del
// partido quedan como dato no disponible.
const TARJETAS = {
  yellow: { tipo: 'amarilla', amarillas: 1, rojas: 0, dobles_amarillas: 0 },
  yellowRed: { tipo: 'doble_amarilla', amarillas: 1, rojas: 1, dobles_amarillas: 1 },
  red: { tipo: 'roja', amarillas: 0, rojas: 1, dobles_amarillas: 0 },
};

// Claves del marcador que aparecen cuando hubo prórroga o penales.
const TIEMPO_EXTRA = ['extra1', 'extra2', 'overtime', 'penalties'];

const conId = (valor) => `${FUENTE}:${valor}`;
/** Parte del id que corresponde a Sofascore: sofascore:17 → 17. */
export const numeroDe = (id) => id.slice(id.indexOf(':') + 1);
const isoDesde = (segundos) => new Date(segundos * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const esConteo = (valor) => Number.isInteger(valor) && valor >= 0;
const sumar = (a, b) => (esConteo(a) && esConteo(b) ? a + b : null);
const persona = (jugador) => (jugador.id ? { id: conId(jugador.id), nombre: jugador.name } : { nombre: jugador.name });

/** Copia el objeto sin los campos null, para no guardar "no se sabe" en cada campo. */
function sinNulos(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== null && valor !== undefined));
}

// ---------------------------------------------------------------- ligas y partidos

/** Liga de un torneo de Sofascore. La liga es el uniqueTournament; el país, la categoría. */
function ligaDe(torneo) {
  const unico = torneo?.uniqueTournament;
  const liga = unico
    ? { id: conId(unico.id), nombre: unico.name }
    // Algunos torneos menores no tienen uniqueTournament: se identifican con el id del torneo.
    : { id: conId(`t${torneo.id}`), nombre: torneo.name };
  return torneo.category?.name ? { ...liga, pais: torneo.category.name } : liga;
}

/**
 * Código de dos letras del país de un partido ("EN", "PE"), que sirve para buscar su liga en Apuesta Total.
 * Viene en los partidos de una liga, no en la lista de torneos del día. Las competiciones internacionales
 * no lo tienen.
 */
export const codigoPaisDe = (evento) => evento?.tournament?.category?.alpha2 ?? null;

/**
 * Ligas con partidos en la fecha de Lima, a partir de las páginas de scheduled-tournaments, en el orden de
 * Sofascore (primero las que Sofascore destaca). `principal` marca las que Sofascore destaca y `region` es
 * el código del país en Sofascore ("england"), que sirve para buscar la liga en las casas de apuestas.
 * Los torneos sin uniqueTournament se dejan fuera porque no hay muestra de cómo pedir sus partidos.
 */
export function ligasDelDia(paginas) {
  const ligas = new Map();
  for (const pagina of paginas) {
    for (const { tournament: torneo, timezoneEventCount: conteos } of pagina?.scheduled ?? []) {
      const cantidad = conteos?.[ZONA_LIMA] ?? 0;
      if (!torneo?.uniqueTournament || cantidad <= 0) continue;
      const liga = ligaDe(torneo);
      const destacada = (torneo.priority ?? 0) > 0;
      const existente = ligas.get(liga.id);
      if (existente) {
        existente.partidos += cantidad;
        existente.principal ||= destacada;
      } else {
        ligas.set(liga.id, { ...liga, region: torneo.category?.slug ?? null, partidos: cantidad, principal: destacada });
      }
    }
  }
  return [...ligas.values()];
}

export function estadoDe(evento, ahora) {
  return ESTADOS[evento.status?.type]
    ?? (new Date(ahora).getTime() < evento.startTimestamp * 1000 ? 'programado' : 'en_juego');
}

const huboTiempoExtra = (evento) => TIEMPO_EXTRA.some((clave) => clave in (evento.homeScore ?? {}) || clave in (evento.awayScore ?? {}));

/**
 * Marcador del tiempo reglamentario. Sofascore lo da en "normaltime"; "current" incluye la prórroga y
 * los penales (en la muestra, un 1-1 definido por penales tenía current 6-5).
 */
export function marcadorReglamentario(evento) {
  const local = evento.homeScore ?? {};
  const visitante = evento.awayScore ?? {};
  if (esConteo(local.normaltime) && esConteo(visitante.normaltime)) return { local: local.normaltime, visitante: visitante.normaltime };
  if (!huboTiempoExtra(evento) && esConteo(local.current) && esConteo(visitante.current)) {
    return { local: local.current, visitante: visitante.current };
  }
  return null;
}

/** Partido de fútbol con el formato del proyecto, sin previa ni estadísticas. `ahora` en ISO. */
export function partidoDesdeEvento(evento, ahora) {
  const inicio = isoDesde(evento.startTimestamp);
  const temporada = evento.season
    ? { id: conId(evento.season.id), nombre: evento.season.name || evento.season.year || `Temporada ${evento.season.id}` }
    : { id: conId('sin-temporada'), nombre: 'Sin temporada' };
  const partido = {
    id: conId(evento.id),
    deporte: 'futbol',
    liga: ligaDe(evento.tournament),
    temporada,
    inicio,
    fecha_local: fechaLocal(inicio),
    local: { id: conId(evento.homeTeam.id), nombre: evento.homeTeam.name },
    visitante: { id: conId(evento.awayTeam.id), nombre: evento.awayTeam.name },
    estado: estadoDe(evento, ahora),
  };
  const marcador = partido.estado === 'finalizado' ? marcadorReglamentario(evento) : null;
  if (marcador) partido.marcador = marcador;
  return partido;
}

// ---------------------------------------------------------------- estadísticas de un partido terminado

function itemsDelPeriodo(estadisticas, periodo) {
  const bloque = estadisticas?.statistics?.find((s) => s.period === periodo);
  if (!bloque) return null;
  const items = new Map();
  for (const grupo of bloque.groups ?? []) {
    // Algunas claves se repiten en dos grupos (remates en "Match overview" y en "Shots") con el mismo valor.
    for (const item of grupo.statisticsItems ?? []) if (!items.has(item.key)) items.set(item.key, item);
  }
  return items;
}

function valorDe(items, clave, lado) {
  const item = items?.get(clave);
  if (!item) return null;
  return lado === 'local' ? item.homeValue : item.awayValue;
}

const porcentaje = (valor) => (typeof valor === 'number' && valor >= 0 && valor <= 100 ? valor : null);
const noNegativo = (valor) => (typeof valor === 'number' && valor >= 0 ? valor : null);

// Momento de una incidencia para ordenarla: el 45+2 va antes del 46.
const momento = (incidencia) => incidencia.time * 100
  + (Number.isInteger(incidencia.addedTime) && incidencia.addedTime > 0 && incidencia.addedTime < 999 ? incidencia.addedTime : 0);

/**
 * Función que dice si un jugador estaba en la cancha al momento de una incidencia: los titulares desde el
 * inicio y los suplentes desde que entraron, hasta que salieron. Con un cambio y una tarjeta en el mismo
 * minuto se toma que estaba en la cancha. Devuelve null si no hay alineación del partido.
 */
function enCanchaSegun(alineaciones, incidencias) {
  const jugadores = ['home', 'away'].flatMap((clave) => alineaciones?.[clave]?.players ?? []);
  if (jugadores.length === 0) return null;
  const titulares = new Set(jugadores.filter((j) => !j.substitute).map((j) => j.player?.id));
  const entradas = new Map();
  const salidas = new Map();
  for (const incidencia of incidencias) {
    if (incidencia.incidentType !== 'substitution') continue;
    if (incidencia.playerIn?.id) entradas.set(incidencia.playerIn.id, momento(incidencia));
    if (incidencia.playerOut?.id) salidas.set(incidencia.playerOut.id, momento(incidencia));
  }
  return (incidencia) => {
    const id = incidencia.player?.id;
    const cuando = momento(incidencia);
    const entro = titulares.has(id) || entradas.get(id) <= cuando;
    const salio = salidas.get(id) < cuando;
    return entro && !salio;
  };
}

/**
 * Tarjetas a jugadores en la cancha hasta el minuto `hasta` (45 o 90, con su descuento), sin las anuladas.
 * `enCancha` dice si el jugador estaba en la cancha; si es null (sin alineación), se cuentan todas las de
 * jugadores.
 */
function tarjetasHasta(incidencias, hasta, enCancha) {
  const cuenta = Object.fromEntries(LADOS.map((lado) => [lado, { amarillas: 0, rojas: 0, dobles_amarillas: 0 }]));
  const eventos = [];
  for (const incidencia of incidencias) {
    if (incidencia.incidentType !== 'card' || incidencia.rescinded) continue;
    // Las tarjetas a entrenadores o al cuerpo técnico no tienen jugador y no se cuentan.
    if (!incidencia.player || !(incidencia.time <= hasta)) continue;
    // Tampoco las de jugadores en el banco: suplentes que no habían entrado o que ya habían salido.
    if (enCancha && !enCancha(incidencia)) continue;
    const clase = TARJETAS[incidencia.incidentClass];
    if (!clase) return null;
    const lado = incidencia.isHome ? 'local' : 'visitante';
    cuenta[lado].amarillas += clase.amarillas;
    cuenta[lado].rojas += clase.rojas;
    cuenta[lado].dobles_amarillas += clase.dobles_amarillas;
    eventos.push(eventoDe(incidencia, clase.tipo, lado));
  }
  return { cuenta, eventos };
}

function eventoDe(incidencia, tipo, equipo) {
  const evento = { minuto: incidencia.time, tipo, equipo };
  if (Number.isInteger(incidencia.addedTime) && incidencia.addedTime > 0 && incidencia.addedTime < 999) {
    evento.minuto_extra = incidencia.addedTime;
  }
  return evento;
}

/**
 * Goles del tiempo reglamentario con su minuto. El equipo sale de cómo cambia el marcador en cada gol
 * (las incidencias traen el marcador después de cada gol), así también se ubican bien los autogoles.
 * Devuelve null si los goles no cuadran con el marcador.
 */
function golesConMinuto(incidencias, marcador) {
  const goles = incidencias
    .filter((i) => i.incidentType === 'goal' && i.time <= 90)
    .sort((a, b) => a.time - b.time || (a.addedTime ?? 0) - (b.addedTime ?? 0));
  let previo = { local: 0, visitante: 0 };
  const eventos = [];
  for (const gol of goles) {
    if (!esConteo(gol.homeScore) || !esConteo(gol.awayScore)) return null;
    let lado = null;
    if (gol.homeScore > previo.local) lado = 'local';
    else if (gol.awayScore > previo.visitante) lado = 'visitante';
    if (!lado) continue;
    eventos.push(eventoDe(gol, 'gol', lado));
    previo = { local: gol.homeScore, visitante: gol.awayScore };
  }
  return previo.local === marcador.local && previo.visitante === marcador.visitante ? eventos : null;
}

/**
 * Estadísticas finales de un partido de fútbol en el tiempo reglamentario.
 * - evento: el partido tal como viene en las listas de Sofascore (con homeScore y awayScore).
 * - estadisticas: respuesta de event/{id}/statistics, o null.
 * - incidencias: respuesta de event/{id}/incidents, o null.
 * - alineaciones: respuesta de event/{id}/lineups, o null. Sirve para no contar las tarjetas a jugadores
 *   en el banco; sin ella se cuentan todas las tarjetas a jugadores.
 * Si hubo prórroga, los conteos del partido salen de sumar el primer y el segundo tiempo, y la posesión
 * y el xG quedan sin dato. Devuelve null si no se conoce el marcador del tiempo reglamentario.
 */
export function estadisticasFutbol({ evento, estadisticas, incidencias, alineaciones = null, extraidoEn }) {
  const marcador = marcadorReglamentario(evento);
  if (!marcador) return null;
  const extra = huboTiempoExtra(evento);
  const todo = itemsDelPeriodo(estadisticas, 'ALL');
  const primero = itemsDelPeriodo(estadisticas, '1ST');
  const segundo = itemsDelPeriodo(estadisticas, '2ND');
  // Una lista vacía en un partido terminado significa que Sofascore no cubre sus incidencias.
  const lista = Array.isArray(incidencias?.incidents) && incidencias.incidents.length > 0 ? incidencias.incidents : null;
  const enCancha = lista ? enCanchaSegun(alineaciones, lista) : null;
  const tarjetas90 = lista ? tarjetasHasta(lista, 90, enCancha) : null;
  const tarjetas45 = lista ? tarjetasHasta(lista, 45, enCancha) : null;

  const completo = {};
  const primerTiempo = {};
  for (const lado of LADOS) {
    const conteos = {};
    const conteos1t = {};
    for (const [clave, campo] of Object.entries(CONTEOS)) {
      const total = valorDe(todo, clave, lado);
      const suma = sumar(valorDe(primero, clave, lado), valorDe(segundo, clave, lado));
      conteos[campo] = !extra && esConteo(total) ? total : suma;
      const parcial = valorDe(primero, clave, lado);
      conteos1t[campo] = esConteo(parcial) ? parcial : null;
    }
    completo[lado] = sinNulos({
      goles: marcador[lado],
      corners: conteos.corners,
      ...(tarjetas90?.cuenta[lado] ?? {}),
      tiros_al_arco: conteos.tiros_al_arco,
      remates: conteos.remates,
      faltas: conteos.faltas,
      fueras_de_juego: conteos.fueras_de_juego,
      posesion: extra ? null : porcentaje(valorDe(todo, 'ballPossession', lado)),
      // expectedGoals no apareció en la muestra (la liga no tenía xG): si Sofascore lo da con otro nombre, queda sin dato.
      xg: extra ? null : noNegativo(valorDe(todo, 'expectedGoals', lado)),
    });
    const golesPrimerTiempo = (lado === 'local' ? evento.homeScore : evento.awayScore)?.period1;
    primerTiempo[lado] = sinNulos({
      goles: esConteo(golesPrimerTiempo) ? golesPrimerTiempo : null,
      corners: conteos1t.corners,
      ...(tarjetas45?.cuenta[lado] ?? {}),
      tiros_al_arco: conteos1t.tiros_al_arco,
      remates: conteos1t.remates,
      faltas: conteos1t.faltas,
      fueras_de_juego: conteos1t.fueras_de_juego,
      posesion: porcentaje(valorDe(primero, 'ballPossession', lado)),
      xg: noNegativo(valorDe(primero, 'expectedGoals', lado)),
    });
  }

  const resultado = { fuente: FUENTE, extraido_en: extraidoEn, completo, primer_tiempo: primerTiempo };
  // Goles y tarjetas con su minuto, para la fase del estilo según el marcador. Los corners por minuto
  // vendrán de Flashscore.
  const goles = lista ? golesConMinuto(lista, marcador) : null;
  if (goles && tarjetas90) {
    resultado.eventos = [...goles, ...tarjetas90.eventos]
      .sort((a, b) => a.minuto - b.minuto || (a.minuto_extra ?? 0) - (b.minuto_extra ?? 0));
  }
  return resultado;
}

/** Partido terminado con sus estadísticas. Si no terminó o no se conoce el marcador, va sin estadísticas. */
export function partidoTerminado({ evento, estadisticas, incidencias, alineaciones = null, ahora }) {
  const partido = partidoDesdeEvento(evento, ahora);
  if (partido.estado !== 'finalizado' || !partido.marcador) return partido;
  const resultado = estadisticasFutbol({ evento, estadisticas, incidencias, alineaciones, extraidoEn: ahora });
  if (resultado) partido.estadisticas = resultado;
  return partido;
}

// ---------------------------------------------------------------- previa

// En la muestra todas las bajas tenían type "missing"; reason 1 traía descripciones de lesiones
// ("Knee Injury"). Los demás motivos quedan como desconocidos, con la descripción de Sofascore.
const motivoDe = (ausente) => (ausente.type === 'missing' && ausente.reason === 1 ? 'lesion' : 'desconocido');

function bajasDe(alineaciones) {
  const bajas = [];
  for (const [clave, equipo] of [['home', 'local'], ['away', 'visitante']]) {
    for (const ausente of alineaciones[clave]?.missingPlayers ?? []) {
      if (!ausente.player?.name) continue;
      bajas.push(sinNulos({
        equipo,
        jugador: persona(ausente.player),
        motivo: motivoDe(ausente),
        detalle: ausente.description || null,
        fuente: FUENTE,
      }));
    }
  }
  return bajas;
}

function alineacionesDe(alineaciones) {
  const titulares = (clave) => (alineaciones[clave]?.players ?? [])
    .filter((j) => !j.substitute && j.player?.name)
    .map((j) => persona(j.player));
  const local = titulares('home');
  const visitante = titulares('away');
  if (local.length === 0 && visitante.length === 0) return null;
  // Antes de que se confirmen, Sofascore muestra la alineación probable (confirmed: false).
  return { confirmadas: alineaciones.confirmed === true, fuente: FUENTE, local, visitante };
}

const CAMPOS_TABLA = { posicion: 'position', partidos_jugados: 'matches', puntos: 'points', ganados: 'wins', empatados: 'draws', perdidos: 'losses' };

function tablaDe(tabla, partido) {
  const local = numeroDe(partido.local.id);
  const visitante = numeroDe(partido.visitante.id);
  for (const grupo of tabla?.standings ?? []) {
    const fila = (id) => grupo.rows?.find((f) => String(f.team?.id) === id);
    const filaLocal = fila(local);
    const filaVisitante = fila(visitante);
    if (!filaLocal || !filaVisitante) continue;
    const convertir = (f) => sinNulos(Object.fromEntries(Object.entries(CAMPOS_TABLA).map(([campo, clave]) => {
      const valor = f[clave];
      const valido = Number.isInteger(valor) && (campo === 'puntos' || valor >= (campo === 'posicion' ? 1 : 0));
      return [campo, valido ? valor : null];
    })));
    return { local: convertir(filaLocal), visitante: convertir(filaVisitante) };
  }
  return null;
}

// Totales del árbitro tal como los da Sofascore en el detalle del partido (en la muestra, de toda su carrera).
const CAMPOS_ARBITRO = { partidos: 'games', amarillas: 'yellowCards', rojas: 'redCards', dobles_amarillas: 'yellowRedCards' };

function arbitroDe(arbitro) {
  if (!arbitro?.name) return null;
  const resultado = { nombre: arbitro.name };
  if (arbitro.id) resultado.id = conId(arbitro.id);
  const estadisticas = sinNulos(Object.fromEntries(Object.entries(CAMPOS_ARBITRO)
    .map(([campo, clave]) => [campo, typeof arbitro[clave] === 'number' ? arbitro[clave] : null])));
  if (Object.keys(estadisticas).length > 0) resultado.estadisticas = estadisticas;
  return resultado;
}

/**
 * Datos previos de un partido de fútbol.
 * - detalle: respuesta de event/{id} (trae el árbitro cuando ya está designado), o null.
 * - alineaciones: respuesta de event/{id}/lineups (alineaciones y bajas), o null.
 * - tabla: respuesta de tournament/{id}/season/{id}/standings/total, o null.
 * - ultimos: { local: [ids], visitante: [ids] } de los partidos anteriores que se leyeron.
 * Sin la respuesta de alineaciones no se sabe si hay bajas y el campo no se incluye; con la respuesta y
 * sin bajas, queda una lista vacía.
 */
export function previaFutbol({ partido, detalle, alineaciones, tabla, ultimos, extraidoEn }) {
  const previa = { extraido_en: extraidoEn, fuentes: [FUENTE] };
  if (alineaciones) {
    previa.bajas = bajasDe(alineaciones);
    const probables = alineacionesDe(alineaciones);
    if (probables) previa.alineaciones_probables = probables;
  }
  const filas = tablaDe(tabla, partido);
  if (filas) previa.tabla = filas;
  const arbitro = arbitroDe(detalle?.event?.referee);
  if (arbitro) previa.arbitro = arbitro;
  previa.ultimos_partidos = ultimos;
  return previa;
}

/**
 * Últimos partidos terminados de un equipo en la misma condición (local o visitante), anteriores a
 * `inicio`, del más reciente al más antiguo. Incluye todas las competiciones.
 */
export function elegirUltimos(eventos, idEquipo, condicion, inicio, cantidad = CANTIDAD_ULTIMOS) {
  const limite = new Date(inicio).getTime() / 1000;
  const vistos = new Set();
  return eventos
    .filter((e) => e.status?.type === 'finished' && e.startTimestamp < limite && marcadorReglamentario(e))
    .filter((e) => (condicion === 'local' ? e.homeTeam?.id : e.awayTeam?.id) === idEquipo)
    .filter((e) => !vistos.has(e.id) && vistos.add(e.id))
    .sort((a, b) => b.startTimestamp - a.startTimestamp)
    .slice(0, cantidad);
}

// ---------------------------------------------------------------- carga con la extensión

/**
 * Ids de las ligas que Sofascore tiene fijas para los usuarios de un país, en su orden. En la muestra, para
 * Perú fueron 22: Liga 1, Liga 2, Premier League, LaLiga, Libertadores, Champions League y otras. Al abrir
 * una fecha, la página de Sofascore pidió los partidos de casi todas las que jugaban ese día.
 */
export function ligasFijas(respuesta) {
  return (respuesta?.uniqueTournaments ?? []).filter((t) => Number.isInteger(t?.id)).map((t) => conId(t.id));
}

const ahoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Ligas fijas de Sofascore para un país ("PE"). Si Sofascore no tiene la lista, devuelve una lista vacía. */
export async function cargarLigasFijas(obtener, { pais = 'PE', deporte = 'futbol' } = {}) {
  const { datos } = await obtener(RUTAS.ligasFijas(pais, deporte));
  return ligasFijas(datos);
}

/** Ligas de un deporte con partidos en la fecha de Lima. Recorre todas las páginas de Sofascore. */
export async function cargarLigas(obtener, fecha, { deporte = 'futbol', progreso = () => {} } = {}) {
  const paginas = [];
  for (let numero = 1; numero <= PAGINAS_DE_TORNEOS; numero += 1) {
    const { datos } = await obtener(RUTAS.torneosDelDia(deporte, fecha, numero));
    if (!datos) break;
    paginas.push(datos);
    progreso(numero);
    if (!datos.hasNextPage) break;
  }
  return ligasDelDia(paginas);
}

/**
 * Partidos de las ligas elegidas en la fecha de Lima. Sofascore devuelve también partidos de los días
 * vecinos, que se descartan. Devuelve los partidos y los eventos originales por id, que hacen falta para
 * la previa.
 */
export async function cargarPartidos(obtener, fecha, ligas, { ahora = ahoraIso, progreso = () => {} } = {}) {
  const partidos = new Map();
  const eventos = new Map();
  for (const [i, liga] of ligas.entries()) {
    const { datos } = await obtener(RUTAS.partidosDeLiga(numeroDe(liga.id), fecha));
    for (const evento of datos?.events ?? []) {
      const partido = partidoDesdeEvento(evento, ahora());
      if (partido.fecha_local !== fecha) continue;
      partidos.set(partido.id, partido);
      eventos.set(partido.id, evento);
    }
    progreso(i + 1, ligas.length);
  }
  const lista = [...partidos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
  return { partidos: lista, eventos };
}

/** Partido terminado con estadísticas e incidencias, a partir del evento de una lista de Sofascore. */
export async function cargarPartidoTerminado(obtener, evento, { ahora = ahoraIso } = {}) {
  const hora = ahora();
  const base = partidoDesdeEvento(evento, hora);
  if (base.estado !== 'finalizado' || !base.marcador) return base;
  const { datos: estadisticas } = await obtener(RUTAS.estadisticas(evento.id));
  const { datos: incidencias } = await obtener(RUTAS.incidencias(evento.id));
  // La alineación solo hace falta si hubo tarjetas a jugadores: dice quién estaba en el banco.
  const conTarjetas = (incidencias?.incidents ?? []).some((i) => i.incidentType === 'card' && i.player && !i.rescinded);
  const alineaciones = conTarjetas ? (await obtener(RUTAS.alineaciones(evento.id))).datos : null;
  return partidoTerminado({ evento, estadisticas, incidencias, alineaciones, ahora: hora });
}

/** Estado actual de un partido por su id (sofascore:123), con estadísticas si ya terminó. Para resolver resultados. */
export async function cargarResultado(obtener, idPartido, { ahora = ahoraIso } = {}) {
  const { datos } = await obtener(RUTAS.partido(numeroDe(idPartido)));
  if (!datos?.event) return null;
  return cargarPartidoTerminado(obtener, datos.event, { ahora });
}

/**
 * Previa de un partido: detalle (árbitro), alineaciones y bajas, tabla y los últimos partidos de cada
 * equipo con sus estadísticas. Devuelve { previa, anteriores }, donde `anteriores` son esos partidos.
 * `progreso(texto)` recibe qué se está leyendo.
 */
export async function cargarPrevia(obtener, partido, evento, { ahora = ahoraIso, cantidad = CANTIDAD_ULTIMOS, progreso = () => {} } = {}) {
  const id = numeroDe(partido.id);
  progreso('datos del partido');
  const { datos: detalle } = await obtener(RUTAS.partido(id));
  const { datos: alineaciones } = await obtener(RUTAS.alineaciones(id));
  const referencia = detalle?.event ?? evento;
  const torneo = referencia?.tournament?.id;
  const temporada = referencia?.season?.id;
  const tabla = torneo && temporada ? (await obtener(RUTAS.tabla(torneo, temporada))).datos : null;

  const ultimos = { local: [], visitante: [] };
  const anteriores = [];
  for (const lado of LADOS) {
    const equipo = Number(numeroDe(partido[lado].id));
    progreso(`últimos partidos de ${partido[lado].nombre}`);
    const eventos = [];
    for (let pagina = 0; pagina < PAGINAS_POR_EQUIPO; pagina += 1) {
      const { datos } = await obtener(RUTAS.ultimosDelEquipo(equipo, pagina));
      eventos.push(...(datos?.events ?? []));
      if (!datos?.hasNextPage || elegirUltimos(eventos, equipo, lado, partido.inicio, cantidad).length >= cantidad) break;
    }
    const elegidos = elegirUltimos(eventos, equipo, lado, partido.inicio, cantidad);
    for (const [i, anterior] of elegidos.entries()) {
      progreso(`últimos partidos de ${partido[lado].nombre} (${i + 1} de ${elegidos.length})`);
      const convertido = await cargarPartidoTerminado(obtener, anterior, { ahora });
      if (!convertido.estadisticas) continue;
      ultimos[lado].push(convertido.id);
      anteriores.push(convertido);
    }
  }
  const previa = previaFutbol({ partido, detalle, alineaciones, tabla, ultimos, extraidoEn: ahora() });
  return { previa, anteriores };
}
