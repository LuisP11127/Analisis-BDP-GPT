// Página principal: partidos del día, resultado del análisis e historial.

import { NIVELES_CONFIANZA, nivelConfianza, tieneLinea } from '../../comun/reglas.js';
import { agruparPartidos, analizar, modeloDeEjemplo, modeloSinAnalisis } from './analisis.js';
import { FUENTES, cargarConfig, cargarExtraccion, cargarHistorial, listarExtracciones } from './datos.js';
import { equivalenciasVacias } from './equivalencias.js';
import { crearConexion, crearLector } from './extension.js';
import * as f from './formato.js';
import {
  CASA as BETANO, buscarCuotas, cargarCuotas, mercadosDeOfertas, nombreDeLiga, recordarEquipos,
} from './fuentes/betano.js';
import { FUENTE as SOFASCORE, cargarLigas, cargarPartidos as cargarPartidosSofascore, cargarPrevia, rutaFija } from './fuentes/sofascore.js';
import { acerto, filtrar, ordenar, resultadoApuesta, resumir, resumirPorConfianza } from './historial.js';
import {
  SEGUNDOS_POR_PARTIDO, agruparLigasPorPais, armarExtraccion, filtrarLigas, hoyEnLima, resumenUltimos, seleccionable,
} from './real.js';
import { html, pintar } from './vista.js';

const PESTANAS = ['partidos', 'resultado', 'historial'];
const CLAVE_FUENTE = 'bdp.fuente';
const POR_PAGINA = 100;
const FILTROS_VACIOS = { desde: '', hasta: '', liga: '', mercado: '' };
const URL_EXTENSION = 'https://github.com/luisp11127/Analisis-BDP-GPT/tree/main/extension#readme';
// Nombres de ligas y equipos en Betano ya confirmados. En el paso 6 se guardarán en datos/equivalencias/.
const CLAVE_EQUIVALENCIAS = 'bdp.equivalencias.futbol';

/** Estado del modo con datos reales: extensión, ligas del día y lo leído de Sofascore. */
const estadoReal = () => ({
  // undefined: todavía no se buscó; null: no está instalada; si no, { version, sitios }.
  extension: undefined,
  fecha: hoyEnLima(),
  ligas: null,
  elegidas: new Set(),
  busquedaLigas: '',
  eligiendoLigas: false,
  // Eventos originales de Sofascore por id de partido, para pedir su previa.
  eventos: new Map(),
  // Partidos anteriores leídos para las previas, por id.
  anteriores: new Map(),
  // Resultado de buscar cada partido en Betano, por id de partido (ver buscarCuotas en fuentes/betano.js).
  betano: new Map(),
  progreso: null,
  errores: [],
});

const estado = {
  config: null,
  fuente: FUENTES.prueba,
  fechas: [],
  fecha: null,
  extraccion: null,
  grupos: [],
  deporte: 'futbol',
  busqueda: '',
  seleccion: new Set(),
  preseleccion: false,
  cargando: false,
  analisis: null,
  historialGuardado: null,
  historialSesion: [],
  historialDeporte: 'futbol',
  filtros: { ...FILTROS_VACIOS },
  mostrados: POR_PAGINA,
  real: estadoReal(),
};

let conexion = null;
let leerSofascore = null;
let leerBetano = null;

const $ = (selector) => document.querySelector(selector);
const esPrueba = () => estado.fuente.codigo === 'prueba';
// Las ligas recordadas de los datos de prueba y de los reales se guardan por separado.
const claveLigas = () => (esPrueba() ? 'bdp.ligas' : 'bdp.ligas.real');
const puedeElegir = (partido) => seleccionable(partido, { prueba: esPrueba() });
const sumarMinutos = (iso, minutos) => new Date(new Date(iso).getTime() + minutos * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const ahoraIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

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

function mostrarAviso() {
  const aviso = $('#aviso');
  aviso.className = 'aviso';
  pintar(aviso, esPrueba()
    ? html`<p><strong>Datos de prueba.</strong> Equipos, cuotas y probabilidades son ficticios. Sirven para probar la página mientras no estén la extensión ni el análisis real.</p>`
    : '');
}

function mostrarError(error) {
  const aviso = $('#aviso');
  aviso.className = 'aviso error';
  pintar(aviso, html`<p><strong>No se pudieron leer los datos.</strong> ${error.message}
    Si abriste el archivo directamente desde la carpeta, ábrelo desde GitHub Pages o con <code>npm run pagina</code>.</p>`);
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

function prediccion(definicion, partido, linea, estadistico, red) {
  const ladoEst = f.nombreLado(definicion, estadistico.lado, partido, linea);
  const desacuerdo = red && red.lado !== estadistico.lado;
  let textoRed = html`<span class="apagado">Red: sin modelo todavía</span>`;
  if (red && !desacuerdo) textoRed = html`Red ${f.porcentaje(f.probLado(red))}`;
  if (desacuerdo) {
    textoRed = html`Red: <strong>${f.nombreLado(definicion, red.lado, partido, linea)}</strong> ${f.porcentaje(f.probLado(red))}
      <span class="marca-desacuerdo">⚠️ En desacuerdo</span>`;
  }
  return html`<div class="prediccion${desacuerdo ? ' desacuerdo' : ''}">
    <p class="prediccion-lado"><strong>${ladoEst}</strong></p>
    <p class="prediccion-confianza">${etiquetaNivel(estadistico, 'Confianza ')}
      <span>(estadístico ${f.porcentaje(f.probLado(estadistico))})</span> · ${textoRed}</p>
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

function vistaPartidos() {
  if (!esPrueba()) {
    vistaPartidosReales();
    return;
  }
  const contenedor = $('#vista-partidos');
  pintar(contenedor, html`
    <div class="barra">
      <label class="campo">Fecha
        <select id="fecha">${estado.fechas.map((fecha) => html`<option value="${fecha}"${fecha === estado.fecha ? html` selected` : ''}>${f.capitalizar(f.fechaLarga(fecha))}</option>`)}</select>
      </label>
      <button class="boton principal" type="button" data-accion="cargar"${estado.cargando ? html` disabled` : ''}>
        ${estado.cargando ? 'Cargando…' : estado.extraccion ? 'Volver a cargar' : 'Cargar partidos'}</button>
    </div>
    <div id="partidos-contenido"></div>`);
  pintarContenidoPartidos();
}

function pintarContenidoPartidos() {
  const contenedor = $('#partidos-contenido');
  if (!contenedor) return;
  if (!estado.extraccion) {
    pintar(contenedor, esPrueba()
      ? html`<p class="nota">Elige la fecha y pulsa <strong>Cargar partidos</strong>.
        En datos de prueba hay una extracción ficticia con partidos de varias ligas.</p>`
      : html`<p class="nota">Elige la fecha y pulsa <strong>Cargar ligas</strong> para ver las ligas de fútbol que
        tienen partidos ese día en Sofascore.</p>`);
    return;
  }
  const ligas = estado.grupos.reduce((n, g) => n + g.ligas.length, 0);
  const hora = f.hora(estado.extraccion.generado_en);
  pintar(contenedor, html`
    <p class="resumen">${estado.extraccion.partidos.length} partidos en ${ligas} ligas ·
      ${esPrueba() ? `extracción de las ${hora}` : `leídos de Sofascore a las ${hora}`}
      ${esPrueba() ? '' : html` · <button class="boton enlace" type="button" data-accion="cambiar-ligas">Cambiar ligas</button>`}</p>
    ${estado.preseleccion ? html`<p class="nota">Se marcaron los partidos de las ligas que analizaste la última vez.</p>` : ''}
    ${esPrueba() ? '' : html`<p class="nota chico">Solo se pueden analizar los partidos que todavía no empiezan.</p>`}
    <div class="selector-deporte" id="deportes" role="group" aria-label="Deporte"></div>
    <label class="campo buscador">Buscar liga o equipo
      <input id="buscar" type="search" autocomplete="off" value="${estado.busqueda}">
    </label>
    <div id="lista-ligas"></div>
    <div class="barra-analisis" id="barra-analisis"></div>`);
  pintarLigas();
}

function pintarDeportes() {
  const contenedor = $('#deportes');
  if (!contenedor) return;
  pintar(contenedor, estado.grupos.map((grupo) => {
    const ids = grupo.ligas.flatMap((l) => l.partidos.map((p) => p.partido.id));
    const elegidos = ids.filter((id) => estado.seleccion.has(id)).length;
    const activo = grupo.deporte.codigo === estado.deporte;
    return html`<button class="pildora" type="button" aria-pressed="${activo ? 'true' : 'false'}"
      data-accion="deporte" data-deporte="${grupo.deporte.codigo}">
      ${grupo.deporte.nombre} <span class="contador">${ids.length}${elegidos ? ` · ${elegidos} elegidos` : ''}</span></button>`;
  }));
}

const normalizar = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function pintarLigas() {
  const contenedor = $('#lista-ligas');
  if (!contenedor) return;
  const grupo = estado.grupos.find((g) => g.deporte.codigo === estado.deporte);
  const texto = normalizar(estado.busqueda);
  const visibles = grupo.ligas
    .map((l) => {
      if (!texto || normalizar(`${l.liga.pais ?? ''} ${l.liga.nombre}`).includes(texto)) return l;
      return { ...l, partidos: l.partidos.filter(({ partido }) => normalizar(`${partido.local.nombre} ${partido.visitante.nombre}`).includes(texto)) };
    })
    .filter((l) => l.partidos.length > 0);

  if (visibles.length === 0) {
    pintar(contenedor, html`<p class="nota">${texto ? 'Ningún partido coincide con la búsqueda.' : `No hay partidos de ${grupo.deporte.nombre.toLowerCase()} en esta fecha.`}</p>`);
  } else {
    pintar(contenedor, visibles.map(({ liga, partidos }) => html`<section class="liga">
      <header class="liga-cabecera">
        <label class="check">
          <input type="checkbox" data-accion="liga" data-liga="${liga.id}">
          <span class="liga-nombre">${liga.pais ? `${liga.pais} · ` : ''}${liga.nombre}</span>
        </label>
        <span class="liga-cuenta" data-cuenta-liga="${liga.id}"></span>
      </header>
      <ul class="lista-partidos">${partidos.map(({ partido, mercadosConCuotas }) => html`<li class="partido-fila">
        <label class="check">
          <input type="checkbox" data-accion="partido" data-partido="${partido.id}"${puedeElegir(partido) ? '' : html` disabled`}>
          <span class="hora">${f.hora(partido.inicio)}</span>
          <span class="equipos">${partido.local.nombre} <span class="vs">vs</span> ${partido.visitante.nombre}</span>
        </label>
        ${puedeElegir(partido)
          ? html`<span class="etiqueta${mercadosConCuotas ? '' : ' apagada'}">${mercadosConCuotas ? `${mercadosConCuotas} mercados con cuotas` : 'Sin cuotas'}</span>`
          : html`<span class="etiqueta apagada">${ESTADOS_PARTIDO[partido.estado] ?? 'Ya empezó'}</span>`}
      </li>`)}</ul>
    </section>`));
  }
  actualizarSeleccion();
}

const ESTADOS_PARTIDO = {
  programado: 'Ya empezó',
  en_juego: 'En juego',
  finalizado: 'Terminado',
  aplazado: 'Aplazado',
  suspendido: 'Suspendido',
  cancelado: 'Cancelado',
};

/** Partidos de una liga que se pueden elegir. */
function partidosDeLiga(idLiga) {
  const liga = estado.grupos.flatMap((g) => g.ligas).find((l) => l.liga.id === idLiga);
  return liga?.partidos.filter((p) => puedeElegir(p.partido)).map((p) => p.partido.id) ?? [];
}

function actualizarSeleccion() {
  for (const casilla of document.querySelectorAll('[data-accion="partido"]')) {
    casilla.checked = estado.seleccion.has(casilla.dataset.partido);
  }
  for (const casilla of document.querySelectorAll('[data-accion="liga"]')) {
    const ids = partidosDeLiga(casilla.dataset.liga);
    const total = estado.grupos.flatMap((g) => g.ligas).find((l) => l.liga.id === casilla.dataset.liga)?.partidos.length ?? 0;
    const elegidos = ids.filter((id) => estado.seleccion.has(id)).length;
    casilla.checked = ids.length > 0 && elegidos === ids.length;
    casilla.indeterminate = elegidos > 0 && elegidos < ids.length;
    casilla.disabled = ids.length === 0;
    const cuenta = document.querySelector(`[data-cuenta-liga="${CSS.escape(casilla.dataset.liga)}"]`);
    if (cuenta) cuenta.textContent = `${total} ${total === 1 ? 'partido' : 'partidos'}${elegidos ? ` · ${elegidos} elegidos` : ''}`;
  }
  pintarDeportes();
  const barra = $('#barra-analisis');
  if (!barra) return;
  const n = estado.seleccion.size;
  const ocupado = Boolean(estado.real.progreso);
  let texto = n === 0 ? 'Elige los partidos que quieres analizar' : `${n} ${n === 1 ? 'partido elegido' : 'partidos elegidos'}`;
  // Con datos reales, leer la previa de cada partido toma su tiempo: se avisa cuánto, más o menos.
  if (n > 0 && !esPrueba()) texto += ` · leer sus datos toma unos ${Math.max(1, Math.round((n * SEGUNDOS_POR_PARTIDO) / 60))} min`;
  pintar(barra, html`<span class="barra-texto">${texto}</span>
    <button class="boton" type="button" data-accion="limpiar"${n && !ocupado ? '' : html` disabled`}>Quitar selección</button>
    <button class="boton principal" type="button" data-accion="analizar"${n && !ocupado ? '' : html` disabled`}>Analizar</button>`);
}

async function cargarPartidos() {
  estado.cargando = true;
  vistaPartidos();
  try {
    mostrarExtraccion(await cargarExtraccion(estado.fuente, estado.fecha));
    mostrarAviso();
  } catch (error) {
    mostrarError(error);
  } finally {
    estado.cargando = false;
    vistaPartidos();
  }
}

/** Deja lista la extracción para elegir partidos, con los de las ligas analizadas la última vez marcados. */
function mostrarExtraccion(extraccion) {
  estado.extraccion = extraccion;
  estado.grupos = agruparPartidos(extraccion, estado.config).filter((g) => g.ligas.length > 0);
  const recordadas = new Set(leerPreferencia(claveLigas(), []));
  estado.seleccion = new Set(extraccion.partidos.filter((p) => recordadas.has(p.liga.id) && puedeElegir(p)).map((p) => p.id));
  estado.preseleccion = estado.seleccion.size > 0;
  estado.deporte = estado.grupos[0]?.deporte.codigo ?? 'futbol';
  estado.busqueda = '';
}

function ejecutarAnalisis() {
  if (!esPrueba()) {
    analizarReales();
    return;
  }
  // En datos de prueba la hora del análisis es la de la extracción ficticia, para que los registros
  // queden antes del inicio de los partidos sin importar el día en que se abra la página.
  terminarAnalisis(sumarMinutos(estado.extraccion.generado_en, 5), modeloDeEjemplo);
}

function terminarAnalisis(ahora, modelo) {
  const resultado = analizar({
    extraccion: estado.extraccion,
    seleccion: estado.seleccion,
    config: estado.config,
    modelo,
    ahora,
  });
  const anteriores = new Map(estado.historialSesion.map((r) => [r.id, r]));
  for (const registro of resultado.registros) {
    registro.apuesta = anteriores.get(registro.id)?.apuesta ?? null;
    deLaSesion.add(registro);
  }
  const nuevos = new Set(resultado.registros.map((r) => r.id));
  estado.historialSesion = [...estado.historialSesion.filter((r) => !nuevos.has(r.id)), ...resultado.registros];
  estado.analisis = { ...resultado, ahora, fecha: estado.extraccion.fecha_local };
  const ligas = new Set(estado.extraccion.partidos.filter((p) => estado.seleccion.has(p.id)).map((p) => p.liga.id));
  guardarPreferencia(claveLigas(), [...ligas]);
  if (location.hash === '#resultado') vistaResultado();
  else location.hash = '#resultado';
}

// ---------------------------------------------------------------- partidos reales (extensión y Sofascore)

async function buscarExtension() {
  conexion ??= crearConexion(window);
  estado.real.extension = undefined;
  if (pestanaActual() === 'partidos') vistaPartidos();
  const encontrada = await conexion.detectar();
  if (esPrueba()) return;
  estado.real.extension = encontrada;
  if (encontrada) {
    leerSofascore ??= crearLector(conexion, SOFASCORE, { guardar: rutaFija });
    leerBetano ??= crearLector(conexion, BETANO);
  }
  if (pestanaActual() === 'partidos') vistaPartidos();
}

/** Muestra qué se está leyendo sin volver a pintar toda la vista. */
function mostrarProgreso(texto) {
  estado.real.progreso = texto;
  const elemento = $('#progreso-real');
  if (elemento) elemento.textContent = texto;
  else if (pestanaActual() === 'partidos') vistaPartidos();
}

function erroresReales() {
  const { errores } = estado.real;
  if (errores.length === 0) return '';
  return html`<div class="aviso error" role="alert"><p><strong>Hubo problemas al leer Sofascore.</strong></p>
    <ul class="errores">${errores.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}

function vistaPartidosReales() {
  const contenedor = $('#vista-partidos');
  const { real } = estado;
  if (real.extension === undefined) {
    pintar(contenedor, html`<p class="nota">Buscando la extensión de Brave…</p>`);
    return;
  }
  if (real.extension === null) {
    pintar(contenedor, html`<div class="vacio">
      <h2>Falta la extensión</h2>
      <p>Los partidos reales se leen de Sofascore con la extensión de Brave. Se instala una sola vez:
        sigue <a href="${URL_EXTENSION}" target="_blank" rel="noopener">estas instrucciones</a> y vuelve a esta página.</p>
      <p class="nota">La extensión solo funciona en la computadora. En el celular puedes ver el historial y los datos de prueba.</p>
      <div class="acciones inicio">
        <button class="boton principal" type="button" data-accion="buscar-extension">Buscar de nuevo</button>
        <button class="boton" type="button" data-accion="usar-prueba">Usar datos de prueba</button>
      </div>
    </div>`);
    return;
  }
  const ocupado = Boolean(real.progreso);
  pintar(contenedor, html`
    <div class="barra">
      <label class="campo">Fecha <input id="fecha-real" type="date" value="${real.fecha}"${ocupado ? html` disabled` : ''}></label>
      <button class="boton principal" type="button" data-accion="cargar-ligas"${ocupado ? html` disabled` : ''}>
        ${real.ligas ? 'Volver a cargar las ligas' : 'Cargar ligas'}</button>
      <span class="apagado chico">Extensión ${real.extension.version} conectada · por ahora solo fútbol</span>
    </div>
    ${ocupado ? html`<p class="progreso" id="progreso-real" role="status">${real.progreso}</p>` : ''}
    ${erroresReales()}
    <div id="partidos-contenido"></div>`);
  if (real.eligiendoLigas && real.ligas) pintarSelectorLigas();
  else pintarContenidoPartidos();
}

function pintarSelectorLigas() {
  const contenedor = $('#partidos-contenido');
  if (!contenedor) return;
  const { real } = estado;
  const partidos = real.ligas.reduce((n, l) => n + l.partidos, 0);
  pintar(contenedor, html`
    <p class="resumen">${real.ligas.length} ligas de fútbol con ${partidos} partidos el ${f.fechaLarga(real.fecha)} (hora de Lima)
      ${estado.extraccion ? html` · <button class="boton enlace" type="button" data-accion="volver-partidos">Volver a los partidos</button>` : ''}</p>
    ${real.ligas.length ? html`<label class="campo buscador">Buscar país o liga
      <input id="buscar-ligas" type="search" autocomplete="off" value="${real.busquedaLigas}"></label>` : ''}
    <div id="ligas-elegidas"></div>
    <div id="lista-ligas-reales"></div>
    <div class="barra-analisis" id="barra-ligas"></div>`);
  pintarListaLigasReales();
}

function filaLiga(liga) {
  return html`<li class="partido-fila">
    <label class="check">
      <input type="checkbox" data-accion="elegir-liga" data-liga="${liga.id}"${estado.real.elegidas.has(liga.id) ? html` checked` : ''}>
      <span class="equipos">${liga.pais ? `${liga.pais} · ` : ''}${liga.nombre}</span>
    </label>
    <span class="etiqueta apagada">${liga.partidos} ${liga.partidos === 1 ? 'partido' : 'partidos'}</span>
  </li>`;
}

function pintarElegidas() {
  const contenedor = $('#ligas-elegidas');
  if (!contenedor) return;
  const elegidas = estado.real.ligas.filter((l) => estado.real.elegidas.has(l.id));
  pintar(contenedor, elegidas.length && !estado.real.busquedaLigas.trim()
    ? html`<section class="liga"><header class="liga-cabecera"><span class="liga-nombre">Elegidas</span></header>
      <ul class="lista-partidos">${elegidas.map(filaLiga)}</ul></section>`
    : '');
}

function pintarListaLigasReales() {
  const contenedor = $('#lista-ligas-reales');
  if (!contenedor) return;
  const { real } = estado;
  if (real.ligas.length === 0) {
    pintar(contenedor, html`<p class="nota">Sofascore no tiene partidos de fútbol para esta fecha.</p>`);
  } else if (real.busquedaLigas.trim()) {
    const visibles = filtrarLigas(real.ligas, real.busquedaLigas);
    pintar(contenedor, visibles.length
      ? html`<section class="liga"><ul class="lista-partidos">${visibles.map(filaLiga)}</ul></section>`
      : html`<p class="nota">Ninguna liga coincide con la búsqueda.</p>`);
  } else {
    const destacadas = real.ligas.filter((l) => l.principal);
    pintar(contenedor, html`
      ${destacadas.length ? html`<section class="liga"><header class="liga-cabecera"><span class="liga-nombre">Destacadas en Sofascore</span></header>
        <ul class="lista-partidos">${destacadas.map(filaLiga)}</ul></section>` : ''}
      <h3 class="subtitulo">Todas, por país</h3>
      ${agruparLigasPorPais(real.ligas).map((grupo) => html`<details class="liga pais">
        <summary class="liga-cabecera"><span class="liga-nombre">${grupo.pais}</span>
          <span class="liga-cuenta">${grupo.ligas.length} ${grupo.ligas.length === 1 ? 'liga' : 'ligas'} ·
            ${grupo.partidos} ${grupo.partidos === 1 ? 'partido' : 'partidos'}</span></summary>
        <ul class="lista-partidos">${grupo.ligas.map(filaLiga)}</ul>
      </details>`)}`);
  }
  pintarElegidas();
  actualizarBarraLigas();
}

function actualizarBarraLigas() {
  const { real } = estado;
  for (const casilla of document.querySelectorAll('[data-accion="elegir-liga"]')) casilla.checked = real.elegidas.has(casilla.dataset.liga);
  const barra = $('#barra-ligas');
  if (!barra) return;
  const n = real.elegidas.size;
  const partidos = real.ligas.filter((l) => real.elegidas.has(l.id)).reduce((s, l) => s + l.partidos, 0);
  const ocupado = Boolean(real.progreso);
  pintar(barra, html`<span class="barra-texto">${n === 0
    ? 'Elige las ligas que quieres ver'
    : `${n} ${n === 1 ? 'liga elegida' : 'ligas elegidas'} · ${partidos} ${partidos === 1 ? 'partido' : 'partidos'}`}</span>
    <button class="boton" type="button" data-accion="limpiar-ligas"${n && !ocupado ? '' : html` disabled`}>Quitar selección</button>
    <button class="boton principal" type="button" data-accion="cargar-partidos-reales"${n && !ocupado ? '' : html` disabled`}>Cargar partidos</button>`);
}

async function cargarLigasReales() {
  const { real } = estado;
  real.errores = [];
  mostrarProgreso('Leyendo las ligas del día en Sofascore…');
  try {
    real.ligas = await cargarLigas(leerSofascore, real.fecha, {
      progreso: (pagina) => mostrarProgreso(`Leyendo las ligas del día en Sofascore (página ${pagina})…`),
    });
    const recordadas = new Set(leerPreferencia(claveLigas(), []));
    real.elegidas = new Set(real.ligas.filter((l) => recordadas.has(l.id)).map((l) => l.id));
    real.busquedaLigas = '';
    real.eligiendoLigas = true;
    Object.assign(estado, { extraccion: null, grupos: [], seleccion: new Set(), preseleccion: false });
  } catch (error) {
    real.errores = [error.message];
  } finally {
    real.progreso = null;
    if (pestanaActual() === 'partidos') vistaPartidos();
  }
}

async function cargarPartidosReales() {
  const { real } = estado;
  const ligas = real.ligas.filter((l) => real.elegidas.has(l.id));
  if (ligas.length === 0) return;
  real.errores = [];
  mostrarProgreso(`Leyendo los partidos de ${ligas.length} ${ligas.length === 1 ? 'liga' : 'ligas'}…`);
  try {
    const { partidos, eventos } = await cargarPartidosSofascore(leerSofascore, real.fecha, ligas, {
      progreso: (n, total) => mostrarProgreso(`Leyendo los partidos: liga ${n} de ${total}…`),
    });
    real.eventos = eventos;
    real.anteriores = new Map();
    mostrarExtraccion(armarExtraccion({ fecha: real.fecha, generadoEn: ahoraIso(), partidos, anteriores: real.anteriores }));
    real.eligiendoLigas = false;
  } catch (error) {
    real.errores = [error.message];
  } finally {
    real.progreso = null;
    if (pestanaActual() === 'partidos') vistaPartidos();
  }
}

/** Lee la previa de cada partido elegido (con sus últimos partidos) y arma el resultado. */
async function analizarReales() {
  const { real } = estado;
  const elegidos = estado.extraccion.partidos.filter((p) => estado.seleccion.has(p.id) && puedeElegir(p));
  if (elegidos.length === 0) return;
  real.errores = [];
  for (const [i, partido] of elegidos.entries()) {
    const nombre = `${partido.local.nombre} vs ${partido.visitante.nombre}`;
    const prefijo = `Partido ${i + 1} de ${elegidos.length} (${nombre})`;
    mostrarProgreso(`${prefijo}…`);
    try {
      const { previa, anteriores } = await cargarPrevia(leerSofascore, partido, real.eventos.get(partido.id), {
        progreso: (texto) => mostrarProgreso(`${prefijo}: ${texto}…`),
      });
      partido.previa = previa;
      for (const anterior of anteriores) real.anteriores.set(anterior.id, anterior);
    } catch (error) {
      real.errores.push(`${nombre}: ${error.message}`);
      // Si Sofascore está rechazando los pedidos, no tiene sentido seguir con los demás partidos.
      if (/rechazó/.test(error.message)) break;
    }
  }
  if (extensionLee(BETANO)) await leerCuotasBetano(elegidos);
  real.progreso = null;
  rehacerExtraccion();
}

const extensionLee = (sitio) => Boolean(estado.real.extension?.sitios?.includes(sitio));

/** Busca en Betano los partidos elegidos y lee sus cuotas. Los errores se informan sin detener el análisis. */
async function leerCuotasBetano(partidos) {
  const { real } = estado;
  real.equivalencias ??= leerPreferencia(CLAVE_EQUIVALENCIAS, null) ?? equivalenciasVacias();
  const ligas = new Map((real.ligas ?? []).map((l) => [l.id, l]));
  try {
    const resultados = await buscarCuotas(leerBetano, partidos, ligas, real.equivalencias, {
      progreso: (texto) => mostrarProgreso(`Betano: ${texto}…`),
    });
    for (const [id, resultado] of resultados) real.betano.set(id, resultado);
    guardarPreferencia(CLAVE_EQUIVALENCIAS, real.equivalencias);
  } catch (error) {
    real.errores.push(`Betano: ${error.message}`);
  }
}

/** Arma la extracción con lo leído hasta ahora (previas y cuotas) y vuelve a mostrar el resultado. */
function rehacerExtraccion() {
  const { real } = estado;
  const mercados = [];
  for (const partido of estado.extraccion.partidos) {
    const betano = real.betano.get(partido.id);
    if (betano?.estado !== 'emparejado') continue;
    partido.ids_externos = { ...partido.ids_externos, [BETANO]: betano.evento.id };
    mercados.push(...mercadosDeOfertas(partido.id, betano.ofertas ?? new Map()));
  }
  const ahora = ahoraIso();
  estado.extraccion = armarExtraccion({ fecha: real.fecha, generadoEn: ahora, partidos: estado.extraccion.partidos, anteriores: real.anteriores, mercados });
  estado.grupos = agruparPartidos(estado.extraccion, estado.config).filter((g) => g.ligas.length > 0);
  terminarAnalisis(ahora, modeloSinAnalisis);
}

/** El usuario eligió a mano el partido de Betano que corresponde a un partido de Sofascore. */
async function confirmarBetano(idPartido, idEvento, boton) {
  const { real } = estado;
  const partido = estado.extraccion.partidos.find((p) => p.id === idPartido);
  const anterior = real.betano.get(idPartido);
  const evento = anterior?.eventosLiga?.find((e) => e.id === idEvento);
  if (!partido || !evento) return;
  boton.disabled = true;
  boton.textContent = 'Leyendo cuotas…';
  try {
    const ofertas = await cargarCuotas(leerBetano, evento);
    real.betano.set(idPartido, { ...anterior, estado: 'emparejado', evento, ofertas });
    recordarEquipos(real.equivalencias, partido, evento, ahoraIso());
    guardarPreferencia(CLAVE_EQUIVALENCIAS, real.equivalencias);
  } catch (error) {
    real.errores.push(`Betano: ${error.message}`);
  }
  rehacerExtraccion();
}

/** Descarga lo leído en el formato de la extracción del día, para revisarlo o compartirlo. */
function descargarExtraccion() {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([JSON.stringify(estado.extraccion, null, 2)], { type: 'application/json' }));
  enlace.download = `${estado.extraccion.fecha_local}.json`;
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

function tablaUltimos(partido, lado) {
  const { filas, promedios } = resumenUltimos(partido, lado, estado.real.anteriores);
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

function datosSofascore(partido) {
  if (!partido.previa) return html`<p class="apagado chico">No se pudieron leer los datos previos de este partido.</p>`;
  return html`<details class="detalle datos-fuente">
    <summary>Datos de Sofascore</summary>
    <p><strong>Tabla:</strong> ${textoTabla(partido)}</p>
    <p><strong>Árbitro:</strong> ${textoArbitro(partido.previa.arbitro)}</p>
    <p><strong>Bajas:</strong> ${textoBajas(partido)}</p>
    ${alineacion(partido)}
    ${tablaUltimos(partido, 'local')}
    ${tablaUltimos(partido, 'visitante')}
    <p class="apagado chico">Leído a las ${f.hora(partido.previa.extraido_en)}.</p>
  </details>`;
}

/** Qué pasó al buscar el partido en Betano; si no es seguro, permite elegirlo a mano. */
function estadoBetano(partido) {
  const clase = 'chico casa-estado';
  if (!extensionLee(BETANO)) {
    return html`<p class="apagado ${clase}">Betano: para leer sus cuotas hay que actualizar la extensión
      (<a href="${URL_EXTENSION}" target="_blank" rel="noopener">instrucciones</a>).</p>`;
  }
  const resultado = estado.real.betano.get(partido.id);
  if (!resultado) return html`<p class="apagado ${clase}">Betano: no se buscó este partido.</p>`;
  if (resultado.estado === 'emparejado') {
    const cantidad = resultado.ofertas?.size ?? 0;
    return html`<p class="${clase}">Betano: ${resultado.evento.nombre} · ${nombreDeLiga(resultado.liga)} ·
      ${cantidad ? `${cantidad} de ${deporteDe(partido.deporte).mercados.length} mercados` : 'todavía sin los mercados del análisis'}</p>`;
  }
  if (resultado.estado === 'sin_liga') return html`<p class="apagado ${clase}">Betano: no se encontró esta liga.</p>`;
  const inicio = Date.parse(partido.inicio);
  const eventos = [...(resultado.eventosLiga ?? [])].sort((a, b) => Math.abs(Date.parse(a.inicio) - inicio) - Math.abs(Date.parse(b.inicio) - inicio));
  const motivo = resultado.estado === 'dudoso'
    ? 'no es seguro cuál es el partido.'
    : `no hay un partido a esa hora en ${nombreDeLiga(resultado.liga)}.`;
  if (eventos.length === 0) return html`<p class="apagado ${clase}">Betano: ${motivo}</p>`;
  return html`<form class="${clase} confirmar-casa" onsubmit="return false">
    <label class="campo">Betano: ${motivo} Elige el que corresponde
      <select name="evento">${eventos.map((e) => html`<option value="${e.id}"${e.id === resultado.evento?.id ? html` selected` : ''}>${f.fechaHora(e.inicio)} · ${e.nombre}</option>`)}</select>
    </label>
    <button class="boton chico" type="button" data-accion="confirmar-betano" data-partido="${partido.id}">Usar este partido</button>
  </form>`;
}

// ---------------------------------------------------------------- resultado

function filaDeMercado(definicion, partido, fila, titulo) {
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
    ${registro ? prediccion(definicion, partido, candidata.linea, estadistico, red) : html`<p class="prediccion apagado">${esPrueba()
      ? 'Estadístico: sin datos suficientes para este mercado'
      : 'Análisis estadístico: se construye en el paso 5'}</p>`}
    ${probabilidadRoja(estadistico)}
    ${apuestaRegistrada(definicion, registro)}
    ${detalle(definicion, entrada.ofertas, candidata, estadistico, red)}`;
}

function mercadoDelPartido(partido, { definicion, filas }) {
  if (filas.length === 0) {
    return html`<li class="mercado sin-cuotas"><span class="mercado-nombre">${definicion.nombre}</span> <span class="apagado">Sin cuotas</span></li>`;
  }
  if (definicion.por_jugador) {
    return html`<li class="mercado">
      <span class="mercado-nombre">${definicion.nombre}</span>
      <ul class="props">${filas.map((fila) => html`<li class="prop">
        ${filaDeMercado(definicion, partido, fila, html`<span class="prop-jugador">${fila.entrada.jugador.nombre}
          <span class="apagado">(${fila.entrada.jugador.equipo === 'local' ? partido.local.nombre : partido.visitante.nombre})</span>
          · ${f.nombreEstadisticaJugador(definicion, fila.entrada.estadistica_jugador)}</span>`)}
      </li>`)}</ul>
    </li>`;
  }
  return html`<li class="mercado">${filaDeMercado(definicion, partido, filas[0], html`<span class="mercado-nombre">${definicion.nombre}</span>`)}</li>`;
}

function vistaResultado() {
  const contenedor = $('#vista-resultado');
  if (!estado.analisis) {
    pintar(contenedor, html`<div class="vacio">
      <h2>Resultado</h2>
      <p>Todavía no hay un análisis. Elige partidos en <strong>Partidos del día</strong> y pulsa <strong>Analizar</strong>.</p>
      <a class="boton principal" href="#partidos">Ir a partidos del día</a>
    </div>`);
    return;
  }
  const { deportes, registros, ahora, fecha } = estado.analisis;
  const partidos = deportes.reduce((n, d) => n + d.partidos.length, 0);
  pintar(contenedor, html`
    <div class="encabezado-vista">
      <h2>Análisis del ${f.fechaLarga(fecha)}</h2>
      <p class="resumen">${partidos} ${partidos === 1 ? 'partido' : 'partidos'} · ${registros.length} mercados analizados · hecho a las ${f.hora(ahora)}</p>
      ${esPrueba() ? html`<p class="nota">Las probabilidades son de ejemplo: el análisis estadístico real se construye en el paso 5.
        Con datos de prueba, estos mercados se agregan al historial solo mientras la página esté abierta.</p>` : html`
        <p class="nota">Los datos vienen de Sofascore y las cuotas, de Betano. Todavía falta el análisis estadístico (paso 5):
          por ahora se ve la línea candidata de cada mercado.</p>
        ${erroresReales()}
        <p><button class="boton" type="button" data-accion="descargar">Descargar los datos leídos (JSON)</button></p>`}
    </div>
    ${deportes.map(({ deporte, partidos: lista }) => html`<section class="deporte">
      <h2 class="deporte-titulo">${deporte.nombre}</h2>
      ${lista.map(({ partido, mercados }) => html`<article class="partido">
        <header class="partido-cabecera">
          <p class="partido-liga">${partido.liga.nombre} · ${f.fechaHora(partido.inicio)}</p>
          <h3 class="partido-equipos">${partido.local.nombre} <span class="vs">vs</span> ${partido.visitante.nombre}</h3>
        </header>
        ${esPrueba() ? '' : html`${datosSofascore(partido)}${estadoBetano(partido)}`}
        <ol class="mercados">${mercados.map((m) => mercadoDelPartido(partido, m))}</ol>
      </article>`)}
    </section>`)}`);
}

// ---------------------------------------------------------------- historial

async function vistaHistorial() {
  const contenedor = $('#vista-historial');
  if (estado.historialGuardado === null) {
    pintar(contenedor, html`<p class="nota">Cargando el historial…</p>`);
    try {
      estado.historialGuardado = await cargarHistorial(estado.fuente);
    } catch (error) {
      mostrarError(error);
      estado.historialGuardado = [];
    }
  }
  pintar(contenedor, html`
    <div class="encabezado-vista">
      <h2>Historial</h2>
      ${esPrueba() ? html`<p class="nota">Registros ficticios de días anteriores, más los que analices en esta sesión.</p>` : ''}
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
    pintar(contenedor, html`<p class="nota">${esPrueba() ? 'No hay registros de este deporte.' : 'Todavía no hay registros guardados. El historial se empieza a guardar en el paso 6.'}</p>`);
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
    ${esPrueba() ? html`<p class="apagado chico">Con datos de prueba la apuesta se guarda solo mientras la página esté abierta.</p>` : ''}
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

async function prepararFuente(codigo) {
  estado.fuente = FUENTES[codigo] ?? FUENTES.prueba;
  $('#fuente').value = estado.fuente.codigo;
  guardarPreferencia(CLAVE_FUENTE, estado.fuente.codigo);
  Object.assign(estado, {
    fechas: [],
    fecha: null,
    extraccion: null,
    grupos: [],
    seleccion: new Set(),
    analisis: null,
    historialGuardado: null,
    historialSesion: [],
    filtros: { ...FILTROS_VACIOS },
    mostrados: POR_PAGINA,
  });
  if (!esPrueba()) {
    estado.real = estadoReal();
    buscarExtension();
  }
  mostrarAviso();
  try {
    estado.fechas = await listarExtracciones(estado.fuente);
    estado.fecha = estado.fechas[0] ?? null;
  } catch (error) {
    mostrarError(error);
  }
}

async function cambiarFuente(codigo) {
  await prepararFuente(codigo);
  pintarPestanaActual();
}

document.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton) return;
  switch (boton.dataset.accion) {
    case 'cargar':
      cargarPartidos();
      break;
    case 'deporte':
      estado.deporte = boton.dataset.deporte;
      pintarLigas();
      break;
    case 'limpiar':
      estado.seleccion.clear();
      actualizarSeleccion();
      break;
    case 'analizar':
      ejecutarAnalisis();
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
    case 'usar-prueba':
      cambiarFuente('prueba');
      break;
    case 'buscar-extension':
      buscarExtension();
      break;
    case 'cargar-ligas':
      cargarLigasReales();
      break;
    case 'cambiar-ligas':
      if (estado.real.progreso) break;
      estado.real.eligiendoLigas = true;
      vistaPartidos();
      break;
    case 'volver-partidos':
      estado.real.eligiendoLigas = false;
      vistaPartidos();
      break;
    case 'limpiar-ligas':
      estado.real.elegidas.clear();
      pintarElegidas();
      actualizarBarraLigas();
      break;
    case 'cargar-partidos-reales':
      cargarPartidosReales();
      break;
    case 'descargar':
      descargarExtraccion();
      break;
    case 'confirmar-betano':
      confirmarBetano(boton.dataset.partido, boton.closest('form').evento.value, boton);
      break;
    default:
  }
});

document.addEventListener('change', (evento) => {
  const elemento = evento.target;
  if (elemento.dataset.accion === 'partido') {
    if (elemento.checked) estado.seleccion.add(elemento.dataset.partido);
    else estado.seleccion.delete(elemento.dataset.partido);
    estado.preseleccion = false;
    actualizarSeleccion();
  } else if (elemento.dataset.accion === 'liga') {
    const ids = partidosDeLiga(elemento.dataset.liga);
    const todos = ids.every((id) => estado.seleccion.has(id));
    for (const id of ids) {
      if (todos) estado.seleccion.delete(id);
      else estado.seleccion.add(id);
    }
    estado.preseleccion = false;
    actualizarSeleccion();
  } else if (elemento.dataset.accion === 'elegir-liga') {
    if (elemento.checked) estado.real.elegidas.add(elemento.dataset.liga);
    else estado.real.elegidas.delete(elemento.dataset.liga);
    pintarElegidas();
    actualizarBarraLigas();
  } else if (elemento.id === 'fecha') {
    estado.fecha = elemento.value;
  } else if (elemento.id === 'fecha-real') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(elemento.value)) estado.real.fecha = elemento.value;
  } else if (elemento.id === 'fuente') {
    cambiarFuente(elemento.value);
  } else if (elemento.closest('#historial-filtros')) {
    leerFiltros();
  }
});

document.addEventListener('input', (evento) => {
  if (evento.target.id === 'buscar') {
    estado.busqueda = evento.target.value;
    pintarLigas();
  } else if (evento.target.id === 'buscar-ligas') {
    estado.real.busquedaLigas = evento.target.value;
    pintarListaLigasReales();
  }
});

window.addEventListener('hashchange', pintarPestanaActual);

async function iniciar() {
  try {
    estado.config = await cargarConfig();
  } catch (error) {
    mostrarError(error);
    return;
  }
  await prepararFuente(leerPreferencia(CLAVE_FUENTE, 'prueba'));
  pintarPestanaActual();
}

iniciar();
