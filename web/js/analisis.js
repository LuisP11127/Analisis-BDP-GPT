// Arma el resultado del análisis a partir de la extracción del día y de los partidos seleccionados.
// Cada mercado con cuotas y con predicción produce un registro listo para el historial.

import { calcularCandidata, idRegistro } from '../../comun/reglas.js';

/**
 * Modelo de prueba: usa las predicciones ficticias que trae la extracción de ejemplo.
 * El análisis estadístico real (paso 5) tendrá la misma forma: predecir(entrada, partido).
 */
export const modeloDeEjemplo = {
  nombre: 'Predicciones de ejemplo',
  predecir: (entrada) => entrada.prediccion_ejemplo ?? { estadistico: null, red: null, entrada_red: null },
};

function crearRegistro(entrada, partido, candidata, prediccion, ahora) {
  const registro = {
    id: null,
    partido_id: partido.id,
    deporte: partido.deporte,
    liga: { id: partido.liga.id, nombre: partido.liga.nombre },
    inicio: partido.inicio,
    fecha_local: partido.fecha_local,
    local: partido.local,
    visitante: partido.visitante,
    mercado: entrada.mercado,
    ...(entrada.jugador ? { jugador: entrada.jugador, estadistica_jugador: entrada.estadistica_jugador } : {}),
    analizado_en: ahora,
    ofertas: entrada.ofertas,
    candidata,
    estadistico: prediccion.estadistico,
    red: prediccion.red ?? null,
    entrada_red: prediccion.entrada_red ?? null,
    apuesta: null,
    resultado: { estado: 'pendiente', valor_real: null, lado_ganador: null },
  };
  registro.id = idRegistro(registro);
  return registro;
}

function ordenProps(definicion) {
  const posicion = new Map((definicion.estadisticas_jugador ?? []).map((e, i) => [e.codigo, i]));
  return (a, b) => (a.jugador.equipo === b.jugador.equipo ? 0 : a.jugador.equipo === 'local' ? -1 : 1)
    || a.jugador.nombre.localeCompare(b.jugador.nombre)
    || (posicion.get(a.estadistica_jugador) ?? 99) - (posicion.get(b.estadistica_jugador) ?? 99);
}

/**
 * Resultado del análisis: deportes → partidos → mercados, en el orden del catálogo.
 * - extraccion: extracción del día (esquemas/extraccion.schema.json).
 * - seleccion: Set con los ids de los partidos elegidos.
 * - config: { mercados, casas }.
 * - modelo: objeto con predecir(entrada, partido) → { estadistico, red, entrada_red }.
 * - ahora: hora del análisis en ISO; no puede ser posterior al inicio de los partidos.
 */
export function analizar({ extraccion, seleccion, config, modelo, ahora }) {
  const prioridad = config.casas.casas.map((c) => c.codigo);
  const entradasPorPartido = new Map();
  for (const entrada of extraccion.mercados) {
    if (!entradasPorPartido.has(entrada.partido_id)) entradasPorPartido.set(entrada.partido_id, []);
    entradasPorPartido.get(entrada.partido_id).push(entrada);
  }

  const deportes = [];
  const registros = [];
  for (const deporte of config.mercados.deportes) {
    const partidos = extraccion.partidos
      .filter((p) => p.deporte === deporte.codigo && seleccion.has(p.id))
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio) || a.liga.nombre.localeCompare(b.liga.nombre));
    if (partidos.length === 0) continue;
    deportes.push({
      deporte,
      partidos: partidos.map((partido) => {
        const entradas = entradasPorPartido.get(partido.id) ?? [];
        return {
          partido,
          mercados: deporte.mercados.map((definicion) => {
            const delMercado = entradas.filter((e) => e.mercado === definicion.codigo);
            if (definicion.por_jugador) delMercado.sort(ordenProps(definicion));
            const filas = delMercado.map((entrada) => {
              const candidata = calcularCandidata(entrada.ofertas, prioridad);
              const prediccion = modelo.predecir(entrada, partido);
              const registro = candidata && prediccion.estadistico
                ? crearRegistro(entrada, partido, candidata, prediccion, ahora)
                : null;
              if (registro) registros.push(registro);
              return { entrada, candidata, prediccion, registro };
            });
            return { definicion, filas };
          }),
        };
      }),
    });
  }
  return { deportes, registros };
}

/** Partidos de la extracción agrupados por deporte y liga, para la lista de selección. */
export function agruparPartidos(extraccion, config) {
  const conCuotas = new Map();
  for (const entrada of extraccion.mercados) {
    if (!conCuotas.has(entrada.partido_id)) conCuotas.set(entrada.partido_id, new Set());
    conCuotas.get(entrada.partido_id).add(entrada.mercado);
  }
  return config.mercados.deportes.map((deporte) => {
    const ligas = new Map();
    for (const partido of extraccion.partidos.filter((p) => p.deporte === deporte.codigo)) {
      if (!ligas.has(partido.liga.id)) ligas.set(partido.liga.id, { liga: partido.liga, partidos: [] });
      ligas.get(partido.liga.id).partidos.push({ partido, mercadosConCuotas: conCuotas.get(partido.id)?.size ?? 0 });
    }
    const lista = [...ligas.values()]
      .map((l) => ({ ...l, partidos: l.partidos.sort((a, b) => new Date(a.partido.inicio) - new Date(b.partido.inicio)) }))
      .sort((a, b) => (a.liga.pais ?? '').localeCompare(b.liga.pais ?? '') || a.liga.nombre.localeCompare(b.liga.nombre));
    return { deporte, ligas: lista };
  });
}
