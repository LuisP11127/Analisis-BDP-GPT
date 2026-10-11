// Página principal: partidos del día, resultado del análisis e historial. Los partidos se leen de Sofascore
// y las cuotas de las casas, con la extensión de Brave.

import { NIVELES_CONFIANZA, nivelConfianza, tieneLinea } from '../../comun/reglas.js';
import { analizar, modeloSinAnalisis } from './analisis.js';
import { cargarConfig, cargarHistorial } from './datos.js';
import { equivalenciasVacias } from './equivalencias.js';
import { crearConexion, crearLector } from './extension.js';
import * as f from './formato.js';
import * as apuestaTotal from './fuentes/apuestatotal.js';
import * as betano from './fuentes/betano.js';
import {
  FUENTE as SOFASCORE, cargarLigas, cargarLigasFijas, cargarPartidos as cargarPartidosSofascore, cargarPrevia, codigoPaisDe, rutaFija,
} from './fuentes/sofascore.js';
import { acerto, filtrar, ordenar, resultadoApuesta, resumir, resumirPorConfianza } from './historial.js';
import { SEGUNDOS_POR_PARTIDO, armarExtraccion, hoyEnLima, mercadosDeOfertas, resumenUltimos, seleccionable } from './real.js';
import { html, pintar } from './vista.js';

const PESTANAS = ['partidos', 'resultado', 'historial'];
const POR_PAGINA = 100;
const FILTROS_VACIOS = { desde: '', hasta: '', liga: '', mercado: '' };
const URL_EXTENSION = 'https://github.com/luisp11127/Analisis-BDP-GPT/tree/main/extension#readme';
// Nombres de ligas y equipos en las casas ya confirmados. En el paso 6 se guardarán en datos/equivalencias/.
const CLAVE_EQUIVALENCIAS = 'bdp.equivalencias.futbol';
// Ligas de los partidos analizados la última vez: al abrir la página se leen y sus partidos quedan marcados.
const CLAVE_LIGAS = 'bdp.ligas.real';
const CLAVE_SOLO_POR_JUGAR = 'bdp.solo-por-jugar';

/**
 * Botones de análisis. Mientras no existan el análisis estadístico (paso 5) y la red neuronal (paso 9),
 * los tres leen los mismos datos y el resultado muestra la línea candidata de cada mercado.
 */
const METODOS = {
  estadistico: { metodos: ['estadistico'], titulo: 'Análisis estadístico', boton: 'Análisis estadístico' },
  red: { metodos: ['red'], titulo: 'Análisis con red neuronal', boton: 'Análisis red neuronal' },
  ambos: { metodos: ['estadistico', 'red'], titulo: 'Análisis estadístico y con red neuronal', boton: 'Ambos análisis' },
};

/** Lo leído de Sofascore y de las casas para una fecha. Al cambiar de fecha se empieza uno nuevo. */
const nuevoDia = (fecha) => ({
  fecha,
  // Ligas con partidos ese día, de la lista de torneos de Sofascore; null mientras no se leyeron.
  ligas: null,
  // Ligas que Sofascore tiene fijas para Perú y que juegan ese día, en el orden de Sofascore.
  fijas: new Set(),
  // Estado de los partidos de cada liga: 'cargando', 'lista' o 'error'; el pedido en curso y el error.
  cargadas: new Map(),
  cargas: new Map(),
  erroresLiga: new Map(),
  // Ligas que se marcan apenas se lean sus partidos.
  porMarcar: new Set(),
  partidos: new Map(),
  // Eventos originales de Sofascore por id de partido, para pedir su previa y armar el enlace al partido.
  eventos: new Map(),
  // Partidos anteriores leídos para las previas, por id.
  anteriores: new Map(),
  // Resultado de buscar cada partido en cada casa: código de la casa → Map id de partido → resultado
  // (ver buscarCuotas en fuentes/betano.js y fuentes/apuestatotal.js).
  casas: new Map(),
  seleccion: new Set(),
  abiertas: new Set(),
  extraccion: null,
  progreso: null,
  errores: [],
});

const estado = {
  config: null,
  // undefined: todavía no se buscó; null: no está instalada; si no, { version, sitios }.
  extension: undefined,
  dia: nuevoDia(hoyEnLima()),
  busqueda: '',
  soloPorJugar: false,
  // Avance del análisis en curso: { metodo, hechos, total, texto, cancelado }.
  avance: null,
  // Último análisis: el resultado, el método y el día del que salió.
  analisis: null,
  equivalencias: null,
  historialGuardado: null,
  historialSesion: [],
  historialDeporte: 'futbol',
  filtros: { ...FILTROS_VACIOS },
  mostrados: POR_PAGINA,
};

let conexion = null;
let leerSofascore = null;
// Lectores de cada casa, por código de casa.
const lectores = new Map();
// Ligas fijas de Sofascore para Perú: se piden una vez por sesión.
let pedidoLigasFijas = null;

/**
 * Casas que lee la página con la extensión, en el orden de prioridad de config/casas.json. Para cada una:
 * cómo armar las ligas que necesita su búsqueda y cómo leer las cuotas de un partido elegido a mano.
 */
const CASAS = [
  {
    codigo: betano.CASA,
    nombre: 'Betano',
    modulo: betano,
    // Betano busca la liga por el código de país de la lista de ligas de Sofascore ("england").
    ligas: (dia) => new Map((dia.ligas ?? []).map((l) => [l.id, l])),
    cuotasDe: (obtener, evento) => betano.cargarCuotas(obtener, evento),
  },
  {
    codigo: apuestaTotal.CASA,
    nombre: 'Apuesta Total',
    modulo: apuestaTotal,
    // Apuesta Total usa el código de dos letras ("EN"), que viene en los partidos de Sofascore.
    ligas: (dia, partidos) => new Map(partidos.map((p) => [p.liga.id, { codigoPais: codigoPaisDe(dia.eventos.get(p.id)) }])),
    cuotasDe: async (obtener, evento) => (await apuestaTotal.cargarCuotas(obtener, [evento.id])).get(evento.id) ?? new Map(),
  },
];
const casaDe = (codigo) => CASAS.find((c) => c.codigo === codigo);
function resultadosDe(dia, codigo) {
  if (!dia.casas.has(codigo)) dia.casas.set(codigo, new Map());
  return dia.casas.get(codigo);
}

const $ = (selector) => document.querySelector(selector);
const puedeElegir = (partido) => seleccionable(partido);
const ahoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ocupado = () => Boolean(estado.avance);
const extensionLee = (sitio) => Boolean(estado.extension?.sitios?.includes(sitio));
const minutosDe = (partidos) => Math.max(1, Math.round((partidos * SEGUNDOS_POR_PARTIDO) / 60));

// ---------------------------------------------------------------- preferencias del navegador

function leerPreferencia(clave, porDefecto) {
  try {
    const valor = localStorage.getItem(clave);
    return valor === null ? porDefecto : JSON.parse(valor);
  } catch {
    return porDefecto;
  }
}

function guardarPreferencia(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento disponible: la preferencia simplemente no se recuerda.
  }
}

function equivalencias() {
  estado.equivalencias ??= leerPreferencia(CLAVE_EQUIVALENCIAS, null) ?? equivalenciasVacias();
  return estado.equivalencias;
}

// ---------------------------------------------------------------- consultas

const deporteDe = (codigo) => estado.config.mercados.deportes.find((d) => d.codigo === codigo);
const definicionDe = (deporte, mercado) => deporteDe(deporte).mercados.find((m) => m.codigo === mercado);
const nombreCasa = (codigo) => estado.config.casas.casas.find((c) => c.codigo === codigo)?.nombre ?? codigo;
const historialCompleto = () => [...(estado.historialGuardado ?? []), ...estado.historialSesion];
const deLaSesion = new WeakSet();

function buscarRegistro(id) {
  return estado.historialSesion.find((r) => r.id === id) ?? estado.historialGuardado?.find((r) => r.id === id);
}

// ---------------------------------------------------------------- avisos

function mostrarError(error) {
  const aviso = $('#aviso');
  aviso.className = 'aviso error';
  pintar(aviso, html`<p><strong>No se pudieron leer los datos.</strong> ${error.message}
    Si abriste el archivo directamente desde la carpeta, ábrelo desde GitHub Pages o con <code>npm run pagina</code>.</p>`);
}

function listaErrores(errores, titulo = 'Hubo problemas al leer los datos.') {
  if (errores.length === 0) return '';
  return html`<div class="aviso error" role="alert"><p><strong>${titulo}</strong></p>
    <ul class="errores">${errores.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}

// ---------------------------------------------------------------- piezas comunes

function lineaCandidata(definicion, partido, candidata) {
  const { linea } = candidata;
  return html`<p class="linea-candidata">
    <span>${f.nombreLado(definicion, 'a', partido, linea)} <b class="cuota">${f.cuota(candidata.cuota_a)}</b></span>
    <span aria-hidden="true">·</span>
    <span>${f.nombreLado(definicion, 'b', partido, linea)} <b class="cuota">${f.cuota(candidata.cuota_b)}</b></span>
    <span class="casa">${nombreCasa(candidata.casa)}</span>
  </p>`;
}

function etiquetaNivel(estadistico, prefijo = '') {
  const { nivel, nombre } = nivelConfianza(f.probLado(estadistico));
  return html`<span class="nivel nivel-${nivel}">${prefijo}${prefijo ? nombre.toUpperCase() : nombre}</span>`;
}

/** Predicción de un mercado según los métodos elegidos ('estadistico', 'red' o los dos). */
function prediccion(definicion, partido, linea, estadistico, red, metodos) {
  if (!metodos.includes('estadistico')) {
    if (!red) return html`<p class="prediccion apagado">Red neuronal: sin modelo todavía</p>`;
    return html`<div class="prediccion">
      <p class="prediccion-lado"><strong>${f.nombreLado(definicion, red.lado, partido, linea)}</strong></p>
      <p class="prediccion-confianza">Red ${f.porcentaje(f.probLado(red))}</p>
    </div>`;
  }
  const ladoEst = f.nombreLado(definicion, estadistico.lado, partido, linea);
  const conRed = metodos.includes('red');
  const desacuerdo = conRed && red && red.lado !== estadistico.lado;
  let textoRed = '';
  if (conRed) textoRed = red ? html` · Red ${f.porcentaje(f.probLado(red))}` : html` · <span class="apagado">Red: sin modelo todavía</span>`;
  if (desacuerdo) {
    textoRed = html` · Red: <strong>${f.nombreLado(definicion, red.lado, partido, linea)}</strong> ${f.porcentaje(f.probLado(red))}
      <span class="marca-desacuerdo">⚠️ En desacuerdo</span>`;
  }
  return html`<div class="prediccion${desacuerdo ? ' desacuerdo' : ''}">
    <p class="prediccion-lado"><strong>${ladoEst}</strong></p>
    <p class="prediccion-confianza">${etiquetaNivel(estadistico, 'Confianza ')}
      <span>(estadístico ${f.porcentaje(f.probLado(estadistico))})</span>${textoRed}</p>
  </div>`;
}

function probabilidadRoja(estadistico) {
  if (estadistico?.prob_roja === undefined) return '';
  const p = estadistico.prob_roja;
  return html`<p class="extra">Tarjeta roja en el partido: <strong>${p >= 0.5 ? 'Sí' : 'No'}</strong> — ${f.porcentaje(Math.max(p, 1 - p))}</p>`;
}

function textoLineaTabla(definicion, linea) {
  if (linea === null) return '—';
  return definicion.tipo === 'handicap' ? f.signo(linea) : String(linea);
}

function tablaCuotas(definicion, ofertas, candidata) {
  return html`<div class="tabla-envoltura"><table class="tabla tabla-cuotas">
    <caption>La candidata es la línea con las cuotas más parejas de la casa con más prioridad que ofrece el mercado.</caption>
    <thead><tr>
      <th scope="col">Casa</th>
      <th scope="col">${definicion.tipo === 'handicap' ? 'Línea del local' : 'Línea'}</th>
      <th scope="col">${definicion.lado_a}</th>
      <th scope="col">${definicion.lado_b}</th>
      <th scope="col">Diferencia</th>
      <th scope="col">Margen</th>
    </tr></thead>
    <tbody>${ofertas.flatMap((oferta) => oferta.lineas.map((l) => {
      const esCandidata = oferta.casa === candidata?.casa && l.linea === candidata?.linea;
      const margen = 1 / l.cuota_a + 1 / l.cuota_b - 1;
      return html`<tr class="${esCandidata ? 'candidata' : ''}">
        <td>${nombreCasa(oferta.casa)}${esCandidata ? html` <span class="etiqueta">Candidata</span>` : ''}</td>
        <td>${textoLineaTabla(definicion, l.linea)}</td>
        <td>${f.cuota(l.cuota_a)}</td>
        <td>${f.cuota(l.cuota_b)}</td>
        <td>${Math.abs(l.cuota_a - l.cuota_b).toFixed(2)}</td>
        <td>${(margen * 100).toFixed(1)}%</td>
      </tr>`;
    }))}</tbody>
  </table></div>`;
}

function factores(titulo, modelo) {
  if (!modelo?.explicacion?.length) return '';
  return html`<p class="detalle-titulo">${titulo}</p>
    <ul class="factores">${modelo.explicacion.map((x) => html`<li>${f.nombreFactor(x.factor)} <b>${f.impactoHaciaLado(x.impacto, modelo.lado)}</b></li>`)}</ul>`;
}

function detalle(definicion, ofertas, candidata, estadistico, red) {
  const versiones = [estadistico && `Estadístico: ${estadistico.version}`, red && `Red: ${red.version}`].filter(Boolean).join(' · ');
  return html`<details class="detalle">
    <summary>Detalle</summary>
    ${tablaCuotas(definicion, ofertas, candidata)}
    ${factores('Lo que más pesó en el estadístico', estadistico)}
    ${factores('Lo que más pesó en la red', red)}
    ${versiones ? html`<p class="apagado chico">${versiones}</p>` : ''}
  </details>`;
}

function textoApuesta(definicion, registro) {
  const { apuesta } = registro;
  return `${f.soles(apuesta.monto)} a ${f.nombreLado(definicion, apuesta.lado, registro, apuesta.linea)} @${f.cuota(apuesta.cuota)} (${nombreCasa(apuesta.casa)})`;
}

function apuestaRegistrada(definicion, registro) {
  if (!registro?.apuesta) return '';
  const cambiar = registro.resultado.estado === 'pendiente'
    ? html` <button class="boton enlace" type="button" data-accion="apostar" data-registro="${registro.id}">Cambiar</button>`
    : '';
  return html`<p class="apuesta">Apostaste ${textoApuesta(definicion, registro)}${cambiar}</p>`;
}

// ---------------------------------------------------------------- partidos del día

/** Mensaje en lugar de la lista mientras se busca la extensión o si no está instalada. */
function avisoExtension() {
  if (estado.extension === undefined) return html`<p class="nota">Buscando la extensión de Brave…</p>`;
  if (estado.extension !== null) return null;
  return html`<div class="vacio">
    <h2>Falta la extensión</h2>
    <p>Los partidos se leen de Sofascore con la extensión de Brave. Se instala una sola vez:
      sigue <a href="${URL_EXTENSION}" target="_blank" rel="noopener">estas instrucciones</a> y vuelve a esta página.</p>
    <p class="nota">La extensión solo funciona en la computadora. En el celular puedes ver el historial.</p>
    <div class="acciones inicio">
      <button class="boton principal" type="button" data-accion="buscar-extension">Buscar de nuevo</button>
    </div>
  </div>`;
}

function controlFecha() {
  const bloqueado = ocupado() ? html` disabled` : '';
  const esHoy = estado.dia.fecha === hoyEnLima();
  return html`<div class="control-fecha" role="group" aria-label="Fecha">
    <button class="boton" type="button" data-accion="dia" data-dias="-1" aria-label="Día anterior"${bloqueado}>‹</button>
    <input id="fecha" type="date" aria-label="Fecha" value="${estado.dia.fecha}"${bloqueado}>
    <button class="boton" type="button" data-accion="dia" data-dias="1" aria-label="Día siguiente"${bloqueado}>›</button>
    <button class="boton" type="button" data-accion="hoy"${ocupado() || esHoy ? html` disabled` : ''}>Hoy</button>
  </div>`;
}

function vistaPartidos() {
  const contenedor = $('#vista-partidos');
  const aviso = avisoExtension();
  if (aviso) {
    pintar(contenedor, aviso);
    return;
  }
  const { dia } = estado;
  const ligas = dia.ligas ? ` · ${dia.ligas.length} ligas con partidos este día` : '';
  pintar(contenedor, html`
    <div class="barra-superior">
      ${controlFecha()}
      <span class="marcados" id="marcados" aria-live="polite"></span>
      <div class="botones-analisis" id="botones-analisis"></div>
    </div>
    <p class="nota chico">Fútbol de Sofascore, en hora de Lima${ligas}. Extensión ${estado.extension.version}.
      Los partidos de una liga se leen al abrirla o marcarla. Solo se pueden analizar los que todavía no empiezan.</p>
    ${dia.progreso ? html`<p class="progreso" id="progreso-dia" role="status">${dia.progreso}</p>` : ''}
    ${listaErrores(dia.errores)}
    <div class="herramientas-lista">
      <input id="buscar" class="buscar" type="search" autocomplete="off" placeholder="Buscar liga, país o equipo"
        aria-label="Buscar liga, país o equipo" value="${estado.busqueda}">
      <label class="check"><input id="solo-por-jugar" type="checkbox"${estado.soloPorJugar ? html` checked` : ''}> Solo por jugar</label>
      <button class="boton chico" type="button" data-accion="abrir-todo" title="Abre las ligas cuyos partidos ya se leyeron">Abrir todo</button>
      <button class="boton chico" type="button" data-accion="cerrar-todo">Cerrar todo</button>
      <button class="boton chico" type="button" data-accion="limpiar">Quitar marcas</button>
      <button class="boton chico" type="button" data-accion="recargar" title="Volver a leer las ligas y los partidos"
        aria-label="Volver a leer las ligas y los partidos"${ocupado() ? html` disabled` : ''}>↻</button>
    </div>
    <div id="lista-ligas"></div>`);
  pintarLigas();
}

const normalizar = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Ligas del día con sus partidos: primero las fijas de Sofascore para Perú, en su orden; después las demás
 * por país y nombre. Una liga cuyos partidos todavía no se leyeron trae partidos null y el total de la lista
 * de torneos de Sofascore.
 */
function ligasDelDia() {
  const { dia } = estado;
  if (!dia.ligas) return [];
  const porLiga = new Map();
  for (const partido of dia.partidos.values()) {
    if (!porLiga.has(partido.liga.id)) porLiga.set(partido.liga.id, []);
    porLiga.get(partido.liga.id).push(partido);
  }
  const items = dia.ligas.map((liga) => {
    const estadoLiga = dia.cargadas.get(liga.id) ?? 'sin_leer';
    const partidos = estadoLiga === 'lista'
      ? (porLiga.get(liga.id) ?? []).sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id))
      : null;
    return { liga, total: partidos ? partidos.length : liga.partidos, partidos, estado: estadoLiga, fija: dia.fijas.has(liga.id) };
  });
  const posicion = new Map([...dia.fijas].map((id, i) => [id, i]));
  return [
    ...items.filter((x) => x.fija).sort((a, b) => posicion.get(a.liga.id) - posicion.get(b.liga.id)),
    ...items.filter((x) => !x.fija)
      .sort((a, b) => (a.liga.pais ?? '').localeCompare(b.liga.pais ?? '', 'es') || a.liga.nombre.localeCompare(b.liga.nombre, 'es')),
  ];
}

/** Ligas que se ven con la búsqueda y "Solo por jugar"; en cada una, los partidos que se ven. */
function ligasVisibles() {
  const texto = normalizar(estado.busqueda);
  const visibles = [];
  for (const item of ligasDelDia()) {
    const coincideLiga = !texto || normalizar(`${item.liga.pais ?? ''} ${item.liga.nombre}`).includes(texto);
    let { partidos } = item;
    // Una liga leída sin partidos se sigue viendo, con un aviso, salvo que se filtre.
    const sinPartidos = partidos?.length === 0 && coincideLiga && !estado.soloPorJugar;
    if (partidos && estado.soloPorJugar) partidos = partidos.filter((p) => puedeElegir(p));
    if (partidos && !coincideLiga) partidos = partidos.filter((p) => normalizar(`${p.local.nombre} ${p.visitante.nombre}`).includes(texto));
    if (partidos ? partidos.length === 0 && !sinPartidos : !coincideLiga) continue;
    visibles.push({ ...item, partidos });
  }
  return visibles;
}

const ESTADOS_PARTIDO = {
  programado: 'Ya empezó',
  en_juego: 'En juego',
  finalizado: 'Terminado',
  aplazado: 'Aplazado',
  suspendido: 'Suspendido',
  cancelado: 'Cancelado',
};

function enlaceSofascore(partido) {
  const evento = estado.dia.eventos.get(partido.id);
  if (!evento?.slug || !evento?.customId) return '';
  return html`<a class="enlace-sitio" href="https://www.sofascore.com/football/match/${evento.slug}/${evento.customId}#id:${evento.id}"
    target="_blank" rel="noopener" title="Ver en Sofascore" aria-label="Ver ${partido.local.nombre} vs ${partido.visitante.nombre} en Sofascore">↗</a>`;
}

function filaPartido(partido, conCuotas) {
  const { dia } = estado;
  const cuotas = conCuotas.get(partido.id) ?? 0;
  const buscado = CASAS.some((casa) => resultadosDe(dia, casa.codigo).has(partido.id));
  let etiqueta = '';
  if (!puedeElegir(partido)) etiqueta = html`<span class="etiqueta apagada">${ESTADOS_PARTIDO[partido.estado] ?? 'Ya empezó'}</span>`;
  else if (cuotas) etiqueta = html`<span class="etiqueta">${cuotas} mercados con cuotas</span>`;
  else if (buscado) etiqueta = html`<span class="etiqueta apagada">Sin cuotas</span>`;
  return html`<li class="partido-fila">
    <label class="check">
      <input type="checkbox" data-accion="partido" data-partido="${partido.id}"${puedeElegir(partido) ? '' : html` disabled`}>
      <span class="hora">${f.hora(partido.inicio)}</span>
      <span class="equipos"><span>${partido.local.nombre}</span><span>${partido.visitante.nombre}</span></span>
    </label>
    ${etiqueta}
    ${enlaceSofascore(partido)}
  </li>`;
}

function contenidoLiga({ liga, partidos, estado: estadoLiga }, conCuotas) {
  if (estadoLiga === 'error') {
    return html`<p class="nota chico liga-aviso">No se pudieron leer los partidos: ${estado.dia.erroresLiga.get(liga.id) ?? 'error desconocido'}.
      <button class="boton enlace" type="button" data-accion="abrir-liga" data-liga="${liga.id}" data-reintentar="1">Reintentar</button></p>`;
  }
  if (!partidos) return html`<p class="nota chico liga-aviso">Leyendo los partidos…</p>`;
  if (partidos.length === 0) return html`<p class="nota chico liga-aviso">Sofascore no devolvió partidos de esta liga en esta fecha.</p>`;
  return html`<ul class="lista-partidos">${partidos.map((p) => filaPartido(p, conCuotas))}</ul>`;
}

function seccionLiga(item, conCuotas, buscando) {
  const { liga } = item;
  const abierta = estado.dia.abiertas.has(liga.id) || (buscando && item.partidos !== null);
  return html`<section class="liga">
    <header class="liga-cabecera">
      <input class="casilla-liga" type="checkbox" data-accion="liga" data-liga="${liga.id}" aria-label="Marcar los partidos de ${liga.nombre}">
      <button class="liga-titulo" type="button" data-accion="abrir-liga" data-liga="${liga.id}" aria-expanded="${abierta ? 'true' : 'false'}">
        <span class="flecha" aria-hidden="true">${abierta ? '▾' : '▸'}</span>
        <span class="liga-nombre">${liga.nombre}</span>
        ${liga.pais ? html`<span class="liga-pais">${liga.pais}</span>` : ''}
      </button>
      <span class="liga-cuenta" data-cuenta-liga="${liga.id}">${item.total}</span>
    </header>
    ${abierta ? contenidoLiga(item, conCuotas) : ''}
  </section>`;
}

function pintarLigas() {
  const contenedor = $('#lista-ligas');
  if (!contenedor) return;
  const { dia } = estado;
  if (!dia.ligas) {
    pintar(contenedor, dia.progreso || dia.errores.length ? '' : html`<p class="nota">Todavía no se leyeron las ligas de este día.</p>`);
  } else if (dia.ligas.length === 0) {
    pintar(contenedor, html`<p class="nota">Sofascore no tiene partidos de fútbol en esta fecha.</p>`);
  } else {
    const visibles = ligasVisibles();
    const buscando = Boolean(estado.busqueda.trim());
    const conCuotas = new Map();
    for (const entrada of dia.extraccion?.mercados ?? []) conCuotas.set(entrada.partido_id, (conCuotas.get(entrada.partido_id) ?? 0) + 1);
    const fijas = visibles.filter((x) => x.fija);
    const otras = visibles.filter((x) => !x.fija);
    let vacio = 'No quedan partidos por jugar en las ligas leídas.';
    if (buscando) vacio = 'Nada coincide con la búsqueda. Los equipos se buscan solo en las ligas que ya se leyeron.';
    pintar(contenedor, visibles.length === 0 ? html`<p class="nota">${vacio}</p>` : html`
      ${fijas.length ? html`<h3 class="titulo-grupo">Principales en Sofascore (Perú)</h3>${fijas.map((x) => seccionLiga(x, conCuotas, buscando))}` : ''}
      ${otras.length ? html`<h3 class="titulo-grupo">${fijas.length ? 'Más ligas, por país' : 'Ligas, por país'}</h3>
        ${otras.map((x) => seccionLiga(x, conCuotas, buscando))}` : ''}`);
  }
  actualizarSeleccion();
}

/** Partidos de una liga que ya se leyeron y se pueden elegir. */
function elegiblesDeLiga(dia, idLiga) {
  return [...dia.partidos.values()].filter((p) => p.liga.id === idLiga && puedeElegir(p)).map((p) => p.id);
}

/** Marcas de los partidos y las ligas, cuenta de marcados y botones de análisis, sin volver a pintar la lista. */
function actualizarSeleccion() {
  const { dia } = estado;
  for (const casilla of document.querySelectorAll('[data-accion="partido"]')) casilla.checked = dia.seleccion.has(casilla.dataset.partido);
  const totales = new Map();
  const elegibles = new Map();
  for (const partido of dia.partidos.values()) {
    const id = partido.liga.id;
    totales.set(id, (totales.get(id) ?? 0) + 1);
    if (!elegibles.has(id)) elegibles.set(id, []);
    if (puedeElegir(partido)) elegibles.get(id).push(partido.id);
  }
  for (const casilla of document.querySelectorAll('[data-accion="liga"]')) {
    const id = casilla.dataset.liga;
    if (dia.cargadas.get(id) !== 'lista') {
      // Una liga sin leer se puede marcar: se marca cuando lleguen sus partidos.
      casilla.checked = dia.porMarcar.has(id);
      casilla.indeterminate = false;
      casilla.disabled = false;
      continue;
    }
    const ids = elegibles.get(id) ?? [];
    const marcados = ids.filter((x) => dia.seleccion.has(x)).length;
    casilla.checked = ids.length > 0 && marcados === ids.length;
    casilla.indeterminate = marcados > 0 && marcados < ids.length;
    casilla.disabled = ids.length === 0;
    const cuenta = document.querySelector(`[data-cuenta-liga="${CSS.escape(id)}"]`);
    if (cuenta) cuenta.textContent = marcados ? `${marcados}/${totales.get(id) ?? 0}` : String(totales.get(id) ?? 0);
  }
  const n = dia.seleccion.size;
  const marcados = $('#marcados');
  // Leer la previa de cada partido toma su tiempo: se avisa cuánto, más o menos.
  if (marcados) marcados.textContent = `${n} ${n === 1 ? 'partido marcado' : 'partidos marcados'}${n ? ` · unos ${minutosDe(n)} min` : ''}`;
  const botones = $('#botones-analisis');
  if (botones) {
    const bloqueado = n === 0 || ocupado() ? html` disabled` : '';
    pintar(botones, Object.entries(METODOS).map(([codigo, metodo]) => html`<button class="boton principal" type="button"
      data-accion="analizar" data-metodo="${codigo}"${bloqueado}>${metodo.boton}</button>`));
  }
}

/** Marca o desmarca los partidos de una liga. Si la liga no se leyó, se lee y se marca al llegar sus partidos. */
function marcarLiga(idLiga, marcar) {
  const { dia } = estado;
  if (dia.cargadas.get(idLiga) !== 'lista') {
    if (marcar) dia.porMarcar.add(idLiga);
    else dia.porMarcar.delete(idLiga);
    cargarLiga(dia, idLiga);
  } else {
    for (const id of elegiblesDeLiga(dia, idLiga)) {
      if (marcar) dia.seleccion.add(id);
      else dia.seleccion.delete(id);
    }
  }
  actualizarSeleccion();
}

function abrirLiga(idLiga, reintentar = false) {
  const { dia } = estado;
  if (dia.abiertas.has(idLiga) && !reintentar) dia.abiertas.delete(idLiga);
  else dia.abiertas.add(idLiga);
  if (dia.abiertas.has(idLiga)) cargarLiga(dia, idLiga);
  pintarLigas();
}

/** "Abrir todo" abre solo las ligas que ya se leyeron: abrir otra pide sus partidos a Sofascore. */
function abrirTodo(abrir) {
  const { dia } = estado;
  if (!abrir) dia.abiertas.clear();
  else for (const item of ligasVisibles()) if (item.partidos !== null) dia.abiertas.add(item.liga.id);
  pintarLigas();
}

function pintarSiEstaVisible() {
  if (pestanaActual() === 'partidos') vistaPartidos();
}

/** Muestra qué se está leyendo sin volver a pintar toda la vista. */
function mostrarProgresoDia(dia, texto) {
  if (estado.dia !== dia) return;
  dia.progreso = texto;
  const elemento = $('#progreso-dia');
  if (elemento) elemento.textContent = texto;
  else pintarSiEstaVisible();
}

function leerLigasFijas() {
  pedidoLigasFijas ??= cargarLigasFijas(leerSofascore).catch(() => {
    pedidoLigasFijas = null;
    return [];
  });
  return pedidoLigasFijas;
}

/**
 * Lee las ligas de una fecha y los partidos de las fijas de Sofascore y de las que se analizaron la última
 * vez (estas quedan abiertas y marcadas). Con `conservar`, vuelve a leer la misma fecha y mantiene las ligas
 * abiertas, las leídas y las marcas.
 */
async function leerDia(fecha, { conservar = false } = {}) {
  const anterior = estado.dia;
  const dia = nuevoDia(fecha);
  const releer = conservar ? [...anterior.cargadas].filter(([, e]) => e === 'lista').map(([id]) => id) : [];
  if (conservar) {
    dia.seleccion = new Set(anterior.seleccion);
    dia.abiertas = new Set(anterior.abiertas);
  }
  estado.dia = dia;
  if (!estado.extension) {
    pintarSiEstaVisible();
    return;
  }
  dia.progreso = 'Leyendo las ligas del día en Sofascore…';
  pintarSiEstaVisible();
  try {
    const [ligas, fijas] = await Promise.all([
      cargarLigas(leerSofascore, fecha, { progreso: (pagina) => mostrarProgresoDia(dia, `Leyendo las ligas del día en Sofascore (página ${pagina})…`) }),
      leerLigasFijas(),
    ]);
    if (estado.dia !== dia) return;
    dia.ligas = ligas;
    const delDia = new Set(ligas.map((l) => l.id));
    dia.fijas = new Set(fijas.filter((id) => delDia.has(id)));
  } catch (error) {
    if (estado.dia !== dia) return;
    dia.errores = [`Sofascore: ${error.message}`];
  } finally {
    if (estado.dia === dia) {
      dia.progreso = null;
      pintarSiEstaVisible();
    }
  }
  if (estado.dia !== dia || !dia.ligas) return;
  const delDia = new Set(dia.ligas.map((l) => l.id));
  const recordadas = conservar ? [] : leerPreferencia(CLAVE_LIGAS, []).filter((id) => delDia.has(id));
  if (!conservar) {
    for (const id of recordadas.length ? recordadas : dia.fijas) dia.abiertas.add(id);
    for (const id of recordadas) dia.porMarcar.add(id);
  }
  await Promise.all([...new Set([...recordadas, ...releer, ...dia.fijas])].map((id) => cargarLiga(dia, id)));
  if (conservar && estado.dia === dia) {
    for (const id of [...dia.seleccion]) if (!dia.partidos.has(id) || !puedeElegir(dia.partidos.get(id))) dia.seleccion.delete(id);
    actualizarSeleccion();
  }
}

/** Lee los partidos de una liga. Si ya se están leyendo, devuelve el mismo pedido. */
function cargarLiga(dia, idLiga) {
  if (dia.cargadas.get(idLiga) === 'lista') return Promise.resolve();
  if (dia.cargas.has(idLiga)) return dia.cargas.get(idLiga);
  const liga = dia.ligas?.find((l) => l.id === idLiga);
  if (!liga) return Promise.resolve();
  dia.cargadas.set(idLiga, 'cargando');
  const carga = (async () => {
    try {
      const { partidos, eventos } = await cargarPartidosSofascore(leerSofascore, dia.fecha, [liga]);
      for (const partido of partidos) dia.partidos.set(partido.id, partido);
      for (const [id, evento] of eventos) dia.eventos.set(id, evento);
      dia.cargadas.set(idLiga, 'lista');
      dia.erroresLiga.delete(idLiga);
      if (dia.porMarcar.delete(idLiga)) for (const id of elegiblesDeLiga(dia, idLiga)) dia.seleccion.add(id);
    } catch (error) {
      dia.cargadas.set(idLiga, 'error');
      dia.erroresLiga.set(idLiga, error.message);
      dia.porMarcar.delete(idLiga);
    } finally {
      dia.cargas.delete(idLiga);
    }
    if (estado.dia === dia) pintarLigas();
  })();
  dia.cargas.set(idLiga, carga);
  return carga;
}

/** Cambia la fecha con las flechas, el botón Hoy o el calendario. */
function cambiarFecha(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha === estado.dia.fecha || ocupado()) return;
  leerDia(fecha);
}

function moverFecha(dias) {
  const fecha = new Date(`${estado.dia.fecha}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  cambiarFecha(fecha.toISOString().slice(0, 10));
}

// ---------------------------------------------------------------- análisis

/** Ventana con el avance del análisis. La estructura se pinta al abrirla; después solo cambian la barra y el texto. */
function pintarAvance() {
  const dialogo = $('#dialogo-avance');
  const { avance } = estado;
  if (!avance) {
    if (dialogo.open) dialogo.close();
    return;
  }
  if (!dialogo.open) {
    pintar(dialogo, html`<div class="formulario">
      <h2>${METODOS[avance.metodo].titulo}</h2>
      <progress id="avance-barra" max="1" value="0"></progress>
      <p id="avance-texto" role="status"></p>
      <p class="apagado chico">Se leen los datos previos de cada partido en Sofascore y sus cuotas en las casas.
        Con ${avance.partidos} ${avance.partidos === 1 ? 'partido' : 'partidos'} toma unos ${minutosDe(avance.partidos)} min.</p>
      <div class="acciones"><button class="boton" type="button" data-accion="cancelar-analisis">Cancelar</button></div>
    </div>`);
    dialogo.showModal();
  }
  const barra = $('#avance-barra');
  barra.max = avance.total;
  barra.value = avance.hechos;
  $('#avance-texto').textContent = avance.texto;
}

function cancelarAnalisis() {
  if (!estado.avance) return;
  estado.avance.cancelado = true;
  const boton = $('#dialogo-avance [data-accion="cancelar-analisis"]');
  if (boton) {
    boton.disabled = true;
    boton.textContent = 'Cancelando…';
  }
}

/** Lee la previa de cada partido marcado (con sus últimos partidos) y sus cuotas en las casas, y arma el resultado. */
async function ejecutarAnalisis(codigoMetodo) {
  const { dia } = estado;
  const metodo = Object.hasOwn(METODOS, codigoMetodo) ? codigoMetodo : 'ambos';
  const elegidos = [...dia.partidos.values()]
    .filter((p) => dia.seleccion.has(p.id) && puedeElegir(p))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  if (elegidos.length === 0 || ocupado()) return;
  const casas = CASAS.filter((casa) => extensionLee(casa.codigo));
  const errores = [];
  const avance = { metodo, partidos: elegidos.length, hechos: 0, total: elegidos.length + casas.length, texto: '', cancelado: false };
  estado.avance = avance;
  const contar = (texto) => {
    avance.texto = texto;
    pintarAvance();
  };
  for (const [i, partido] of elegidos.entries()) {
    if (avance.cancelado) break;
    const nombre = `${partido.local.nombre} vs ${partido.visitante.nombre}`;
    const prefijo = `Partido ${i + 1} de ${elegidos.length}: ${nombre}`;
    contar(`${prefijo}…`);
    try {
      const { previa, anteriores } = await cargarPrevia(leerSofascore, partido, dia.eventos.get(partido.id), {
        progreso: (texto) => contar(`${prefijo} · ${texto}…`),
      });
      partido.previa = previa;
      for (const anterior of anteriores) dia.anteriores.set(anterior.id, anterior);
    } catch (error) {
      errores.push(`${nombre}: ${error.message}`);
      // Si Sofascore está rechazando los pedidos, no tiene sentido seguir con los demás partidos.
      if (/rechazó/.test(error.message)) break;
    }
    avance.hechos += 1;
  }
  for (const casa of casas) {
    if (avance.cancelado) break;
    contar(`${casa.nombre}: buscando los partidos…`);
    await leerCuotas(dia, casa, elegidos, errores, contar);
    avance.hechos += 1;
  }
  estado.avance = null;
  pintarAvance();
  if (avance.cancelado) {
    pintarSiEstaVisible();
    return;
  }
  armarResultado(dia, { metodo, seleccion: new Set(elegidos.map((p) => p.id)), errores });
}

/** Busca en una casa los partidos elegidos y lee sus cuotas. Los errores se informan sin detener el análisis. */
async function leerCuotas(dia, casa, partidos, errores, contar) {
  try {
    const resultados = await casa.modulo.buscarCuotas(lectores.get(casa.codigo), partidos, casa.ligas(dia, partidos), equivalencias(), {
      progreso: (texto) => contar(`${casa.nombre}: ${texto}…`),
    });
    for (const [id, resultado] of resultados) resultadosDe(dia, casa.codigo).set(id, resultado);
    guardarPreferencia(CLAVE_EQUIVALENCIAS, equivalencias());
  } catch (error) {
    errores.push(`${casa.nombre}: ${error.message}`);
  }
}

/** Arma la extracción del día con lo leído hasta ahora: partidos, previas y cuotas de las casas. */
function rehacerExtraccion(dia) {
  const partidos = [...dia.partidos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id));
  const mercados = [];
  for (const partido of partidos) {
    const ofertasPorCasa = [];
    for (const casa of CASAS) {
      const resultado = resultadosDe(dia, casa.codigo).get(partido.id);
      if (resultado?.estado !== 'emparejado') continue;
      partido.ids_externos = { ...partido.ids_externos, [casa.codigo]: resultado.evento.id };
      ofertasPorCasa.push(resultado.ofertas ?? new Map());
    }
    mercados.push(...mercadosDeOfertas(partido.id, ...ofertasPorCasa));
  }
  dia.extraccion = armarExtraccion({ fecha: dia.fecha, generadoEn: ahoraIso(), partidos, anteriores: dia.anteriores, mercados });
}

/** Resultado del análisis de los partidos elegidos. Recuerda sus ligas para la próxima vez y muestra el resultado. */
function armarResultado(dia, { metodo, seleccion, errores }) {
  rehacerExtraccion(dia);
  const ahora = dia.extraccion.generado_en;
  const resultado = analizar({ extraccion: dia.extraccion, seleccion, config: estado.config, modelo: modeloSinAnalisis, ahora });
  const anteriores = new Map(estado.historialSesion.map((r) => [r.id, r]));
  for (const registro of resultado.registros) {
    registro.apuesta = anteriores.get(registro.id)?.apuesta ?? null;
    deLaSesion.add(registro);
  }
  const nuevos = new Set(resultado.registros.map((r) => r.id));
  estado.historialSesion = [...estado.historialSesion.filter((r) => !nuevos.has(r.id)), ...resultado.registros];
  estado.analisis = { ...resultado, ahora, fecha: dia.fecha, metodo, seleccion, errores, dia };
  const ligas = new Set(dia.extraccion.partidos.filter((p) => seleccion.has(p.id)).map((p) => p.liga.id));
  guardarPreferencia(CLAVE_LIGAS, [...ligas]);
  if (location.hash === '#resultado') vistaResultado();
  else location.hash = '#resultado';
}

/** El usuario eligió a mano el partido de una casa que corresponde a un partido de Sofascore. */
async function confirmarPartido(codigoCasa, idPartido, idEvento, boton) {
  const { analisis } = estado;
  const casa = casaDe(codigoCasa);
  const partido = analisis?.dia.partidos.get(idPartido);
  const anterior = analisis && resultadosDe(analisis.dia, codigoCasa).get(idPartido);
  const evento = anterior?.eventosLiga?.find((e) => e.id === idEvento);
  if (!casa || !partido || !evento) return;
  boton.disabled = true;
  boton.textContent = 'Leyendo cuotas…';
  try {
    const ofertas = await casa.cuotasDe(lectores.get(codigoCasa), evento);
    resultadosDe(analisis.dia, codigoCasa).set(idPartido, { ...anterior, estado: 'emparejado', evento, ofertas });
    casa.modulo.recordarEquipos(equivalencias(), partido, evento, ahoraIso());
    guardarPreferencia(CLAVE_EQUIVALENCIAS, equivalencias());
  } catch (error) {
    analisis.errores.push(`${casa.nombre}: ${error.message}`);
  }
  armarResultado(analisis.dia, analisis);
}

/** Descarga lo leído en el formato de la extracción del día, para revisarlo o compartirlo. */
function descargarExtraccion() {
  const { extraccion } = estado.analisis.dia;
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([JSON.stringify(extraccion, null, 2)], { type: 'application/json' }));
  enlace.download = `${extraccion.fecha_local}.json`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 10000);
}

// ---------------------------------------------------------------- datos de Sofascore en el resultado

const MOTIVOS_BAJA = { lesion: 'lesión', sancion: 'sanción', duda: 'duda', otro: 'otro motivo', desconocido: 'motivo no indicado' };
const LADOS_PARTIDO = ['local', 'visitante'];

function textoTabla(partido) {
  const { tabla } = partido.previa;
  if (!tabla) return 'Sofascore no tiene tabla de esta competición.';
  const linea = (lado) => {
    const fila = tabla[lado];
    return `${partido[lado].nombre}: ${fila.posicion ? `${fila.posicion}.º` : 'sin posición'}, ${fila.partidos_jugados ?? '—'} PJ, ${fila.puntos ?? '—'} pts`;
  };
  return `${linea('local')} · ${linea('visitante')}`;
}

function textoArbitro(arbitro) {
  if (!arbitro) return 'Sofascore todavía no lo tiene designado.';
  const { partidos, amarillas, rojas } = arbitro.estadisticas ?? {};
  if (!partidos) return arbitro.nombre;
  const promedios = [
    amarillas === undefined ? null : `${(amarillas / partidos).toFixed(1)} amarillas`,
    rojas === undefined ? null : `${(rojas / partidos).toFixed(2)} rojas`,
  ].filter(Boolean);
  return `${arbitro.nombre} · ${promedios.join(' y ')} por partido en ${partidos} partidos`;
}

function textoBajas(partido) {
  const { bajas } = partido.previa;
  if (!bajas) return 'Sofascore todavía no tiene la alineación de este partido.';
  if (bajas.length === 0) return 'Sofascore no informa bajas.';
  return LADOS_PARTIDO.map((lado) => {
    const delEquipo = bajas.filter((b) => b.equipo === lado);
    if (delEquipo.length === 0) return null;
    const nombres = delEquipo.map((b) => `${b.jugador.nombre} (${MOTIVOS_BAJA[b.motivo]}${b.detalle ? `: ${b.detalle}` : ''})`);
    return `${partido[lado].nombre}: ${nombres.join(', ')}`;
  }).filter(Boolean).join(' · ');
}

function alineacion(partido) {
  const probables = partido.previa.alineaciones_probables;
  if (!probables) return '';
  return html`<p><strong>Alineación ${probables.confirmadas ? 'confirmada' : 'probable'}:</strong></p>
    <ul class="factores">${LADOS_PARTIDO.map((lado) => html`<li>${partido[lado].nombre}: ${probables[lado].map((j) => j.nombre).join(', ') || '—'}</li>`)}</ul>`;
}

const COLUMNAS_ULTIMOS = [['goles', 'Goles'], ['corners', 'Corners'], ['tarjetas', 'Tarjetas'], ['tiros', 'Tiros al arco'], ['remates', 'Remates']];

function tablaUltimos(partido, lado, anteriores) {
  const { filas, promedios } = resumenUltimos(partido, lado, anteriores);
  const equipo = partido[lado].nombre;
  const titulo = `Últimos ${filas.length} de ${equipo} ${lado === 'local' ? 'de local' : 'de visita'}`;
  if (filas.length === 0) return html`<p class="detalle-titulo">${titulo}</p><p class="apagado chico">Sofascore no tiene partidos anteriores.</p>`;
  const par = ([propio, rival]) => (propio === null && rival === null ? '—' : `${propio ?? '—'}-${rival ?? '—'}`);
  const promedio = ([propio, rival]) => (propio || rival ? `${propio ? propio.valor.toFixed(1) : '—'}-${rival ? rival.valor.toFixed(1) : '—'}` : '—');
  return html`<p class="detalle-titulo">${titulo}</p>
    <div class="tabla-envoltura"><table class="tabla tabla-ultimos">
      <caption>Cada dato es a favor-en contra de ${equipo}, en el tiempo reglamentario. Las tarjetas se cuentan como en Betano.</caption>
      <thead><tr><th scope="col">Fecha</th><th scope="col">Rival</th>${COLUMNAS_ULTIMOS.map(([, nombre]) => html`<th scope="col">${nombre}</th>`)}</tr></thead>
      <tbody>${filas.map((fila) => html`<tr>
        <td data-titulo="Fecha"><div>${f.fechaCorta(fila.fecha)}</div></td>
        <td data-titulo="Rival"><div>${fila.rival} <span class="apagado chico bloque">${fila.liga}</span></div></td>
        ${COLUMNAS_ULTIMOS.map(([campo, nombre]) => html`<td data-titulo="${nombre}"><div>${par(fila[campo])}</div></td>`)}
      </tr>`)}</tbody>
      <tfoot><tr><th scope="row" colspan="2">Promedio</th>
        ${COLUMNAS_ULTIMOS.map(([campo, nombre]) => html`<td data-titulo="${nombre}"><div>${promedio(promedios[campo])}</div></td>`)}</tr></tfoot>
    </table></div>`;
}

function datosSofascore(partido, dia) {
  if (!partido.previa) return html`<p class="apagado chico">No se pudieron leer los datos previos de este partido.</p>`;
  return html`<details class="detalle datos-fuente">
    <summary>Datos de Sofascore</summary>
    <p><strong>Tabla:</strong> ${textoTabla(partido)}</p>
    <p><strong>Árbitro:</strong> ${textoArbitro(partido.previa.arbitro)}</p>
    <p><strong>Bajas:</strong> ${textoBajas(partido)}</p>
    ${alineacion(partido)}
    ${tablaUltimos(partido, 'local', dia.anteriores)}
    ${tablaUltimos(partido, 'visitante', dia.anteriores)}
    <p class="apagado chico">Leído a las ${f.hora(partido.previa.extraido_en)}.</p>
  </details>`;
}

/** Qué pasó al buscar el partido en una casa; si no es seguro, permite elegirlo a mano. */
function estadoCasa(casa, partido, dia) {
  const clase = 'chico casa-estado';
  const { nombre } = casa;
  if (!extensionLee(casa.codigo)) {
    return html`<p class="apagado ${clase}">${nombre}: para leer sus cuotas hay que actualizar la extensión
      (<a href="${URL_EXTENSION}" target="_blank" rel="noopener">instrucciones</a>).</p>`;
  }
  const resultados = resultadosDe(dia, casa.codigo);
  const resultado = resultados.get(partido.id);
  if (!resultado) return html`<p class="apagado ${clase}">${nombre}: no se buscó este partido.</p>`;
  const nombreDeLiga = (liga) => casa.modulo.nombreDeLiga(liga);
  if (resultado.estado === 'emparejado') {
    const cantidad = resultado.ofertas?.size ?? 0;
    return html`<p class="${clase}">${nombre}: ${resultado.evento.nombre} · ${nombreDeLiga(resultado.liga)} ·
      ${cantidad ? `${cantidad} de ${deporteDe(partido.deporte).mercados.length} mercados` : 'todavía sin los mercados del análisis'}</p>`;
  }
  if (resultado.estado === 'sin_liga') return html`<p class="apagado ${clase}">${nombre}: no se encontró esta liga.</p>`;
  const inicio = Date.parse(partido.inicio);
  // No se ofrecen los partidos de la casa que ya quedaron emparejados con otro partido de Sofascore.
  const usados = new Set([...resultados].filter(([id, r]) => id !== partido.id && r.estado === 'emparejado').map(([, r]) => r.evento.id));
  const eventos = (resultado.eventosLiga ?? []).filter((e) => !usados.has(e.id))
    .sort((a, b) => Math.abs(Date.parse(a.inicio) - inicio) - Math.abs(Date.parse(b.inicio) - inicio));
  const motivo = resultado.estado === 'dudoso'
    ? 'no es seguro cuál es el partido.'
    : `no hay un partido a esa hora en ${nombreDeLiga(resultado.liga)}.`;
  if (eventos.length === 0) return html`<p class="apagado ${clase}">${nombre}: ${motivo}</p>`;
  return html`<form class="${clase} confirmar-casa" onsubmit="return false">
    <label class="campo">${nombre}: ${motivo} Elige el que corresponde
      <select name="evento">${eventos.map((e) => html`<option value="${e.id}"${e.id === resultado.evento?.id ? html` selected` : ''}>${f.fechaHora(e.inicio)} · ${e.nombre}</option>`)}</select>
    </label>
    <button class="boton chico" type="button" data-accion="confirmar-casa" data-casa="${casa.codigo}" data-partido="${partido.id}">Usar este partido</button>
  </form>`;
}

// ---------------------------------------------------------------- resultado

const FALTA_METODO = {
  estadistico: 'Análisis estadístico: falta construirlo (paso 5)',
  red: 'Red neuronal: falta construirla (paso 9)',
};

function filaDeMercado(definicion, partido, fila, titulo, metodos) {
  const { entrada, candidata, prediccion: pred, registro } = fila;
  const estadistico = registro?.estadistico ?? pred.estadistico;
  const red = registro?.red ?? pred.red;
  const puedeApostar = registro && registro.resultado.estado === 'pendiente' && !registro.apuesta;
  return html`
    <div class="mercado-cabecera">
      ${titulo}
      ${puedeApostar ? html`<button class="boton chico" type="button" data-accion="apostar" data-registro="${registro.id}">Registrar apuesta</button>` : ''}
    </div>
    ${lineaCandidata(definicion, partido, candidata)}
    ${registro
      ? prediccion(definicion, partido, candidata.linea, estadistico, red, metodos)
      : html`<p class="prediccion apagado">${metodos.map((m) => FALTA_METODO[m]).join(' · ')}</p>`}
    ${probabilidadRoja(estadistico)}
    ${apuestaRegistrada(definicion, registro)}
    ${detalle(definicion, entrada.ofertas, candidata, estadistico, red)}`;
}

function mercadoDelPartido(partido, { definicion, filas }, metodos) {
  if (filas.length === 0) {
    return html`<li class="mercado sin-cuotas"><span class="mercado-nombre">${definicion.nombre}</span> <span class="apagado">Sin cuotas</span></li>`;
  }
  if (definicion.por_jugador) {
    return html`<li class="mercado">
      <span class="mercado-nombre">${definicion.nombre}</span>
      <ul class="props">${filas.map((fila) => html`<li class="prop">
        ${filaDeMercado(definicion, partido, fila, html`<span class="prop-jugador">${fila.entrada.jugador.nombre}
          <span class="apagado">(${fila.entrada.jugador.equipo === 'local' ? partido.local.nombre : partido.visitante.nombre})</span>
          · ${f.nombreEstadisticaJugador(definicion, fila.entrada.estadistica_jugador)}</span>`, metodos)}
      </li>`)}</ul>
    </li>`;
  }
  return html`<li class="mercado">${filaDeMercado(definicion, partido, filas[0], html`<span class="mercado-nombre">${definicion.nombre}</span>`, metodos)}</li>`;
}

function notaMetodo(metodos) {
  const faltan = [
    metodos.includes('estadistico') ? 'el análisis estadístico (paso 5)' : null,
    metodos.includes('red') ? 'la red neuronal, que se entrena con el historial (paso 9)' : null,
  ].filter(Boolean);
  return `Todavía falta construir ${faltan.join(' y ')}. Por ahora se ven los datos leídos de Sofascore y la línea
    candidata de cada mercado con las cuotas de Betano y Apuesta Total.`;
}

function vistaResultado() {
  const contenedor = $('#vista-resultado');
  if (!estado.analisis) {
    pintar(contenedor, html`<div class="vacio">
      <h2>Resultado</h2>
      <p>Todavía no hay un análisis. Marca partidos en <strong>Partidos del día</strong> y pulsa uno de los botones de análisis.</p>
      <a class="boton principal" href="#partidos">Ir a partidos del día</a>
    </div>`);
    return;
  }
  const { deportes, ahora, fecha, metodo, seleccion, errores, dia } = estado.analisis;
  const { metodos, titulo } = METODOS[metodo];
  const partidos = deportes.reduce((n, d) => n + d.partidos.length, 0);
  const conCuotas = dia.extraccion.mercados.filter((m) => seleccion.has(m.partido_id)).length;
  pintar(contenedor, html`
    <div class="encabezado-vista">
      <h2>${titulo}</h2>
      <p class="resumen">${f.capitalizar(f.fechaLarga(fecha))} · ${partidos} ${partidos === 1 ? 'partido' : 'partidos'} ·
        ${conCuotas} ${conCuotas === 1 ? 'mercado' : 'mercados'} con cuotas · hecho a las ${f.hora(ahora)}</p>
      <p class="nota">${notaMetodo(metodos)}</p>
      ${listaErrores(errores)}
      <p><button class="boton" type="button" data-accion="descargar">Descargar los datos leídos (JSON)</button></p>
    </div>
    ${deportes.map(({ deporte, partidos: lista }) => html`<section class="deporte">
      <h2 class="deporte-titulo">${deporte.nombre}</h2>
      ${lista.map(({ partido, mercados }) => html`<article class="partido">
        <header class="partido-cabecera">
          <p class="partido-liga">${partido.liga.nombre} · ${f.fechaHora(partido.inicio)}</p>
          <h3 class="partido-equipos">${partido.local.nombre} <span class="vs">vs</span> ${partido.visitante.nombre}</h3>
        </header>
        ${datosSofascore(partido, dia)}${CASAS.map((casa) => estadoCasa(casa, partido, dia))}
        <ol class="mercados">${mercados.map((m) => mercadoDelPartido(partido, m, metodos))}</ol>
      </article>`)}
    </section>`)}`);
}

// ---------------------------------------------------------------- historial

async function vistaHistorial() {
  const contenedor = $('#vista-historial');
  if (estado.historialGuardado === null) {
    pintar(contenedor, html`<p class="nota">Cargando el historial…</p>`);
    try {
      estado.historialGuardado = await cargarHistorial();
    } catch (error) {
      mostrarError(error);
      estado.historialGuardado = [];
    }
  }
  pintar(contenedor, html`
    <div class="encabezado-vista">
      <h2>Historial</h2>
    </div>
    <div class="selector-deporte" id="historial-deportes" role="group" aria-label="Deporte"></div>
    <form class="filtros" id="historial-filtros" onsubmit="return false"></form>
    <div id="historial-contenido"></div>`);
  pintarDeportesHistorial();
  pintarFiltros();
  pintarContenidoHistorial();
}

function pintarDeportesHistorial() {
  const todos = historialCompleto();
  pintar($('#historial-deportes'), estado.config.mercados.deportes.map((d) => html`<button class="pildora" type="button"
    aria-pressed="${d.codigo === estado.historialDeporte ? 'true' : 'false'}" data-accion="historial-deporte" data-deporte="${d.codigo}">
    ${d.nombre} <span class="contador">${todos.filter((r) => r.deporte === d.codigo).length}</span></button>`));
}

function pintarFiltros() {
  const deporte = deporteDe(estado.historialDeporte);
  const registros = historialCompleto().filter((r) => r.deporte === deporte.codigo);
  const ligas = [...new Map(registros.map((r) => [r.liga.id, r.liga])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const fechas = registros.map((r) => r.fecha_local).sort();
  const { desde, hasta, liga, mercado } = estado.filtros;
  const opcion = (valor, texto, actual) => html`<option value="${valor}"${valor === actual ? html` selected` : ''}>${texto}</option>`;
  pintar($('#historial-filtros'), html`
    <label class="campo">Desde <input type="date" name="desde" value="${desde}" min="${fechas[0] ?? ''}" max="${fechas.at(-1) ?? ''}"></label>
    <label class="campo">Hasta <input type="date" name="hasta" value="${hasta}" min="${fechas[0] ?? ''}" max="${fechas.at(-1) ?? ''}"></label>
    <label class="campo">Liga <select name="liga">${opcion('', 'Todas', liga)}${ligas.map((l) => opcion(l.id, l.nombre, liga))}</select></label>
    <label class="campo">Mercado <select name="mercado">${opcion('', 'Todos', mercado)}${deporte.mercados.map((m) => opcion(m.codigo, m.nombre, mercado))}</select></label>
    <button class="boton" type="button" data-accion="limpiar-filtros">Limpiar filtros</button>`);
}

function textoAcierto(cantidad) {
  if (cantidad.total === 0) return '—';
  return `${f.porcentaje(cantidad.aciertos / cantidad.total)} (${cantidad.aciertos}/${cantidad.total})`;
}

function tablaResumen(resumen) {
  const fila = (nombre, x, clase = '') => html`<tr class="${clase}">
    <th scope="row">${nombre}</th>
    <td data-titulo="Registros"><div>${x.total}</div></td>
    <td data-titulo="Resueltos"><div>${x.resueltos}${x.pendientes ? html` <span class="apagado">· ${x.pendientes} pend.</span>` : ''}${x.anulados ? html` <span class="apagado">· ${x.anulados} anul.</span>` : ''}</div></td>
    <td data-titulo="Acierto estadístico"><div>${textoAcierto(x.estadistico)}</div></td>
    <td data-titulo="Acierto red"><div>${textoAcierto(x.red)}</div></td>
    <td data-titulo="Apuestas"><div>${x.apuestas.cantidad || '—'}</div></td>
    <td data-titulo="Ganancia" class="${x.apuestas.ganancia > 0 ? 'positivo' : x.apuestas.ganancia < 0 ? 'negativo' : ''}"><div>
      ${x.apuestas.resueltas ? f.soles(x.apuestas.ganancia, { conSigno: true }) : '—'}</div></td>
  </tr>`;
  return html`<h3 class="subtitulo">Resumen por mercado</h3>
    <div class="tabla-envoltura"><table class="tabla tabla-resumen">
      <thead><tr>
        <th scope="col">Mercado</th><th scope="col">Registros</th><th scope="col">Resueltos</th>
        <th scope="col">Acierto estadístico</th><th scope="col">Acierto red</th><th scope="col">Apuestas</th><th scope="col">Ganancia</th>
      </tr></thead>
      <tbody>${resumen.filas.map((x) => fila(x.definicion.nombre, x))}</tbody>
      <tfoot>${fila('Total', resumen.total, 'total')}</tfoot>
    </table></div>
    <p class="apagado chico">El acierto cuenta solo los resultados resueltos. La ganancia es la de las apuestas registradas.</p>`;
}

function tablaPorConfianza(filas) {
  if (filas.length === 0) return '';
  const cortes = NIVELES_CONFIANZA.map((n, i) => {
    const hasta = i === 0 ? null : NIVELES_CONFIANZA[i - 1].desde - 1;
    if (hasta === null) return `${n.nombre.toLowerCase()} desde ${n.desde}%`;
    return n.desde === 0 ? `${n.nombre.toLowerCase()} por debajo de ${NIVELES_CONFIANZA[i - 1].desde}%` : `${n.nombre.toLowerCase()} de ${n.desde}% a ${hasta}%`;
  });
  return html`<h3 class="subtitulo">Acierto por nivel de confianza</h3>
    <div class="tabla-envoltura"><table class="tabla tabla-resumen">
      <thead><tr>
        <th scope="col">Nivel</th><th scope="col">Registros</th><th scope="col">Resueltos</th>
        <th scope="col">Acierto estadístico</th><th scope="col">Apuestas</th><th scope="col">Ganancia</th>
      </tr></thead>
      <tbody>${filas.map((x) => html`<tr>
        <th scope="row"><span class="nivel nivel-${x.nivel.nivel}">${x.nivel.nombre}</span></th>
        <td data-titulo="Registros"><div>${x.total}</div></td>
        <td data-titulo="Resueltos"><div>${x.resueltos}${x.pendientes ? html` <span class="apagado">· ${x.pendientes} pend.</span>` : ''}</div></td>
        <td data-titulo="Acierto estadístico"><div>${textoAcierto(x.estadistico)}</div></td>
        <td data-titulo="Apuestas"><div>${x.apuestas.cantidad || '—'}</div></td>
        <td data-titulo="Ganancia" class="${x.apuestas.ganancia > 0 ? 'positivo' : x.apuestas.ganancia < 0 ? 'negativo' : ''}"><div>
          ${x.apuestas.resueltas ? f.soles(x.apuestas.ganancia, { conSigno: true }) : '—'}</div></td>
      </tr>`)}</tbody>
    </table></div>
    <p class="apagado chico">El nivel sale de la probabilidad del estadístico: ${cortes.join(', ')}.</p>`;
}

function marcaAcierto(valor) {
  if (valor === null) return '';
  return valor
    ? html` <span class="marca acierto" title="Acertó">✓<span class="solo-lector"> acertó</span></span>`
    : html` <span class="marca fallo" title="Falló">✗<span class="solo-lector"> falló</span></span>`;
}

function celdaModelo(definicion, registro, modelo, conNivel = false) {
  if (!modelo) return html`<span class="apagado">—</span>`;
  const lado = f.nombreLado(definicion, modelo.lado, registro, registro.candidata.linea);
  return html`${lado} ${f.porcentaje(f.probLado(modelo))}${conNivel ? html` ${etiquetaNivel(modelo)}` : ''}${marcaAcierto(acerto(modelo, registro.resultado))}`;
}

function celdaResultado(definicion, registro) {
  const { resultado } = registro;
  if (resultado.estado === 'pendiente') return html`<span class="apagado">Pendiente</span>`;
  if (resultado.estado === 'anulado') return html`<span class="apagado">Anulado: ${resultado.motivo}</span>`;
  return html`${f.textoValorReal(definicion, registro)} → <strong>${f.nombreLado(definicion, resultado.lado_ganador, registro, registro.candidata.linea)}</strong>`;
}

function celdaApuesta(definicion, registro) {
  const estadoApuesta = resultadoApuesta(registro, definicion.tipo);
  if (!estadoApuesta) {
    return registro.resultado.estado === 'pendiente'
      ? html`<button class="boton chico" type="button" data-accion="apostar" data-registro="${registro.id}">Registrar</button>`
      : html`<span class="apagado">—</span>`;
  }
  const textos = {
    pendiente: html`<span class="apagado">pendiente</span>`,
    anulada: html`<span class="apagado">anulada</span>`,
    ganada: html`<span class="positivo">ganada ${f.soles(estadoApuesta.ganancia, { conSigno: true })}</span>`,
    perdida: html`<span class="negativo">perdida ${f.soles(estadoApuesta.ganancia, { conSigno: true })}</span>`,
  };
  const cambiar = registro.resultado.estado === 'pendiente'
    ? html` <button class="boton enlace" type="button" data-accion="apostar" data-registro="${registro.id}">Cambiar</button>`
    : '';
  return html`${textoApuesta(definicion, registro)} · ${textos[estadoApuesta.estado]}${cambiar}`;
}

function filaHistorial(registro) {
  const definicion = definicionDe(registro.deporte, registro.mercado);
  const { candidata } = registro;
  const desacuerdo = registro.red && registro.red.lado !== registro.estadistico.lado;
  return html`<tr>
    <td data-titulo="Hora"><div>${f.hora(registro.inicio)}${deLaSesion.has(registro) ? html` <span class="etiqueta">Esta sesión</span>` : ''}</div></td>
    <td data-titulo="Partido"><div>${registro.local.nombre} <span class="vs">vs</span> ${registro.visitante.nombre}
      <span class="apagado chico bloque">${registro.liga.nombre}</span></div></td>
    <td data-titulo="Mercado"><div>${definicion.nombre}${registro.jugador ? ` · ${registro.jugador.nombre} · ${f.nombreEstadisticaJugador(definicion, registro.estadistica_jugador)}` : ''}
      <span class="apagado chico bloque">${f.nombreLado(definicion, 'a', registro, candidata.linea)} ${f.cuota(candidata.cuota_a)} ·
        ${f.nombreLado(definicion, 'b', registro, candidata.linea)} ${f.cuota(candidata.cuota_b)} · ${nombreCasa(candidata.casa)}</span></div></td>
    <td data-titulo="Estadístico"><div>${celdaModelo(definicion, registro, registro.estadistico, true)}</div></td>
    <td data-titulo="Red"><div>${celdaModelo(definicion, registro, registro.red)}${desacuerdo ? html` <span class="marca-desacuerdo" title="En desacuerdo">⚠️</span>` : ''}</div></td>
    <td data-titulo="Resultado"><div>${celdaResultado(definicion, registro)}</div></td>
    <td data-titulo="Apuesta"><div>${celdaApuesta(definicion, registro)}</div></td>
  </tr>`;
}

function pintarContenidoHistorial() {
  const contenedor = $('#historial-contenido');
  if (!contenedor) return;
  const deporte = deporteDe(estado.historialDeporte);
  const todos = historialCompleto().filter((r) => r.deporte === deporte.codigo);
  if (todos.length === 0) {
    pintar(contenedor, html`<p class="nota">Todavía no hay registros guardados. El historial se empieza a guardar en el paso 6.</p>`);
    return;
  }
  const filtrados = filtrar(todos, { deporte: deporte.codigo, ...estado.filtros });
  const ordenados = ordenar(filtrados, deporte.mercados.map((m) => m.codigo));
  const visibles = ordenados.slice(0, estado.mostrados);
  const porFecha = new Map();
  for (const registro of visibles) {
    if (!porFecha.has(registro.fecha_local)) porFecha.set(registro.fecha_local, []);
    porFecha.get(registro.fecha_local).push(registro);
  }
  pintar(contenedor, html`
    ${tablaResumen(resumir(filtrados, deporte.mercados))}
    ${tablaPorConfianza(resumirPorConfianza(filtrados, deporte.mercados))}
    <h3 class="subtitulo">Registros <span class="apagado">(${filtrados.length})</span></h3>
    ${filtrados.length === 0 ? html`<p class="nota">Ningún registro cumple los filtros.</p>` : ''}
    ${[...porFecha.entries()].map(([fecha, lista]) => html`<section class="dia">
      <h4 class="dia-titulo">${f.capitalizar(f.fechaLarga(fecha))}</h4>
      <div class="tabla-envoltura"><table class="tabla tabla-historial">
        <thead><tr>
          <th scope="col">Hora</th><th scope="col">Partido</th><th scope="col">Mercado</th><th scope="col">Estadístico y confianza</th>
          <th scope="col">Red</th><th scope="col">Resultado</th><th scope="col">Apuesta</th>
        </tr></thead>
        <tbody>${lista.map(filaHistorial)}</tbody>
      </table></div>
    </section>`)}
    ${ordenados.length > visibles.length ? html`<button class="boton" type="button" data-accion="mostrar-mas">
      Mostrar más (${ordenados.length - visibles.length} restantes)</button>` : ''}`);
}

function leerFiltros() {
  const formulario = $('#historial-filtros');
  const datos = new FormData(formulario);
  estado.filtros = {
    desde: datos.get('desde') ?? '',
    hasta: datos.get('hasta') ?? '',
    liga: datos.get('liga') ?? '',
    mercado: datos.get('mercado') ?? '',
  };
  estado.mostrados = POR_PAGINA;
  pintarContenidoHistorial();
}

// ---------------------------------------------------------------- apuestas

function abrirDialogoApuesta(id) {
  const registro = buscarRegistro(id);
  if (!registro || registro.resultado.estado !== 'pendiente') return;
  const definicion = definicionDe(registro.deporte, registro.mercado);
  const conLinea = tieneLinea(definicion.tipo);
  const actual = registro.apuesta ?? {
    casa: registro.candidata.casa,
    linea: registro.candidata.linea,
    lado: registro.estadistico.lado,
    cuota: registro.estadistico.lado === 'a' ? registro.candidata.cuota_a : registro.candidata.cuota_b,
    monto: '',
  };
  const dialogo = $('#dialogo-apuesta');
  pintar(dialogo, html`<form method="dialog" class="formulario" id="form-apuesta">
    <h2>Registrar apuesta</h2>
    <p class="apagado">${registro.local.nombre} vs ${registro.visitante.nombre} · ${definicion.nombre}${registro.jugador ? ` · ${registro.jugador.nombre} · ${f.nombreEstadisticaJugador(definicion, registro.estadistica_jugador)}` : ''}</p>
    <label class="campo">Casa
      <select name="casa">${registro.ofertas.map((o) => html`<option value="${o.casa}"${o.casa === actual.casa ? html` selected` : ''}>${nombreCasa(o.casa)}</option>`)}</select>
    </label>
    ${conLinea ? html`<label class="campo">${definicion.tipo === 'handicap' ? 'Línea del local' : 'Línea'} <select name="linea"></select></label>` : ''}
    <fieldset class="campo"><legend>Lado</legend><div id="lados-apuesta"></div></fieldset>
    <label class="campo">Cuota <input name="cuota" type="number" inputmode="decimal" step="0.01" min="1.01" required value="${actual.cuota}"></label>
    <label class="campo">Monto (S/) <input name="monto" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${actual.monto}"></label>
    <p class="apagado chico">Hasta que esté el guardado del historial (paso 6), la apuesta se guarda solo mientras la página esté abierta.</p>
    <div class="acciones">
      ${registro.apuesta ? html`<button class="boton peligro" value="quitar" formnovalidate>Quitar apuesta</button>` : ''}
      <button class="boton" value="cancelar" formnovalidate>Cancelar</button>
      <button class="boton principal" value="guardar">Guardar</button>
    </div>
  </form>`);

  const formulario = $('#form-apuesta');
  const lineasDe = (casa) => registro.ofertas.find((o) => o.casa === casa)?.lineas ?? [];
  const actualizarLineas = (lineaElegida) => {
    if (!conLinea) return;
    const lineas = lineasDe(formulario.casa.value);
    pintar(formulario.linea, lineas.map((l) => html`<option value="${l.linea}"${l.linea === lineaElegida ? html` selected` : ''}>${textoLineaTabla(definicion, l.linea)}</option>`));
  };
  const lineaActual = () => (conLinea ? Number(formulario.linea.value) : null);
  const actualizarLados = (ladoElegido) => {
    pintar($('#lados-apuesta'), ['a', 'b'].map((lado) => html`<label class="check">
      <input type="radio" name="lado" value="${lado}"${lado === ladoElegido ? html` checked` : ''}>
      ${f.nombreLado(definicion, lado, registro, lineaActual())}</label>`));
  };
  const actualizarCuota = () => {
    const linea = lineasDe(formulario.casa.value).find((l) => l.linea === lineaActual());
    const lado = formulario.querySelector('input[name="lado"]:checked')?.value;
    if (linea && lado) formulario.cuota.value = lado === 'a' ? linea.cuota_a : linea.cuota_b;
  };
  actualizarLineas(actual.linea);
  actualizarLados(actual.lado);
  formulario.addEventListener('change', (evento) => {
    if (evento.target.name === 'casa') actualizarLineas(lineaActual());
    if (evento.target.name === 'casa' || evento.target.name === 'linea') {
      actualizarLados(formulario.querySelector('input[name="lado"]:checked')?.value ?? actual.lado);
    }
    if (['casa', 'linea', 'lado'].includes(evento.target.name)) actualizarCuota();
  });

  dialogo.onclose = () => {
    if (dialogo.returnValue === 'guardar') {
      registro.apuesta = {
        casa: formulario.casa.value,
        linea: lineaActual(),
        lado: formulario.querySelector('input[name="lado"]:checked').value,
        cuota: Number(formulario.cuota.value),
        monto: Number(formulario.monto.value),
        moneda: 'PEN',
        registrada_en: ahoraIso(),
      };
    } else if (dialogo.returnValue === 'quitar') {
      registro.apuesta = null;
    }
    dialogo.returnValue = '';
    pintarPestanaActual();
  };
  dialogo.showModal();
}

// ---------------------------------------------------------------- navegación

function pestanaActual() {
  const pestana = location.hash.slice(1);
  return PESTANAS.includes(pestana) ? pestana : 'partidos';
}

function pintarPestanaActual() {
  const pestana = pestanaActual();
  for (const nombre of PESTANAS) $(`#vista-${nombre}`).hidden = nombre !== pestana;
  for (const enlace of document.querySelectorAll('[data-pestana]')) {
    if (enlace.dataset.pestana === pestana) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  }
  if (pestana === 'partidos') vistaPartidos();
  if (pestana === 'resultado') vistaResultado();
  if (pestana === 'historial') vistaHistorial();
}

/** Busca la extensión. Si está, prepara los lectores y lee solas las ligas del día, como al abrir Sofascore. */
async function buscarExtension() {
  conexion ??= crearConexion(window);
  estado.extension = undefined;
  pintarSiEstaVisible();
  const encontrada = await conexion.detectar();
  estado.extension = encontrada;
  if (encontrada) {
    leerSofascore ??= crearLector(conexion, SOFASCORE, { guardar: rutaFija });
    for (const casa of CASAS) if (!lectores.has(casa.codigo)) lectores.set(casa.codigo, crearLector(conexion, casa.codigo));
  }
  pintarSiEstaVisible();
  if (encontrada && !estado.dia.ligas && !estado.dia.progreso) leerDia(estado.dia.fecha);
}

document.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton) return;
  const { dia } = estado;
  switch (boton.dataset.accion) {
    case 'dia':
      moverFecha(Number(boton.dataset.dias));
      break;
    case 'hoy':
      cambiarFecha(hoyEnLima());
      break;
    case 'abrir-liga':
      abrirLiga(boton.dataset.liga, Boolean(boton.dataset.reintentar));
      break;
    case 'abrir-todo':
      abrirTodo(true);
      break;
    case 'cerrar-todo':
      abrirTodo(false);
      break;
    case 'limpiar':
      dia.seleccion.clear();
      dia.porMarcar.clear();
      actualizarSeleccion();
      break;
    case 'recargar':
      if (!ocupado() && estado.extension) leerDia(dia.fecha, { conservar: true });
      break;
    case 'analizar':
      ejecutarAnalisis(boton.dataset.metodo);
      break;
    case 'cancelar-analisis':
      cancelarAnalisis();
      break;
    case 'apostar':
      abrirDialogoApuesta(boton.dataset.registro);
      break;
    case 'historial-deporte':
      estado.historialDeporte = boton.dataset.deporte;
      estado.filtros = { ...FILTROS_VACIOS };
      estado.mostrados = POR_PAGINA;
      pintarDeportesHistorial();
      pintarFiltros();
      pintarContenidoHistorial();
      break;
    case 'limpiar-filtros':
      estado.filtros = { ...FILTROS_VACIOS };
      estado.mostrados = POR_PAGINA;
      pintarFiltros();
      pintarContenidoHistorial();
      break;
    case 'mostrar-mas':
      estado.mostrados += POR_PAGINA;
      pintarContenidoHistorial();
      break;
    case 'buscar-extension':
      buscarExtension();
      break;
    case 'descargar':
      descargarExtraccion();
      break;
    case 'confirmar-casa':
      confirmarPartido(boton.dataset.casa, boton.dataset.partido, boton.closest('form').evento.value, boton);
      break;
    default:
  }
});

// El calendario avisa un cambio por cada parte de la fecha que se escribe: se espera a que termine.
let relojFecha = null;

document.addEventListener('change', (evento) => {
  const elemento = evento.target;
  if (elemento.dataset.accion === 'partido') {
    if (elemento.checked) estado.dia.seleccion.add(elemento.dataset.partido);
    else estado.dia.seleccion.delete(elemento.dataset.partido);
    actualizarSeleccion();
  } else if (elemento.dataset.accion === 'liga') {
    marcarLiga(elemento.dataset.liga, elemento.checked);
  } else if (elemento.id === 'fecha') {
    clearTimeout(relojFecha);
    relojFecha = setTimeout(() => cambiarFecha(elemento.value), 400);
  } else if (elemento.id === 'solo-por-jugar') {
    estado.soloPorJugar = elemento.checked;
    guardarPreferencia(CLAVE_SOLO_POR_JUGAR, estado.soloPorJugar);
    pintarLigas();
  } else if (elemento.closest('#historial-filtros')) {
    leerFiltros();
  }
});

document.addEventListener('input', (evento) => {
  if (evento.target.id === 'buscar') {
    estado.busqueda = evento.target.value;
    pintarLigas();
  }
});

window.addEventListener('hashchange', pintarPestanaActual);

// La barra de la fecha y los botones de análisis quedan fijos debajo de la cabecera, que cambia de alto en el celular.
new ResizeObserver(([entrada]) => {
  document.documentElement.style.setProperty('--alto-cabecera', `${Math.ceil(entrada.target.getBoundingClientRect().height)}px`);
}).observe($('.cabecera'));

// Escape en la ventana del análisis pide cancelarlo, en lugar de cerrar la ventana y dejar el análisis andando.
$('#dialogo-avance').addEventListener('cancel', (evento) => {
  evento.preventDefault();
  cancelarAnalisis();
});

async function iniciar() {
  try {
    estado.config = await cargarConfig();
  } catch (error) {
    mostrarError(error);
    return;
  }
  estado.soloPorJugar = leerPreferencia(CLAVE_SOLO_POR_JUGAR, false);
  pintarPestanaActual();
  buscarExtension();
}

iniciar();
