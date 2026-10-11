import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCandidata } from '../comun/reglas.js';
import { cargarValidador } from '../herramientas/cargar.mjs';
import { aliasDe, equivalenciasVacias } from '../web/js/equivalencias.js';
import * as at from '../web/js/fuentes/apuestatotal.js';
import { mercadosDeOfertas } from '../web/js/real.js';
import * as d from './datos/apuestatotal.mjs';

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

test('apuesta total: un pedido trae varios partidos con los tipos de mercado del proyecto', () => {
  assert.equal(at.RUTAS.mercados(['9001', '9002']), '/api/eventlist/eu/markets/all?markets=9001%7C9002%3AOU200%7CQA158%7COU615%7COU6010%7COU121%7COU2083%7COU14');
  assert.equal(at.RUTAS.mercados(['9001'], ['OU200']), '/api/eventlist/eu/markets/all?markets=9001%3AOU200');
});

test('apuesta total: partidos de fútbol de la lista, con hora UTC, equipos en orden y su liga', () => {
  const lista = [
    d.evento({ id: '501', local: 'Leones', visitante: 'Halcones', inicio: '2026-10-11T20:00:00Z' }),
    d.evento({ id: '502', local: 'Gaitas', visitante: 'Cardos', inicio: '2026-10-11T19:00:00Z', liga: '7101', nombreLiga: 'Premiership', region: 'Escocia', codigo: 'KK' }),
    // Apuestas a largo plazo, otros deportes y partidos sin los dos equipos no se usan.
    { ...d.evento({ id: '503', local: 'X', visitante: 'Y', inicio: '2026-10-11T20:00:00Z' }), Type: 'Outright' },
    d.evento({ id: '504', local: 'Leones (e)', visitante: 'Halcones (e)', inicio: '2026-10-11T20:00:00Z', deporte: '241' }),
    { ...d.evento({ id: '505', local: 'Solo', visitante: 'Uno', inicio: '2026-10-11T20:00:00Z' }), Participants: [] },
  ];
  const partidos = at.partidosDeFutbol(lista);
  assert.deepEqual(partidos[0], {
    id: '501',
    nombre: 'Leones vs Halcones',
    inicio: '2026-10-11T20:00:00Z',
    local: 'Leones',
    visitante: 'Halcones',
    liga: { id: '7001', nombre: 'Primera Ficticia', region: 'Inventia', codigoRegion: 'IV' },
  });
  // Escocia usa otro código en Apuesta Total (KK) que en Sofascore (SX).
  assert.equal(partidos[1].liga.codigoRegion, 'SX');
  assert.equal(partidos.length, 2);
  assert.equal(at.partidosDeFutbol(null).length, 0);
  assert.deepEqual(at.catalogoDeLigas([...partidos, partidos[0]]).map((l) => l.id), ['7001', '7101']);
  assert.equal(at.nombreDeLiga(partidos[0].liga), 'Inventia - Primera Ficticia');
  assert.equal(at.nombreDeLiga({ nombre: 'Inventia - Segunda', region: 'Inventia' }), 'Inventia - Segunda');
});

test('apuesta total: cuotas por partido, solo con líneas .5 y las dos cuotas activas', () => {
  const goles = d.masMenos('9001', 'OU200', 'Total de goles', [[1.5, 1.28, 3.6], [2, 1.55, 2.4], [2.25, 1.7, 2.1], [2.5, 1.85, 1.95], [3.5, 3.1, 1.36]]);
  goles.Selections.find((s) => s.Side === 3 && s.Points === 3.5).IsDisabled = true;
  const cornersSuspendido = { ...d.masMenos('9002', 'OU615', 'Total tiros de esquina', [[8.5, 1.9, 1.9]]), IsSuspended: true };
  const respuesta = [
    d.unoEquisDos('9001', 2.1, 3.3, 3.4),
    goles,
    d.siNo('9001', 'QA158', 'Ambos equipos anotan', 1.7, 2.1),
    d.masMenos('9001', 'OU615', 'Total tiros de esquina', [[9.5, 1.9, 1.9]]),
    // El mercado asiático de tarjetas (con líneas enteras) no se usa; el de líneas .5 sí.
    d.masMenos('9001', 'OU10', 'Total de tarjetas', [[4, 1.8, 1.95], [4.5, 1.9, 1.85]]),
    d.masMenos('9001', 'OU6010', 'Total de tarjetas', [[3.5, 1.6, 2.2], [4.5, 2.1, 1.65]]),
    d.masMenos('9001', 'OU121', 'Disparos a puerta totales', [[8.5, 1.83, 1.91]]),
    d.masMenos('9001', 'OU2083', 'Disparos totales', [[24.5, 1.87, 1.87]]),
    // Línea entera: no se usa.
    d.masMenos('9001', 'OU14', '1ra mitad: Total de tiros de esquina', [[4, 1.8, 1.95]]),
    d.masMenos('9002', 'OU200', 'Total de goles', [[2.5, 2, 1.8]]),
    cornersSuspendido,
    // Un partido sin ninguna línea útil no aparece.
    d.masMenos('9003', 'OU14', '1ra mitad: Total de tiros de esquina', [[4, 1.8, 1.95]]),
  ];
  const porPartido = at.ofertasFutbol(respuesta, AHORA);
  assert.deepEqual([...porPartido.keys()], ['9001', '9002']);

  const ofertas = porPartido.get('9001');
  assert.deepEqual([...ofertas.keys()], ['futbol_goles', 'futbol_ambos_anotan', 'futbol_corners', 'futbol_tarjetas', 'futbol_tiros_arco', 'futbol_remates']);
  assert.deepEqual(ofertas.get('futbol_goles'), {
    casa: 'apuesta_total',
    extraido_en: AHORA,
    lineas: [{ linea: 1.5, cuota_a: 1.28, cuota_b: 3.6 }, { linea: 2.5, cuota_a: 1.85, cuota_b: 1.95 }],
  });
  assert.deepEqual(ofertas.get('futbol_ambos_anotan').lineas, [{ linea: null, cuota_a: 1.7, cuota_b: 2.1 }]);
  assert.deepEqual(ofertas.get('futbol_tarjetas').lineas, [{ linea: 3.5, cuota_a: 1.6, cuota_b: 2.2 }, { linea: 4.5, cuota_a: 2.1, cuota_b: 1.65 }]);
  assert.deepEqual(ofertas.get('futbol_remates').lineas, [{ linea: 24.5, cuota_a: 1.87, cuota_b: 1.87 }]);
  assert.deepEqual([...porPartido.get('9002').keys()], ['futbol_goles']);
  assert.equal(at.ofertasFutbol(null, AHORA).size, 0);
});

test('apuesta total: si Betano no ofrece el mercado, la línea candidata sale de Apuesta Total', () => {
  const corners = at.ofertasFutbol([d.masMenos('9001', 'OU615', 'Total tiros de esquina', [[8.5, 1.6, 2.3], [9.5, 1.9, 1.9]])], AHORA)
    .get('9001').get('futbol_corners');
  const candidata = calcularCandidata([corners], PRIORIDAD);
  assert.equal(candidata.casa, 'apuesta_total');
  assert.equal(candidata.linea, 9.5);
});

test('apuesta total: búsqueda completa con la lista de partidos y las cuotas en un pedido', async () => {
  const lista = [
    // La liga más parecida por nombre no tiene el partido: se pasa a la siguiente.
    d.evento({ id: '400', local: 'Otro', visitante: 'Equipo', inicio: '2026-10-11T20:00:00Z' }),
    d.evento({ id: '501', local: 'Leones FC', visitante: 'Halcones', inicio: '2026-10-11T20:00:00Z', liga: '7002', nombreLiga: 'Segunda Ficticia' }),
    d.evento({ id: '502', local: 'Pumas', visitante: 'Toros', inicio: '2026-10-11T22:00:00Z', liga: '7002', nombreLiga: 'Segunda Ficticia' }),
    d.evento({ id: '601', local: 'Gaitas', visitante: 'Cardos United', inicio: '2026-10-11T19:00:00Z', liga: '7101', nombreLiga: 'Premiership', region: 'Escocia', codigo: 'KK' }),
  ];
  const { obtener, pedidas } = servidor({
    [at.RUTAS.eventos]: lista,
    [at.RUTAS.mercados(['501', '502', '601'])]: [
      d.masMenos('501', 'OU200', 'Total de goles', [[2.5, 1.85, 1.95]]),
      d.masMenos('601', 'OU615', 'Total tiros de esquina', [[9.5, 1.9, 1.9]]),
    ],
  });
  const primera = { id: 'sofascore:701', nombre: 'Primera Ficticia' };
  const escocesa = { id: 'sofascore:801', nombre: 'Premiership' };
  const elegidos = [
    partido(20, 'Leones', 'Halcones', '2026-10-11T20:00:00Z', primera),
    partido(21, 'Pumas', 'Toros', '2026-10-11T22:00:00Z', primera),
    partido(22, 'Gaitas FC', 'Cardos United', '2026-10-11T19:00:00Z', escocesa),
    partido(23, 'Uno', 'Dos', '2026-10-11T20:00:00Z', { id: 'sofascore:799', nombre: 'Liga Inexistente' }),
  ];
  const ligas = new Map([['sofascore:701', { codigoPais: 'IV' }], ['sofascore:801', { codigoPais: 'SX' }], ['sofascore:799', { codigoPais: 'ZX' }]]);
  const equivalencias = equivalenciasVacias();
  const resultados = await at.buscarCuotas(obtener, elegidos, ligas, equivalencias, { ahora: () => AHORA });

  const leones = resultados.get('sofascore:20');
  assert.equal(leones.estado, 'emparejado');
  assert.equal(at.nombreDeLiga(leones.liga), 'Inventia - Segunda Ficticia');
  assert.deepEqual(mercadosDeOfertas('sofascore:20', leones.ofertas), [{
    partido_id: 'sofascore:20', mercado: 'futbol_goles', ofertas: [{ casa: 'apuesta_total', extraido_en: AHORA, lineas: [{ linea: 2.5, cuota_a: 1.85, cuota_b: 1.95 }] }],
  }]);
  // Emparejado, pero sin los mercados del proyecto.
  assert.equal(resultados.get('sofascore:21').ofertas.size, 0);
  assert.equal(resultados.get('sofascore:22').estado, 'emparejado');
  assert.equal(resultados.get('sofascore:22').ofertas.get('futbol_corners').lineas[0].linea, 9.5);
  assert.equal(resultados.get('sofascore:23').estado, 'sin_liga');
  // Un pedido para la lista y otro para las cuotas de los tres partidos.
  assert.deepEqual(pedidas, [at.RUTAS.eventos, at.RUTAS.mercados(['501', '502', '601'])]);

  assert.deepEqual(aliasDe(equivalencias, 'ligas', 'apuesta_total').get('sofascore:801'), ['Escocia - Premiership']);
  assert.deepEqual(aliasDe(equivalencias, 'equipos', 'apuesta_total').get('sofascore:221'), ['Gaitas']);
  assert.deepEqual(validador.validarArchivo('equivalencias/futbol.json', equivalencias), []);
});

test('apuesta total: las ofertas de las dos casas van juntas en cada mercado de la extracción', () => {
  const betano = new Map([['futbol_goles', { casa: 'betano', extraido_en: AHORA, lineas: [{ linea: 2.5, cuota_a: 1.8, cuota_b: 2 }] }]]);
  const apuestaTotal = new Map([
    ['futbol_goles', { casa: 'apuesta_total', extraido_en: AHORA, lineas: [{ linea: 2.5, cuota_a: 1.85, cuota_b: 1.95 }] }],
    ['futbol_corners', { casa: 'apuesta_total', extraido_en: AHORA, lineas: [{ linea: 9.5, cuota_a: 1.9, cuota_b: 1.9 }] }],
  ]);
  const mercados = mercadosDeOfertas('sofascore:20', betano, apuestaTotal);
  assert.deepEqual(mercados.map((m) => [m.mercado, m.ofertas.map((o) => o.casa)]), [
    ['futbol_goles', ['betano', 'apuesta_total']],
    ['futbol_corners', ['apuesta_total']],
  ]);
  assert.equal(mercadosDeOfertas('sofascore:20', undefined, new Map()).length, 0);
});
