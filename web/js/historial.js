// Cálculos de la vista del historial: filtros, acierto de cada modelo, resultado de las apuestas y resumen por mercado.

import { ladoGanador, redondear } from '../../comun/reglas.js';

/** true si la predicción acertó, false si falló y null si no hay predicción o el resultado no está resuelto. */
export function acerto(prediccion, resultado) {
  if (!prediccion || resultado.estado !== 'resuelto') return null;
  return prediccion.lado === resultado.lado_ganador;
}

/** Estado y ganancia de la apuesta de un registro, o null si no se apostó. */
export function resultadoApuesta(registro, tipo) {
  const { apuesta, resultado } = registro;
  if (!apuesta) return null;
  if (resultado.estado === 'pendiente') return { estado: 'pendiente', ganancia: null };
  if (resultado.estado === 'anulado') return { estado: 'anulada', ganancia: 0 };
  // La línea apostada puede ser distinta de la candidata: se resuelve con el valor real.
  const gano = ladoGanador(tipo, apuesta.linea, resultado.valor_real) === apuesta.lado;
  return gano
    ? { estado: 'ganada', ganancia: redondear(apuesta.monto * (apuesta.cuota - 1), 2) }
    : { estado: 'perdida', ganancia: -apuesta.monto };
}

/** Registros de un deporte que cumplen los filtros (fechas AAAA-MM-DD inclusive, liga y mercado opcionales). */
export function filtrar(registros, { deporte, desde, hasta, liga, mercado }) {
  return registros.filter((r) => r.deporte === deporte
    && (!desde || r.fecha_local >= desde)
    && (!hasta || r.fecha_local <= hasta)
    && (!liga || r.liga.id === liga)
    && (!mercado || r.mercado === mercado));
}

/** Del más reciente al más antiguo; dentro de un partido, en el orden del catálogo de mercados. */
export function ordenar(registros, codigosMercado) {
  const posicion = new Map(codigosMercado.map((codigo, i) => [codigo, i]));
  return [...registros].sort((a, b) => new Date(b.inicio) - new Date(a.inicio)
    || a.partido_id.localeCompare(b.partido_id)
    || (posicion.get(a.mercado) ?? 99) - (posicion.get(b.mercado) ?? 99)
    || a.id.localeCompare(b.id));
}

function filaVacia(definicion) {
  return {
    definicion,
    total: 0,
    pendientes: 0,
    anulados: 0,
    resueltos: 0,
    estadistico: { aciertos: 0, total: 0 },
    red: { aciertos: 0, total: 0 },
    apuestas: { cantidad: 0, resueltas: 0, apostado: 0, ganancia: 0 },
  };
}

function sumarRegistro(fila, registro) {
  fila.total += 1;
  const { estado } = registro.resultado;
  if (estado === 'pendiente') fila.pendientes += 1;
  if (estado === 'anulado') fila.anulados += 1;
  if (estado === 'resuelto') fila.resueltos += 1;
  for (const modelo of ['estadistico', 'red']) {
    const resultado = acerto(registro[modelo], registro.resultado);
    if (resultado === null) continue;
    fila[modelo].total += 1;
    if (resultado) fila[modelo].aciertos += 1;
  }
  const apuesta = resultadoApuesta(registro, fila.definicion?.tipo ?? registro.tipo);
  if (apuesta) {
    fila.apuestas.cantidad += 1;
    fila.apuestas.apostado += registro.apuesta.monto;
    if (apuesta.ganancia !== null) {
      fila.apuestas.resueltas += 1;
      fila.apuestas.ganancia = redondear(fila.apuestas.ganancia + apuesta.ganancia, 2);
    }
  }
}

/**
 * Resumen por mercado, en el orden del catálogo, más una fila con el total.
 * `definiciones` son los mercados del deporte en config/mercados.json.
 */
export function resumir(registros, definiciones) {
  const filas = new Map(definiciones.map((d) => [d.codigo, filaVacia(d)]));
  const total = filaVacia(null);
  for (const registro of registros) {
    const fila = filas.get(registro.mercado);
    if (!fila) continue;
    sumarRegistro(fila, registro);
    sumarRegistro(total, { ...registro, tipo: fila.definicion.tipo });
  }
  return { filas: [...filas.values()].filter((f) => f.total > 0), total };
}
