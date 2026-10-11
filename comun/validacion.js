// Validación de los archivos de datos: primero el esquema JSON y después las reglas que el esquema no puede
// expresar (línea candidata, fechas, marcadores, referencias entre archivos).
// No lee archivos: recibe el contenido ya cargado, para poder usarse también desde la página.

import { calcularCandidata, idRegistro, ladoGanador, tieneLinea } from './reglas.js';
import { clasificarRuta, fechaLocal, rutaHistorial, rutaPartidos } from './rutas.js';

export const URL_ESQUEMAS = 'https://luisp11127.github.io/Analisis-BDP-GPT/esquemas/';

export const NOMBRES_ESQUEMAS = [
  'comun',
  'partido',
  'registro',
  'archivo-partidos',
  'archivo-historial',
  'equivalencias',
  'config-mercados',
  'config-casas',
  'indice',
  'extraccion',
];

const ESQUEMA_POR_TIPO = {
  partidos: 'archivo-partidos',
  historial: 'archivo-historial',
  equivalencias: 'equivalencias',
};

const ESTADISTICAS_POR_DEPORTE = {
  futbol: ['goles', 'corners', 'tarjetas', 'tiros_al_arco', 'remates'],
  basquet: ['puntos'],
  beisbol: ['carreras'],
};

const CONTEOS_FUTBOL = [
  'goles', 'corners', 'amarillas', 'rojas', 'dobles_amarillas',
  'tiros_al_arco', 'remates', 'faltas', 'fueras_de_juego',
];

const LADOS = ['local', 'visitante'];
const TOLERANCIA = 1e-9;

const antes = (a, b) => new Date(a).getTime() < new Date(b).getTime();
const suma = (valores) => valores.reduce((total, v) => total + (v ?? 0), 0);
const presente = (valor) => valor !== null && valor !== undefined;

function lugarAjv(instancePath) {
  if (!instancePath) return '(raíz)';
  return instancePath
    .split('/')
    .slice(1)
    .map((parte) => (/^\d+$/.test(parte) ? `[${parte}]` : `.${parte}`))
    .join('')
    .replace(/^\./, '');
}

const TIPOS = {
  integer: 'un número entero',
  number: 'un número',
  string: 'un texto',
  object: 'un objeto',
  array: 'una lista',
  boolean: 'true o false',
  null: 'null',
};

const LINEA_MEDIA = 'la línea debe terminar en .5 (no se aceptan líneas enteras ni asiáticas)';

function mensajeAjv(e) {
  const p = e.params;
  switch (e.keyword) {
    case 'required': return `falta el campo ${p.missingProperty}`;
    case 'additionalProperties': return `campo no permitido: ${p.additionalProperty}`;
    case 'unevaluatedProperties': return `campo no permitido: ${p.unevaluatedProperty}`;
    case 'enum': return `debe ser uno de estos valores: ${p.allowedValues.join(', ')}`;
    case 'const': return `debe ser ${JSON.stringify(p.allowedValue)}`;
    case 'type': return `debe ser ${[].concat(p.type).map((tipo) => TIPOS[tipo] ?? tipo).join(' o ')}`;
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum': return `debe ser ${p.comparison} ${p.limit}`;
    case 'minItems': return `debe tener al menos ${p.limit} elemento(s)`;
    case 'minLength': return 'no puede estar vacío';
    case 'uniqueItems': return `tiene elementos repetidos (posiciones ${p.j} y ${p.i})`;
    case 'pattern': return `no tiene el formato esperado (${p.pattern})`;
    case 'format': return `no tiene el formato ${p.format}`;
    case 'multipleOf': return e.schemaPath.includes('linea_media') ? LINEA_MEDIA : `debe ser múltiplo de ${p.multipleOf}`;
    case 'not': return e.schemaPath.includes('linea_media') ? LINEA_MEDIA : 'no cumple la regla del esquema';
    default: return e.message;
  }
}

function erroresDeEsquema(validar, contenido) {
  if (validar(contenido)) return [];
  // Los resúmenes de if/anyOf no agregan información, y en los campos que aceptan null el
  // "debe ser null" sobra cuando hay otro error que explica qué está mal.
  const utiles = validar.errors.filter((e) => e.keyword !== 'if' && e.keyword !== 'anyOf');
  const esNull = (e) => e.keyword === 'type' && e.params.type === 'null';
  const otrasRutas = utiles.filter((e) => !esNull(e)).map((e) => e.instancePath);
  const explicado = (ruta) => otrasRutas.some((otra) => otra === ruta || otra.startsWith(`${ruta}/`));
  const mensajes = utiles
    .filter((e) => !(esNull(e) && explicado(e.instancePath)))
    .map((e) => `${lugarAjv(e.instancePath)}: ${mensajeAjv(e)}`);
  return [...new Set(mensajes)];
}

function revisarConfig({ mercados, casas }) {
  const errores = [];
  const codigosMercado = new Set();
  const deportes = new Set();
  for (const deporte of mercados.deportes) {
    if (deportes.has(deporte.codigo)) errores.push(`config/mercados.json: deporte repetido ${deporte.codigo}`);
    deportes.add(deporte.codigo);
    for (const mercado of deporte.mercados) {
      const lugar = `config/mercados.json: ${mercado.codigo}`;
      if (codigosMercado.has(mercado.codigo)) errores.push(`${lugar}: código repetido`);
      codigosMercado.add(mercado.codigo);
      if (!mercado.codigo.startsWith(`${deporte.codigo}_`)) errores.push(`${lugar}: debe empezar con ${deporte.codigo}_`);
      if (!deporte.periodos[mercado.periodo]) errores.push(`${lugar}: el período ${mercado.periodo} no está definido en ${deporte.codigo}`);
      if (mercado.estadistica && !ESTADISTICAS_POR_DEPORTE[deporte.codigo].includes(mercado.estadistica)) {
        errores.push(`${lugar}: la estadística ${mercado.estadistica} no corresponde a ${deporte.codigo}`);
      }
      const props = (mercado.estadisticas_jugador ?? []).map((e) => e.codigo);
      if (new Set(props).size !== props.length) errores.push(`${lugar}: estadística de jugador repetida`);
    }
  }
  const codigosCasa = casas.casas.map((c) => c.codigo);
  const codigosFuente = casas.fuentes.map((f) => f.codigo);
  const todos = [...codigosCasa, ...codigosFuente];
  if (new Set(todos).size !== todos.length) errores.push('config/casas.json: hay códigos repetidos entre casas y fuentes');
  const principales = casas.casas.filter((c) => c.rol === 'principal');
  if (principales.length !== 1 || casas.casas[0].rol !== 'principal') {
    errores.push('config/casas.json: debe haber una sola casa principal y debe ir primera');
  }
  return errores;
}

function construirCatalogo({ mercados, casas }) {
  return {
    mercados: new Map(
      mercados.deportes.map((d) => [d.codigo, new Map(d.mercados.map((m) => [m.codigo, m]))]),
    ),
    prioridadCasas: casas.casas.map((c) => c.codigo),
    casas: new Set(casas.casas.map((c) => c.codigo)),
    fuentes: new Set(casas.fuentes.map((f) => f.codigo)),
  };
}

// ---------------------------------------------------------------- partidos

function revisarPrevia(partido, catalogo) {
  const errores = [];
  const { previa } = partido;
  if (!antes(previa.extraido_en, partido.inicio)) {
    errores.push('los datos previos deben extraerse antes del inicio del partido');
  }
  const fuentes = [
    ...previa.fuentes,
    ...(previa.bajas ?? []).map((b) => b.fuente),
    previa.alineaciones_probables?.fuente,
  ].filter(presente);
  for (const fuente of fuentes) {
    if (!catalogo.fuentes.has(fuente)) errores.push(`fuente desconocida ${fuente}`);
  }
  return errores;
}

function revisarFutbol(partido) {
  const errores = [];
  const { completo, primer_tiempo: primerTiempo } = partido.estadisticas;
  for (const lado of LADOS) {
    const goles = completo[lado].goles;
    if (presente(goles) && partido.marcador && goles !== partido.marcador[lado]) {
      errores.push(`completo.${lado}.goles no coincide con el marcador`);
    }
    for (const [nombre, periodo] of [['completo', completo], ['primer_tiempo', primerTiempo]]) {
      if (!periodo) continue;
      const { rojas, dobles_amarillas: dobles } = periodo[lado];
      if (presente(rojas) && presente(dobles) && dobles > rojas) {
        errores.push(`${nombre}.${lado}.dobles_amarillas no puede ser mayor que rojas`);
      }
    }
    if (!primerTiempo) continue;
    for (const campo of CONTEOS_FUTBOL) {
      const parcial = primerTiempo[lado][campo];
      const total = completo[lado][campo];
      if (presente(parcial) && presente(total) && parcial > total) {
        errores.push(`primer_tiempo.${lado}.${campo} es mayor que el del partido completo`);
      }
    }
  }
  return errores;
}

function revisarBasquet(partido) {
  const errores = [];
  const est = partido.estadisticas;
  const esperados = est.formato_periodos === 'cuartos' ? 4 : 2;
  for (const lado of LADOS) {
    if (est.periodos[lado].length !== esperados) {
      errores.push(`periodos.${lado} debe tener ${esperados} valores (${est.formato_periodos})`);
    }
  }
  const prorrogas = est.prorrogas ?? { local: [], visitante: [] };
  if (prorrogas.local.length !== prorrogas.visitante.length) {
    errores.push('prorrogas.local y prorrogas.visitante deben tener la misma cantidad de valores');
  } else {
    // Solo hay prórroga si el período anterior terminó empatado.
    let local = suma(est.periodos.local);
    let visitante = suma(est.periodos.visitante);
    for (let i = 0; i < prorrogas.local.length; i += 1) {
      if (local !== visitante) {
        errores.push(`hay prórroga ${i + 1} pero el marcador no estaba empatado`);
        break;
      }
      local += prorrogas.local[i];
      visitante += prorrogas.visitante[i];
    }
    if (partido.marcador && (local !== partido.marcador.local || visitante !== partido.marcador.visitante)) {
      errores.push('la suma de periodos y prórrogas no coincide con el marcador');
    }
  }
  const ids = (est.jugadores ?? []).map((j) => j.jugador.id);
  if (new Set(ids).size !== ids.length) errores.push('jugadores tiene un jugador repetido');
  return errores;
}

function revisarBeisbol(partido) {
  const errores = [];
  const { local, visitante } = partido.estadisticas.carreras_por_entrada;
  if (local.length !== visitante.length) {
    errores.push('carreras_por_entrada.local y .visitante deben tener la misma cantidad de entradas');
  }
  if (visitante.some((c) => c === null)) {
    errores.push('carreras_por_entrada.visitante no puede tener null: el visitante batea todas las entradas');
  }
  if (local.slice(0, -1).some((c) => c === null)) {
    errores.push('carreras_por_entrada.local solo puede tener null en la última entrada');
  }
  if (partido.marcador && (suma(local) !== partido.marcador.local || suma(visitante) !== partido.marcador.visitante)) {
    errores.push('la suma de carreras por entrada no coincide con el marcador');
  }
  for (const lado of LADOS) {
    const abridores = (partido.estadisticas.lanzadores ?? []).filter((l) => l.equipo === lado && l.abridor);
    if (abridores.length > 1) errores.push(`hay más de un abridor en ${lado}`);
  }
  return errores;
}

const REVISAR_ESTADISTICAS = { futbol: revisarFutbol, basquet: revisarBasquet, beisbol: revisarBeisbol };

function revisarPartidos(ruta, { partidos }, catalogo) {
  const errores = [];
  const ids = new Set();
  partidos.forEach((partido, i) => {
    const agregar = (mensaje) => errores.push(`partidos[${i}]: ${mensaje}`);
    if (ids.has(partido.id)) agregar(`id repetido ${partido.id}`);
    ids.add(partido.id);
    if (rutaPartidos(partido) !== ruta) agregar(`debería estar en ${rutaPartidos(partido)}`);
    if (fechaLocal(partido.inicio) !== partido.fecha_local) {
      agregar(`fecha_local debería ser ${fechaLocal(partido.inicio)} (hora de Lima)`);
    }
    for (const codigo of Object.keys(partido.ids_externos ?? {})) {
      if (!catalogo.casas.has(codigo) && !catalogo.fuentes.has(codigo)) agregar(`ids_externos: código desconocido ${codigo}`);
    }
    if (partido.estado === 'finalizado' && !partido.marcador) agregar('un partido finalizado necesita marcador');
    if (partido.deporte === 'beisbol' && partido.estado === 'finalizado' && partido.marcador
      && partido.marcador.local === partido.marcador.visitante) {
      agregar('en béisbol un partido finalizado no puede terminar empatado');
    }
    if (partido.previa) revisarPrevia(partido, catalogo).forEach((m) => agregar(`previa: ${m}`));
    if (partido.estadisticas) {
      if (partido.estado !== 'finalizado') agregar('solo un partido finalizado puede tener estadísticas');
      if (!catalogo.fuentes.has(partido.estadisticas.fuente)) agregar(`fuente desconocida ${partido.estadisticas.fuente}`);
      REVISAR_ESTADISTICAS[partido.deporte](partido).forEach((m) => agregar(`estadisticas: ${m}`));
    }
  });
  return errores;
}

// ---------------------------------------------------------------- mercados de registros y extracciones

/** Jugador y estadística de un mercado. Devuelve false si falta algo y no tiene sentido seguir revisando. */
function revisarMercado(entrada, mercado, agregar) {
  if (mercado.por_jugador) {
    if (!entrada.jugador || !entrada.estadistica_jugador) {
      agregar('un mercado de jugador necesita jugador y estadistica_jugador');
      return false;
    }
    if (!mercado.estadisticas_jugador.some((e) => e.codigo === entrada.estadistica_jugador)) {
      agregar(`estadística de jugador desconocida ${entrada.estadistica_jugador}`);
    }
  } else if (entrada.jugador || entrada.estadistica_jugador) {
    agregar('jugador y estadistica_jugador solo van en mercados de jugador');
  }
  return true;
}

/** `limites`: [{ hora, mensaje }]. Las cuotas no pueden haberse extraído después de esas horas. */
function revisarOfertas(ofertas, mercado, catalogo, agregar, limites) {
  const casas = new Set();
  ofertas.forEach((oferta, i) => {
    const lugar = `ofertas[${i}]`;
    if (!catalogo.casas.has(oferta.casa)) agregar(`${lugar}: casa desconocida ${oferta.casa}`);
    if (casas.has(oferta.casa)) agregar(`${lugar}: la casa ${oferta.casa} aparece dos veces`);
    casas.add(oferta.casa);
    for (const { hora, mensaje } of limites) {
      if (antes(hora, oferta.extraido_en)) agregar(`${lugar}: ${mensaje}`);
    }
    const lineas = oferta.lineas.map((l) => l.linea);
    if (new Set(lineas).size !== lineas.length) agregar(`${lugar}: hay líneas repetidas`);
    if (tieneLinea(mercado.tipo)) {
      if (lineas.includes(null)) agregar(`${lugar}: este mercado necesita líneas .5`);
    } else if (lineas.length !== 1 || lineas[0] !== null) {
      agregar(`${lugar}: este mercado no lleva línea: debe tener una sola entrada con linea null`);
    }
  });
}

function revisarPrediccion(nombre, prediccion, codigoMercado, agregar) {
  if (prediccion === null || prediccion === undefined) return;
  const { lado, prob_a: probA } = prediccion;
  if ((lado === 'a' && probA < 0.5) || (lado === 'b' && probA > 0.5)) {
    agregar(`${nombre}: el lado ${lado} no coincide con prob_a ${probA}`);
  }
  if (prediccion.prob_roja !== undefined && codigoMercado !== 'futbol_tarjetas') {
    agregar(`${nombre}: prob_roja solo va en futbol_tarjetas`);
  }
}

/** Revisa estadistico, red y entrada_red de un registro o de una predicción de ejemplo. */
function revisarPredicciones(contenedor, codigoMercado, agregar, prefijo = '') {
  revisarPrediccion(`${prefijo}estadistico`, contenedor.estadistico, codigoMercado, agregar);
  revisarPrediccion(`${prefijo}red`, contenedor.red, codigoMercado, agregar);
  if (contenedor.red && !contenedor.entrada_red) {
    agregar(`${prefijo}si hay predicción de la red, debe guardarse entrada_red`);
  }
}

// ---------------------------------------------------------------- historial

function revisarCandidata(registro, catalogo, agregar) {
  const esperada = calcularCandidata(registro.ofertas, catalogo.prioridadCasas);
  if (esperada === null) {
    agregar('candidata: ninguna casa conocida ofrece este mercado');
    return;
  }
  for (const [campo, valor] of Object.entries(esperada)) {
    const guardado = registro.candidata[campo];
    const igual = typeof valor === 'number' && typeof guardado === 'number'
      ? Math.abs(valor - guardado) <= TOLERANCIA
      : valor === guardado;
    if (!igual) agregar(`candidata.${campo} debería ser ${valor} y es ${guardado}`);
  }
}

function revisarResultado(registro, mercado, catalogo, agregar) {
  const { resultado } = registro;
  if (resultado.estado === 'pendiente') return;
  if (antes(resultado.actualizado_en, registro.inicio)) agregar('resultado: no puede actualizarse antes del inicio del partido');
  if (resultado.estado !== 'resuelto') return;
  if (!catalogo.fuentes.has(resultado.fuente)) agregar(`resultado: fuente desconocida ${resultado.fuente}`);
  const valor = resultado.valor_real;
  if (!Number.isInteger(valor)) {
    agregar('resultado: valor_real debe ser un número entero');
    return;
  }
  if (mercado.tipo === 'mas_menos' && valor < 0) agregar('resultado: un total no puede ser negativo');
  try {
    const esperado = ladoGanador(mercado.tipo, registro.candidata.linea, valor);
    if (esperado !== resultado.lado_ganador) {
      agregar(`resultado: con valor_real ${valor} y línea ${registro.candidata.linea} el lado ganador es ${esperado}`);
    }
  } catch (error) {
    agregar(`resultado: ${error.message}`);
  }
}

function revisarHistorial(ruta, { registros }, catalogo) {
  const errores = [];
  const ids = new Set();
  registros.forEach((registro, i) => {
    const agregar = (mensaje) => errores.push(`registros[${i}]: ${mensaje}`);
    if (rutaHistorial(registro) !== ruta) agregar(`debería estar en ${rutaHistorial(registro)}`);
    if (fechaLocal(registro.inicio) !== registro.fecha_local) {
      agregar(`fecha_local debería ser ${fechaLocal(registro.inicio)} (hora de Lima)`);
    }
    const mercado = catalogo.mercados.get(registro.deporte)?.get(registro.mercado);
    if (!mercado) {
      agregar(`el mercado ${registro.mercado} no existe en ${registro.deporte}`);
      return;
    }
    if (!revisarMercado(registro, mercado, agregar)) return;
    const id = idRegistro(registro);
    if (registro.id !== id) agregar(`id debería ser ${id}`);
    if (ids.has(registro.id)) agregar(`id repetido ${registro.id}`);
    ids.add(registro.id);
    if (antes(registro.inicio, registro.analizado_en)) agregar('el análisis debe hacerse antes del inicio del partido');

    revisarOfertas(registro.ofertas, mercado, catalogo, agregar, [
      { hora: registro.analizado_en, mensaje: 'las cuotas no pueden extraerse después del análisis' },
    ]);
    revisarCandidata(registro, catalogo, agregar);
    revisarPredicciones(registro, registro.mercado, agregar);

    if (registro.apuesta) {
      if (!catalogo.casas.has(registro.apuesta.casa)) agregar(`apuesta: casa desconocida ${registro.apuesta.casa}`);
      if (tieneLinea(mercado.tipo) !== (registro.apuesta.linea !== null)) {
        agregar(tieneLinea(mercado.tipo) ? 'apuesta: falta la línea' : 'apuesta: este mercado no lleva línea');
      }
    }
    revisarResultado(registro, mercado, catalogo, agregar);
  });
  return errores;
}

// ---------------------------------------------------------------- equivalencias

function revisarEquivalencias(ruta, contenido, catalogo) {
  const errores = [];
  for (const lista of ['ligas', 'equipos', 'jugadores']) {
    const ids = new Set();
    contenido[lista].forEach((entrada, i) => {
      if (ids.has(entrada.id)) errores.push(`${lista}[${i}]: id repetido ${entrada.id}`);
      ids.add(entrada.id);
      for (const codigo of Object.keys(entrada.alias)) {
        if (!catalogo.casas.has(codigo) && !catalogo.fuentes.has(codigo)) {
          errores.push(`${lista}[${i}].alias: código desconocido ${codigo}`);
        }
      }
    });
  }
  return errores;
}

// ---------------------------------------------------------------- referencias entre archivos

function indexarPartidos(archivos) {
  const errores = [];
  const partidos = new Map();
  for (const { ruta, tipo, contenido } of archivos) {
    if (tipo !== 'partidos') continue;
    contenido.partidos.forEach((partido, i) => {
      const previo = partidos.get(partido.id);
      if (previo) {
        // Los repetidos dentro de un mismo archivo ya los informa revisarPartidos.
        if (previo.ruta !== ruta) errores.push(`${ruta}: partidos[${i}]: el id ${partido.id} ya está en ${previo.ruta}`);
      } else {
        partidos.set(partido.id, { ruta, partido });
      }
    });
  }
  return { partidos, errores };
}

/** Los partidos usados para las estadísticas previas deben estar guardados, finalizados y ser anteriores. */
function revisarUltimosPartidos(partido, partidos, existe, agregar) {
  for (const lado of LADOS) {
    for (const id of partido.previa.ultimos_partidos[lado]) {
      const decir = (mensaje) => agregar(`previa.ultimos_partidos.${lado}: ${id} ${mensaje}`);
      const anterior = partidos.get(id)?.partido;
      if (!existe(id)) decir('no existe en los datos');
      else if (!anterior) continue;
      else if (anterior.deporte !== partido.deporte) decir('es de otro deporte');
      else if (!antes(anterior.inicio, partido.inicio)) decir('no es anterior al partido');
      else if (anterior.estado !== 'finalizado') decir('no está finalizado');
      else if (![anterior.local.id, anterior.visitante.id].includes(partido[lado].id)) decir(`no lo jugó ${partido[lado].nombre}`);
    }
  }
}

function revisarReferencias(archivos, partidos, existe) {
  const errores = [];
  for (const { ruta, partido } of partidos.values()) {
    if (partido.previa) revisarUltimosPartidos(partido, partidos, existe, (m) => errores.push(`${ruta}: ${partido.id}: ${m}`));
  }

  for (const { ruta, tipo, contenido } of archivos) {
    if (tipo !== 'historial') continue;
    contenido.registros.forEach((registro, i) => {
      const agregar = (mensaje) => errores.push(`${ruta}: registros[${i}]: ${mensaje}`);
      const partido = partidos.get(registro.partido_id)?.partido;
      if (!partido) {
        if (!existe(registro.partido_id)) agregar(`el partido ${registro.partido_id} no existe en los datos`);
        return;
      }
      const iguales = [
        ['deporte', registro.deporte, partido.deporte],
        ['inicio', registro.inicio, partido.inicio],
        ['fecha_local', registro.fecha_local, partido.fecha_local],
        ['liga', registro.liga.id, partido.liga.id],
        ['local', registro.local.id, partido.local.id],
        ['visitante', registro.visitante.id, partido.visitante.id],
      ];
      for (const [campo, delRegistro, delPartido] of iguales) {
        if (delRegistro !== delPartido) agregar(`${campo} no coincide con el partido (${delPartido})`);
      }
      if (registro.resultado.estado === 'resuelto' && partido.estado !== 'finalizado') {
        agregar('el resultado está resuelto pero el partido no está finalizado');
      }
    });
  }
  return errores;
}

// ---------------------------------------------------------------- extracciones del día

function revisarExtraccion(ruta, contenido, catalogo, partidosGuardados, existe) {
  const errores = [];
  if (ruta !== `${contenido.fecha_local}.json`) errores.push(`debería llamarse ${contenido.fecha_local}.json`);

  const delDia = new Map();
  contenido.partidos.forEach((partido, i) => {
    const agregar = (mensaje) => errores.push(`partidos[${i}]: ${mensaje}`);
    if (delDia.has(partido.id)) agregar(`id repetido ${partido.id}`);
    delDia.set(partido.id, partido);
    if (partido.fecha_local !== contenido.fecha_local) agregar(`es del ${partido.fecha_local}, no del ${contenido.fecha_local}`);
    if (fechaLocal(partido.inicio) !== partido.fecha_local) {
      agregar(`fecha_local debería ser ${fechaLocal(partido.inicio)} (hora de Lima)`);
    }
    for (const codigo of Object.keys(partido.ids_externos ?? {})) {
      if (!catalogo.casas.has(codigo) && !catalogo.fuentes.has(codigo)) agregar(`ids_externos: código desconocido ${codigo}`);
    }
    if (partido.estadisticas) agregar('una extracción del día no trae estadísticas finales');
    if (partido.previa) {
      revisarPrevia(partido, catalogo).forEach((m) => agregar(`previa: ${m}`));
      if (antes(contenido.generado_en, partido.previa.extraido_en)) {
        agregar('previa: no puede extraerse después de generar la extracción');
      }
      revisarUltimosPartidos(partido, partidosGuardados, existe, agregar);
    }
  });

  const claves = new Set();
  contenido.mercados.forEach((entrada, i) => {
    const agregar = (mensaje) => errores.push(`mercados[${i}]: ${mensaje}`);
    const partido = delDia.get(entrada.partido_id);
    if (!partido) {
      agregar(`el partido ${entrada.partido_id} no está en la extracción`);
      return;
    }
    const mercado = catalogo.mercados.get(partido.deporte)?.get(entrada.mercado);
    if (!mercado) {
      agregar(`el mercado ${entrada.mercado} no existe en ${partido.deporte}`);
      return;
    }
    if (!revisarMercado(entrada, mercado, agregar)) return;
    const clave = idRegistro(entrada);
    if (claves.has(clave)) agregar(`mercado repetido ${clave}`);
    claves.add(clave);
    revisarOfertas(entrada.ofertas, mercado, catalogo, agregar, [
      { hora: contenido.generado_en, mensaje: 'las cuotas no pueden extraerse después de generar la extracción' },
      { hora: partido.inicio, mensaje: 'las cuotas deben extraerse antes del inicio del partido' },
    ]);
    if (calcularCandidata(entrada.ofertas, catalogo.prioridadCasas) === null) {
      agregar('ninguna casa conocida ofrece este mercado');
    }
    if (entrada.prediccion_ejemplo) revisarPredicciones(entrada.prediccion_ejemplo, entrada.mercado, agregar, 'prediccion_ejemplo.');
  });
  return errores;
}

// ---------------------------------------------------------------- índices

/** Diferencias entre un indice.json y los archivos que hay de verdad en su carpeta. */
export function revisarIndice(indice, rutas) {
  const errores = [];
  const listadas = new Set(indice.archivos);
  const existentes = new Set(rutas);
  for (const ruta of rutas) if (!listadas.has(ruta)) errores.push(`falta ${ruta}`);
  for (const ruta of indice.archivos) if (!existentes.has(ruta)) errores.push(`lista ${ruta}, que no existe`);
  const ordenadas = [...indice.archivos].sort();
  if (ordenadas.some((ruta, i) => ruta !== indice.archivos[i])) errores.push('los archivos deben estar en orden alfabético');
  return errores;
}

// ---------------------------------------------------------------- validador

/**
 * Crea el validador.
 * - ajv: instancia de Ajv para JSON Schema 2020-12, con formatos.
 * - esquemas: { nombre: esquema } con los archivos de esquemas/.
 * - config: { mercados, casas } con el contenido de config/.
 * Lanza un error si la configuración no es válida.
 */
export function crearValidador({ ajv, esquemas, config }) {
  for (const nombre of NOMBRES_ESQUEMAS) ajv.addSchema(esquemas[nombre]);
  const esquema = (nombre) => ajv.getSchema(`${URL_ESQUEMAS}${nombre}.schema.json`);

  const problemas = [
    ...erroresDeEsquema(esquema('config-mercados'), config.mercados).map((e) => `config/mercados.json: ${e}`),
    ...erroresDeEsquema(esquema('config-casas'), config.casas).map((e) => `config/casas.json: ${e}`),
  ];
  if (problemas.length === 0) problemas.push(...revisarConfig(config));
  if (problemas.length > 0) throw new Error(`Configuración inválida:\n${problemas.join('\n')}`);

  const catalogo = construirCatalogo(config);
  const revisar = { partidos: revisarPartidos, historial: revisarHistorial, equivalencias: revisarEquivalencias };

  // Las reglas solo se revisan si el archivo cumple el esquema, porque suponen que la estructura es correcta.
  function revisarArchivo(ruta, contenido) {
    const clase = clasificarRuta(ruta);
    if (!clase) return { clase, esquemaValido: false, errores: ['la ruta no corresponde a ningún tipo de archivo de datos'] };
    const errores = erroresDeEsquema(esquema(ESQUEMA_POR_TIPO[clase.tipo]), contenido);
    const esquemaValido = errores.length === 0;
    if (esquemaValido) errores.push(...revisar[clase.tipo](ruta, contenido, catalogo));
    return { clase, esquemaValido, errores };
  }

  /** Errores de un archivo. `ruta` es relativa a la carpeta de datos (historial/futbol/2026/2026-10-11.json). */
  function validarArchivo(ruta, contenido) {
    return revisarArchivo(ruta, contenido).errores.map((e) => `${ruta}: ${e}`);
  }

  // Revisa cada archivo y arma el índice de partidos con los archivos que cumplen el esquema.
  function analizarDatos(archivos) {
    const errores = [];
    const conEsquemaValido = [];
    const idsEnArchivosInvalidos = new Set();
    for (const { ruta, contenido } of archivos) {
      const { clase, esquemaValido, errores: propios } = revisarArchivo(ruta, contenido);
      errores.push(...propios.map((e) => `${ruta}: ${e}`));
      if (esquemaValido) {
        conEsquemaValido.push({ ruta, contenido, tipo: clase.tipo });
      } else if (clase?.tipo === 'partidos' && Array.isArray(contenido?.partidos)) {
        for (const partido of contenido.partidos) {
          if (typeof partido?.id === 'string') idsEnArchivosInvalidos.add(partido.id);
        }
      }
    }
    const { partidos, errores: repetidos } = indexarPartidos(conEsquemaValido);
    errores.push(...repetidos);
    // Si el partido está en un archivo con errores de esquema, ese archivo ya tiene su error:
    // no se repite como "no existe" en cada archivo que lo menciona.
    const existe = (id) => partidos.has(id) || idsEnArchivosInvalidos.has(id);
    return { errores, conEsquemaValido, partidos, existe };
  }

  /** Errores de un conjunto de archivos [{ ruta, contenido }], incluidas las referencias entre ellos. */
  function validarDatos(archivos) {
    const { errores, conEsquemaValido, partidos, existe } = analizarDatos(archivos);
    errores.push(...revisarReferencias(conEsquemaValido, partidos, existe));
    return errores;
  }

  /**
   * Errores de extracciones del día [{ ruta, contenido }] (ruta: AAAA-MM-DD.json).
   * `archivosDatos` es la carpeta de datos contra la que se revisan los partidos previos.
   */
  function validarExtracciones(extracciones, archivosDatos) {
    const { partidos, existe } = analizarDatos(archivosDatos);
    const errores = [];
    for (const { ruta, contenido } of extracciones) {
      const propios = erroresDeEsquema(esquema('extraccion'), contenido);
      if (propios.length === 0) propios.push(...revisarExtraccion(ruta, contenido, catalogo, partidos, existe));
      errores.push(...propios.map((e) => `${ruta}: ${e}`));
    }
    return errores;
  }

  /** Errores de un indice.json comparado con las rutas de los archivos de su carpeta. */
  function validarIndice(contenido, rutas) {
    const errores = erroresDeEsquema(esquema('indice'), contenido);
    if (errores.length === 0) errores.push(...revisarIndice(contenido, rutas));
    return errores.map((e) => `indice.json: ${e}`);
  }

  return { validarArchivo, validarDatos, validarExtracciones, validarIndice, catalogo };
}
