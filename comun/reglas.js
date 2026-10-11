// Reglas acordadas en docs/ESPECIFICACION.md que definen los valores calculados del formato.
// No depende de nada: lo usan el validador y, más adelante, la página y la extensión.

export const DECIMALES = 4;

export function redondear(valor, decimales = DECIMALES) {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

export function margen(cuotaA, cuotaB) {
  return 1 / cuotaA + 1 / cuotaB - 1;
}

export function probSinMargenA(cuotaA, cuotaB) {
  const a = 1 / cuotaA;
  return a / (a + 1 / cuotaB);
}

export function diferencia(cuotaA, cuotaB) {
  return Math.abs(cuotaA - cuotaB);
}

/** Los mercados mas_menos y handicap llevan línea .5; si_no y ganador no llevan línea. */
export function tieneLinea(tipo) {
  return tipo === 'mas_menos' || tipo === 'handicap';
}

// Se compara con 6 decimales para que el ruido de los números decimales no rompa los empates.
const comparable = (valor) => redondear(valor, 6);

function esMejorLinea(x, y) {
  const dx = comparable(diferencia(x.cuota_a, x.cuota_b));
  const dy = comparable(diferencia(y.cuota_a, y.cuota_b));
  if (dx !== dy) return dx < dy;
  const mx = comparable(margen(x.cuota_a, x.cuota_b));
  const my = comparable(margen(y.cuota_a, y.cuota_b));
  if (mx !== my) return mx < my;
  // Empate total: se toma la línea más baja para que la elección no dependa del orden.
  return (x.linea ?? 0) < (y.linea ?? 0);
}

/**
 * Línea candidata: la de cuotas más cercanas entre sí.
 * Si empatan en diferencia, la de menor margen; si también empatan, la línea más baja.
 */
export function elegirLinea(lineas) {
  let mejor = null;
  for (const linea of lineas) {
    if (mejor === null || esMejorLinea(linea, mejor)) mejor = linea;
  }
  return mejor;
}

/** Oferta de la primera casa, en orden de prioridad, que ofrece el mercado. */
export function elegirOferta(ofertas, prioridadCasas) {
  for (const casa of prioridadCasas) {
    const oferta = ofertas.find((o) => o.casa === casa && o.lineas.length > 0);
    if (oferta) return oferta;
  }
  return null;
}

/** Promedio de la probabilidad sin margen del lado A en las otras casas que ofrecen la misma línea. */
export function promedioMercadoA(ofertas, casaCandidata, linea) {
  const probabilidades = [];
  for (const oferta of ofertas) {
    if (oferta.casa === casaCandidata) continue;
    const misma = oferta.lineas.find((l) => l.linea === linea);
    if (misma) probabilidades.push(probSinMargenA(misma.cuota_a, misma.cuota_b));
  }
  if (probabilidades.length === 0) return null;
  return probabilidades.reduce((suma, p) => suma + p, 0) / probabilidades.length;
}

/** Objeto `candidata` de un registro del historial, calculado a partir de sus ofertas. */
export function calcularCandidata(ofertas, prioridadCasas) {
  const oferta = elegirOferta(ofertas, prioridadCasas);
  if (oferta === null) return null;
  const { linea, cuota_a, cuota_b } = elegirLinea(oferta.lineas);
  const promedio = promedioMercadoA(ofertas, oferta.casa, linea);
  return {
    casa: oferta.casa,
    linea,
    cuota_a,
    cuota_b,
    diferencia: redondear(diferencia(cuota_a, cuota_b)),
    margen: redondear(margen(cuota_a, cuota_b)),
    prob_sin_margen_a: redondear(probSinMargenA(cuota_a, cuota_b)),
    promedio_mercado_a: promedio === null ? null : redondear(promedio),
  };
}

/**
 * Lado que ganó, según el tipo de mercado:
 * - mas_menos: valor = total contado; gana A (Más) si supera la línea.
 * - handicap: valor = local − visitante; la línea es el handicap del local; gana A (Local) si valor + línea > 0.
 * - ganador: valor = local − visitante; gana A (Local) si es positivo. No admite empate.
 * - si_no: valor = 1 si pasó (ambos anotaron), 0 si no; gana A (Sí) con 1.
 */
export function ladoGanador(tipo, linea, valor) {
  switch (tipo) {
    case 'mas_menos':
      return valor > linea ? 'a' : 'b';
    case 'handicap':
      return valor + linea > 0 ? 'a' : 'b';
    case 'ganador':
      if (valor === 0) throw new Error('un mercado de ganador no admite empate');
      return valor > 0 ? 'a' : 'b';
    case 'si_no':
      if (valor !== 0 && valor !== 1) throw new Error('en un mercado Sí/No el valor real es 1 o 0');
      return valor === 1 ? 'a' : 'b';
    default:
      throw new Error(`tipo de mercado desconocido: ${tipo}`);
  }
}

/** Id de un registro: partido_id|mercado, y en props de jugador se agregan jugador y estadística. */
export function idRegistro({ partido_id, mercado, jugador, estadistica_jugador }) {
  const partes = [partido_id, mercado];
  if (jugador) partes.push(jugador.id, estadistica_jugador);
  return partes.join('|');
}
