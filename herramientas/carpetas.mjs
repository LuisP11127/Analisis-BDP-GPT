// Carpetas con datos del proyecto. Cada una tiene su indice.json.

/** Carpetas de datos guardados: partidos, historial y equivalencias. */
export const CARPETAS_DATOS = ['datos', 'ejemplos/datos'];

/** Carpetas de extracciones del día, con la carpeta de datos contra la que se revisan. */
export const CARPETAS_EXTRACCION = [{ carpeta: 'ejemplos/extraccion', datos: 'ejemplos/datos' }];

export const TODAS = [...CARPETAS_DATOS, ...CARPETAS_EXTRACCION.map((c) => c.carpeta)];
