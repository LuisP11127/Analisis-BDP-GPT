// Emparejamiento de los partidos de Sofascore con los de una casa de apuestas: parecido de nombres, liga
// candidata por país y nombre, y partido por hora y equipos. Lo usan Betano y Apuesta Total; cada casa da
// su lista de ligas y cómo leer los partidos de una liga.

import { agregarAlias, aliasDe } from './equivalencias.js';

// Palabras que no ayudan a distinguir equipos o ligas.
const GENERICAS = new Set(['fc', 'cf', 'sc', 'ac', 'cd', 'ca', 'afc', 'fk', 'sk', 'bk', 'sv', 'club', 'de', 'del', 'la', 'el', 'los', 'las', 'the', 'and', 'y']);

// Diferencia máxima entre la hora de inicio de Sofascore y la de la casa. En las muestras coincidían al segundo.
const MARGEN_HORA_MS = 15 * 60 * 1000;

/** Cuántas ligas de la casa se revisan, como máximo, para encontrar una liga de Sofascore. */
const LIGAS_A_REVISAR = 6;

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
 * Ligas de la casa candidatas para una liga de Sofascore, de la más a la menos parecida.
 * - liga: { nombre, region }, con region en el mismo código de país que usa el catálogo.
 * - catalogo: ligas de la casa, cada una con su nombre y codigoRegion.
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
 * Busca en los partidos de una liga de la casa el partido de Sofascore: misma hora (con 15 minutos de margen)
 * y equipos parecidos. `alias` es un Map id de equipo de Sofascore → nombres conocidos en la casa.
 * El partido es claro si supera en 0.25 al segundo candidato y, además, el parecido de los dos equipos llega
 * a 0.5 o uno de los equipos llega a 0.8: en una liga, dos partidos a la misma hora no comparten equipo, así
 * que basta un equipo claro aunque la casa escriba el otro de forma muy distinta ("Friburgo" y "SC Freiburg").
 * Devuelve { estado, evento, candidatos }: estado "emparejado" si es claro, "dudoso" si hay que confirmarlo
 * y "no_encontrado" si no hay partidos a esa hora.
 */
export function emparejarPartido(partido, eventos, alias = new Map()) {
  const inicio = Date.parse(partido.inicio);
  const parecido = (equipo, nombre) => (alias.get(equipo.id)?.includes(nombre) ? 1 : similitud(equipo.nombre, nombre));
  const puntuados = eventos
    .filter((evento) => Math.abs(Date.parse(evento.inicio) - inicio) <= MARGEN_HORA_MS)
    .map((evento) => {
      const equipos = [parecido(partido.local, evento.local), parecido(partido.visitante, evento.visitante)];
      return { evento, puntaje: (equipos[0] + equipos[1]) / 2, mejorEquipo: Math.max(...equipos) };
    })
    .sort((a, b) => b.puntaje - a.puntaje);
  const [mejor, segundo] = puntuados;
  if (!mejor) return { estado: 'no_encontrado', evento: null, candidatos: [] };
  const claro = (mejor.puntaje >= 0.5 || mejor.mejorEquipo >= 0.8) && (!segundo || mejor.puntaje - segundo.puntaje >= 0.25);
  return { estado: claro ? 'emparejado' : 'dudoso', evento: mejor.evento, candidatos: puntuados.map((p) => p.evento) };
}

/** Guarda con qué nombres aparecen en la casa los equipos de un partido emparejado o confirmado. */
export function recordarEquipos(equivalencias, casa, partido, evento, confirmadoEn) {
  agregarAlias(equivalencias, 'equipos', partido.local, casa, evento.local, confirmadoEn);
  agregarAlias(equivalencias, 'equipos', partido.visitante, casa, evento.visitante, confirmadoEn);
}

/**
 * Busca en una casa los partidos de Sofascore elegidos, liga por liga.
 * - casa: código de la casa en las equivalencias.
 * - partidos: partidos del día (formato del proyecto).
 * - regionDe(partido): código de país de la liga del partido, en el mismo código que usa el catálogo.
 * - catalogo: ligas de la casa; nombreDeLiga(liga): nombre con que se guarda en las equivalencias.
 * - leerLiga(liga): partidos de esa liga en la casa, con { id, nombre, inicio, local, visitante }.
 * - equivalencias: nombres conocidos (equivalencias.js); se agregan los que se emparejan.
 * Para cada liga se prueba primero la liga de la casa ya conocida y después las candidatas por país y
 * nombre: se acepta la primera en la que aparece alguno de los partidos a la misma hora y con equipos
 * parecidos. Devuelve un Map id de partido → { estado, evento, candidatos, liga, eventosLiga }, con estado
 * "emparejado", "dudoso", "no_encontrado" o "sin_liga". eventosLiga son los partidos de la liga elegida,
 * para confirmar a mano los que no quedaron emparejados.
 */
export async function emparejarPorLiga({
  casa, partidos, regionDe, catalogo, nombreDeLiga, leerLiga, equivalencias, ahora, progreso = () => {},
}) {
  const resultados = new Map();
  const aliasLigas = aliasDe(equivalencias, 'ligas', casa);
  const aliasEquipos = aliasDe(equivalencias, 'equipos', casa);
  const porLiga = new Map();
  for (const partido of partidos) {
    if (!porLiga.has(partido.liga.id)) porLiga.set(partido.liga.id, []);
    porLiga.get(partido.liga.id).push(partido);
  }

  for (const [idLiga, lista] of porLiga) {
    const ligaSofascore = { nombre: lista[0].liga.nombre, region: regionDe(lista[0]) ?? null };
    const conocidas = catalogo.filter((l) => aliasLigas.get(idLiga)?.includes(nombreDeLiga(l)));
    const candidatas = [...new Set([...conocidas, ...candidatasDeLiga(ligaSofascore, catalogo).map((c) => c.liga)])]
      .slice(0, LIGAS_A_REVISAR + conocidas.length);
    let elegida = null;
    let eventosLiga = [];
    let intentos = [];
    for (const candidata of candidatas) {
      progreso(`buscando ${ligaSofascore.nombre} (${nombreDeLiga(candidata)})`);
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
    agregarAlias(equivalencias, 'ligas', lista[0].liga, casa, nombreDeLiga(elegida), momento);
    for (const [partido, resultado] of intentos) {
      resultados.set(partido.id, { ...resultado, liga: elegida, eventosLiga });
      if (resultado.estado === 'emparejado') recordarEquipos(equivalencias, casa, partido, resultado.evento, momento);
    }
  }
  return resultados;
}
