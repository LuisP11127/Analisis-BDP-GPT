import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparLigasPorPais, armarExtraccion, filtrarLigas, hoyEnLima, resumenUltimos, seleccionable } from '../web/js/real.js';

const equipo = (n) => ({ id: `sofascore:${n}`, nombre: `Equipo ${n}` });

test('modo real: solo se eligen partidos que no empezaron; con datos de prueba, todos', () => {
  const partido = { estado: 'programado', inicio: '2026-10-11T20:00:00Z' };
  assert.equal(seleccionable(partido, { prueba: false, ahora: '2026-10-11T19:59:00Z' }), true);
  assert.equal(seleccionable(partido, { prueba: false, ahora: '2026-10-11T20:00:00Z' }), false);
  assert.equal(seleccionable({ ...partido, estado: 'aplazado' }, { prueba: false, ahora: '2026-10-11T12:00:00Z' }), false);
  assert.equal(seleccionable({ ...partido, estado: 'finalizado' }, { prueba: true, ahora: '2026-10-12T00:00:00Z' }), true);
  assert.equal(hoyEnLima(new Date('2026-10-12T03:00:00Z')), '2026-10-11');
});

test('modo real: ligas por país y búsqueda sin tildes', () => {
  const ligas = [
    { id: 'sofascore:1', nombre: 'Liga 1', pais: 'Peru', partidos: 3 },
    { id: 'sofascore:2', nombre: 'Primera División', pais: 'Argentina', partidos: 5 },
    { id: 'sofascore:3', nombre: 'Copa de la Liga', pais: 'Peru', partidos: 2 },
    { id: 'sofascore:4', nombre: 'Amistosos', partidos: 1 },
  ];
  assert.deepEqual(agruparLigasPorPais(ligas).map((g) => [g.pais, g.ligas.length, g.partidos]), [
    ['Argentina', 1, 5], ['Otras', 1, 1], ['Peru', 2, 5],
  ]);
  assert.deepEqual(filtrarLigas(ligas, 'division').map((l) => l.id), ['sofascore:2']);
  assert.deepEqual(filtrarLigas(ligas, 'PERU liga').map((l) => l.id), ['sofascore:1']);
  assert.equal(filtrarLigas(ligas, '  ').length, 4);
});

test('modo real: la extracción lleva solo los partidos anteriores que usa alguna previa', () => {
  const previa = { extraido_en: '2026-10-11T12:00:00Z', fuentes: ['sofascore'], ultimos_partidos: { local: ['sofascore:10'], visitante: [] } };
  const partidos = [
    { id: 'sofascore:1', inicio: '2026-10-11T20:00:00Z', previa },
    { id: 'sofascore:2', inicio: '2026-10-11T22:00:00Z' },
  ];
  const anteriores = new Map([
    ['sofascore:10', { id: 'sofascore:10', inicio: '2026-10-01T20:00:00Z' }],
    ['sofascore:11', { id: 'sofascore:11', inicio: '2026-10-02T20:00:00Z' }],
  ]);
  const extraccion = armarExtraccion({ fecha: '2026-10-11', generadoEn: '2026-10-11T12:05:00Z', partidos, anteriores });
  assert.deepEqual(extraccion.partidos_anteriores.map((p) => p.id), ['sofascore:10']);
  assert.deepEqual(extraccion.mercados, []);
  const sinPrevia = armarExtraccion({ fecha: '2026-10-11', generadoEn: '2026-10-11T12:05:00Z', partidos: [partidos[1]], anteriores });
  assert.equal(sinPrevia.partidos_anteriores, undefined);
});

test('modo real: últimos partidos vistos desde el equipo, con promedios de los que tienen el dato', () => {
  const local = equipo(1);
  const partido = {
    local,
    visitante: equipo(2),
    previa: { ultimos_partidos: { local: ['sofascore:20', 'sofascore:21'], visitante: [] } },
  };
  const conDatos = {
    id: 'sofascore:20',
    fecha_local: '2026-10-04',
    liga: { nombre: 'Liga' },
    local,
    visitante: equipo(3),
    estadisticas: {
      completo: {
        local: { goles: 2, corners: 7, amarillas: 3, rojas: 1, dobles_amarillas: 1, tiros_al_arco: 5, remates: 12 },
        visitante: { goles: 1, corners: 2, amarillas: 1, rojas: 0, dobles_amarillas: 0, tiros_al_arco: 3, remates: 8 },
      },
    },
  };
  const soloGoles = {
    id: 'sofascore:21',
    fecha_local: '2026-09-27',
    liga: { nombre: 'Copa' },
    local: equipo(4),
    visitante: local,
    estadisticas: { completo: { local: { goles: 0 }, visitante: { goles: 3 } } },
  };
  const { filas, promedios } = resumenUltimos(partido, 'local', new Map([[conDatos.id, conDatos], [soloGoles.id, soloGoles]]));
  assert.deepEqual(filas[0], {
    id: 'sofascore:20', fecha: '2026-10-04', liga: 'Liga', rival: 'Equipo 3', condicion: 'local',
    goles: [2, 1], corners: [7, 2], tarjetas: [3, 1], tiros: [5, 3], remates: [12, 8],
  });
  // En el segundo, el equipo jugó de visita: los datos se dan vuelta.
  assert.deepEqual([filas[1].condicion, filas[1].goles, filas[1].corners], ['visitante', [3, 0], [null, null]]);
  assert.deepEqual(promedios.goles, [{ valor: 2.5, partidos: 2 }, { valor: 0.5, partidos: 2 }]);
  assert.deepEqual(promedios.corners, [{ valor: 7, partidos: 1 }, { valor: 2, partidos: 1 }]);
});
