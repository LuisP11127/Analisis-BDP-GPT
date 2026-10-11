// Servidor local para ver la página sin publicarla. Uso: npm run pagina, y abrir http://localhost:8080/web/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ } from './cargar.mjs';

const PUERTO = Number(process.env.PUERTO ?? 8080);
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

createServer(async (pedido, respuesta) => {
  const ruta = decodeURIComponent(new URL(pedido.url, 'http://localhost').pathname);
  let archivo = path.normalize(path.join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ) || archivo.includes(`${path.sep}node_modules${path.sep}`)) {
    respuesta.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(archivo)).isDirectory()) archivo = path.join(archivo, 'index.html');
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    respuesta.end(contenido);
  } catch {
    respuesta.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}).listen(PUERTO, () => console.log(`Página en http://localhost:${PUERTO}/web/`));
