import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularCandidata, elegirLinea, elegirOferta, idRegistro, ladoGanador, margen, probSinMargenA,
  promedioMercadoA, redondear,
} from '../comun/reglas.js';
import { clasificarRuta, fechaLocal, rutaHistorial, rutaPartidos } from '../comun/rutas.js';

const lineas = (...filas) => filas.map(([linea, cuota_a, cuota_b]) => ({ linea, cuota_a, cuota_b }));
const oferta = (casa, ...filas) => ({ casa, extraido_en: '2026-10-11T14:00:00Z', lineas: lineas(...filas) });
const PRIORIDAD = ['betano', 'apuesta_total', 'te_apuesto'];

test('margen y probabilidad sin margen', () => {
  assert.equal(redondear(margen(1.9, 1.9)), 0.0526);
  assert.equal(probSinMargenA(1.9, 1.9), 0.5);
  assert.equal(redondear(probSinMargenA(1.75, 2.2)), 0.557);
});

test('ejemplo de la especificación: la candidata es 2.5 y no 3.5', () => {
  assert.equal(elegirLinea(lineas([2.5, 1.75, 1.8], [3.5, 1.9, 2.05])).linea, 2.5);
});

test('no hay rango de cuotas: gana la línea más pareja aunque su diferencia sea grande', () => {
  assert.equal(elegirLinea(lineas([0.5, 1.1, 6.5], [1.5, 1.7, 2.1])).linea, 1.5);
  assert.equal(elegirLinea(lineas([1.5, 1.2, 4.0])).linea, 1.5);
});

test('empate en la diferencia: gana la línea con menos margen', () => {
  assert.equal(elegirLinea(lineas([22.5, 1.8, 2.0], [23.5, 2.05, 1.85])).linea, 23.5);
});

test('empate en diferencia y margen: gana la línea más baja, sin importar el orden', () => {
  const pareja = lineas([9.5, 1.85, 1.95], [10.5, 1.95, 1.85]);
  assert.equal(elegirLinea(pareja).linea, 9.5);
  assert.equal(elegirLinea([...pareja].reverse()).linea, 9.5);
});

test('handicap: compara las líneas igual que en Más/Menos', () => {
  assert.equal(elegirLinea(lineas([-2.5, 1.83, 1.97], [-3.5, 1.95, 1.85], [-4.5, 2.05, 1.75])).linea, -3.5);
});

test('casa de la candidata: Betano primero y, si no ofrece el mercado, la siguiente', () => {
  const ofertas = [oferta('te_apuesto', [27.5, 1.8, 1.9]), oferta('apuesta_total', [27.5, 1.83, 1.87])];
  assert.equal(elegirOferta(ofertas, PRIORIDAD).casa, 'apuesta_total');
  assert.equal(elegirOferta([...ofertas, oferta('betano', [26.5, 1.9, 1.9])], PRIORIDAD).casa, 'betano');
  assert.equal(elegirOferta([oferta('otra_casa', [1.5, 1.9, 1.9])], PRIORIDAD), null);
});

test('promedio del mercado: solo otras casas que ofrecen la misma línea', () => {
  const ofertas = [
    oferta('betano', [2.5, 1.85, 1.95]),
    oferta('apuesta_total', [2.5, 1.9, 1.9], [3.5, 3.0, 1.4]),
    oferta('te_apuesto', [3.5, 3.1, 1.36]),
  ];
  assert.equal(promedioMercadoA(ofertas, 'betano', 2.5), 0.5);
  assert.equal(promedioMercadoA(ofertas, 'betano', 1.5), null);
});

test('calcularCandidata devuelve los valores redondeados a 4 decimales', () => {
  const candidata = calcularCandidata(
    [oferta('betano', [1.5, 1.3, 3.4], [2.5, 1.95, 1.85]), oferta('apuesta_total', [2.5, 1.92, 1.86])],
    PRIORIDAD,
  );
  assert.deepEqual(candidata, {
    casa: 'betano',
    linea: 2.5,
    cuota_a: 1.95,
    cuota_b: 1.85,
    diferencia: 0.1,
    margen: 0.0534,
    prob_sin_margen_a: 0.4868,
    promedio_mercado_a: 0.4921,
  });
});

test('lado ganador según el tipo de mercado', () => {
  assert.equal(ladoGanador('mas_menos', 2.5, 3), 'a');
  assert.equal(ladoGanador('mas_menos', 2.5, 2), 'b');
  // Local -3.5: cubre si gana por 4 o más.
  assert.equal(ladoGanador('handicap', -3.5, 4), 'a');
  assert.equal(ladoGanador('handicap', -3.5, 3), 'b');
  // Local +1.5: cubre si pierde por 1.
  assert.equal(ladoGanador('handicap', 1.5, -1), 'a');
  assert.equal(ladoGanador('handicap', 1.5, -2), 'b');
  assert.equal(ladoGanador('ganador', null, 1), 'a');
  assert.equal(ladoGanador('ganador', null, -2), 'b');
  assert.throws(() => ladoGanador('ganador', null, 0), /no admite empate/);
  assert.equal(ladoGanador('si_no', null, 1), 'a');
  assert.equal(ladoGanador('si_no', null, 0), 'b');
  assert.throws(() => ladoGanador('si_no', null, 2));
});

test('id de registro', () => {
  assert.equal(idRegistro({ partido_id: 'sofascore:1', mercado: 'futbol_goles' }), 'sofascore:1|futbol_goles');
  assert.equal(
    idRegistro({ partido_id: 'sofascore:1', mercado: 'basquet_jugador', jugador: { id: 'sofascore:9' }, estadistica_jugador: 'puntos' }),
    'sofascore:1|basquet_jugador|sofascore:9|puntos',
  );
});

test('la fecha local es la de Lima', () => {
  assert.equal(fechaLocal('2026-10-05T01:30:00Z'), '2026-10-04');
  assert.equal(fechaLocal('2026-10-05T05:00:00Z'), '2026-10-05');
});

test('rutas de los archivos', () => {
  const partido = {
    deporte: 'futbol', liga: { id: 'sofascore:17' }, temporada: { id: 'sofascore:61627' }, fecha_local: '2026-10-11',
  };
  assert.equal(rutaPartidos(partido), 'partidos/futbol/sofascore-17/sofascore-61627/2026-10.json');
  assert.equal(rutaHistorial({ deporte: 'basquet', fecha_local: '2026-10-11' }), 'historial/basquet/2026/2026-10-11.json');
  assert.deepEqual(clasificarRuta('historial/beisbol/2026/2026-10-11.json'), { tipo: 'historial', deporte: 'beisbol' });
  assert.equal(clasificarRuta('historial/tenis/2026/2026-10-11.json'), null);
});
