// Carga esquemas y configuración desde el disco y crea el validador (solo para Node).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { NOMBRES_ESQUEMAS, crearValidador } from '../comun/validacion.js';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function leerJson(archivo) {
  return JSON.parse(await readFile(archivo, 'utf8'));
}

export async function leerEsquemas() {
  const esquemas = {};
  for (const nombre of NOMBRES_ESQUEMAS) {
    esquemas[nombre] = await leerJson(path.join(RAIZ, 'esquemas', `${nombre}.schema.json`));
  }
  return esquemas;
}

export async function leerConfig() {
  return {
    mercados: await leerJson(path.join(RAIZ, 'config', 'mercados.json')),
    casas: await leerJson(path.join(RAIZ, 'config', 'casas.json')),
  };
}

export function crearAjv() {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true, strictRequired: false });
  addFormats(ajv);
  return ajv;
}

export async function cargarValidador() {
  return crearValidador({ ajv: crearAjv(), esquemas: await leerEsquemas(), config: await leerConfig() });
}

const IGNORADOS = new Set(['README.md', '.gitkeep']);

/** Todos los archivos de una carpeta de datos, con su ruta relativa en formato a/b/c.json. */
export async function listarArchivos(carpeta) {
  const entradas = await readdir(carpeta, { recursive: true, withFileTypes: true });
  return entradas
    .filter((e) => e.isFile() && !IGNORADOS.has(e.name))
    .map((e) => path.relative(carpeta, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

/** Lee todos los archivos de una carpeta de datos como [{ ruta, contenido }]. */
export async function leerCarpeta(carpeta) {
  const archivos = [];
  for (const ruta of await listarArchivos(carpeta)) {
    archivos.push({ ruta, contenido: await leerJson(path.join(carpeta, ruta)) });
  }
  return archivos;
}
