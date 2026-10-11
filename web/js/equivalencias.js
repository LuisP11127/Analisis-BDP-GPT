// Equivalencias de nombres entre Sofascore y las casas (esquemas/equivalencias.schema.json): con qué nombre
// aparece cada liga y equipo en cada casa. La página las recuerda en el navegador; al guardar el historial
// (paso 6) se guardarán en datos/equivalencias/{deporte}.json con el mismo formato.

export const equivalenciasVacias = () => ({ version_formato: 1, ligas: [], equipos: [], jugadores: [] });

/** Nombres con que aparece cada liga o equipo en una casa: id → [nombres]. */
export function aliasDe(equivalencias, tipo, casa) {
  return new Map((equivalencias?.[tipo] ?? [])
    .filter((entrada) => entrada.alias?.[casa]?.length)
    .map((entrada) => [entrada.id, entrada.alias[casa]]));
}

/**
 * Agrega el nombre con que aparece una liga o un equipo en una casa. Crea la entrada si no existe.
 * Devuelve true si cambió algo.
 */
export function agregarAlias(equivalencias, tipo, { id, nombre }, casa, alias, confirmadoEn) {
  let entrada = equivalencias[tipo].find((e) => e.id === id);
  if (!entrada) {
    entrada = { id, nombre, alias: {} };
    equivalencias[tipo].push(entrada);
  }
  const conocidos = entrada.alias[casa] ?? [];
  if (conocidos.includes(alias)) return false;
  entrada.alias[casa] = [...conocidos, alias];
  if (confirmadoEn) entrada.confirmado_en = confirmadoEn;
  return true;
}
