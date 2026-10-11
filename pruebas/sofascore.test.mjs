import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { totalTarjetas } from '../comun/reglas.js';
import { cargarValidador } from '../herramientas/cargar.mjs';
import * as s from '../web/js/fuentes/sofascore.js';
import * as d from './datos/sofascore.mjs';

const { leones, halcones, pumas, toros } = d.EQUIPOS;
const AHORA = '2026-10-11T12:00:00Z';
const ahora = () => AHORA;

let validador;
before(async () => {
  validador = await cargarValidador();
});

/** `obtener` de prueba: responde con las rutas dadas y 404 en las demás. Anota lo que se pidió. */
function servidor(respuestas) {
  const pedidas = [];
  const obtener = async (ruta) => {
    pedidas.push(ruta);
    return Object.hasOwn(respuestas, ruta) ? { estado: 200, datos: respuestas[ruta] } : { estado: 404, datos: null };
  };
  return { obtener, pedidas };
}

// Partido con prórroga y penales: 1-1 en los 90 minutos, 4-3 en los penales.
const conPenales = d.evento({
  id: 600, inicio: '2026-10-04T20:00:00Z', local: leones, visitante: halcones, estado: 'penales', marcador: [1, 1, 1, 0], extra: [4, 3],
});
const estadisticasConPenales = d.estadisticas({
  // ALL incluye la prórroga: no debe usarse para el tiempo reglamentario.
  ALL: { cornerKicks: [9, 6], shotsOnGoal: [6, 4], totalShotsOnGoal: [15, 10], fouls: [14, 16], offsides: [2, 1], ballPossession: [55, 45], expectedGoals: [1.8, 1.1] },
  '1ST': { cornerKicks: [3, 2], shotsOnGoal: [2, 1], totalShotsOnGoal: [5, 4], fouls: [6, 7], offsides: [1, 0], ballPossession: [52, 48], expectedGoals: [0.6, 0.4] },
  '2ND': { cornerKicks: [4, 3], shotsOnGoal: [3, 2], totalShotsOnGoal: [7, 4], fouls: [5, 6], offsides: [1, 1], ballPossession: [57, 43], expectedGoals: [0.9, 0.5] },
});
const incidenciasConPenales = {
  incidents: [
    d.tarjeta(110, false, 'red'),
    d.gol(95, true, 2, 1),
    d.periodo('FT', 90, 1, 1),
    d.tarjeta(90, true, 'yellowRed', { addedTime: 3, player: { id: 9555, name: 'Expulsado' } }),
    d.gol(78, false, 1, 1, { incidentClass: 'ownGoal', isHome: true }),
    d.tarjeta(70, false, 'yellow', { rescinded: true }),
    d.tarjeta(62, true, 'yellow', { player: undefined, manager: { id: 1, name: 'Entrenador' } }),
    d.tarjeta(55, true, 'yellow', { player: { id: 9555, name: 'Expulsado' } }),
    d.tarjeta(50, false, 'red'),
    d.periodo('HT', 45, 1, 0),
    d.tarjeta(45, false, 'yellow', { addedTime: 2 }),
    d.gol(30, true, 1, 0),
    d.tarjeta(12, true, 'yellow'),
  ],
};

test('sofascore: ligas del día en Lima, sumando los grupos de una misma liga', () => {
  const sinUnico = d.torneo({ id: 5009, nombre: 'Torneo sin liga' });
  const otraZona = d.torneo({ id: 5010, nombre: 'Liga de otra zona', unico: 710 });
  const ligas = s.ligasDelDia([
    d.paginaTorneos([[d.LIGA, 3], [d.COPA, 2]], true),
    d.paginaTorneos([[d.COPA_B, 1], [sinUnico, 2], [otraZona, 0, 4]]),
  ]);
  assert.deepEqual(ligas, [
    { id: 'sofascore:701', nombre: 'Primera Ficticia', pais: 'Inventia', partidos: 3, principal: true },
    { id: 'sofascore:702', nombre: 'Copa Ficticia', pais: 'Inventia', partidos: 3, principal: false },
  ]);
});

test('sofascore: cargarLigas recorre las páginas hasta que no hay más', async () => {
  const { obtener, pedidas } = servidor({
    [s.RUTAS.torneosDelDia('futbol', '2026-10-11', 1)]: d.paginaTorneos([[d.LIGA, 3]], true),
    [s.RUTAS.torneosDelDia('futbol', '2026-10-11', 2)]: d.paginaTorneos([[d.COPA, 2]], false),
  });
  const ligas = await s.cargarLigas(obtener, '2026-10-11');
  assert.equal(ligas.length, 2);
  assert.equal(pedidas.length, 2);
});

test('sofascore: partido del día con ids, hora de Lima y estado', () => {
  const evento = d.evento({ id: 501, inicio: '2026-10-12T01:30:00Z', local: leones, visitante: halcones });
  assert.deepEqual(s.partidoDesdeEvento(evento, AHORA), {
    id: 'sofascore:501',
    deporte: 'futbol',
    liga: { id: 'sofascore:701', nombre: 'Primera Ficticia', pais: 'Inventia' },
    temporada: { id: 'sofascore:8801', nombre: 'Primera Ficticia 2026' },
    inicio: '2026-10-12T01:30:00Z',
    fecha_local: '2026-10-11',
    local: { id: 'sofascore:101', nombre: 'Leones del Norte' },
    visitante: { id: 'sofascore:102', nombre: 'Halcones FC' },
    estado: 'programado',
  });
  const abandonado = d.evento({ id: 502, inicio: '2026-10-11T15:00:00Z', local: pumas, visitante: toros, estado: 'abandoned' });
  assert.equal(s.partidoDesdeEvento(abandonado, AHORA).estado, 'cancelado');
});

test('sofascore: un estado que no estaba en la muestra queda programado o en juego según la hora', () => {
  const raro = { ...d.evento({ id: 503, inicio: '2026-10-11T15:00:00Z', local: pumas, visitante: toros }), status: { code: 61, type: 'otro' } };
  assert.equal(s.estadoDe(raro, '2026-10-11T14:00:00Z'), 'programado');
  assert.equal(s.estadoDe(raro, '2026-10-11T16:00:00Z'), 'en_juego');
});

test('sofascore: el marcador es el del tiempo reglamentario, sin prórroga ni penales', () => {
  assert.deepEqual(s.marcadorReglamentario(conPenales), { local: 1, visitante: 1 });
  assert.equal(conPenales.homeScore.current, 5);
  const sinNormal = { ...conPenales, homeScore: { current: 5, penalties: 4 }, awayScore: { current: 4, penalties: 3 } };
  assert.equal(s.marcadorReglamentario(sinNormal), null);
  const simple = { homeScore: { current: 2 }, awayScore: { current: 0 } };
  assert.deepEqual(s.marcadorReglamentario(simple), { local: 2, visitante: 0 });
});

test('sofascore: cargarPartidos deja solo los partidos del día en Lima', async () => {
  const eventos = [
    d.evento({ id: 510, inicio: '2026-10-11T04:00:00Z', local: leones, visitante: halcones }), // 23:00 del 10 en Lima
    d.evento({ id: 511, inicio: '2026-10-11T18:00:00Z', local: pumas, visitante: toros }),
    d.evento({ id: 512, inicio: '2026-10-12T03:30:00Z', local: halcones, visitante: pumas }), // 22:30 del 11 en Lima
    d.evento({ id: 513, inicio: '2026-10-12T05:30:00Z', local: toros, visitante: leones }), // 00:30 del 12 en Lima
  ];
  const { obtener } = servidor({ [s.RUTAS.partidosDeLiga(701, '2026-10-11')]: { events: eventos } });
  const { partidos, eventos: originales } = await s.cargarPartidos(obtener, '2026-10-11', [{ id: 'sofascore:701' }], { ahora });
  assert.deepEqual(partidos.map((p) => p.id), ['sofascore:511', 'sofascore:512']);
  assert.equal(originales.get('sofascore:512').id, 512);
});

test('sofascore: estadísticas del tiempo reglamentario cuando hubo prórroga', () => {
  const est = s.estadisticasFutbol({ evento: conPenales, estadisticas: estadisticasConPenales, incidencias: incidenciasConPenales, extraidoEn: AHORA });
  const { local, visitante } = est.completo;
  // Conteos: primer tiempo + segundo tiempo; posesión y xG sin dato porque ALL incluye la prórroga.
  assert.deepEqual(local, { goles: 1, corners: 7, amarillas: 3, rojas: 1, dobles_amarillas: 1, tiros_al_arco: 5, remates: 12, faltas: 11, fueras_de_juego: 2 });
  assert.deepEqual(visitante, { goles: 1, corners: 5, amarillas: 1, rojas: 1, dobles_amarillas: 0, tiros_al_arco: 3, remates: 8, faltas: 13, fueras_de_juego: 1 });
  // Tarjetas como Betano. Local: amarilla en el 12' (1) y doble amarilla del mismo jugador en el 55' y el 90+3 (2).
  // Visitante: amarilla en el 45+2 (1) y roja directa en el 50' (2). No cuentan la roja de la prórroga,
  // la amarilla anulada ni la del entrenador.
  assert.equal(totalTarjetas(local), 3);
  assert.equal(totalTarjetas(visitante), 3);
  assert.deepEqual(est.primer_tiempo.local, { goles: 1, corners: 3, amarillas: 1, rojas: 0, dobles_amarillas: 0, tiros_al_arco: 2, remates: 5, faltas: 6, fueras_de_juego: 1, posesion: 52, xg: 0.6 });
  assert.equal(est.primer_tiempo.visitante.amarillas, 1);
});

test('sofascore: goles y tarjetas con su minuto; el autogol se asigna por el cambio del marcador', () => {
  const est = s.estadisticasFutbol({ evento: conPenales, estadisticas: estadisticasConPenales, incidencias: incidenciasConPenales, extraidoEn: AHORA });
  assert.deepEqual(est.eventos, [
    { minuto: 12, tipo: 'amarilla', equipo: 'local' },
    { minuto: 30, tipo: 'gol', equipo: 'local' },
    { minuto: 45, minuto_extra: 2, tipo: 'amarilla', equipo: 'visitante' },
    { minuto: 50, tipo: 'roja', equipo: 'visitante' },
    { minuto: 55, tipo: 'amarilla', equipo: 'local' },
    { minuto: 78, tipo: 'gol', equipo: 'visitante' },
    { minuto: 90, minuto_extra: 3, tipo: 'doble_amarilla', equipo: 'local' },
  ]);
});

test('sofascore: sin prórroga se usan los valores del partido completo', () => {
  const evento = d.evento({ id: 601, inicio: '2026-10-04T20:00:00Z', local: pumas, visitante: toros, estado: 'finished', marcador: [2, 0, 1, 0] });
  const estadisticas = d.estadisticas({
    ALL: { cornerKicks: [6, 2], ballPossession: [61, 39], expectedGoals: [1.42, 0.31] },
    '1ST': { cornerKicks: [2, 1] },
    '2ND': { cornerKicks: [4, 1] },
  });
  const incidencias = { incidents: [d.periodo('FT', 90, 2, 0), d.gol(70, true, 2, 0), d.periodo('HT', 45, 1, 0), d.gol(20, true, 1, 0)] };
  const est = s.estadisticasFutbol({ evento, estadisticas, incidencias, extraidoEn: AHORA });
  assert.deepEqual(est.completo.local, { goles: 2, corners: 6, amarillas: 0, rojas: 0, dobles_amarillas: 0, posesion: 61, xg: 1.42 });
  assert.equal(est.eventos.length, 2);
});

test('sofascore: sin incidencias o con una tarjeta desconocida, las tarjetas quedan sin dato', () => {
  const evento = d.evento({ id: 602, inicio: '2026-10-04T20:00:00Z', local: pumas, visitante: toros, estado: 'finished', marcador: [0, 0, 0, 0] });
  const vacias = s.estadisticasFutbol({ evento, estadisticas: null, incidencias: { incidents: [] }, extraidoEn: AHORA });
  assert.deepEqual(vacias.completo.local, { goles: 0 });
  assert.equal(vacias.eventos, undefined);
  const rara = s.estadisticasFutbol({ evento, estadisticas: null, incidencias: { incidents: [d.tarjeta(30, true, 'purple')] }, extraidoEn: AHORA });
  assert.equal(rara.completo.local.amarillas, undefined);
  assert.equal(totalTarjetas({ amarillas: rara.completo.local.amarillas, rojas: rara.completo.local.rojas }), null);
});

test('sofascore: los goles que no cuadran con el marcador no generan eventos', () => {
  const evento = d.evento({ id: 603, inicio: '2026-10-04T20:00:00Z', local: pumas, visitante: toros, estado: 'finished', marcador: [2, 0, 1, 0] });
  const incidencias = { incidents: [d.gol(20, true, 1, 0), d.periodo('FT', 90, 2, 0)] };
  const est = s.estadisticasFutbol({ evento, estadisticas: null, incidencias, extraidoEn: AHORA });
  assert.equal(est.eventos, undefined);
  assert.equal(est.completo.local.amarillas, 0);
});

test('sofascore: previa con bajas, alineación probable, tabla y árbitro', () => {
  const partido = s.partidoDesdeEvento(d.evento({ id: 520, inicio: '2026-10-11T20:00:00Z', local: leones, visitante: halcones }), AHORA);
  const previa = s.previaFutbol({
    partido,
    detalle: { event: { referee: { id: 77, name: 'Árbitro Inventado', games: 120, yellowCards: 500, redCards: 30, yellowRedCards: 12 } } },
    alineaciones: d.alineaciones({
      bajasLocal: [{ player: { id: 31, name: 'Lesionado Uno' }, type: 'missing', reason: 1, description: 'Knee Injury' }],
      bajasVisitante: [{ player: { id: 41, name: 'Ausente Dos' }, type: 'missing', reason: 3 }],
    }),
    tabla: d.tabla([[leones, 3, 10, 6, 2, 2, 20], [halcones, 15, 10, 1, 3, 6, -1], [pumas, 1, 10, 8, 1, 1, 25]]),
    ultimos: { local: [], visitante: [] },
    extraidoEn: AHORA,
  });
  assert.deepEqual(previa.bajas, [
    { equipo: 'local', jugador: { id: 'sofascore:31', nombre: 'Lesionado Uno' }, motivo: 'lesion', detalle: 'Knee Injury', fuente: 'sofascore' },
    { equipo: 'visitante', jugador: { id: 'sofascore:41', nombre: 'Ausente Dos' }, motivo: 'desconocido', fuente: 'sofascore' },
  ]);
  assert.equal(previa.alineaciones_probables.confirmadas, false);
  assert.equal(previa.alineaciones_probables.local.length, 11);
  assert.deepEqual(previa.tabla.visitante, { posicion: 15, partidos_jugados: 10, puntos: -1, ganados: 1, empatados: 3, perdidos: 6 });
  assert.deepEqual(previa.arbitro, {
    nombre: 'Árbitro Inventado', id: 'sofascore:77', estadisticas: { partidos: 120, amarillas: 500, rojas: 30, dobles_amarillas: 12 },
  });
  const sinAlineaciones = s.previaFutbol({ partido, detalle: null, alineaciones: null, tabla: null, ultimos: { local: [], visitante: [] }, extraidoEn: AHORA });
  assert.deepEqual(Object.keys(sinAlineaciones), ['extraido_en', 'fuentes', 'ultimos_partidos']);
});

test('sofascore: últimos partidos terminados en la misma condición, del más reciente al más antiguo', () => {
  const eventos = [
    d.evento({ id: 1, inicio: '2026-09-01T20:00:00Z', local: leones, visitante: pumas, estado: 'finished', marcador: [1, 0, 0, 0] }),
    d.evento({ id: 2, inicio: '2026-09-08T20:00:00Z', local: toros, visitante: leones, estado: 'finished', marcador: [1, 1, 0, 0] }),
    d.evento({ id: 3, inicio: '2026-09-15T20:00:00Z', local: leones, visitante: toros, estado: 'abandoned' }),
    d.evento({ id: 4, inicio: '2026-09-22T20:00:00Z', local: leones, visitante: halcones, estado: 'finished', marcador: [3, 2, 1, 1] }),
    d.evento({ id: 5, inicio: '2026-10-20T20:00:00Z', local: leones, visitante: pumas, estado: 'finished', marcador: [0, 0, 0, 0] }),
  ];
  assert.deepEqual(s.elegirUltimos(eventos, leones.id, 'local', '2026-10-11T20:00:00Z').map((e) => e.id), [4, 1]);
  assert.deepEqual(s.elegirUltimos(eventos, leones.id, 'visitante', '2026-10-11T20:00:00Z').map((e) => e.id), [2]);
  assert.deepEqual(s.elegirUltimos(eventos, leones.id, 'local', '2026-10-11T20:00:00Z', 1).map((e) => e.id), [4]);
});

test('sofascore: previa completa y extracción que cumple todas las reglas del formato', async () => {
  const delDia = d.evento({ id: 530, inicio: '2026-10-11T20:00:00Z', local: leones, visitante: halcones });
  const anteriores = [
    d.evento({ id: 401, inicio: '2026-09-20T20:00:00Z', local: leones, visitante: pumas, estado: 'finished', marcador: [2, 1, 1, 0] }),
    d.evento({ id: 402, inicio: '2026-09-27T20:00:00Z', local: toros, visitante: halcones, estado: 'finished', marcador: [0, 0, 0, 0] }),
    d.evento({ id: 403, inicio: '2026-10-04T20:00:00Z', local: leones, visitante: toros, estado: 'finished', marcador: [1, 1, 1, 0] }),
  ];
  const respuestas = {
    [s.RUTAS.partido(530)]: { event: { ...delDia, referee: { id: 9, name: 'Árbitro', games: 10, yellowCards: 40 } } },
    [s.RUTAS.alineaciones(530)]: d.alineaciones(),
    [s.RUTAS.tabla(5001, 8801)]: d.tabla([[leones, 2, 9, 5, 2, 2, 17], [halcones, 7, 9, 3, 3, 3, 12]]),
    [s.RUTAS.ultimosDelEquipo(leones.id, 0)]: { events: [anteriores[0], anteriores[2]], hasNextPage: false },
    [s.RUTAS.ultimosDelEquipo(halcones.id, 0)]: { events: [anteriores[1]], hasNextPage: false },
    [s.RUTAS.estadisticas(401)]: d.estadisticas({ ALL: { cornerKicks: [7, 3] }, '1ST': { cornerKicks: [4, 1] } }),
    [s.RUTAS.incidencias(401)]: { incidents: [d.gol(80, false, 2, 1), d.gol(60, true, 2, 0), d.periodo('HT', 45, 1, 0), d.gol(10, true, 1, 0), d.tarjeta(33, false, 'yellow')] },
  };
  const { obtener, pedidas } = servidor(respuestas);
  const partido = s.partidoDesdeEvento(delDia, AHORA);
  const textos = [];
  const { previa, anteriores: leidos } = await s.cargarPrevia(obtener, partido, delDia, { ahora, progreso: (t) => textos.push(t) });
  assert.deepEqual(previa.ultimos_partidos, { local: ['sofascore:403', 'sofascore:401'], visitante: ['sofascore:402'] });
  assert.equal(previa.arbitro.nombre, 'Árbitro');
  assert.equal(leidos.find((p) => p.id === 'sofascore:401').estadisticas.completo.local.corners, 7);
  assert.ok(textos.some((t) => t.includes('Halcones FC')));
  assert.equal(pedidas.filter((r) => r.endsWith('/statistics')).length, 3);

  const extraccion = {
    version_formato: 1,
    fecha_local: '2026-10-11',
    generado_en: AHORA,
    partidos: [{ ...partido, previa }],
    partidos_anteriores: leidos,
    mercados: [],
  };
  assert.deepEqual(validador.validarExtracciones([{ ruta: '2026-10-11.json', contenido: extraccion }], []), []);
});

test('sofascore: resultado de un partido del día ya terminado', async () => {
  const terminado = d.evento({ id: 540, inicio: '2026-10-11T15:00:00Z', local: pumas, visitante: toros, estado: 'finished', marcador: [3, 1, 2, 0] });
  const { obtener } = servidor({
    [s.RUTAS.partido(540)]: { event: terminado },
    [s.RUTAS.estadisticas(540)]: d.estadisticas({ ALL: { cornerKicks: [5, 4] } }),
    [s.RUTAS.incidencias(540)]: { incidents: [d.periodo('FT', 90, 3, 1)] },
  });
  const partido = await s.cargarResultado(obtener, 'sofascore:540', { ahora: () => '2026-10-11T17:30:00Z' });
  assert.equal(partido.estado, 'finalizado');
  assert.deepEqual(partido.marcador, { local: 3, visitante: 1 });
  assert.equal(partido.estadisticas.completo.visitante.corners, 4);
  assert.equal(await s.cargarResultado(obtener, 'sofascore:999'), null);
});
