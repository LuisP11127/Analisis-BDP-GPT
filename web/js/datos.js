// Lectura de archivos. La página se publica con la misma estructura de carpetas que el repositorio,
// así que las rutas se resuelven desde la raíz del sitio.

const RAIZ = new URL('../../', import.meta.url);

export const FUENTES = {
  prueba: {
    codigo: 'prueba',
    nombre: 'Datos de prueba',
    datos: 'ejemplos/datos/',
    extracciones: 'ejemplos/extraccion/',
  },
  real: {
    codigo: 'real',
    nombre: 'Datos reales',
    datos: 'datos/',
    extracciones: null,
  },
};

export async function leerJson(ruta) {
  const respuesta = await fetch(new URL(ruta, RAIZ), { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta} (error ${respuesta.status}).`);
  return respuesta.json();
}

export async function cargarConfig() {
  const [mercados, casas] = await Promise.all([leerJson('config/mercados.json'), leerJson('config/casas.json')]);
  return { mercados, casas };
}

/** Todos los registros del historial de una fuente. */
export async function cargarHistorial(fuente) {
  const indice = await leerJson(`${fuente.datos}indice.json`);
  const rutas = indice.archivos.filter((r) => r.startsWith('historial/'));
  const archivos = await Promise.all(rutas.map((r) => leerJson(`${fuente.datos}${r}`)));
  return archivos.flatMap((a) => a.registros);
}

/** Fechas con extracción disponible, de la más reciente a la más antigua. */
export async function listarExtracciones(fuente) {
  if (!fuente.extracciones) return [];
  const indice = await leerJson(`${fuente.extracciones}indice.json`);
  return indice.archivos.map((r) => r.replace(/\.json$/, '')).sort().reverse();
}

export function cargarExtraccion(fuente, fecha) {
  return leerJson(`${fuente.extracciones}${fecha}.json`);
}
