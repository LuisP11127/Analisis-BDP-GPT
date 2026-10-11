// Betano Perú: qué se le pide, cómo se convierten sus cuotas al formato del proyecto y cómo se emparejan sus
// partidos con los de Sofascore. Las direcciones y los campos salen de una muestra real de www.betano.pe
// (HAR del 11 de octubre de 2026: Premier League y Liverpool FC - Manchester City con sus pestañas de mercados).
// Por ahora solo fútbol.
//
// Las funciones de conversión no hacen pedidos. Las de carga reciben `obtener(ruta)`, que devuelve
// { estado, datos } con datos null cuando Betano responde 404.

import { agregarAlias, aliasDe } from '../equivalencias.js';

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

// Diferencia máxima entre la hora de inicio de Sofascore y la de Betano. En la muestra coincidían al segundo.
const MARGEN_HORA_MS = 15 * 60 * 1000;

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

// ---------------------------------------------------------------- emparejamiento

// Palabras que no ayudan a distinguir equipos o ligas.
const GENERICAS = new Set(['fc', 'cf', 'sc', 'ac', 'cd', 'ca', 'afc', 'fk', 'sk', 'bk', 'sv', 'club', 'de', 'del', 'la', 'el', 'los', 'las', 'the', 'and', 'y']);

const sinTildes = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Palabras de un nombre, sin tildes ni mayúsculas. */
export function palabras(nombre, { todas = false } = {}) {
  return sinTildes(nombre ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((p) => p && (todas || !GENERICAS.has(p)));
}

const coinciden = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Parecido entre dos nombres, de 0 a 1. Cuenta las palabras en común (o que una empieza con la otra) y
 * reconoce las siglas: "UTC" frente a "Universidad Técnica de Cajamarca".
 */
export function similitud(a, b) {
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.length === 0 || pb.length === 0) return 0;
  if (pa.join(' ') === pb.join(' ')) return 1;
  const comunes = pa.filter((x) => pb.some((y) => coinciden(x, y))).length;
  const contencion = comunes / Math.min(pa.length, pb.length);
  const union = new Set([...pa, ...pb]).size;
  let puntaje = 0.7 * contencion + 0.3 * (comunes / union);
  const siglas = (lista) => lista.map((p) => p[0]).join('');
  for (const [corta, larga] of [[pa, palabras(b, { todas: true })], [pb, palabras(a, { todas: true })]]) {
    if (corta.length === 1 && corta[0].length >= 2 && larga.length >= 2
      && (corta[0] === siglas(larga) || corta[0] === siglas(larga.filter((p) => !GENERICAS.has(p))))) {
      puntaje = Math.max(puntaje, 0.9);
    }
  }
  return Math.min(1, puntaje);
}

/**
 * Ligas de Betano candidatas para una liga de Sofascore, de la más a la menos parecida.
 * - liga: { nombre, region } con region = slug de la categoría de Sofascore ("england").
 * Primero se buscan las del mismo país; si no hay, todas (competiciones internacionales).
 */
export function candidatasDeLiga(liga, catalogo) {
  const mismoPais = catalogo.filter((l) => l.codigoRegion && l.codigoRegion === liga.region);
  const lista = mismoPais.length > 0 ? mismoPais : catalogo;
  return lista
    .map((l) => ({ liga: l, puntaje: similitud(liga.nombre, l.nombre) }))
    .sort((a, b) => b.puntaje - a.puntaje);
}

/**
 * Busca en los partidos de una liga de Betano el partido de Sofascore: misma hora (con 15 minutos de margen)
 * y equipos parecidos. `alias` es un Map id de equipo de Sofascore → nombres conocidos en Betano.
 * Devuelve { estado, evento, candidatos }: estado "emparejado" si es claro, "dudoso" si hay que confirmarlo
 * y "no_encontrado" si no hay partidos a esa hora.
 */
export function emparejarPartido(partido, eventos, alias = new Map()) {
  const inicio = Date.parse(partido.inicio);
  const parecido = (equipo, nombre) => (alias.get(equipo.id)?.includes(nombre) ? 1 : similitud(equipo.nombre, nombre));
  const puntuados = eventos
    .filter((evento) => Math.abs(Date.parse(evento.inicio) - inicio) <= MARGEN_HORA_MS)
    .map((evento) => ({
      evento,
      puntaje: (parecido(partido.local, evento.local) + parecido(partido.visitante, evento.visitante)) / 2,
    }))
    .sort((a, b) => b.puntaje - a.puntaje);
  const [mejor, segundo] = puntuados;
  if (!mejor) return { estado: 'no_encontrado', evento: null, candidatos: [] };
  const claro = mejor.puntaje >= 0.5 && (!segundo || mejor.puntaje - segundo.puntaje >= 0.25);
  return { estado: claro ? 'emparejado' : 'dudoso', evento: mejor.evento, candidatos: puntuados.map((p) => p.evento) };
}

/** Entradas de mercados de la extracción del día a partir de las ofertas de un partido. */
export function mercadosDeOfertas(partidoId, ofertas) {
  return [...ofertas.entries()].map(([mercado, oferta]) => ({ partido_id: partidoId, mercado, ofertas: [oferta] }));
}

// ---------------------------------------------------------------- carga con la extensión

const ahoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Cuántas ligas de Betano se revisan, como máximo, para encontrar una liga de Sofascore. */
const LIGAS_A_REVISAR = 6;

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
 * Para cada liga se prueba primero la liga de Betano ya conocida y después las candidatas por país y
 * nombre: se acepta la primera en la que aparece alguno de los partidos a la misma hora y con equipos
 * parecidos. Devuelve un Map id de partido → { estado, evento, candidatos, liga, ofertas, eventosLiga }, con
 * estado "emparejado", "dudoso", "no_encontrado" o "sin_liga". Los que no quedan emparejados traen en
 * eventosLiga los partidos de su liga en Betano, para confirmarlos a mano.
 */
export async function buscarCuotas(obtener, partidos, ligas, equivalencias, { ahora = ahoraIso, progreso = () => {} } = {}) {
  const resultados = new Map();
  if (partidos.length === 0) return resultados;
  progreso('lista de ligas de Betano');
  const catalogo = await cargarCatalogo(obtener);
  const paginas = new Map();
  const leerLiga = async (liga) => {
    if (!paginas.has(liga.url)) paginas.set(liga.url, await cargarLiga(obtener, liga));
    return paginas.get(liga.url);
  };
  const aliasLigas = aliasDe(equivalencias, 'ligas', CASA);
  const aliasEquipos = aliasDe(equivalencias, 'equipos', CASA);

  const porLiga = new Map();
  for (const partido of partidos) {
    if (!porLiga.has(partido.liga.id)) porLiga.set(partido.liga.id, []);
    porLiga.get(partido.liga.id).push(partido);
  }

  for (const [idLiga, lista] of porLiga) {
    const ligaSofascore = { nombre: lista[0].liga.nombre, region: null, ...(ligas.get(idLiga) ?? {}) };
    const conocidas = catalogo.filter((l) => aliasLigas.get(idLiga)?.includes(nombreDeLiga(l)));
    const candidatas = [...new Set([...conocidas, ...candidatasDeLiga(ligaSofascore, catalogo).map((c) => c.liga)])]
      .slice(0, LIGAS_A_REVISAR + conocidas.length);
    let elegida = null;
    let eventosLiga = [];
    let intentos = [];
    for (const candidata of candidatas) {
      progreso(`buscando ${ligaSofascore.nombre} en Betano (${nombreDeLiga(candidata)})`);
      eventosLiga = await leerLiga(candidata);
      intentos = lista.map((partido) => [partido, emparejarPartido(partido, eventosLiga, aliasEquipos)]);
      if (intentos.some(([, r]) => r.estado === 'emparejado')) {
        elegida = candidata;
        break;
      }
    }
    if (!elegida) {
      for (const partido of lista) resultados.set(partido.id, { estado: 'sin_liga', evento: null, candidatos: [] });
      continue;
    }
    const momento = ahora();
    agregarAlias(equivalencias, 'ligas', lista[0].liga, CASA, nombreDeLiga(elegida), momento);
    for (const [partido, resultado] of intentos) {
      if (resultado.estado !== 'emparejado') {
        // Los partidos de la liga quedan a mano para que el usuario elija el que corresponde.
        resultados.set(partido.id, { ...resultado, liga: elegida, eventosLiga });
        continue;
      }
      progreso(`cuotas de ${partido.local.nombre} vs ${partido.visitante.nombre} en Betano`);
      const ofertas = await cargarCuotas(obtener, resultado.evento, { ahora });
      resultados.set(partido.id, { ...resultado, liga: elegida, ofertas });
      recordarEquipos(equivalencias, partido, resultado.evento, momento);
    }
  }
  return resultados;
}

/** Guarda con qué nombres aparecen en Betano los equipos de un partido emparejado o confirmado. */
export function recordarEquipos(equivalencias, partido, evento, confirmadoEn) {
  agregarAlias(equivalencias, 'equipos', partido.local, CASA, evento.local, confirmadoEn);
  agregarAlias(equivalencias, 'equipos', partido.visitante, CASA, evento.visitante, confirmadoEn);
}
