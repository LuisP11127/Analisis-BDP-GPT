import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCandidata } from '../comun/reglas.js';
import { cargarValidador } from '../herramientas/cargar.mjs';
import * as b from '../web/js/fuentes/betano.js';
import { agregarAlias, aliasDe, equivalenciasVacias } from '../web/js/equivalencias.js';
import * as d from './datos/betano.mjs';

const AHORA = '2026-10-11T12:00:00Z';
const PRIORIDAD = ['betano', 'apuesta_total', 'te_apuesto'];

let validador;
before(async () => {
  validador = await cargarValidador();
});

function servidor(respuestas) {
  const pedidas = [];
  const obtener = async (ruta) => {
    pedidas.push(ruta);
    return Object.hasOwn(respuestas, ruta) ? { estado: 200, datos: respuestas[ruta] } : { estado: 404, datos: null };
  };
  return { obtener, pedidas };
}

const partido = (id, local, visitante, inicio, liga = { id: 'sofascore:701', nombre: 'Primera Ficticia' }) => ({
  id: `sofascore:${id}`,
  liga,
  inicio,
  local: { id: `sofascore:${id}1`, nombre: local },
  visitante: { id: `sofascore:${id}2`, nombre: visitante },
});

test('betano: catálogo de ligas con el código de país y nombre para las equivalencias', () => {
  const catalogo = b.catalogoDeLigas(d.paginaDeLiga('Inventia - Primera Ficticia', []));
  assert.equal(catalogo.length, 4);
  assert.deepEqual(catalogo[0], {
    id: '9001', nombre: 'Primera Ficticia', region: 'Inventia', codigoRegion: 'inventia', url: '/sport/futbol/inventia/primera-ficticia/9001/',
  });
  assert.equal(b.nombreDeLiga(catalogo[0]), 'Inventia - Primera Ficticia');
});

test('betano: partidos de una liga con hora UTC y equipos en orden', () => {
  const pagina = d.paginaDeLiga('Inventia - Primera Ficticia', [
    d.evento({ id: '501', local: 'Leones del Norte FC', visitante: 'Halcones', inicio: '2026-10-11T20:00:00Z' }),
    { ...d.evento({ id: '502', local: 'Solo', visitante: 'Uno', inicio: '2026-10-11T20:00:00Z' }), participants: [{ name: 'Solo' }] },
  ]);
  assert.deepEqual(b.partidosDeLiga(pagina), [{
    id: '501',
    nombre: 'Leones del Norte FC - Halcones',
    inicio: '2026-10-11T20:00:00Z',
    url: '/cuotas-de-partido/partido-501/501/',
    local: 'Leones del Norte FC',
    visitante: 'Halcones',
    liga: 'Inventia - Primera Ficticia',
  }]);
});

test('betano: cuotas de los mercados del proyecto, solo con líneas .5 y las dos cuotas', () => {
  const pagina = d.paginaDePartido('501', [
    d.masMenos('HCTG', 'Goles totales Más/Menos', [[2.5, 1.85, 1.95], [1.5, 1.28, 3.6], [3.5, 3.1, 1.36]]),
    d.siNo('BTSC', 'Ambos equipos anotan', 1.7, 2.1),
    // Línea entera y asiática: se descartan.
    d.masMenos('CNOU', 'Más/Menos Córners', [[9.5, 1.9, 1.9], [9, 1.5, 2.5], [9.25, 1.7, 2.1]]),
    // Una línea con una sola cuota: se descarta.
    { ...d.masMenos('TCOU', 'Tarjetas Totales Más/Menos', [[4.5, 1.8, 1.95]]), selections: [{ name: 'Más de 4.5', price: 1.8, handicap: 4.5 }] },
    // Mercado de otro tipo: se ignora.
    d.masMenos('OUHG', 'Leones - Goles totales Más/Menos', [[1.5, 2, 1.8]]),
  ]);
  const ofertas = b.ofertasFutbol([pagina], AHORA);
  assert.deepEqual([...ofertas.keys()], ['futbol_goles', 'futbol_ambos_anotan', 'futbol_corners']);
  assert.deepEqual(ofertas.get('futbol_goles'), {
    casa: 'betano',
    extraido_en: AHORA,
    lineas: [{ linea: 1.5, cuota_a: 1.28, cuota_b: 3.6 }, { linea: 2.5, cuota_a: 1.85, cuota_b: 1.95 }, { linea: 3.5, cuota_a: 3.1, cuota_b: 1.36 }],
  });
  assert.deepEqual(ofertas.get('futbol_ambos_anotan').lineas, [{ linea: null, cuota_a: 1.7, cuota_b: 2.1 }]);
  assert.deepEqual(ofertas.get('futbol_corners').lineas, [{ linea: 9.5, cuota_a: 1.9, cuota_b: 1.9 }]);
  assert.equal(calcularCandidata([ofertas.get('futbol_goles')], PRIORIDAD).linea, 2.5);
});

test('betano: pide las pestañas solo para los mercados que faltan', async () => {
  const url = '/cuotas-de-partido/partido-501/501/';
  const { obtener, pedidas } = servidor({
    [b.RUTAS.pagina(url)]: d.paginaDePartido('501', [
      d.masMenos('HCTG', 'Goles', [[2.5, 1.85, 1.95]]),
      d.siNo('BTSC', 'Ambos', 1.7, 2.1),
      d.masMenos('CNOU', 'Córners', [[9.5, 1.9, 1.9]]),
      d.masMenos('COU1', 'Córners 1T', [[4.5, 1.85, 1.95]]),
    ]),
    [b.RUTAS.pestana(url, '5')]: d.paginaDePartido('501', [d.masMenos('TCOU', 'Tarjetas', [[4.5, 1.8, 1.95]])]),
    [b.RUTAS.pestana(url, '6')]: d.paginaDePartido('501', [
      d.masMenos('X002', 'Tiros al Arco', [[8.5, 1.9, 1.9]]),
      d.masMenos('4159', 'Remates totales', [[24.5, 1.85, 1.95]]),
    ]),
  });
  const ofertas = await b.cargarCuotas(obtener, { url }, { ahora: () => AHORA });
  assert.equal(ofertas.size, 7);
  assert.deepEqual(pedidas.map((r) => r.split('?')[1]), ['req=la,s,stnf,c,mb', 'bt=5&req=la,s,stnf,c,mb', 'bt=6&req=la,s,stnf,c,mb']);
});

test('betano: parecido de nombres, con siglas y palabras genéricas', () => {
  assert.equal(b.similitud('Liverpool', 'Liverpool FC'), 1);
  assert.equal(b.similitud('Everton', 'Everton FC'), 1);
  assert.equal(b.similitud('UTC', 'Universidad Técnica de Cajamarca'), 0.9);
  assert.ok(b.similitud('Club Sporting Cristal', 'Sporting Cristal') >= 0.9);
  assert.ok(b.similitud('Manchester City', 'Manchester United') < 0.7);
  assert.equal(b.similitud('Crystal Palace', 'Nottingham Forest'), 0);
});

test('betano: liga candidata del mismo país; sin país conocido, por nombre en todo el catálogo', () => {
  const catalogo = b.catalogoDeLigas(d.paginaDeLiga('x', []));
  assert.equal(b.candidatasDeLiga({ nombre: 'Primera Ficticia Apuestas', region: 'inventia' }, catalogo)[0].liga.id, '9001');
  assert.ok(b.candidatasDeLiga({ nombre: 'Copa', region: 'inventia' }, catalogo).every((c) => c.liga.codigoRegion === 'inventia'));
  assert.equal(b.candidatasDeLiga({ nombre: 'Copa Continental', region: 'world' }, catalogo)[0].liga.id, '9101');
});

test('betano: emparejamiento por hora y nombres; si no es claro, queda para confirmar', () => {
  const eventos = b.partidosDeLiga(d.paginaDeLiga('Inventia - Primera Ficticia', [
    d.evento({ id: '1', local: 'Leones del Norte FC', visitante: 'Halcones FC', inicio: '2026-10-11T20:00:00Z' }),
    d.evento({ id: '2', local: 'Pumas Unidos', visitante: 'Toros de Prueba', inicio: '2026-10-11T20:00:00Z' }),
    d.evento({ id: '3', local: 'Águilas', visitante: 'Cóndores', inicio: '2026-10-11T22:00:00Z' }),
  ]));
  const claro = b.emparejarPartido(partido(10, 'Leones del Norte', 'Halcones', '2026-10-11T20:00:00Z'), eventos);
  assert.equal(claro.estado, 'emparejado');
  assert.equal(claro.evento.id, '1');
  assert.equal(claro.candidatos.length, 2);
  const dudoso = b.emparejarPartido(partido(11, 'Real Águilas', 'Cóndores del Sur', '2026-10-11T22:10:00Z'), eventos);
  assert.equal(dudoso.estado, 'emparejado');
  const nombresDistintos = b.emparejarPartido(partido(12, 'Club Uno', 'Club Dos', '2026-10-11T22:00:00Z'), eventos);
  assert.equal(nombresDistintos.estado, 'dudoso');
  assert.equal(b.emparejarPartido(partido(13, 'Leones', 'Halcones', '2026-10-12T20:00:00Z'), eventos).estado, 'no_encontrado');
  // Con un nombre ya confirmado, el partido queda claro.
  const alias = new Map([['sofascore:121', ['Águilas']], ['sofascore:122', ['Cóndores']]]);
  assert.equal(b.emparejarPartido(partido(12, 'Club Uno', 'Club Dos', '2026-10-11T22:00:00Z'), eventos, alias).estado, 'emparejado');
});

test('betano: búsqueda completa con equivalencias válidas para guardar', async () => {
  const urlLiga = '/sport/futbol/inventia/primera-ficticia/9001/';
  const urlSegunda = '/sport/futbol/inventia/segunda-ficticia/9002/';
  const urlPartido = '/cuotas-de-partido/leones-halcones/501/';
  const { obtener, pedidas } = servidor({
    [b.RUTAS.pagina(b.LIGA_DE_ENTRADA)]: d.paginaDeLiga('Otro', []),
    // La liga más parecida por nombre no tiene el partido: se pasa a la siguiente.
    [b.RUTAS.pagina(urlLiga)]: d.paginaDeLiga('Inventia - Primera Ficticia', [
      d.evento({ id: '400', local: 'Otro', visitante: 'Equipo', inicio: '2026-10-11T20:00:00Z' }),
    ]),
    [b.RUTAS.pagina(urlSegunda)]: d.paginaDeLiga('Inventia - Segunda Ficticia', [
      d.evento({ id: '501', local: 'Leones FC', visitante: 'Halcones', inicio: '2026-10-11T20:00:00Z', slug: 'leones-halcones' }),
    ]),
    [b.RUTAS.pagina(urlPartido)]: d.paginaDePartido('501', [d.masMenos('HCTG', 'Goles', [[2.5, 1.85, 1.95]])]),
  });
  const equivalencias = equivalenciasVacias();
  const elegido = partido(20, 'Leones', 'Halcones', '2026-10-11T20:00:00Z', { id: 'sofascore:701', nombre: 'Primera Ficticia' });
  const sinLiga = partido(21, 'Uno', 'Dos', '2026-10-11T20:00:00Z', { id: 'sofascore:799', nombre: 'Liga Inexistente' });
  const ligas = new Map([['sofascore:701', { nombre: 'Primera Ficticia', region: 'inventia' }], ['sofascore:799', { nombre: 'Liga Inexistente', region: 'otra' }]]);
  const resultados = await b.buscarCuotas(obtener, [elegido, sinLiga], ligas, equivalencias, { ahora: () => AHORA });

  const encontrado = resultados.get(elegido.id);
  assert.equal(encontrado.estado, 'emparejado');
  assert.equal(b.nombreDeLiga(encontrado.liga), 'Inventia - Segunda Ficticia');
  assert.deepEqual(b.mercadosDeOfertas(elegido.id, encontrado.ofertas), [{
    partido_id: 'sofascore:20', mercado: 'futbol_goles', ofertas: [{ casa: 'betano', extraido_en: AHORA, lineas: [{ linea: 2.5, cuota_a: 1.85, cuota_b: 1.95 }] }],
  }]);
  assert.equal(resultados.get(sinLiga.id).estado, 'sin_liga');
  // La página de una liga se pide una sola vez aunque se revise para varias ligas de Sofascore.
  assert.equal(pedidas.filter((r) => r === b.RUTAS.pagina(urlLiga)).length, 1);

  assert.deepEqual(aliasDe(equivalencias, 'ligas', 'betano').get('sofascore:701'), ['Inventia - Segunda Ficticia']);
  assert.deepEqual(aliasDe(equivalencias, 'equipos', 'betano').get('sofascore:201'), ['Leones FC']);
  assert.deepEqual(validador.validarArchivo('equivalencias/futbol.json', equivalencias), []);

  // La segunda vez se prueba primero la liga conocida.
  pedidas.length = 0;
  await b.buscarCuotas(obtener, [elegido], ligas, equivalencias, { ahora: () => AHORA });
  assert.equal(pedidas[1], b.RUTAS.pagina(urlSegunda));
});

test('equivalencias: agregar un nombre no lo repite y marca la confirmación', () => {
  const equivalencias = equivalenciasVacias();
  assert.equal(agregarAlias(equivalencias, 'equipos', { id: 'sofascore:1', nombre: 'Leones' }, 'betano', 'Leones FC', AHORA), true);
  assert.equal(agregarAlias(equivalencias, 'equipos', { id: 'sofascore:1', nombre: 'Leones' }, 'betano', 'Leones FC', AHORA), false);
  agregarAlias(equivalencias, 'equipos', { id: 'sofascore:1', nombre: 'Leones' }, 'apuesta_total', 'Leones', AHORA);
  assert.deepEqual(equivalencias.equipos, [{ id: 'sofascore:1', nombre: 'Leones', alias: { betano: ['Leones FC'], apuesta_total: ['Leones'] }, confirmado_en: AHORA }]);
});
