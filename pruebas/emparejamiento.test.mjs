import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as e from '../web/js/emparejamiento.js';

const partido = (id, local, visitante, inicio) => ({
  id: `sofascore:${id}`,
  liga: { id: 'sofascore:701', nombre: 'Primera Ficticia' },
  inicio,
  local: { id: `sofascore:${id}1`, nombre: local },
  visitante: { id: `sofascore:${id}2`, nombre: visitante },
});

const evento = (id, local, visitante, inicio) => ({ id, nombre: `${local} - ${visitante}`, inicio, local, visitante });

test('emparejamiento: parecido de nombres, con siglas y palabras genéricas', () => {
  assert.equal(e.similitud('Liverpool', 'Liverpool FC'), 1);
  assert.equal(e.similitud('Everton', 'Everton FC'), 1);
  assert.equal(e.similitud('UTC', 'Universidad Técnica de Cajamarca'), 0.9);
  assert.ok(e.similitud('Club Sporting Cristal', 'Sporting Cristal') >= 0.9);
  assert.ok(e.similitud('Manchester City', 'Manchester United') < 0.7);
  assert.equal(e.similitud('Crystal Palace', 'Nottingham Forest'), 0);
});

test('emparejamiento: liga candidata del mismo país; sin país conocido, por nombre en todo el catálogo', () => {
  const catalogo = [
    { id: '9001', nombre: 'Primera Ficticia', codigoRegion: 'inventia' },
    { id: '9002', nombre: 'Segunda Ficticia', codigoRegion: 'inventia' },
    { id: '9003', nombre: 'Copa', codigoRegion: 'inventia' },
    { id: '9101', nombre: 'Copa Continental', codigoRegion: 'copa-continental' },
  ];
  assert.equal(e.candidatasDeLiga({ nombre: 'Primera Ficticia Apuestas', region: 'inventia' }, catalogo)[0].liga.id, '9001');
  assert.ok(e.candidatasDeLiga({ nombre: 'Copa', region: 'inventia' }, catalogo).every((c) => c.liga.codigoRegion === 'inventia'));
  assert.equal(e.candidatasDeLiga({ nombre: 'Copa Continental', region: 'world' }, catalogo)[0].liga.id, '9101');
  assert.equal(e.candidatasDeLiga({ nombre: 'Copa Continental', region: null }, catalogo)[0].liga.id, '9101');
});

test('emparejamiento: partido por hora y nombres; si no es claro, queda para confirmar', () => {
  const eventos = [
    evento('1', 'Leones del Norte FC', 'Halcones FC', '2026-10-11T20:00:00Z'),
    evento('2', 'Pumas Unidos', 'Toros de Prueba', '2026-10-11T20:00:00Z'),
    evento('3', 'Águilas', 'Cóndores', '2026-10-11T22:00:00Z'),
  ];
  const claro = e.emparejarPartido(partido(10, 'Leones del Norte', 'Halcones', '2026-10-11T20:00:00Z'), eventos);
  assert.equal(claro.estado, 'emparejado');
  assert.equal(claro.evento.id, '1');
  assert.equal(claro.candidatos.length, 2);
  // 10 minutos de diferencia caben en el margen.
  assert.equal(e.emparejarPartido(partido(11, 'Real Águilas', 'Cóndores del Sur', '2026-10-11T22:10:00Z'), eventos).estado, 'emparejado');
  const nombresDistintos = e.emparejarPartido(partido(12, 'Club Uno', 'Club Dos', '2026-10-11T22:00:00Z'), eventos);
  assert.equal(nombresDistintos.estado, 'dudoso');
  assert.equal(e.emparejarPartido(partido(13, 'Leones', 'Halcones', '2026-10-12T20:00:00Z'), eventos).estado, 'no_encontrado');
  // Con un nombre ya confirmado, el partido queda claro.
  const alias = new Map([['sofascore:121', ['Águilas']], ['sofascore:122', ['Cóndores']]]);
  assert.equal(e.emparejarPartido(partido(12, 'Club Uno', 'Club Dos', '2026-10-11T22:00:00Z'), eventos, alias).estado, 'emparejado');
});

test('emparejamiento: basta un equipo claro si ningún otro partido de la liga se le acerca', () => {
  // La casa escribe el local en otro idioma ("Ciudad del León" y "Lion City") y acorta el visitante: el
  // parecido de los dos equipos no llega a 0.5, pero el visitante es claro.
  const solo = [evento('1', 'Ciudad del León', 'Halcones', '2026-10-11T20:00:00Z')];
  const leon = partido(20, 'Lion City SC', 'Halcones del Sur FC', '2026-10-11T20:00:00Z');
  assert.equal(e.emparejarPartido(leon, solo).estado, 'emparejado');
  // Otro partido a la misma hora, con equipos distintos, no impide reconocerlo.
  const dos = [...solo, evento('2', 'Pumas Unidos', 'Toros de Prueba', '2026-10-11T20:00:00Z')];
  const conOtro = e.emparejarPartido(leon, dos);
  assert.equal(conOtro.estado, 'emparejado');
  assert.equal(conOtro.evento.id, '1');
  // Sin ningún equipo claro, hay que confirmarlo.
  assert.equal(e.emparejarPartido(partido(21, 'Lion City SC', 'Gavilanes', '2026-10-11T20:00:00Z'), solo).estado, 'dudoso');
});
