// Partes del modo con datos reales que no dependen de la pantalla: qué partidos se pueden analizar,
// cómo se ordenan las ligas, cómo se arma la extracción del día y el resumen de los últimos partidos.

import { totalTarjetas } from '../../comun/reglas.js';
import { fechaLocal } from '../../comun/rutas.js';

/** Fecha de hoy en Lima (AAAA-MM-DD). */
export const hoyEnLima = (ahora = new Date()) => fechaLocal(ahora);

/** Segundos aproximados que toma leer la previa de un partido: unos 65 pedidos con una pausa entre ellos. */
export const SEGUNDOS_POR_PARTIDO = 25;

/**
 * Un partido real solo se puede analizar si todavía no empezó: los datos previos y las cuotas tienen que
 * ser anteriores al inicio. Con datos de prueba todos se pueden elegir.
 */
export function seleccionable(partido, { prueba, ahora = new Date() }) {
  if (prueba) return true;
  return partido.estado === 'programado' && new Date(partido.inicio).getTime() > new Date(ahora).getTime();
}

const normalizar = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Ligas que coinciden con la búsqueda por país o nombre. */
export function filtrarLigas(ligas, texto) {
  const buscado = normalizar(texto ?? '');
  if (!buscado) return ligas;
  return ligas.filter((liga) => normalizar(`${liga.pais ?? ''} ${liga.nombre}`).includes(buscado));
}

/** Ligas agrupadas por país, en orden alfabético de país; dentro de cada país, en el orden de Sofascore. */
export function agruparLigasPorPais(ligas) {
  const paises = new Map();
  for (const liga of ligas) {
    const pais = liga.pais ?? 'Otras';
    if (!paises.has(pais)) paises.set(pais, []);
    paises.get(pais).push(liga);
  }
  return [...paises.entries()]
    .map(([pais, lista]) => ({ pais, ligas: lista, partidos: lista.reduce((n, l) => n + l.partidos, 0) }))
    .sort((a, b) => a.pais.localeCompare(b.pais, 'es'));
}

/**
 * Extracción del día con el formato de esquemas/extraccion.schema.json. Los partidos anteriores que no
 * usa ninguna previa se dejan fuera. `mercados` son las cuotas de las casas por partido y mercado.
 */
export function armarExtraccion({ fecha, generadoEn, partidos, anteriores, mercados = [] }) {
  const usados = new Set(partidos.flatMap((p) => (p.previa ? [...p.previa.ultimos_partidos.local, ...p.previa.ultimos_partidos.visitante] : [])));
  const delDia = new Set(partidos.map((p) => p.id));
  const lista = [...anteriores.values()]
    .filter((p) => usados.has(p.id) && !delDia.has(p.id))
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id));
  const extraccion = { version_formato: 1, fecha_local: fecha, generado_en: generadoEn, partidos, mercados };
  if (lista.length > 0) extraccion.partidos_anteriores = lista;
  return extraccion;
}

const PROPIAS = { goles: 'goles', corners: 'corners', tiros: 'tiros_al_arco', remates: 'remates' };

function valorDelEquipo(periodo, lado, campo) {
  if (campo === 'tarjetas') return totalTarjetas(periodo[lado]);
  return periodo[lado][PROPIAS[campo]] ?? null;
}

/**
 * Últimos partidos de un equipo vistos desde ese equipo: rival, resultado y cada estadística a favor y en
 * contra, más el promedio de cada una con los partidos que tienen el dato.
 * - partido: el partido del día, con previa.
 * - lado: 'local' o 'visitante'.
 * - anteriores: Map id → partido anterior con estadísticas.
 */
export function resumenUltimos(partido, lado, anteriores) {
  const idEquipo = partido[lado].id;
  const campos = ['goles', 'corners', 'tarjetas', 'tiros', 'remates'];
  const filas = (partido.previa?.ultimos_partidos[lado] ?? []).map((id) => anteriores.get(id)).filter(Boolean).map((anterior) => {
    const propio = anterior.local.id === idEquipo ? 'local' : 'visitante';
    const rival = propio === 'local' ? 'visitante' : 'local';
    const completo = anterior.estadisticas?.completo;
    const valores = Object.fromEntries(campos.map((campo) => [campo, completo
      ? [valorDelEquipo(completo, propio, campo), valorDelEquipo(completo, rival, campo)]
      : [null, null]]));
    return {
      id: anterior.id,
      fecha: anterior.fecha_local,
      liga: anterior.liga.nombre,
      rival: anterior[rival].nombre,
      condicion: propio,
      ...valores,
    };
  });
  const promedio = (campo, i) => {
    const conDato = filas.map((f) => f[campo][i]).filter((v) => v !== null);
    return conDato.length ? { valor: conDato.reduce((a, b) => a + b, 0) / conDato.length, partidos: conDato.length } : null;
  };
  const promedios = Object.fromEntries(campos.map((campo) => [campo, [promedio(campo, 0), promedio(campo, 1)]]));
  return { filas, promedios };
}
