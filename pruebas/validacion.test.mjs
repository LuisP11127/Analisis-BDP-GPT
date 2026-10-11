import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { crearValidador } from '../comun/validacion.js';
import { RAIZ, cargarValidador, crearAjv, leerCarpeta, leerConfig, leerEsquemas } from '../herramientas/cargar.mjs';

let validador;
let ejemplos;
let extracciones;

before(async () => {
  validador = await cargarValidador();
  ejemplos = await leerCarpeta(path.join(RAIZ, 'ejemplos', 'datos'));
  extracciones = await leerCarpeta(path.join(RAIZ, 'ejemplos', 'extraccion'));
});

const registrosDe = (archivos) => archivos.filter((a) => a.ruta.startsWith('historial/')).flatMap((a) => a.contenido.registros);
const partidosDe = (archivos) => archivos.filter((a) => a.ruta.startsWith('partidos/')).flatMap((a) => a.contenido.partidos);

/** Errores de los ejemplos después de modificar una copia. */
function erroresCon(modificar) {
  const archivos = structuredClone(ejemplos);
  modificar(archivos);
  return validador.validarDatos(archivos);
}

/** Errores de la extracción de prueba después de modificar una copia. */
function erroresDeExtraccionCon(modificar) {
  const copia = structuredClone(extracciones);
  modificar(copia[0].contenido);
  return validador.validarExtracciones(copia, ejemplos);
}

function contiene(errores, patron) {
  assert.ok(errores.some((e) => patron.test(e)), `ningún error coincide con ${patron}:\n${errores.join('\n')}`);
}

function registro(archivos, condicion) {
  const encontrado = registrosDe(archivos).find(condicion);
  assert.ok(encontrado, 'no hay un registro de ejemplo que cumpla la condición');
  return encontrado;
}

function partido(archivos, condicion) {
  const encontrado = partidosDe(archivos).find(condicion);
  assert.ok(encontrado, 'no hay un partido de ejemplo que cumpla la condición');
  return encontrado;
}

const conVariasLineas = (r) => r.mercado === 'futbol_goles' && r.ofertas[0].lineas.length >= 2;
const resuelto = (mercado) => (r) => r.mercado === mercado && r.resultado.estado === 'resuelto';

test('los ejemplos son válidos', () => {
  assert.ok(registrosDe(ejemplos).length > 100);
  assert.deepEqual(validador.validarDatos(ejemplos), []);
  assert.deepEqual(validador.validarExtracciones(extracciones, ejemplos), []);
});

test('rechaza líneas enteras y asiáticas', () => {
  for (const linea of [2, 2.25]) {
    const errores = erroresCon((a) => { registro(a, conVariasLineas).ofertas[0].lineas[1].linea = linea; });
    contiene(errores, /ofertas\[0\]\.lineas\[1\]\.linea: la línea debe terminar en \.5/);
  }
});

test('rechaza una candidata que no cumple la regla', () => {
  const errores = erroresCon((a) => {
    const r = registro(a, conVariasLineas);
    const otra = r.ofertas[0].lineas.find((l) => l.linea !== r.candidata.linea);
    Object.assign(r.candidata, { linea: otra.linea, cuota_a: otra.cuota_a, cuota_b: otra.cuota_b });
  });
  contiene(errores, /candidata\.linea debería ser/);
});

test('rechaza un mercado que no pertenece al deporte', () => {
  contiene(erroresCon((a) => { registro(a, (r) => r.deporte === 'futbol').mercado = 'basquet_puntos'; }), /el mercado basquet_puntos no existe en futbol/);
});

test('rechaza una prop de jugador sin jugador', () => {
  contiene(erroresCon((a) => { delete registro(a, (r) => r.mercado === 'basquet_jugador').jugador; }), /necesita jugador y estadistica_jugador/);
});

test('rechaza un mercado sin línea que trae línea', () => {
  contiene(erroresCon((a) => { registro(a, (r) => r.mercado === 'futbol_ambos_anotan').ofertas[0].lineas[0].linea = 0.5; }), /no lleva línea/);
});

test('rechaza una casa que no está en la configuración', () => {
  contiene(erroresCon((a) => { registro(a, (r) => r.ofertas.length >= 2).ofertas[1].casa = 'casa_x'; }), /casa desconocida casa_x/);
});

test('rechaza un lado que no coincide con la probabilidad', () => {
  contiene(erroresCon((a) => {
    Object.assign(registro(a, (r) => r.estadistico.lado === 'a').estadistico, { prob_a: 0.3 });
  }), /estadistico: el lado a no coincide con prob_a 0\.3/);
});

test('acepta la probabilidad de roja solo en el mercado de tarjetas', () => {
  contiene(erroresCon((a) => { registro(a, (r) => r.mercado === 'futbol_goles').estadistico.prob_roja = 0.2; }), /prob_roja solo va en futbol_tarjetas/);
  assert.ok(registrosDe(ejemplos).filter((r) => r.mercado === 'futbol_tarjetas').every((r) => r.estadistico.prob_roja !== undefined));
});

test('exige guardar la entrada de la red cuando hay predicción de la red', () => {
  contiene(erroresCon((a) => { registro(a, (r) => r.red !== null).entrada_red = null; }), /debe guardarse entrada_red/);
});

test('rechaza un análisis hecho después del inicio del partido', () => {
  contiene(erroresCon((a) => {
    const r = registro(a, () => true);
    r.analizado_en = new Date(new Date(r.inicio).getTime() + 3600000).toISOString();
  }), /el análisis debe hacerse antes del inicio del partido/);
});

test('rechaza un resultado con el lado ganador equivocado', () => {
  contiene(erroresCon((a) => {
    const r = registro(a, resuelto('futbol_goles'));
    r.resultado.lado_ganador = r.resultado.lado_ganador === 'a' ? 'b' : 'a';
  }), /el lado ganador es/);
});

test('rechaza un resultado resuelto sin valor real', () => {
  contiene(erroresCon((a) => { registro(a, resuelto('futbol_goles')).resultado.valor_real = null; }), /resultado\.valor_real: debe ser un número/);
});

test('rechaza una fecha local que no es la de Lima', () => {
  contiene(erroresCon((a) => {
    const p = partido(a, (x) => x.inicio.slice(0, 10) !== x.fecha_local);
    p.fecha_local = p.inicio.slice(0, 10);
  }), /fecha_local debería ser/);
});

test('rechaza datos previos extraídos después del inicio', () => {
  contiene(erroresCon((a) => {
    const p = partido(a, (x) => x.previa);
    p.previa.extraido_en = new Date(new Date(p.inicio).getTime() + 3600000).toISOString();
  }), /previa: los datos previos deben extraerse antes/);
});

test('rechaza usar como partido previo uno posterior', () => {
  contiene(erroresCon((a) => {
    const todos = partidosDe(a);
    const p = todos.find((x) => x.previa && todos.some((y) => y.deporte === x.deporte && y.estado === 'finalizado' && y.inicio > x.inicio));
    const posterior = todos.find((y) => y.deporte === p.deporte && y.estado === 'finalizado' && y.inicio > p.inicio);
    p.previa.ultimos_partidos.local = [posterior.id];
  }), /no es anterior al partido/);
});

test('rechaza un registro de un partido que no está guardado', () => {
  const id = registrosDe(ejemplos)[0].partido_id;
  contiene(erroresCon((a) => {
    for (const archivo of a.filter((x) => x.ruta.startsWith('partidos/'))) {
      archivo.contenido.partidos = archivo.contenido.partidos.filter((p) => p.id !== id);
    }
  }), new RegExp(`el partido ${id} no existe en los datos`));
});

test('rechaza un marcador que no coincide con los períodos en básquet', () => {
  contiene(erroresCon((a) => { partido(a, (p) => p.deporte === 'basquet' && p.marcador).marcador.local += 1; }), /no coincide con el marcador/);
});

test('rechaza una prórroga sin empate al final del tiempo regular', () => {
  contiene(erroresCon((a) => {
    const p = partido(a, (x) => x.estadisticas?.prorrogas);
    p.estadisticas.periodos.local[0] += 1;
    p.marcador.local += 1;
  }), /hay prórroga 1 pero el marcador no estaba empatado/);
});

test('rechaza un empate en béisbol', () => {
  contiene(erroresCon((a) => { partido(a, (p) => p.deporte === 'beisbol' && p.marcador).marcador = { local: 3, visitante: 3 }; }), /no puede terminar empatado/);
});

test('rechaza un archivo en una ruta que no corresponde', () => {
  contiene(validador.validarArchivo('historial/futbol/2026-10-11.json', { version_formato: 1, registros: [] }), /la ruta no corresponde/);
  const archivo = ejemplos.find((a) => a.ruta.startsWith('historial/futbol/'));
  contiene(validador.validarArchivo('historial/futbol/2026/2026-12-31.json', archivo.contenido), /debería estar en historial\/futbol\//);
});

test('extracción: rechaza mercados de partidos que no están en la extracción', () => {
  contiene(erroresDeExtraccionCon((c) => { c.mercados[0].partido_id = 'ejemplo:no-existe'; }), /el partido ejemplo:no-existe no está en la extracción/);
});

test('extracción: rechaza cuotas extraídas después del inicio', () => {
  contiene(erroresDeExtraccionCon((c) => {
    const entrada = c.mercados[0];
    const p = c.partidos.find((x) => x.id === entrada.partido_id);
    entrada.ofertas[0].extraido_en = new Date(new Date(p.inicio).getTime() + 60000).toISOString();
  }), /las cuotas deben extraerse antes del inicio del partido/);
});

test('extracción: rechaza partidos de otra fecha y un nombre de archivo que no coincide', () => {
  contiene(erroresDeExtraccionCon((c) => { c.partidos[0].fecha_local = '2026-10-12'; }), /es del 2026-10-12/);
  const [extraccion] = extracciones;
  contiene(validador.validarExtracciones([{ ruta: '2026-10-12.json', contenido: extraccion.contenido }], ejemplos), /debería llamarse 2026-10-11\.json/);
});

test('extracción: los partidos previos tienen que estar guardados', () => {
  contiene(erroresDeExtraccionCon((c) => {
    c.partidos.find((p) => p.previa).previa.ultimos_partidos.local = ['ejemplo:no-guardado'];
  }), /ejemplo:no-guardado no existe en los datos/);
});

test('el índice tiene que coincidir con los archivos de la carpeta', () => {
  const errores = validador.validarIndice({ version_formato: 1, archivos: ['b.json', 'a.json'] }, ['a.json', 'c.json']);
  contiene(errores, /falta c\.json/);
  contiene(errores, /lista b\.json, que no existe/);
  contiene(errores, /orden alfabético/);
  assert.deepEqual(validador.validarIndice({ version_formato: 1, archivos: ['a.json'] }, ['a.json']), []);
});

test('rechaza una configuración inconsistente', async () => {
  const config = await leerConfig();
  const beisbol = config.mercados.deportes.find((d) => d.codigo === 'beisbol');
  beisbol.mercados[0].periodo = 'primer_tiempo';
  const esquemas = await leerEsquemas();
  assert.throws(() => crearValidador({ ajv: crearAjv(), esquemas, config }), /el período primer_tiempo no está definido en beisbol/);
});
