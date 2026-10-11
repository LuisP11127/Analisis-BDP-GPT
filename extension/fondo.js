// Service worker de la extensión. Recibe los pedidos de la página del proyecto (a través de puente.js)
// y de la página de diagnóstico, y los hace desde una pestaña del sitio, igual que los haría la propia
// página del sitio: mismo origen, mismas cookies y la misma cabecera que usa su API.
// Los pedidos a un sitio van de a uno, con una pausa entre ellos. Si no hay una pestaña del sitio
// abierta, abre una en segundo plano y la cierra cuando lleva un minuto sin usarse.

import { SITIOS, urlDelPedido } from './sitios.js';

const VERSION = chrome.runtime.getManifest().version;
const ESPERA_CARGA_MS = 30000;
const ESPERA_CABECERA_MS = 5000;
const CIERRE_MS = 60000;
const ALARMA_CIERRE = 'cerrar-pestanas';

const dormir = (ms) => new Promise((resolver) => { setTimeout(resolver, ms); });

// ---------------------------------------------------------------- cabeceras de la API de cada sitio

// Copia en memoria de storage.session: código del sitio → { cabecera: valor }.
const cabeceras = {};

async function cabecerasDe(codigo) {
  if (!cabeceras[codigo]) {
    const clave = `cabeceras.${codigo}`;
    cabeceras[codigo] = (await chrome.storage.session.get(clave))[clave] ?? {};
  }
  return cabeceras[codigo];
}

for (const [codigo, sitio] of Object.entries(SITIOS)) {
  if (!sitio.cabeceras?.length) continue;
  chrome.webRequest.onSendHeaders.addListener((detalles) => {
    const vistas = {};
    for (const { name: nombre, value: valor } of detalles.requestHeaders ?? []) {
      if (sitio.cabeceras.includes(nombre.toLowerCase()) && valor) vistas[nombre.toLowerCase()] = valor;
    }
    const actuales = cabeceras[codigo] ?? {};
    if (Object.entries(vistas).every(([nombre, valor]) => actuales[nombre] === valor)) return;
    cabeceras[codigo] = { ...actuales, ...vistas };
    chrome.storage.session.set({ [`cabeceras.${codigo}`]: cabeceras[codigo] });
  }, { urls: [sitio.api] }, ['requestHeaders']);
}

async function esperarCabeceras(codigo, sitio) {
  const limite = Date.now() + ESPERA_CABECERA_MS;
  while (Date.now() < limite) {
    const actuales = await cabecerasDe(codigo);
    if (sitio.cabeceras.every((nombre) => actuales[nombre])) return;
    await dormir(250);
  }
}

// ---------------------------------------------------------------- pestañas

// Pestañas que abrió la extensión: id → { sitio, uso }. Se guardan en storage.session para no
// perderlas si el navegador detiene el service worker entre un pedido y otro.
async function pestanasPropias() {
  return (await chrome.storage.session.get('pestanas')).pestanas ?? {};
}

async function marcarUso(idPestana, codigo, abiertaAhora = false) {
  const pestanas = await pestanasPropias();
  if (!abiertaAhora && !pestanas[idPestana]) return;
  pestanas[idPestana] = { sitio: codigo, uso: Date.now() };
  await chrome.storage.session.set({ pestanas });
  await chrome.alarms.create(ALARMA_CIERRE, { when: Date.now() + CIERRE_MS });
}

chrome.alarms.onAlarm.addListener(async (alarma) => {
  if (alarma.name !== ALARMA_CIERRE) return;
  const pestanas = await pestanasPropias();
  let quedan = false;
  for (const [id, { uso }] of Object.entries(pestanas)) {
    if (Date.now() - uso < CIERRE_MS - 1000) {
      quedan = true;
      continue;
    }
    delete pestanas[id];
    try {
      const pestana = await chrome.tabs.get(Number(id));
      // Si el usuario la está mirando, la deja abierta.
      if (!pestana.active) await chrome.tabs.remove(pestana.id);
    } catch {
      // Ya estaba cerrada.
    }
  }
  await chrome.storage.session.set({ pestanas });
  if (quedan) await chrome.alarms.create(ALARMA_CIERRE, { when: Date.now() + CIERRE_MS });
});

chrome.tabs.onRemoved.addListener(async (id) => {
  const pestanas = await pestanasPropias();
  if (!pestanas[id]) return;
  delete pestanas[id];
  await chrome.storage.session.set({ pestanas });
});

function esperarCarga(idPestana) {
  return new Promise((resolver, rechazar) => {
    const terminar = (error) => {
      clearTimeout(reloj);
      chrome.tabs.onUpdated.removeListener(alActualizar);
      chrome.tabs.onRemoved.removeListener(alCerrar);
      if (error) rechazar(new Error(error));
      else resolver();
    };
    const alActualizar = (id, cambio) => { if (id === idPestana && cambio.status === 'complete') terminar(); };
    const alCerrar = (id) => { if (id === idPestana) terminar('se cerró la pestaña'); };
    const reloj = setTimeout(() => terminar('la página tardó demasiado en cargar'), ESPERA_CARGA_MS);
    chrome.tabs.onUpdated.addListener(alActualizar);
    chrome.tabs.onRemoved.addListener(alCerrar);
    chrome.tabs.get(idPestana).then(
      (pestana) => { if (pestana.status === 'complete') terminar(); },
      () => terminar('se cerró la pestaña'),
    );
  });
}

async function pestanaDe(codigo, sitio) {
  const abiertas = (await chrome.tabs.query({ url: sitio.pestanas })).filter((p) => !p.discarded);
  const lista = abiertas.find((p) => p.status === 'complete');
  if (lista) return lista.id;
  if (abiertas[0]) {
    await esperarCarga(abiertas[0].id);
    return abiertas[0].id;
  }
  const nueva = await chrome.tabs.create({ url: sitio.inicio, active: false });
  await marcarUso(nueva.id, codigo, true);
  await esperarCarga(nueva.id);
  // Al cargar, la página del sitio hace sus propios pedidos a la API: así se conoce su cabecera.
  if (sitio.cabeceras?.length) await esperarCabeceras(codigo, sitio);
  return nueva.id;
}

// ---------------------------------------------------------------- pedidos

// Se ejecuta dentro de la pestaña del sitio, así que no puede usar nada de este archivo.
async function pedirDesdeLaPagina(url, cabecerasDelSitio) {
  try {
    const respuesta = await fetch(url, { headers: cabecerasDelSitio, credentials: 'include' });
    const texto = await respuesta.text();
    if (!respuesta.ok) return { estado: respuesta.status, datos: null };
    try {
      return { estado: respuesta.status, datos: JSON.parse(texto) };
    } catch {
      return { estado: respuesta.status, error: 'la respuesta no es JSON' };
    }
  } catch (error) {
    return { estado: 0, error: String(error?.message ?? error) };
  }
}

function interpretar(sitio, { estado, datos, error }) {
  if (error) throw new Error(`${sitio.nombre} no respondió bien: ${error}.`);
  if (estado === 200) return { ok: true, estado, datos };
  // El dato no existe, por ejemplo un partido sin estadísticas o una liga sin tabla.
  if (estado === 404) return { ok: true, estado, datos: null };
  if (estado === 403 || estado === 429) {
    throw new Error(`${sitio.nombre} rechazó el pedido (error ${estado}). Abre ${sitio.inicio} en una pestaña, `
      + 'espera a que cargue y vuelve a intentar. Si sigue pasando, espera unos minutos.');
  }
  throw new Error(`${sitio.nombre} respondió con el error ${estado}.`);
}

// Una cola por sitio: los pedidos van de a uno y con una pausa mínima entre ellos.
const colas = new Map();

function enCola(codigo, esperaMs, tarea) {
  const cola = colas.get(codigo) ?? { cadena: Promise.resolve(), ultimo: 0 };
  colas.set(codigo, cola);
  const resultado = cola.cadena.then(async () => {
    const falta = cola.ultimo + esperaMs - Date.now();
    if (falta > 0) await dormir(falta);
    try {
      return await tarea();
    } finally {
      cola.ultimo = Date.now();
    }
  });
  cola.cadena = resultado.catch(() => {});
  return resultado;
}

async function pedir(codigo, ruta) {
  const url = urlDelPedido(codigo, ruta);
  const sitio = SITIOS[codigo];
  return enCola(codigo, sitio.esperaMs, async () => {
    let respuesta = null;
    let fallo = null;
    // Si la pestaña cambió de página o se cerró en medio del pedido, se intenta una vez más con otra.
    for (let intento = 0; intento < 2 && !respuesta; intento += 1) {
      const idPestana = await pestanaDe(codigo, sitio);
      try {
        const [ejecucion] = await chrome.scripting.executeScript({
          target: { tabId: idPestana },
          func: pedirDesdeLaPagina,
          args: [url, await cabecerasDe(codigo)],
        });
        respuesta = ejecucion?.result ?? null;
        await marcarUso(idPestana, codigo);
      } catch (error) {
        fallo = error;
      }
    }
    if (!respuesta) throw new Error(`No se pudo usar la pestaña de ${sitio.nombre}: ${fallo?.message ?? 'no hubo respuesta'}.`);
    return interpretar(sitio, respuesta);
  });
}

// ---------------------------------------------------------------- mensajes

async function diagnostico() {
  const sitios = [];
  for (const [codigo, sitio] of Object.entries(SITIOS)) {
    sitios.push({
      codigo,
      nombre: sitio.nombre,
      cabeceras: Object.keys(await cabecerasDe(codigo)),
      pestanas: (await chrome.tabs.query({ url: sitio.pestanas })).length,
    });
  }
  return { ok: true, version: VERSION, sitios };
}

async function atender(mensaje) {
  switch (mensaje?.tipo) {
    case 'estado': return { ok: true, version: VERSION, sitios: Object.keys(SITIOS) };
    case 'pedir': return pedir(mensaje.sitio, mensaje.ruta);
    case 'diagnostico': return diagnostico();
    default: throw new Error('Pedido desconocido.');
  }
}

// Solo responde a las partes de esta misma extensión: puente.js y la página de diagnóstico.
chrome.runtime.onMessage.addListener((mensaje, remitente, responder) => {
  if (remitente.id !== chrome.runtime.id) return false;
  atender(mensaje).then(responder, (error) => responder({ ok: false, error: error?.message ?? String(error) }));
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('diagnostico.html') });
});
