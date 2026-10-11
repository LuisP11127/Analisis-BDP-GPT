// Valida las carpetas de datos indicadas. Uso: node herramientas/validar.mjs datos ejemplos/datos

import path from 'node:path';
import { RAIZ, cargarValidador, leerJson, listarArchivos } from './cargar.mjs';

const carpetas = process.argv.slice(2);
if (carpetas.length === 0) {
  console.error('Indica al menos una carpeta de datos. Ej.: node herramientas/validar.mjs datos');
  process.exit(2);
}

const validador = await cargarValidador();
let totalErrores = 0;

for (const carpeta of carpetas) {
  const absoluta = path.resolve(RAIZ, carpeta);
  const archivos = [];
  const errores = [];
  for (const ruta of await listarArchivos(absoluta)) {
    try {
      archivos.push({ ruta, contenido: await leerJson(path.join(absoluta, ruta)) });
    } catch (error) {
      errores.push(`${ruta}: no es un JSON válido (${error.message})`);
    }
  }
  errores.push(...validador.validarDatos(archivos));
  totalErrores += errores.length;
  console.log(`${carpeta}: ${archivos.length} archivos, ${errores.length} errores`);
  for (const error of errores) console.log(`  ${error}`);
}

process.exit(totalErrores > 0 ? 1 : 0);
