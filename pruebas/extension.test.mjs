import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ } from '../herramientas/cargar.mjs';
import { SITIOS, urlDelPedido } from '../extension/sitios.js';
import { crearLector } from '../web/js/extension.js';
import { RUTAS as APUESTA_TOTAL } from '../web/js/fuentes/apuestatotal.js';
import { RUTAS as BETANO } from '../web/js/fuentes/betano.js';
import { rutaFija, RUTAS } from '../web/js/fuentes/sofascore.js';

test('extensión: solo acepta pedidos a la API de los sitios conocidos', () => {
  assert.equal(urlDelPedido('sofascore', '/api/v1/event/16280837/statistics'), 'https://www.sofascore.com/api/v1/event/16280837/statistics');
  assert.equal(urlDelPedido('sofascore', RUTAS.torneosDelDia('futbol', '2026-10-11', 1)),
    'https://www.sofascore.com/api/v1/sport/football/scheduled-tournaments/2026-10-11/page/1');
  for (const ruta of ['/api/v1/event/1?x=1', '/api/v1/../user', '/api/v1/event//1', '/usuario', 'https://otro.com/api/v1/x', '/api/v1/', 42, undefined]) {
    assert.throws(() => urlDelPedido('sofascore', ruta), /Ruta no permitida/, String(ruta));
  }
  assert.throws(() => urlDelPedido('te_apuesto', '/api/v1/x'), /Sitio desconocido/);
  assert.throws(() => urlDelPedido('toString', '/api/v1/x'), /Sitio desconocido/);
});

test('extensión: en Betano acepta páginas de liga y de partido con los parámetros de su página', () => {
  assert.equal(urlDelPedido('betano', BETANO.pagina('/sport/futbol/peru/liga-1/17079/')),
    'https://www.betano.pe/api/sport/futbol/peru/liga-1/17079/?req=la,s,stnf,c,mb');
  assert.equal(urlDelPedido('betano', BETANO.pestana('/cuotas-de-partido/liverpool-fc-manchester-city/92398258/', '6')),
    'https://www.betano.pe/api/cuotas-de-partido/liverpool-fc-manchester-city/92398258/?bt=6&req=la,s,stnf,c,mb');
  for (const ruta of ['/api/kb-config/', '/api/sport/futbol/x/?otro=1', '/api/sport/../usuario/', '/api/cuotas-de-partido/x/1', '/api/v1/event/1']) {
    assert.throws(() => urlDelPedido('betano', ruta), /Ruta no permitida/, ruta);
  }
});

test('extensión: en Apuesta Total acepta la lista de partidos y los mercados de varios partidos', () => {
  assert.equal(urlDelPedido('apuesta_total', APUESTA_TOTAL.eventos), 'https://prod20392.kmianko.com/api/pulse/snapshot/events?lang=ES-PE&t=hPNl');
  const mercados = APUESTA_TOTAL.mercados(['888089270525636608', '886663999788429312']);
  assert.equal(urlDelPedido('apuesta_total', mercados), `https://prod20392.kmianko.com${mercados}`);
  const muchos = Array.from({ length: 10 }, (_, i) => String(900000000000000000 + i));
  assert.ok(urlDelPedido('apuesta_total', APUESTA_TOTAL.mercados(muchos)));
  for (const ruta of [
    '/api/master/auth/signToken',
    '/api/eventlist/eu/markets/all?markets=1:OU200',
    '/api/pulse/snapshot/events?lang=ES-PE&t=hPNl&otro=1',
    '/api/eventpage/events/888089270525636608?hideX25X75Selections=false',
    '/api/eventlist/eu/markets/all?markets=1%3AOU200%26x%3D1',
  ]) {
    assert.throws(() => urlDelPedido('apuesta_total', ruta), /Ruta no permitida/, ruta);
  }
});

test('extensión: cada origen de sitios.js tiene permiso en el manifiesto', async () => {
  const manifiesto = JSON.parse(await readFile(path.join(RAIZ, 'extension', 'manifest.json'), 'utf8'));
  for (const sitio of Object.values(SITIOS)) {
    assert.ok(manifiesto.host_permissions.includes(`${sitio.origen}/*`), sitio.nombre);
    // Si la API está en un marco, la página que lo contiene es de otro origen y también necesita permiso.
    const pagina = new URL(sitio.inicio).origin;
    if (sitio.marco) assert.ok(manifiesto.host_permissions.includes(`${pagina}/*`), sitio.nombre);
    else assert.equal(pagina, sitio.origen);
    assert.ok(sitio.pestanas.startsWith(pagina), sitio.nombre);
  }
  const paginas = manifiesto.content_scripts[0].matches;
  assert.ok(paginas.includes('https://luisp11127.github.io/Analisis-BDP-GPT/*'));
});

test('página: los pedidos a la extensión van de a uno y se recuerdan los que no cambian', async () => {
  let enCurso = 0;
  let maximo = 0;
  const pedidos = [];
  const conexion = {
    async pedir(sitio, ruta) {
      enCurso += 1;
      maximo = Math.max(maximo, enCurso);
      pedidos.push(ruta);
      await new Promise((listo) => { setTimeout(listo, 5); });
      enCurso -= 1;
      if (ruta.includes('falla')) throw new Error('falló');
      return { estado: 200, datos: { ruta } };
    },
  };
  const obtener = crearLector(conexion, 'sofascore', { guardar: rutaFija });
  const fija = RUTAS.estadisticas(1);
  const resultados = await Promise.all([obtener(fija), obtener(RUTAS.partido(1)), obtener(fija), obtener(RUTAS.partido(1))]);
  assert.equal(maximo, 1);
  assert.deepEqual(pedidos, [fija, RUTAS.partido(1), RUTAS.partido(1)]);
  assert.equal(resultados[2].datos.ruta, fija);
  // Un pedido que falla no se recuerda y no detiene los siguientes.
  const fallida = '/api/v1/event/2/statistics-falla';
  await assert.rejects(obtener(fallida), /falló/);
  assert.equal((await obtener(RUTAS.partido(3))).datos.ruta, RUTAS.partido(3));
});
