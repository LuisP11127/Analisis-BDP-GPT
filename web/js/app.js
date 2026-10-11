// Página principal: partidos del día, resultado del análisis e historial.

import { tieneLinea } from '../../comun/reglas.js';
import { agruparPartidos, analizar, modeloDeEjemplo } from './analisis.js';
import { FUENTES, cargarConfig, cargarExtraccion, cargarHistorial, listarExtracciones } from './datos.js';
import * as f from './formato.js';
import { acerto, filtrar, ordenar, resultadoApuesta, resumir } from './historial.js';
import { html, pintar } from './vista.js';

const PESTANAS = ['partidos', 'resultado', 'historial'];
const CLAVE_FUENTE = 'bdp.fuente';
const CLAVE_LIGAS = 'bdp.ligas';
const POR_PAGINA = 100;
const FILTROS_VACIOS = { desde: '', hasta: '', liga: '', mercado: '' };

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
};

const $ = (selector) => document.querySelector(selector);
const esPrueba = () => estado.fuente.codigo === 'prueba';
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

function prediccion(definicion, partido, linea, estadistico, red) {
  const ladoEst = f.nombreLado(definicion, estadistico.lado, partido, linea);
  const probEst = f.porcentaje(f.probLado(estadistico));
  if (!red) {
    return html`<p class="prediccion"><strong>${ladoEst}</strong> — Estadístico ${probEst} ·
      <span class="apagado">Red: sin modelo todavía</span></p>`;
  }
  const probRed = f.porcentaje(f.probLado(red));
  if (red.lado === estadistico.lado) {
    return html`<p class="prediccion"><strong>${ladoEst}</strong> — Estadístico ${probEst} · Red ${probRed}</p>`;
  }
  const ladoRed = f.nombreLado(definicion, red.lado, partido, linea);
  return html`<p class="prediccion desacuerdo">
    <span>Estadístico: <strong>${ladoEst}</strong> ${probEst}</span> ·
    <span>Red: <strong>${ladoRed}</strong> ${probRed}</span>
    <span class="marca-desacuerdo">⚠️ En desacuerdo</span></p>`;
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
  const contenedor = $('#vista-partidos');
  if (!estado.fuente.extracciones) {
    pintar(contenedor, html`<div class="vacio">
      <h2>Partidos del día</h2>
      <p>Los partidos reales llegarán desde la extensión de Brave, que se construye en los pasos 3 y 4.
        Mientras tanto puedes probar la página con los datos de prueba.</p>
      <button class="boton principal" type="button" data-accion="usar-prueba">Usar datos de prueba</button>
    </div>`);
    return;
  }
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
    pintar(contenedor, html`<p class="nota">Elige la fecha y pulsa <strong>Cargar partidos</strong>.
      En datos de prueba hay una extracción ficticia con partidos de varias ligas.</p>`);
    return;
  }
  const ligas = estado.grupos.reduce((n, g) => n + g.ligas.length, 0);
  pintar(contenedor, html`
    <p class="resumen">${estado.extraccion.partidos.length} partidos en ${ligas} ligas ·
      extracción de las ${f.hora(estado.extraccion.generado_en)}</p>
    ${estado.preseleccion ? html`<p class="nota">Se marcaron los partidos de las ligas que analizaste la última vez.</p>` : ''}
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
          <input type="checkbox" data-accion="partido" data-partido="${partido.id}">
          <span class="hora">${f.hora(partido.inicio)}</span>
          <span class="equipos">${partido.local.nombre} <span class="vs">vs</span> ${partido.visitante.nombre}</span>
        </label>
        <span class="etiqueta${mercadosConCuotas ? '' : ' apagada'}">${mercadosConCuotas ? `${mercadosConCuotas} mercados con cuotas` : 'Sin cuotas'}</span>
      </li>`)}</ul>
    </section>`));
  }
  actualizarSeleccion();
}

function partidosDeLiga(idLiga) {
  return estado.grupos.flatMap((g) => g.ligas).find((l) => l.liga.id === idLiga)?.partidos.map((p) => p.partido.id) ?? [];
}

function actualizarSeleccion() {
  for (const casilla of document.querySelectorAll('[data-accion="partido"]')) {
    casilla.checked = estado.seleccion.has(casilla.dataset.partido);
  }
  for (const casilla of document.querySelectorAll('[data-accion="liga"]')) {
    const ids = partidosDeLiga(casilla.dataset.liga);
    const elegidos = ids.filter((id) => estado.seleccion.has(id)).length;
    casilla.checked = elegidos === ids.length;
    casilla.indeterminate = elegidos > 0 && elegidos < ids.length;
    const cuenta = document.querySelector(`[data-cuenta-liga="${CSS.escape(casilla.dataset.liga)}"]`);
    if (cuenta) cuenta.textContent = `${ids.length} ${ids.length === 1 ? 'partido' : 'partidos'}${elegidos ? ` · ${elegidos} elegidos` : ''}`;
  }
  pintarDeportes();
  const barra = $('#barra-analisis');
  if (!barra) return;
  const n = estado.seleccion.size;
  pintar(barra, html`<span class="barra-texto">${n === 0 ? 'Elige los partidos que quieres analizar' : `${n} ${n === 1 ? 'partido elegido' : 'partidos elegidos'}`}</span>
    <button class="boton" type="button" data-accion="limpiar"${n ? '' : html` disabled`}>Quitar selección</button>
    <button class="boton principal" type="button" data-accion="analizar"${n ? '' : html` disabled`}>Analizar</button>`);
}

async function cargarPartidos() {
  estado.cargando = true;
  vistaPartidos();
  try {
    const extraccion = await cargarExtraccion(estado.fuente, estado.fecha);
    estado.extraccion = extraccion;
    estado.grupos = agruparPartidos(extraccion, estado.config).filter((g) => g.ligas.length > 0);
    const recordadas = new Set(leerPreferencia(CLAVE_LIGAS, []));
    estado.seleccion = new Set(extraccion.partidos.filter((p) => recordadas.has(p.liga.id)).map((p) => p.id));
    estado.preseleccion = estado.seleccion.size > 0;
    estado.deporte = estado.grupos[0]?.deporte.codigo ?? 'futbol';
    estado.busqueda = '';
    mostrarAviso();
  } catch (error) {
    mostrarError(error);
  } finally {
    estado.cargando = false;
    vistaPartidos();
  }
}

function ejecutarAnalisis() {
  // En datos de prueba la hora del análisis es la de la extracción ficticia, para que los registros
  // queden antes del inicio de los partidos sin importar el día en que se abra la página.
  const ahora = esPrueba() ? sumarMinutos(estado.extraccion.generado_en, 5) : ahoraIso();
  const resultado = analizar({
    extraccion: estado.extraccion,
    seleccion: estado.seleccion,
    config: estado.config,
    modelo: modeloDeEjemplo,
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
  guardarPreferencia(CLAVE_LIGAS, [...ligas]);
  if (location.hash === '#resultado') vistaResultado();
  else location.hash = '#resultado';
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
    ${registro ? prediccion(definicion, partido, candidata.linea, estadistico, red) : html`<p class="prediccion apagado">Estadístico: sin datos suficientes para este mercado</p>`}
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
        Con datos de prueba, estos mercados se agregan al historial solo mientras la página esté abierta.</p>` : ''}
    </div>
    ${deportes.map(({ deporte, partidos: lista }) => html`<section class="deporte">
      <h2 class="deporte-titulo">${deporte.nombre}</h2>
      ${lista.map(({ partido, mercados }) => html`<article class="partido">
        <header class="partido-cabecera">
          <p class="partido-liga">${partido.liga.nombre} · ${f.fechaHora(partido.inicio)}</p>
          <h3 class="partido-equipos">${partido.local.nombre} <span class="vs">vs</span> ${partido.visitante.nombre}</h3>
        </header>
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

function marcaAcierto(valor) {
  if (valor === null) return '';
  return valor
    ? html` <span class="marca acierto" title="Acertó">✓<span class="solo-lector"> acertó</span></span>`
    : html` <span class="marca fallo" title="Falló">✗<span class="solo-lector"> falló</span></span>`;
}

function celdaModelo(definicion, registro, modelo) {
  if (!modelo) return html`<span class="apagado">—</span>`;
  const lado = f.nombreLado(definicion, modelo.lado, registro, registro.candidata.linea);
  return html`${lado} ${f.porcentaje(f.probLado(modelo))}${marcaAcierto(acerto(modelo, registro.resultado))}`;
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
    <td data-titulo="Estadístico"><div>${celdaModelo(definicion, registro, registro.estadistico)}</div></td>
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
    <h3 class="subtitulo">Registros <span class="apagado">(${filtrados.length})</span></h3>
    ${filtrados.length === 0 ? html`<p class="nota">Ningún registro cumple los filtros.</p>` : ''}
    ${[...porFecha.entries()].map(([fecha, lista]) => html`<section class="dia">
      <h4 class="dia-titulo">${f.capitalizar(f.fechaLarga(fecha))}</h4>
      <div class="tabla-envoltura"><table class="tabla tabla-historial">
        <thead><tr>
          <th scope="col">Hora</th><th scope="col">Partido</th><th scope="col">Mercado</th><th scope="col">Estadístico</th>
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
  } else if (elemento.id === 'fecha') {
    estado.fecha = elemento.value;
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
