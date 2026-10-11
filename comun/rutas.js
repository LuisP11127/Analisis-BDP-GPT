// Dónde se guarda cada archivo dentro de la carpeta de datos.
// Las fechas de los archivos son fechas de Lima, porque los partidos del día son los del día en Perú.

export const ZONA_HORARIA = 'America/Lima';

const formatoFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha AAAA-MM-DD en Lima de una fecha y hora ISO. */
export function fechaLocal(fechaHora) {
  return formatoFecha.format(new Date(fechaHora));
}

/** Convierte un id (sofascore:17) en un nombre de carpeta válido en todos los sistemas (sofascore-17). */
export function segmento(id) {
  return id.replace(':', '-');
}

export function rutaPartidos(partido) {
  const mes = partido.fecha_local.slice(0, 7);
  return `partidos/${partido.deporte}/${segmento(partido.liga.id)}/${segmento(partido.temporada.id)}/${mes}.json`;
}

export function rutaHistorial(registro) {
  const anio = registro.fecha_local.slice(0, 4);
  return `historial/${registro.deporte}/${anio}/${registro.fecha_local}.json`;
}

export function rutaEquivalencias(deporte) {
  return `equivalencias/${deporte}.json`;
}

const PATRONES = [
  { tipo: 'partidos', patron: /^partidos\/(futbol|basquet|beisbol)\/[^/]+\/[^/]+\/\d{4}-\d{2}\.json$/ },
  { tipo: 'historial', patron: /^historial\/(futbol|basquet|beisbol)\/\d{4}\/\d{4}-\d{2}-\d{2}\.json$/ },
  { tipo: 'equivalencias', patron: /^equivalencias\/(futbol|basquet|beisbol)\.json$/ },
];

/** Tipo de archivo según su ruta relativa a la carpeta de datos, o null si la ruta no corresponde a ninguno. */
export function clasificarRuta(ruta) {
  for (const { tipo, patron } of PATRONES) {
    const coincidencia = ruta.match(patron);
    if (coincidencia) return { tipo, deporte: coincidencia[1] };
  }
  return null;
}
