// Arma la carpeta _sitio que se publica en GitHub Pages. Copia las carpetas que usa la página con la misma
// estructura que el repositorio, para que las rutas relativas funcionen igual en local y publicadas.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RAIZ } from './cargar.mjs';

const SITIO = path.join(RAIZ, '_sitio');
const CARPETAS = ['web', 'comun', 'config', 'esquemas', 'ejemplos', 'datos'];

await rm(SITIO, { recursive: true, force: true });
await mkdir(SITIO);
for (const carpeta of CARPETAS) await cp(path.join(RAIZ, carpeta), path.join(SITIO, carpeta), { recursive: true });
await writeFile(path.join(SITIO, 'index.html'), `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=web/">
  <title>Análisis BDP</title>
</head>
<body><p><a href="web/">Abrir la página</a></p></body>
</html>
`);
console.log(`Sitio armado en ${path.relative(RAIZ, SITIO)}/ con ${CARPETAS.join(', ')}`);
