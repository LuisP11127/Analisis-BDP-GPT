// Página de diagnóstico: se abre al hacer clic en el ícono de la extensión. Hace pedidos de prueba a cada
// sitio y arma un reporte para copiar y compartir si algo falla. También guarda la respuesta de una ruta
// en un archivo, para mandarla cuando haga falta una muestra de un sitio.

// Tipos de mercado de fútbol que lee la página del proyecto en Apuesta Total (web/js/fuentes/apuestatotal.js).
const MERCADOS_APUESTA_TOTAL = ['OU200', 'QA158', 'OU615', 'OU6010', 'OU121', 'OU2083', 'OU14'];

const futbolDe = (lista) => (Array.isArray(lista) ? lista.filter((e) => e.SportId === '1' && e.Type === 'Fixture') : []);

/** Próximo partido de fútbol que no empezó, de preferencia de una liga destacada. */
function proximoPartido(lista) {
  const proximos = futbolDe(lista).filter((e) => !e.IsLive && e.StartEventDate > Date.now()).sort((a, b) => a.StartEventDate - b.StartEventDate);
  return proximos.find((e) => e.IsTopLeague) ?? proximos[0] ?? null;
}

// Por cada sitio, los pedidos de prueba y qué contar en la respuesta. `ruta` recibe la fecha de hoy en Lima
// y los datos de la prueba anterior del mismo sitio; si devuelve null, la prueba no se puede hacer.
const PRUEBAS = {
  sofascore: [
    // Lista de torneos de fútbol del día en Lima: es lo primero que pide la página del proyecto.
    { ruta: (hoy) => `/api/v1/sport/football/scheduled-tournaments/${hoy}/page/1`, contar: (d) => `${d?.scheduled?.length ?? 0} torneos en la primera página` },
    // Todos los partidos del día en una sola lista: es la que usa el proyecto Analisis-BDP.
    { ruta: (hoy) => `/api/v1/sport/football/scheduled-events/${hoy}`, contar: (d) => `${d?.events?.length ?? 0} partidos en la lista del día` },
  ],
  betano: [
    // Página de liga con la que se lee el catálogo de ligas.
    { ruta: () => '/api/sport/futbol/inglaterra/premier-league/1r/?req=la,s,stnf,c,mb', contar: (d) => `${d?.data?.blocks?.[0]?.events?.length ?? 0} partidos de la Premier League` },
    // Una liga con la dirección del catálogo, como las pide la página del proyecto.
    { ruta: () => '/api/sport/futbol/peru/liga-1/17079/?req=la,s,stnf,c,mb', contar: (d) => `${d?.data?.blocks?.[0]?.events?.length ?? 0} partidos de la Liga 1 de Perú` },
  ],
  apuesta_total: [
    // Lista de todos los partidos.
    { ruta: () => '/api/pulse/snapshot/events?lang=ES-PE&t=hPNl', contar: (d) => `${futbolDe(d).length} partidos de fútbol de ${Array.isArray(d) ? d.length : 0} eventos` },
    // Cuotas de un partido de fútbol que todavía no empieza.
    {
      ruta: (hoy, anterior) => {
        const partido = proximoPartido(anterior);
        return partido ? `/api/eventlist/eu/markets/all?markets=${encodeURIComponent(`${partido._id}:${MERCADOS_APUESTA_TOTAL.join('|')}`)}` : null;
      },
      contar: (d, anterior) => {
        const partido = proximoPartido(anterior);
        const tipos = [...new Set((Array.isArray(d) ? d : []).map((m) => m.MarketType?._id))];
        return `${partido?.EventName ?? 'partido'}: ${tipos.length} de ${MERCADOS_APUESTA_TOTAL.length} mercados (${tipos.join(', ') || 'ninguno'})`;
      },
    },
  ],
};

const $ = (selector) => document.querySelector(selector);
const hoyEnLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const lineas = [];

function mostrar(texto, clase = '') {
  const elemento = document.createElement('li');
  elemento.textContent = texto;
  if (clase) elemento.className = clase;
  $('#resultados').append(elemento);
  lineas.push(texto);
}

async function estado() {
  const respuesta = await chrome.runtime.sendMessage({ tipo: 'diagnostico' });
  $('#version').textContent = `Versión ${respuesta.version}. Sitios: ${respuesta.sitios.map((s) => s.nombre).join(', ')}.`;
  return respuesta;
}

async function probar() {
  $('#probar').disabled = true;
  $('#copiar').disabled = true;
  $('#resultados').replaceChildren();
  lineas.length = 0;
  const inicio = await estado();
  lineas.push(`Análisis BDP · extensión ${inicio.version} · ${new Date().toISOString()}`, navigator.userAgent);
  for (const sitio of inicio.sitios) {
    let anterior = null;
    for (const prueba of PRUEBAS[sitio.codigo] ?? []) {
      const ruta = prueba.ruta(hoyEnLima(), anterior);
      if (!ruta) {
        mostrar(`${sitio.nombre}: no se pudo hacer una prueba porque la anterior no trajo datos.`, 'mal');
        continue;
      }
      const desde = performance.now();
      try {
        const respuesta = await chrome.runtime.sendMessage({ tipo: 'pedir', sitio: sitio.codigo, ruta });
        const ms = Math.round(performance.now() - desde);
        if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'sin respuesta');
        const bien = respuesta.estado === 200;
        mostrar(`${sitio.nombre}: ${bien ? 'funciona' : 'no encontró el dato'} (respuesta ${respuesta.estado} en ${ms} ms, ${prueba.contar(respuesta.datos, anterior)}). ${ruta}`, bien ? 'bien' : 'mal');
        anterior = respuesta.datos;
      } catch (error) {
        mostrar(`${sitio.nombre}: falló. ${error.message} ${ruta}`, 'mal');
        anterior = null;
      }
    }
  }
  const despues = await estado();
  for (const sitio of despues.sitios) {
    mostrar(`${sitio.nombre}: ${sitio.pestanas} pestaña(s) abierta(s); cabeceras de la API conocidas: ${sitio.cabeceras.join(', ') || 'ninguna'}.`);
  }
  $('#probar').disabled = false;
  $('#copiar').disabled = false;
}

// ---------------------------------------------------------------- muestras

function descargar(nombre, texto) {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 10000);
}

async function guardarMuestra(evento) {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  const sitio = formulario.sitio.value;
  const ruta = formulario.ruta.value.trim();
  const aviso = $('#estado-muestra');
  formulario.querySelector('button').disabled = true;
  aviso.textContent = 'Pidiendo la ruta…';
  try {
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'pedir', sitio, ruta });
    if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'sin respuesta');
    if (respuesta.estado !== 200) throw new Error(`el sitio respondió ${respuesta.estado}`);
    const nombre = `${sitio}-${ruta.replace(/^\/+/, '').replace(/[^A-Za-z0-9.-]+/g, '_').slice(0, 80)}.json`;
    descargar(nombre, JSON.stringify(respuesta.datos));
    aviso.textContent = `Se guardó ${nombre} en tu carpeta de descargas.`;
  } catch (error) {
    aviso.textContent = `No se pudo guardar: ${error.message}`;
  } finally {
    formulario.querySelector('button').disabled = false;
  }
}

$('#probar').addEventListener('click', probar);
$('#copiar').addEventListener('click', async () => {
  await navigator.clipboard.writeText(lineas.join('\n'));
  $('#copiado').textContent = 'Reporte copiado.';
});
$('#muestra').addEventListener('submit', guardarMuestra);

estado().then((respuesta) => {
  for (const sitio of respuesta.sitios) {
    const opcion = document.createElement('option');
    opcion.value = sitio.codigo;
    opcion.textContent = sitio.nombre;
    $('#muestra').sitio.append(opcion);
  }
}, (error) => { $('#version').textContent = `No se pudo leer el estado: ${error.message}`; });
