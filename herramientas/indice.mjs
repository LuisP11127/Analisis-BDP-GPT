// Escribe el indice.json de cada carpeta de datos. Uso: npm run indice

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crearIndice } from '../comun/rutas.js';
import { INDICE, RAIZ, listarArchivos } from './cargar.mjs';
import { TODAS } from './carpetas.mjs';

for (const carpeta of TODAS) {
  const absoluta = path.join(RAIZ, carpeta);
  const indice = crearIndice(await listarArchivos(absoluta));
  await writeFile(path.join(absoluta, INDICE), `${JSON.stringify(indice, null, 2)}\n`);
  console.log(`${carpeta}/${INDICE}: ${indice.archivos.length} archivos`);
}
