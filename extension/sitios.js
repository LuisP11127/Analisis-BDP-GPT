// Sitios que la extensión puede leer y qué pedidos acepta de cada uno.
// Un sitio se agrega cuando hay una muestra real (HAR) de sus respuestas (ver docs/FUENTES.md).
// Cada origen nuevo también tiene que agregarse en host_permissions de manifest.json.

export const SITIOS = {
  sofascore: {
    nombre: 'Sofascore',
    origen: 'https://www.sofascore.com',
    // Página que se abre en segundo plano cuando no hay una pestaña del sitio.
    inicio: 'https://www.sofascore.com/',
    pestanas: 'https://www.sofascore.com/*',
    // Solo se aceptan pedidos GET a la API, sin parámetros: /api/v1/event/16280837/statistics
    rutas: /^\/api\/v1(\/[A-Za-z0-9_.,-]+)+$/,
    api: 'https://www.sofascore.com/api/*',
    // La página de Sofascore manda esta cabecera en cada pedido a su API. La extensión toma el valor
    // de esos pedidos y lo repite en los suyos.
    cabeceras: ['x-requested-with'],
    // Pausa mínima entre dos pedidos al sitio, para no cargarlo.
    esperaMs: 300,
  },
  betano: {
    nombre: 'Betano',
    origen: 'https://www.betano.pe',
    inicio: 'https://www.betano.pe/',
    pestanas: 'https://www.betano.pe/*',
    // Páginas de liga y de partido de la API, con los parámetros que usa la página de Betano:
    // /api/sport/futbol/peru/liga-1/17079/?req=la,s,stnf,c,mb
    // /api/cuotas-de-partido/liverpool-fc-manchester-city/92398258/?bt=6&req=la,s,stnf,c,mb
    rutas: /^\/api\/(sport|cuotas-de-partido)(\/[A-Za-z0-9_.,-]+)+\/(\?(bt=\d{1,3}&)?req=[a-z,]{1,40})?$/,
    api: 'https://www.betano.pe/api/*',
    // La página de Betano no manda cabeceras propias a su API.
    cabeceras: [],
    esperaMs: 400,
  },
};

/** URL completa del pedido. Lanza un error si el sitio no existe o la ruta no está permitida. */
export function urlDelPedido(codigoSitio, ruta) {
  const sitio = Object.hasOwn(SITIOS, codigoSitio) ? SITIOS[codigoSitio] : null;
  if (!sitio) throw new Error(`Sitio desconocido: ${codigoSitio}`);
  const partes = typeof ruta === 'string' ? ruta.split('/') : [];
  if (!sitio.rutas.test(ruta) || partes.some((parte) => parte === '.' || parte === '..')) {
    throw new Error(`Ruta no permitida para ${sitio.nombre}: ${String(ruta).slice(0, 120)}`);
  }
  return `${sitio.origen}${ruta}`;
}
