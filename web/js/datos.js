// Lectura de archivos. La página se publica con la misma estructura de carpetas que el repositorio,
// así que las rutas se resuelven desde la raíz del sitio.

const RAIZ = new URL('../../', import.meta.url);

export async function leerJson(ruta) {
  const respuesta = await fetch(new URL(ruta, RAIZ), { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta} (error ${respuesta.status}).`);
  return respuesta.json();
}

export async function cargarConfig() {
  const [mercados, casas] = await Promise.all([leerJson('config/mercados.json'), leerJson('config/casas.json')]);
  return { mercados, casas };
}

/** Todos los registros del historial guardados en datos/. */
export async function cargarHistorial() {
  const indice = await leerJson('datos/indice.json');
  const rutas = indice.archivos.filter((r) => r.startsWith('historial/'));
  const archivos = await Promise.all(rutas.map((r) => leerJson(`datos/${r}`)));
  return archivos.flatMap((a) => a.registros);
}
