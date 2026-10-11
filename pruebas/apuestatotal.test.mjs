import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCandidata } from '../comun/reglas.js';
import * as at from '../web/js/fuentes/apuestatotal.js';
import * as d from './datos/apuestatotal.mjs';

const AHORA = '2026-10-11T12:00:00Z';
const PRIORIDAD = ['betano', 'apuesta_total', 'te_apuesto'];

test('apuesta total: un pedido trae varios partidos con los tipos de mercado del proyecto', () => {
  assert.equal(at.RUTAS.mercados(['9001', '9002']), '/api/eventlist/eu/markets/all?markets=9001%7C9002%3AOU200%7CQA158%7COU615%7COU121%7COU2083%7COU14');
  assert.equal(at.RUTAS.mercados(['9001'], ['OU200']), '/api/eventlist/eu/markets/all?markets=9001%3AOU200');
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
    d.masMenos('9001', 'OU121', 'Disparos a puerta totales', [[8.5, 1.83, 1.91]]),
    d.masMenos('9001', 'OU2083', 'Disparos totales', [[24.5, 1.87, 1.87]]),
    // Línea entera: no se usa.
    d.masMenos('9001', 'OU14', '1ra mitad: Total de tiros de esquina', [[4, 1.8, 1.95]]),
    // Tarjetas: pendiente de saber qué mercado cuenta como Betano.
    d.masMenos('9001', 'OU10', 'Total de tarjetas', [[4.5, 1.8, 1.95]]),
    d.masMenos('9002', 'OU200', 'Total de goles', [[2.5, 2, 1.8]]),
    cornersSuspendido,
    // Un partido sin ninguna línea útil no aparece.
    d.masMenos('9003', 'OU14', '1ra mitad: Total de tiros de esquina', [[4, 1.8, 1.95]]),
  ];
  const porPartido = at.ofertasFutbol(respuesta, AHORA);
  assert.deepEqual([...porPartido.keys()], ['9001', '9002']);

  const ofertas = porPartido.get('9001');
  assert.deepEqual([...ofertas.keys()], ['futbol_goles', 'futbol_ambos_anotan', 'futbol_corners', 'futbol_tiros_arco', 'futbol_remates']);
  assert.deepEqual(ofertas.get('futbol_goles'), {
    casa: 'apuesta_total',
    extraido_en: AHORA,
    lineas: [{ linea: 1.5, cuota_a: 1.28, cuota_b: 3.6 }, { linea: 2.5, cuota_a: 1.85, cuota_b: 1.95 }],
  });
  assert.deepEqual(ofertas.get('futbol_ambos_anotan').lineas, [{ linea: null, cuota_a: 1.7, cuota_b: 2.1 }]);
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
