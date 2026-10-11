import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { crearValidador } from '../comun/validacion.js';
import { RAIZ, cargarValidador, crearAjv, leerCarpeta, leerConfig, leerEsquemas } from '../herramientas/cargar.mjs';

const FUTBOL_HOY = 'historial/futbol/2026/2026-10-11.json';
const FUTBOL_AYER = 'historial/futbol/2026/2026-10-10.json';
const BASQUET_HOY = 'historial/basquet/2026/2026-10-11.json';
const PARTIDOS_FUTBOL = 'partidos/futbol/ejemplo-liga-futbol/ejemplo-temporada-2026/2026-10.json';
const PARTIDOS_BASQUET = 'partidos/basquet/ejemplo-liga-basquet/ejemplo-temporada-2026-27/2026-10.json';
const PARTIDOS_BEISBOL = 'partidos/beisbol/ejemplo-liga-beisbol/ejemplo-temporada-2026/2026-10.json';

let validador;
let ejemplos;

before(async () => {
  validador = await cargarValidador();
  ejemplos = await leerCarpeta(path.join(RAIZ, 'ejemplos', 'datos'));
});

/** Errores de los ejemplos después de modificar una copia del archivo indicado. */
function erroresCon(ruta, modificar) {
  const archivos = structuredClone(ejemplos);
  const archivo = archivos.find((a) => a.ruta === ruta);
  assert.ok(archivo, `no existe el ejemplo ${ruta}`);
  modificar(archivo.contenido);
  return validador.validarDatos(archivos);
}

function contiene(errores, patron) {
  assert.ok(errores.some((e) => patron.test(e)), `ningún error coincide con ${patron}:\n${errores.join('\n')}`);
}

const registro = (contenido, mercado) => contenido.registros.find((r) => r.mercado === mercado);
const partido = (contenido, id) => contenido.partidos.find((p) => p.id === id);

test('los ejemplos son válidos', () => {
  assert.equal(ejemplos.length, 10);
  assert.deepEqual(validador.validarDatos(ejemplos), []);
});

test('rechaza líneas enteras y asiáticas', () => {
  contiene(erroresCon(FUTBOL_HOY, (c) => { registro(c, 'futbol_goles').ofertas[0].lineas[1].linea = 2; }), /lineas\[1\]\.linea: la línea debe terminar en \.5/);
  contiene(erroresCon(FUTBOL_HOY, (c) => { registro(c, 'futbol_goles').ofertas[0].lineas[1].linea = 2.25; }), /lineas\[1\]\.linea: la línea debe terminar en \.5/);
});

test('rechaza una candidata que no cumple la regla', () => {
  const errores = erroresCon(FUTBOL_HOY, (c) => {
    Object.assign(registro(c, 'futbol_goles').candidata, { linea: 3.5, cuota_a: 3.1, cuota_b: 1.36 });
  });
  contiene(errores, /candidata\.linea debería ser 2\.5 y es 3\.5/);
});

test('rechaza un mercado que no pertenece al deporte', () => {
  contiene(erroresCon(FUTBOL_HOY, (c) => { c.registros[0].mercado = 'basquet_puntos'; }), /el mercado basquet_puntos no existe en futbol/);
});

test('rechaza una prop de jugador sin jugador', () => {
  contiene(erroresCon(BASQUET_HOY, (c) => { delete registro(c, 'basquet_jugador').jugador; }), /necesita jugador y estadistica_jugador/);
});

test('rechaza un mercado sin línea que trae línea', () => {
  contiene(erroresCon(FUTBOL_AYER, (c) => { registro(c, 'futbol_ambos_anotan').ofertas[0].lineas[0].linea = 0.5; }), /no lleva línea/);
});

test('rechaza una casa que no está en la configuración', () => {
  contiene(erroresCon(FUTBOL_HOY, (c) => { registro(c, 'futbol_goles').ofertas[1].casa = 'casa_x'; }), /casa desconocida casa_x/);
});

test('rechaza un lado que no coincide con la probabilidad', () => {
  contiene(erroresCon(FUTBOL_HOY, (c) => { registro(c, 'futbol_goles').estadistico.prob_a = 0.3; }), /estadistico: el lado a no coincide con prob_a 0\.3/);
});

test('exige guardar la entrada de la red cuando hay predicción de la red', () => {
  contiene(erroresCon(FUTBOL_HOY, (c) => { registro(c, 'futbol_goles').entrada_red = null; }), /debe guardarse entrada_red/);
});

test('rechaza un análisis hecho después del inicio del partido', () => {
  contiene(erroresCon(FUTBOL_HOY, (c) => { registro(c, 'futbol_goles').analizado_en = '2026-10-11T22:00:00Z'; }), /antes del inicio del partido/);
});

test('rechaza un resultado con el lado ganador equivocado', () => {
  contiene(erroresCon(FUTBOL_AYER, (c) => { registro(c, 'futbol_goles').resultado.lado_ganador = 'b'; }), /el lado ganador es a/);
});

test('rechaza un resultado resuelto sin valor real', () => {
  contiene(erroresCon(FUTBOL_AYER, (c) => { registro(c, 'futbol_goles').resultado.valor_real = null; }), /resultado\.valor_real: debe ser un número/);
});

test('rechaza una fecha local que no es la de Lima', () => {
  contiene(erroresCon(PARTIDOS_FUTBOL, (c) => { partido(c, 'ejemplo:f2').fecha_local = '2026-10-05'; }), /fecha_local debería ser 2026-10-04/);
});

test('rechaza datos previos extraídos después del inicio', () => {
  contiene(erroresCon(PARTIDOS_FUTBOL, (c) => { partido(c, 'ejemplo:f4').previa.extraido_en = '2026-10-11T21:30:00Z'; }), /previa: los datos previos deben extraerse antes/);
});

test('rechaza usar como partido previo uno posterior', () => {
  contiene(erroresCon(PARTIDOS_FUTBOL, (c) => { partido(c, 'ejemplo:f3').previa.ultimos_partidos.local = ['ejemplo:f4']; }), /ejemplo:f4 no es anterior al partido/);
});

test('rechaza un registro de un partido que no está guardado', () => {
  contiene(erroresCon(PARTIDOS_FUTBOL, (c) => { c.partidos = c.partidos.filter((p) => p.id !== 'ejemplo:f4'); }), /el partido ejemplo:f4 no existe en los datos/);
});

test('rechaza un marcador que no coincide con los períodos en básquet', () => {
  contiene(erroresCon(PARTIDOS_BASQUET, (c) => { partido(c, 'ejemplo:b1').marcador.local = 107; }), /no coincide con el marcador/);
});

test('rechaza una prórroga sin empate al final del tiempo regular', () => {
  contiene(erroresCon(PARTIDOS_BASQUET, (c) => {
    const p = partido(c, 'ejemplo:b1');
    p.estadisticas.periodos.local[0] = 26;
    p.marcador.local = 109;
  }), /hay prórroga 1 pero el marcador no estaba empatado/);
});

test('rechaza un empate en béisbol', () => {
  contiene(erroresCon(PARTIDOS_BEISBOL, (c) => { partido(c, 'ejemplo:e1').marcador = { local: 3, visitante: 3 }; }), /no puede terminar empatado/);
});

test('rechaza un archivo en una ruta que no corresponde', () => {
  contiene(validador.validarArchivo('historial/futbol/2026-10-11.json', { version_formato: 1, registros: [] }), /la ruta no corresponde/);
  const [archivo] = ejemplos.filter((a) => a.ruta === FUTBOL_HOY);
  contiene(validador.validarArchivo('historial/futbol/2026/2026-10-12.json', archivo.contenido), /debería estar en historial\/futbol\/2026\/2026-10-11\.json/);
});

test('rechaza una configuración inconsistente', async () => {
  const config = await leerConfig();
  const beisbol = config.mercados.deportes.find((d) => d.codigo === 'beisbol');
  beisbol.mercados[0].periodo = 'primer_tiempo';
  const esquemas = await leerEsquemas();
  assert.throws(() => crearValidador({ ajv: crearAjv(), esquemas, config }), /el período primer_tiempo no está definido en beisbol/);
});
