import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { calcularCandidata } from '../comun/reglas.js';
import { rutaHistorial, rutaPartidos } from '../comun/rutas.js';
import { RAIZ, cargarValidador, leerCarpeta, leerConfig } from '../herramientas/cargar.mjs';
import { agruparPartidos, analizar, modeloDeEjemplo } from '../web/js/analisis.js';
import * as f from '../web/js/formato.js';
import { acerto, filtrar, ordenar, resultadoApuesta, resumir } from '../web/js/historial.js';

let config;
let extraccion;
let ejemplos;
let validador;

before(async () => {
  config = await leerConfig();
  [{ contenido: extraccion }] = await leerCarpeta(path.join(RAIZ, 'ejemplos', 'extraccion'));
  ejemplos = await leerCarpeta(path.join(RAIZ, 'ejemplos', 'datos'));
  validador = await cargarValidador();
});

const PRIORIDAD = ['betano', 'apuesta_total', 'te_apuesto'];
const analizarTodo = () => analizar({
  extraccion,
  seleccion: new Set(extraccion.partidos.map((p) => p.id)),
  config,
  modelo: modeloDeEjemplo,
  ahora: '2026-10-11T13:15:00Z',
});

test('análisis: deportes y mercados en el orden del catálogo', () => {
  const { deportes } = analizarTodo();
  assert.deepEqual(deportes.map((d) => d.deporte.codigo), ['futbol', 'basquet', 'beisbol']);
  for (const { deporte, partidos } of deportes) {
    for (const { mercados } of partidos) {
      assert.deepEqual(mercados.map((m) => m.definicion.codigo), deporte.mercados.map((m) => m.codigo));
    }
  }
});

test('análisis: solo los partidos elegidos', () => {
  const elegido = extraccion.partidos.find((p) => p.deporte === 'beisbol');
  const { deportes } = analizar({ extraccion, seleccion: new Set([elegido.id]), config, modelo: modeloDeEjemplo, ahora: '2026-10-11T13:15:00Z' });
  assert.equal(deportes.length, 1);
  assert.equal(deportes[0].partidos[0].partido.id, elegido.id);
});

test('análisis: la candidata sale de la regla y hay registro solo con predicción', () => {
  const { deportes, registros } = analizarTodo();
  const filas = deportes.flatMap((d) => d.partidos.flatMap((p) => p.mercados.flatMap((m) => m.filas)));
  for (const fila of filas) {
    assert.deepEqual(fila.candidata, calcularCandidata(fila.entrada.ofertas, PRIORIDAD));
    assert.equal(fila.registro !== null, fila.entrada.prediccion_ejemplo.estadistico !== null);
  }
  const conPrediccion = extraccion.mercados.filter((m) => m.prediccion_ejemplo.estadistico !== null).length;
  assert.equal(registros.length, conPrediccion);
  assert.ok(filas.some((fila) => fila.registro === null), 'la extracción de prueba tiene un mercado sin datos suficientes');
});

test('análisis: los partidos sin cuotas quedan con todos sus mercados vacíos', () => {
  const { deportes } = analizarTodo();
  const copa = deportes[0].partidos.filter((p) => p.partido.liga.nombre === 'Copa de Ejemplo');
  assert.equal(copa.length, 2);
  for (const { mercados } of copa) assert.ok(mercados.every((m) => m.filas.length === 0));
});

test('análisis: los registros que crea la página cumplen todas las reglas del formato', () => {
  const { registros } = analizarTodo();
  const archivos = structuredClone(ejemplos);
  const porRuta = new Map(archivos.map((a) => [a.ruta, a]));
  const agregar = (ruta, clave, item) => {
    if (!porRuta.has(ruta)) {
      const nuevo = { ruta, contenido: { version_formato: 1, [clave]: [] } };
      porRuta.set(ruta, nuevo);
      archivos.push(nuevo);
    }
    porRuta.get(ruta).contenido[clave].push(item);
  };
  const analizados = new Set(registros.map((r) => r.partido_id));
  for (const partido of extraccion.partidos.filter((p) => analizados.has(p.id))) agregar(rutaPartidos(partido), 'partidos', partido);
  for (const registro of registros) agregar(rutaHistorial(registro), 'registros', registro);
  assert.deepEqual(validador.validarDatos(archivos), []);
});

test('lista de partidos: agrupados por deporte y liga, con los mercados que tienen cuotas', () => {
  const grupos = agruparPartidos(extraccion, config);
  assert.deepEqual(grupos.map((g) => g.deporte.codigo), ['futbol', 'basquet', 'beisbol']);
  const futbol = grupos[0];
  assert.deepEqual(futbol.ligas.map((l) => l.liga.nombre), ['Copa de Ejemplo', 'Liga de Ejemplo', 'Liga Muestra']);
  assert.ok(futbol.ligas[0].partidos.every((p) => p.mercadosConCuotas === 0));
  assert.ok(futbol.ligas[1].partidos.every((p) => p.mercadosConCuotas === 7));
});

// ---------------------------------------------------------------- historial

const definicionGoles = { codigo: 'futbol_goles', tipo: 'mas_menos', lado_a: 'Más', lado_b: 'Menos', estadistica: 'goles' };

function registroDePrueba({ mercado = 'futbol_goles', fecha = '2026-10-10', liga = 'ejemplo:l', estado = 'resuelto', valor = 3, ganador = 'a', est = 'a', red = null, apuesta = null } = {}) {
  return {
    id: `${mercado}-${fecha}-${valor}-${est}`,
    partido_id: `ejemplo:${fecha}`,
    deporte: 'futbol',
    liga: { id: liga, nombre: liga },
    inicio: `${fecha}T20:00:00Z`,
    fecha_local: fecha,
    mercado,
    candidata: { linea: 2.5 },
    estadistico: { prob_a: est === 'a' ? 0.6 : 0.4, lado: est },
    red: red ? { prob_a: red === 'a' ? 0.6 : 0.4, lado: red } : null,
    apuesta,
    resultado: estado === 'resuelto'
      ? { estado, valor_real: valor, lado_ganador: ganador }
      : { estado, valor_real: null, lado_ganador: null, motivo: 'x' },
  };
}

test('historial: acierto de cada modelo', () => {
  assert.equal(acerto({ lado: 'a' }, { estado: 'resuelto', lado_ganador: 'a' }), true);
  assert.equal(acerto({ lado: 'b' }, { estado: 'resuelto', lado_ganador: 'a' }), false);
  assert.equal(acerto(null, { estado: 'resuelto', lado_ganador: 'a' }), null);
  assert.equal(acerto({ lado: 'a' }, { estado: 'pendiente' }), null);
});

test('historial: resultado de las apuestas, incluso a otra línea', () => {
  const apuesta = (linea, lado) => ({ casa: 'betano', linea, lado, cuota: 1.9, monto: 20, moneda: 'PEN' });
  assert.deepEqual(resultadoApuesta(registroDePrueba({ apuesta: apuesta(2.5, 'a') }), 'mas_menos'), { estado: 'ganada', ganancia: 18 });
  assert.deepEqual(resultadoApuesta(registroDePrueba({ apuesta: apuesta(3.5, 'a') }), 'mas_menos'), { estado: 'perdida', ganancia: -20 });
  assert.deepEqual(resultadoApuesta(registroDePrueba({ estado: 'anulado', apuesta: apuesta(2.5, 'a') }), 'mas_menos'), { estado: 'anulada', ganancia: 0 });
  assert.deepEqual(resultadoApuesta(registroDePrueba({ estado: 'pendiente', apuesta: apuesta(2.5, 'b') }), 'mas_menos'), { estado: 'pendiente', ganancia: null });
  assert.equal(resultadoApuesta(registroDePrueba(), 'mas_menos'), null);
});

test('historial: filtros por fecha, liga y mercado', () => {
  const registros = [
    registroDePrueba({ fecha: '2026-10-08' }),
    registroDePrueba({ fecha: '2026-10-09', liga: 'ejemplo:otra' }),
    registroDePrueba({ fecha: '2026-10-10', mercado: 'futbol_corners' }),
  ];
  assert.equal(filtrar(registros, { deporte: 'futbol' }).length, 3);
  assert.equal(filtrar(registros, { deporte: 'basquet' }).length, 0);
  assert.equal(filtrar(registros, { deporte: 'futbol', desde: '2026-10-09' }).length, 2);
  assert.equal(filtrar(registros, { deporte: 'futbol', hasta: '2026-10-08' }).length, 1);
  assert.equal(filtrar(registros, { deporte: 'futbol', liga: 'ejemplo:otra' }).length, 1);
  assert.equal(filtrar(registros, { deporte: 'futbol', mercado: 'futbol_corners' }).length, 1);
  assert.deepEqual(ordenar(registros, ['futbol_goles', 'futbol_corners']).map((r) => r.fecha_local), ['2026-10-10', '2026-10-09', '2026-10-08']);
});

test('historial: resumen por mercado', () => {
  const registros = [
    registroDePrueba({ valor: 3, ganador: 'a', est: 'a', red: 'b', apuesta: { casa: 'betano', linea: 2.5, lado: 'a', cuota: 2, monto: 10, moneda: 'PEN' } }),
    registroDePrueba({ valor: 1, ganador: 'b', est: 'a', red: 'b' }),
    registroDePrueba({ estado: 'pendiente' }),
    registroDePrueba({ estado: 'anulado' }),
  ];
  const { filas, total } = resumir(registros, [definicionGoles, { codigo: 'futbol_corners', tipo: 'mas_menos' }]);
  assert.equal(filas.length, 1);
  const [goles] = filas;
  assert.equal(goles.total, 4);
  assert.equal(goles.resueltos, 2);
  assert.equal(goles.pendientes, 1);
  assert.equal(goles.anulados, 1);
  assert.deepEqual(goles.estadistico, { aciertos: 1, total: 2 });
  assert.deepEqual(goles.red, { aciertos: 1, total: 2 });
  assert.deepEqual(goles.apuestas, { cantidad: 1, resueltas: 1, apostado: 10, ganancia: 10 });
  assert.deepEqual(total.estadistico, goles.estadistico);
});

// ---------------------------------------------------------------- formato

const partido = { local: { nombre: 'Toros' }, visitante: { nombre: 'Halcones' } };

test('formato: nombre de cada lado según el tipo de mercado', () => {
  assert.equal(f.nombreLado(definicionGoles, 'a', partido, 2.5), 'Más 2.5');
  assert.equal(f.nombreLado(definicionGoles, 'b', partido, 2.5), 'Menos 2.5');
  const handicap = { tipo: 'handicap', lado_a: 'Local', lado_b: 'Visitante' };
  assert.equal(f.nombreLado(handicap, 'a', partido, -3.5), 'Toros -3.5');
  assert.equal(f.nombreLado(handicap, 'b', partido, -3.5), 'Halcones +3.5');
  assert.equal(f.nombreLado({ tipo: 'ganador' }, 'b', partido, null), 'Halcones');
  assert.equal(f.nombreLado({ tipo: 'si_no', lado_a: 'Sí', lado_b: 'No' }, 'a', partido, null), 'Sí');
});

test('formato: porcentajes, signos, impactos y fechas', () => {
  assert.equal(f.porcentaje(0.585), '59%');
  assert.equal(f.porcentaje(0.5), '50%');
  assert.equal(f.signo(3.5), '+3.5');
  assert.equal(f.signo(-1.5), '-1.5');
  assert.equal(f.probLado({ prob_a: 0.42, lado: 'b' }), 0.5800000000000001);
  assert.equal(f.impactoHaciaLado(0.05, 'a'), '+5%');
  assert.equal(f.impactoHaciaLado(0.05, 'b'), '−5%');
  assert.equal(f.fechaLarga('2026-10-11'), 'domingo, 11 de octubre de 2026');
  assert.equal(f.capitalizar(f.fechaLarga('2026-10-11')), 'Domingo, 11 de octubre de 2026');
  assert.equal(f.hora('2026-10-11T21:00:00Z'), '16:00');
  // Intl separa el símbolo con un espacio que no se corta (U+00A0).
  assert.equal(f.soles(-20, { conSigno: true }).replace(/\s/g, ' '), '−S/ 20.00');
  assert.equal(f.nombreFactor('forma_reciente'), 'Forma reciente');
  assert.equal(f.nombreFactor('nuevo_factor'), 'Nuevo factor');
});

test('formato: valor real de cada tipo de mercado', () => {
  const resuelto = (valor) => ({ resultado: { valor_real: valor } });
  assert.equal(f.textoValorReal(definicionGoles, resuelto(1)), '1 gol');
  assert.equal(f.textoValorReal(definicionGoles, resuelto(3)), '3 goles');
  assert.equal(f.textoValorReal({ tipo: 'si_no' }, resuelto(1)), 'Anotaron los dos');
  assert.equal(f.textoValorReal({ tipo: 'handicap' }, resuelto(-2)), 'Diferencia del local: -2');
  const props = { tipo: 'mas_menos', por_jugador: true, estadisticas_jugador: [{ codigo: 'puntos', nombre: 'Puntos' }] };
  assert.equal(f.textoValorReal(props, { ...resuelto(27), estadistica_jugador: 'puntos' }), '27 (puntos)');
});
