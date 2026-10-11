// Página de diagnóstico: se abre al hacer clic en el ícono de la extensión. Hace un pedido de prueba a
// cada sitio y arma un reporte para copiar y compartir si algo falla.

// Por cada sitio, los pedidos de prueba y qué contar en la respuesta.
const PRUEBAS = {
  sofascore: [
    // Lista de torneos de fútbol del día en Lima: es lo primero que pide la página del proyecto.
    { ruta: (hoy) => `/api/v1/sport/football/scheduled-tournaments/${hoy}/page/1`, contar: (d) => `${d?.scheduled?.length ?? 0} torneos en la primera página` },
  ],
  betano: [
    // Página de liga con la que se lee el catálogo de ligas.
    { ruta: () => '/api/sport/futbol/inglaterra/premier-league/1r/?req=la,s,stnf,c,mb', contar: (d) => `${d?.data?.blocks?.[0]?.events?.length ?? 0} partidos de la Premier League` },
    // Una liga con la dirección del catálogo, como las pide la página del proyecto.
    { ruta: () => '/api/sport/futbol/peru/liga-1/17079/?req=la,s,stnf,c,mb', contar: (d) => `${d?.data?.blocks?.[0]?.events?.length ?? 0} partidos de la Liga 1 de Perú` },
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
    for (const prueba of PRUEBAS[sitio.codigo] ?? []) {
      const ruta = prueba.ruta(hoyEnLima());
      const desde = performance.now();
      try {
        const respuesta = await chrome.runtime.sendMessage({ tipo: 'pedir', sitio: sitio.codigo, ruta });
        const ms = Math.round(performance.now() - desde);
        if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'sin respuesta');
        const bien = respuesta.estado === 200;
        mostrar(`${sitio.nombre}: ${bien ? 'funciona' : 'no encontró el dato'} (respuesta ${respuesta.estado} en ${ms} ms, ${prueba.contar(respuesta.datos)}). ${ruta}`, bien ? 'bien' : 'mal');
      } catch (error) {
        mostrar(`${sitio.nombre}: falló. ${error.message} ${ruta}`, 'mal');
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

$('#probar').addEventListener('click', probar);
$('#copiar').addEventListener('click', async () => {
  await navigator.clipboard.writeText(lineas.join('\n'));
  $('#copiado').textContent = 'Reporte copiado.';
});

estado().catch((error) => { $('#version').textContent = `No se pudo leer el estado: ${error.message}`; });
