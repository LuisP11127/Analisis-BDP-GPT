// Betano Perú: qué se le pide, cómo se convierten sus cuotas al formato del proyecto y cómo se emparejan sus
// partidos con los de Sofascore. Las direcciones y los campos salen de una muestra real de www.betano.pe
// (HAR del 11 de octubre de 2026: Premier League y Liverpool FC - Manchester City con sus pestañas de mercados).
// Por ahora solo fútbol.
//
// Las funciones de conversión no hacen pedidos. Las de carga reciben `obtener(ruta)`, que devuelve
// { estado, datos } con datos null cuando Betano responde 404.

import { emparejarPorLiga, recordarEquipos as recordarEquiposEn } from '../emparejamiento.js';

export const CASA = 'betano';

const PEDIDO = 'req=la,s,stnf,c,mb';

/**
 * Mercados de fútbol del proyecto en Betano: tipo de mercado de Betano → código del catálogo y la pestaña
 * del partido donde aparece. En la muestra, la pestaña "Populares" (la que llega sin pedir pestaña) traía
 * goles, ambos anotan, córners, tarjetas y córners del primer tiempo con todas sus líneas; tiros al arco y
 * remates solo estaban en "Estadísticas".
 */
export const MERCADOS_FUTBOL = new Map([
  ['HCTG', { mercado: 'futbol_goles', pestana: 'goals' }],
  ['BTSC', { mercado: 'futbol_ambos_anotan', pestana: 'goals' }],
  ['CNOU', { mercado: 'futbol_corners', pestana: 'cornerkicks' }],
  ['TCOU', { mercado: 'futbol_tarjetas', pestana: 'cards' }],
  ['X002', { mercado: 'futbol_tiros_arco', pestana: 'statistics' }],
  ['4159', { mercado: 'futbol_remates', pestana: 'statistics' }],
  ['COU1', { mercado: 'futbol_corners_1t', pestana: 'cornerkicks' }],
]);

/** Cualquier página de liga trae la lista completa de ligas de fútbol de Betano. Esta es la de la muestra. */
export const LIGA_DE_ENTRADA = '/sport/futbol/inglaterra/premier-league/1r/';

export const RUTAS = {
  pagina: (url) => `/api${url}?${PEDIDO}`,
  pestana: (url, id) => `/api${url}?bt=${id}&${PEDIDO}`,
};

// Códigos de país de Betano que no coinciden con el de Sofascore (comparando las dos muestras).
const CODIGOS_DISTINTOS = { czechia: 'czech-republic', turkiye: 'turkey' };

const isoDesdeMs = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const esCuota = (valor) => typeof valor === 'number' && Number.isFinite(valor) && valor > 1;
const esLineaMedia = (linea) => typeof linea === 'number' && Math.abs(linea % 1) === 0.5;

// ---------------------------------------------------------------- ligas y partidos

/** Ligas de fútbol de Betano a partir de la lista de una página de liga (dropdownList). */
export function catalogoDeLigas(respuesta) {
  return (respuesta?.data?.dropdownList ?? []).flatMap((region) => (region.leagues ?? []).map((liga) => ({
    id: liga.id,
    nombre: liga.text,
    region: region.name,
    // Código del país en inglés, igual al de las categorías de Sofascore en la mayoría de los países.
    codigoRegion: CODIGOS_DISTINTOS[region.regionCode] ?? region.regionCode ?? null,
    url: liga.url,
  })));
}

/** Nombre con que se guarda una liga de Betano en las equivalencias: "Inglaterra - Premier League". */
export const nombreDeLiga = (liga) => `${liga.region} - ${liga.nombre}`;

/** Partidos de una página de liga, con la hora en UTC y los equipos en el orden de Betano (local primero). */
export function partidosDeLiga(respuesta) {
  return (respuesta?.data?.blocks ?? []).flatMap((bloque) => (bloque.events ?? [])
    .filter((evento) => evento.participants?.length === 2 && Number.isFinite(evento.startTime))
    .map((evento) => ({
      id: String(evento.id),
      nombre: evento.name,
      inicio: isoDesdeMs(evento.startTime),
      url: evento.url,
      local: evento.participants[0].name,
      visitante: evento.participants[1].name,
      liga: bloque.name,
    })));
}

// ---------------------------------------------------------------- cuotas

/** Pestañas de mercados de un partido: tipo (goals, cornerkicks, cards, statistics...) → id. */
export function pestanasDe(respuesta) {
  return Object.fromEntries((respuesta?.data?.markets ?? []).map((pestana) => [pestana.type, pestana.id]));
}

const lado = (seleccion) => {
  const nombre = seleccion.name ?? '';
  if (nombre.startsWith('Más') || nombre === 'Sí') return 'a';
  if (nombre.startsWith('Menos') || nombre === 'No') return 'b';
  return null;
};

/**
 * Líneas de un mercado de Betano. En los Más/Menos cada línea trae "Más de X" y "Menos X" con el mismo
 * handicap; en ambos anotan, "Sí" y "No" sin línea. Se dejan solo las líneas .5 con las dos cuotas.
 */
function lineasDe(mercado, conLinea) {
  const porLinea = new Map();
  for (const seleccion of mercado.selections ?? []) {
    const ladoSeleccion = lado(seleccion);
    if (!ladoSeleccion || !esCuota(seleccion.price)) continue;
    const linea = conLinea ? seleccion.handicap : null;
    if (conLinea && !esLineaMedia(linea)) continue;
    if (!porLinea.has(linea)) porLinea.set(linea, {});
    porLinea.get(linea)[ladoSeleccion] = seleccion.price;
  }
  return [...porLinea.entries()]
    .filter(([, cuotas]) => cuotas.a && cuotas.b)
    .map(([linea, cuotas]) => ({ linea, cuota_a: cuotas.a, cuota_b: cuotas.b }))
    .sort((x, y) => (x.linea ?? 0) - (y.linea ?? 0));
}

/**
 * Ofertas de Betano para los mercados de fútbol del proyecto, a partir de las respuestas de un partido
 * (la página y sus pestañas). Devuelve un Map código de mercado → oferta con el formato del historial.
 */
export function ofertasFutbol(respuestas, extraidoEn) {
  const ofertas = new Map();
  for (const respuesta of respuestas) {
    for (const mercado of respuesta?.data?.event?.markets ?? []) {
      const definicion = MERCADOS_FUTBOL.get(mercado.type);
      if (!definicion || ofertas.has(definicion.mercado)) continue;
      const lineas = lineasDe(mercado, definicion.mercado !== 'futbol_ambos_anotan');
      if (lineas.length > 0) ofertas.set(definicion.mercado, { casa: CASA, extraido_en: extraidoEn, lineas });
    }
  }
  return ofertas;
}

// ---------------------------------------------------------------- carga con la extensión

const ahoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Catálogo de ligas de fútbol de Betano. */
export async function cargarCatalogo(obtener) {
  const { datos } = await obtener(RUTAS.pagina(LIGA_DE_ENTRADA));
  return catalogoDeLigas(datos);
}

/** Partidos de una liga de Betano. */
export async function cargarLiga(obtener, liga) {
  const { datos } = await obtener(RUTAS.pagina(liga.url));
  return partidosDeLiga(datos);
}

/**
 * Cuotas de un partido de Betano para los mercados de fútbol del proyecto. Pide la página del partido y,
 * si faltan mercados, las pestañas donde suelen estar. Devuelve el Map de ofertasFutbol.
 */
export async function cargarCuotas(obtener, evento, { ahora = ahoraIso } = {}) {
  const { datos: pagina } = await obtener(RUTAS.pagina(evento.url));
  if (!pagina) return new Map();
  const respuestas = [pagina];
  const pestanas = pestanasDe(pagina);
  const faltan = () => [...MERCADOS_FUTBOL.values()].filter((d) => !ofertasFutbol(respuestas, '').has(d.mercado));
  for (const tipo of [...new Set(faltan().map((d) => d.pestana))]) {
    if (pestanas[tipo] === undefined || !faltan().some((d) => d.pestana === tipo)) continue;
    const { datos } = await obtener(RUTAS.pestana(evento.url, pestanas[tipo]));
    if (datos) respuestas.push(datos);
  }
  return ofertasFutbol(respuestas, ahora());
}

/**
 * Busca en Betano los partidos de Sofascore elegidos y lee sus cuotas.
 * - partidos: partidos del día (formato del proyecto).
 * - ligas: Map id de liga de Sofascore → { nombre, region } (de ligasDelDia de Sofascore).
 * - equivalencias: nombres conocidos (equivalencias.js); se agregan los que se confirman al emparejar.
 * El emparejamiento está en emparejamiento.js: la liga se busca por país (Betano usa el mismo código que
 * las categorías de Sofascore, "england") y nombre, y cada página de liga se pide una sola vez. Devuelve el
 * Map de emparejarPorLiga; los partidos emparejados traen además sus ofertas.
 */
export async function buscarCuotas(obtener, partidos, ligas, equivalencias, { ahora = ahoraIso, progreso = () => {} } = {}) {
  if (partidos.length === 0) return new Map();
  progreso('lista de ligas de Betano');
  const catalogo = await cargarCatalogo(obtener);
  const paginas = new Map();
  const resultados = await emparejarPorLiga({
    casa: CASA,
    partidos,
    regionDe: (partido) => ligas.get(partido.liga.id)?.region,
    catalogo,
    nombreDeLiga,
    leerLiga: async (liga) => {
      if (!paginas.has(liga.url)) paginas.set(liga.url, await cargarLiga(obtener, liga));
      return paginas.get(liga.url);
    },
    equivalencias,
    ahora,
    progreso,
  });
  for (const partido of partidos) {
    const resultado = resultados.get(partido.id);
    if (resultado?.estado !== 'emparejado') continue;
    progreso(`cuotas de ${partido.local.nombre} vs ${partido.visitante.nombre}`);
    resultado.ofertas = await cargarCuotas(obtener, resultado.evento, { ahora });
  }
  return resultados;
}

/** Guarda con qué nombres aparecen en Betano los equipos de un partido confirmado a mano. */
export const recordarEquipos = (equivalencias, partido, evento, confirmadoEn) => recordarEquiposEn(equivalencias, CASA, partido, evento, confirmadoEn);
