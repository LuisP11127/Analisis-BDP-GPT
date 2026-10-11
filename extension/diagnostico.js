// Página de diagnóstico: se abre al hacer clic en el ícono de la extensión. Hace un pedido de prueba a
// cada sitio y arma un reporte para copiar y compartir si algo falla.

const PRUEBAS = {
  // Lista de torneos de fútbol del día en Lima: es lo primero que pide la página del proyecto.
  sofascore: (hoy) => `/api/v1/sport/football/scheduled-tournaments/${hoy}/page/1`,
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
    const ruta = PRUEBAS[sitio.codigo]?.(hoyEnLima());
    if (!ruta) continue;
    const desde = performance.now();
    try {
      const respuesta = await chrome.runtime.sendMessage({ tipo: 'pedir', sitio: sitio.codigo, ruta });
      const ms = Math.round(performance.now() - desde);
      if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'sin respuesta');
      const torneos = respuesta.datos?.scheduled?.length;
      mostrar(`${sitio.nombre}: funciona (respuesta ${respuesta.estado} en ${ms} ms${torneos === undefined ? '' : `, ${torneos} torneos en la primera página`}).`, 'bien');
    } catch (error) {
      mostrar(`${sitio.nombre}: falló. ${error.message}`, 'mal');
    }
  }
  const despues = await estado();
  for (const sitio of despues.sitios) {
    mostrar(`${sitio.nombre}: ${sitio.pestanas} pestaña(s) abierta(s); cabeceras de la API conocidas: ${sitio.cabeceras.join(', ') || 'ninguna'}.`);
  }
  $('#probar').disabled = false;
  $('#copiar').disabled = false;
}

$('#probar').addEventListener('click', probar);
$('#copiar').addEventListener('click', async () => {
  await navigator.clipboard.writeText(lineas.join('\n'));
  $('#copiado').textContent = 'Reporte copiado.';
});

estado().catch((error) => { $('#version').textContent = `No se pudo leer el estado: ${error.message}`; });
