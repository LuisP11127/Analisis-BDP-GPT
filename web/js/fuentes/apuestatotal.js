// Apuesta Total: qué se le pide, cómo se convierten sus partidos y cuotas al formato del proyecto y cómo se
// emparejan sus partidos con los de Sofascore. Su sección de apuestas deportivas es de un proveedor externo y
// responde en prod20392.kmianko.com. Las direcciones y los campos salen de dos muestras reales del 11 de
// octubre de 2026: un HAR (la lista de fútbol, Como vs AS Roma, un partido de NBA y uno de MLB) y la lista
// de partidos guardada desde el navegador. Por ahora solo fútbol.
//
// Las funciones de conversión no hacen pedidos. Las de carga reciben `obtener(ruta)`, que devuelve
// { estado, datos } con datos null cuando Apuesta Total responde 404.

import { emparejarPorLiga, recordarEquipos as recordarEquiposEn } from '../emparejamiento.js';

export const CASA = 'apuesta_total';

/**
 * Mercados de fútbol del proyecto en Apuesta Total: tipo de mercado → código del catálogo. Hay dos mercados
 * "Total de tarjetas": OU10 es el asiático (con líneas enteras) y no se usa; OU6010 tiene las líneas .5.
 */
export const MERCADOS_FUTBOL = new Map([
  ['OU200', 'futbol_goles'],
  ['QA158', 'futbol_ambos_anotan'],
  ['OU615', 'futbol_corners'],
  ['OU6010', 'futbol_tarjetas'],
  ['OU121', 'futbol_tiros_arco'],
  ['OU2083', 'futbol_remates'],
  ['OU14', 'futbol_corners_1t'],
]);

/** Partidos por pedido de mercados. En la muestra, la página de Apuesta Total pedía hasta 9 a la vez. */
const PARTIDOS_POR_PEDIDO = 10;

export const RUTAS = {
  /** Todos los partidos de todos los deportes, de hoy y de las semanas siguientes (2834 en la muestra). */
  eventos: '/api/pulse/snapshot/events?lang=ES-PE&t=hPNl',
  /** Mercados de varios partidos en un solo pedido: ids separados por "|", ":" y los tipos de mercado. */
  mercados: (idsPartidos, tipos = [...MERCADOS_FUTBOL.keys()]) =>
    `/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${idsPartidos.join('|')}:${tipos.join('|')}`)}`,
};

// Códigos de país de Apuesta Total que no coinciden con los de Sofascore (category.alpha2), comparando las
// dos muestras: Escocia y Irlanda del Norte. Europa (EU), Sudamérica (SAM) e Internacional (ZZ) no tienen
// código en Sofascore; esas ligas se buscan por nombre.
const CODIGOS_DISTINTOS = { KK: 'SX', NIE: 'NX' };

const isoDesdeMs = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const ahoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---------------------------------------------------------------- partidos y ligas

/**
 * Partidos de fútbol de la lista de Apuesta Total, con la hora en UTC, los equipos en orden (local primero) y
 * su liga. Se dejan fuera las apuestas a largo plazo (campeón, goleador) y los e-sports.
 */
export function partidosDeFutbol(lista) {
  const partidos = [];
  for (const evento of Array.isArray(lista) ? lista : []) {
    if (evento.SportId !== '1' || evento.Type !== 'Fixture' || !Number.isFinite(evento.StartEventDate)) continue;
    const local = evento.Participants?.find((p) => p.VenueRole === 'Home');
    const visitante = evento.Participants?.find((p) => p.VenueRole === 'Away');
    if (!local || !visitante) continue;
    partidos.push({
      id: String(evento._id),
      nombre: evento.EventName,
      inicio: isoDesdeMs(evento.StartEventDate),
      local: local.Name,
      visitante: visitante.Name,
      liga: {
        id: String(evento.LeagueId),
        nombre: evento.LeagueName,
        region: evento.RegionName,
        codigoRegion: CODIGOS_DISTINTOS[evento.RegionCode] ?? evento.RegionCode ?? null,
      },
    });
  }
  return partidos;
}

/** Ligas de Apuesta Total que tienen partidos en la lista, sin repetir. */
export function catalogoDeLigas(partidos) {
  return [...new Map(partidos.map((p) => [p.liga.id, p.liga])).values()];
}

/**
 * Nombre con que se guarda una liga de Apuesta Total en las equivalencias: "Inglaterra - Premier League".
 * Algunas ligas ya traen el país en el nombre ("Perú - Liga 2").
 */
export const nombreDeLiga = (liga) => (liga.nombre.startsWith(`${liga.region} - `) ? liga.nombre : `${liga.region} - ${liga.nombre}`);

// ---------------------------------------------------------------- cuotas

// En las selecciones, Side 1 es "Más de" o "Sí" y Side 3 es "Menos de" o "No" (2 es el empate en los 1X2).
const LADOS = { 1: 'a', 3: 'b' };

const esCuota = (valor) => typeof valor === 'number' && Number.isFinite(valor) && valor > 1;
const esLineaMedia = (linea) => typeof linea === 'number' && Math.abs(linea % 1) === 0.5;

/** Cuota decimal que muestra la página. En la muestra, DisplayOdds.Decimal y TrueOdds siempre coincidían. */
const cuotaDe = (seleccion) => Number(seleccion.DisplayOdds?.Decimal ?? seleccion.TrueOdds);

/**
 * Líneas de un mercado. En los Más/Menos la línea viene en Points ("Más de 2.5" → 2.5); en ambos anotan no
 * hay línea. Se dejan solo las líneas .5 con las dos cuotas, sin las selecciones desactivadas.
 */
function lineasDe(mercado, conLinea) {
  const porLinea = new Map();
  for (const seleccion of mercado.Selections ?? []) {
    const lado = LADOS[seleccion.Side];
    const cuota = cuotaDe(seleccion);
    if (!lado || seleccion.IsDisabled || seleccion.IsRemoved || !esCuota(cuota)) continue;
    const linea = conLinea ? seleccion.Points : null;
    if (conLinea && !esLineaMedia(linea)) continue;
    if (!porLinea.has(linea)) porLinea.set(linea, {});
    porLinea.get(linea)[lado] = cuota;
  }
  return [...porLinea.entries()]
    .filter(([, cuotas]) => cuotas.a && cuotas.b)
    .map(([linea, cuotas]) => ({ linea, cuota_a: cuotas.a, cuota_b: cuotas.b }))
    .sort((x, y) => (x.linea ?? 0) - (y.linea ?? 0));
}

/**
 * Ofertas de Apuesta Total para los mercados de fútbol del proyecto, a partir de la respuesta de
 * RUTAS.mercados. Devuelve un Map id de partido de Apuesta Total → Map código de mercado → oferta con el
 * formato del historial (el mismo que ofertasFutbol de Betano). Se saltan los mercados suspendidos.
 */
export function ofertasFutbol(respuesta, extraidoEn) {
  const porPartido = new Map();
  for (const mercado of Array.isArray(respuesta) ? respuesta : []) {
    const codigo = MERCADOS_FUTBOL.get(mercado.MarketType?._id);
    if (!codigo || mercado.IsSuspended || mercado.IsRemoved) continue;
    const id = String(mercado.EventId);
    const ofertas = porPartido.get(id) ?? new Map();
    if (ofertas.has(codigo)) continue;
    const lineas = lineasDe(mercado, codigo !== 'futbol_ambos_anotan');
    if (lineas.length === 0) continue;
    ofertas.set(codigo, { casa: CASA, extraido_en: extraidoEn, lineas });
    porPartido.set(id, ofertas);
  }
  return porPartido;
}

// ---------------------------------------------------------------- carga con la extensión

/** Cuotas de varios partidos de Apuesta Total: Map id de partido → Map de ofertasFutbol. */
export async function cargarCuotas(obtener, idsPartidos, { ahora = ahoraIso } = {}) {
  const momento = ahora();
  const porPartido = new Map();
  for (let i = 0; i < idsPartidos.length; i += PARTIDOS_POR_PEDIDO) {
    const { datos } = await obtener(RUTAS.mercados(idsPartidos.slice(i, i + PARTIDOS_POR_PEDIDO)));
    for (const [id, ofertas] of ofertasFutbol(datos, momento)) porPartido.set(id, ofertas);
  }
  return porPartido;
}

/**
 * Busca en Apuesta Total los partidos de Sofascore elegidos y lee sus cuotas.
 * - partidos: partidos del día (formato del proyecto).
 * - ligas: Map id de liga de Sofascore → { codigoPais }, con el código de dos letras de Sofascore ("EN").
 * - equivalencias: nombres conocidos (equivalencias.js); se agregan los que se confirman al emparejar.
 * Un pedido trae todos los partidos de Apuesta Total; el emparejamiento (emparejamiento.js) busca la liga
 * por país y nombre y el partido por hora y equipos. Las cuotas de los emparejados se piden de a 10
 * partidos. Devuelve el Map de emparejarPorLiga; los partidos emparejados traen además sus ofertas.
 */
export async function buscarCuotas(obtener, partidos, ligas, equivalencias, { ahora = ahoraIso, progreso = () => {} } = {}) {
  if (partidos.length === 0) return new Map();
  progreso('lista de partidos');
  const { datos } = await obtener(RUTAS.eventos);
  const eventos = partidosDeFutbol(datos);
  const resultados = await emparejarPorLiga({
    casa: CASA,
    partidos,
    regionDe: (partido) => ligas.get(partido.liga.id)?.codigoPais,
    catalogo: catalogoDeLigas(eventos),
    nombreDeLiga,
    leerLiga: async (liga) => eventos.filter((e) => e.liga.id === liga.id),
    equivalencias,
    ahora,
    progreso,
  });
  const emparejados = partidos.map((p) => resultados.get(p.id)).filter((r) => r?.estado === 'emparejado');
  if (emparejados.length > 0) {
    progreso(`cuotas de ${emparejados.length} ${emparejados.length === 1 ? 'partido' : 'partidos'}`);
    const cuotas = await cargarCuotas(obtener, emparejados.map((r) => r.evento.id), { ahora });
    for (const resultado of emparejados) resultado.ofertas = cuotas.get(resultado.evento.id) ?? new Map();
  }
  return resultados;
}

/** Guarda con qué nombres aparecen en Apuesta Total los equipos de un partido confirmado a mano. */
export const recordarEquipos = (equivalencias, partido, evento, confirmadoEn) => recordarEquiposEn(equivalencias, CASA, partido, evento, confirmadoEn);
