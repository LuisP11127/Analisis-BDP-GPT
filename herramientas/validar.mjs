// Valida las carpetas de datos y sus índices. Uso: npm run validar

import path from 'node:path';
import { INDICE, RAIZ, cargarValidador, leerJson, listarArchivos } from './cargar.mjs';
import { CARPETAS_DATOS } from './carpetas.mjs';

const validador = await cargarValidador();
let totalErrores = 0;

async function leerCarpeta(carpeta, errores) {
  const absoluta = path.join(RAIZ, carpeta);
  const rutas = await listarArchivos(absoluta);
  const archivos = [];
  for (const ruta of rutas) {
    try {
      archivos.push({ ruta, contenido: await leerJson(path.join(absoluta, ruta)) });
    } catch (error) {
      errores.push(`${ruta}: no es un JSON válido (${error.message})`);
    }
  }
  try {
    errores.push(...validador.validarIndice(await leerJson(path.join(absoluta, INDICE)), rutas));
  } catch (error) {
    errores.push(`${INDICE}: no se pudo leer (${error.message}). Ejecuta npm run indice`);
  }
  return archivos;
}

function informar(carpeta, cantidad, errores) {
  totalErrores += errores.length;
  console.log(`${carpeta}: ${cantidad} archivos, ${errores.length} errores`);
  for (const error of errores) console.log(`  ${error}`);
}

for (const carpeta of CARPETAS_DATOS) {
  const errores = [];
  const archivos = await leerCarpeta(carpeta, errores);
  errores.push(...validador.validarDatos(archivos));
  informar(carpeta, archivos.length, errores);
}

process.exit(totalErrores > 0 ? 1 : 0);
