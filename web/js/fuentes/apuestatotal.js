// Apuesta Total: qué se le pide y cómo se convierten sus cuotas al formato del proyecto. Su sección de
// apuestas deportivas es de un proveedor externo y responde en prod20392.kmianko.com. Las direcciones y los
// campos salen de una muestra real (HAR del 11 de octubre de 2026: la lista de fútbol, Como vs AS Roma,
// Houston Rockets vs Dallas Mavericks y Milwaukee Brewers vs Los Angeles Dodgers).
//
// Por ahora solo las cuotas de fútbol de partidos ya identificados en Apuesta Total. Falta la lista de
// partidos del día para buscar en ella los de Sofascore: la muestra no la trae.

export const CASA = 'apuesta_total';

/**
 * Mercados de fútbol del proyecto en Apuesta Total: tipo de mercado → código del catálogo. Las tarjetas
 * quedan fuera hasta saber cuál de sus dos mercados "Total de tarjetas" (OU10 y OU6010, con cuotas
 * distintas) cuenta como Betano.
 */
export const MERCADOS_FUTBOL = new Map([
  ['OU200', 'futbol_goles'],
  ['QA158', 'futbol_ambos_anotan'],
  ['OU615', 'futbol_corners'],
  ['OU121', 'futbol_tiros_arco'],
  ['OU2083', 'futbol_remates'],
  ['OU14', 'futbol_corners_1t'],
]);

export const RUTAS = {
  /** Mercados de varios partidos en un solo pedido: ids separados por "|", ":" y los tipos de mercado. */
  mercados: (idsPartidos, tipos = [...MERCADOS_FUTBOL.keys()]) =>
    `/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${idsPartidos.join('|')}:${tipos.join('|')}`)}`,
};

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
