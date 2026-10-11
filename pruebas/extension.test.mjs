import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ } from '../herramientas/cargar.mjs';
import { SITIOS, urlDelPedido } from '../extension/sitios.js';
import { crearLector } from '../web/js/extension.js';
import { RUTAS as BETANO } from '../web/js/fuentes/betano.js';
import { rutaFija, RUTAS } from '../web/js/fuentes/sofascore.js';

test('extensión: solo acepta pedidos a la API de los sitios conocidos', () => {
  assert.equal(urlDelPedido('sofascore', '/api/v1/event/16280837/statistics'), 'https://www.sofascore.com/api/v1/event/16280837/statistics');
  assert.equal(urlDelPedido('sofascore', RUTAS.torneosDelDia('futbol', '2026-10-11', 1)),
    'https://www.sofascore.com/api/v1/sport/football/scheduled-tournaments/2026-10-11/page/1');
  for (const ruta of ['/api/v1/event/1?x=1', '/api/v1/../user', '/api/v1/event//1', '/usuario', 'https://otro.com/api/v1/x', '/api/v1/', 42, undefined]) {
    assert.throws(() => urlDelPedido('sofascore', ruta), /Ruta no permitida/, String(ruta));
  }
  assert.throws(() => urlDelPedido('apuesta_total', '/api/v1/x'), /Sitio desconocido/);
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

test('extensión: cada origen de sitios.js tiene permiso en el manifiesto', async () => {
  const manifiesto = JSON.parse(await readFile(path.join(RAIZ, 'extension', 'manifest.json'), 'utf8'));
  for (const sitio of Object.values(SITIOS)) {
    assert.ok(manifiesto.host_permissions.includes(`${sitio.origen}/*`), sitio.nombre);
    assert.ok(sitio.inicio.startsWith(sitio.origen));
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
