// Respuestas de Apuesta Total inventadas para las pruebas. Copian la estructura de una muestra real (HAR de
// la sección de apuestas deportivas, prod20392.kmianko.com), con ids y cuotas ficticios. Solo tienen los
// campos que se usan y unos pocos más.

const seleccion = (idMercado, side, nombre, linea, cuota) => ({
  _id: `${idMercado}-${side}-${linea ?? 'x'}`,
  Name: nombre,
  BetslipLine: linea === null ? nombre : `${nombre} ${linea}`,
  Side: side,
  ...(linea === null ? {} : { Points: linea }),
  QAParam1: 0,
  DisplayOdds: { Decimal: cuota.toFixed(2), American: '100', Fractional: '1/1' },
  TrueOdds: cuota,
  IsDisabled: false,
  IsRemoved: false,
});

const mercado = (evento, tipo, nombre, selecciones) => ({
  _id: `0${tipo}${evento}`,
  EventId: evento,
  SportId: '1',
  Name: nombre,
  MarketType: { _id: tipo, Name: nombre },
  IsLive: false,
  IsSuspended: false,
  IsRemoved: false,
  ParticipantMapping: '',
  Selections: selecciones(`0${tipo}${evento}`),
});

/** Mercado Más/Menos con sus líneas: [[línea, más, menos], ...]. */
export const masMenos = (evento, tipo, nombre, lineas) => mercado(evento, tipo, nombre, (id) => lineas.flatMap(([linea, mas, menos]) => [
  seleccion(id, 1, 'Más de', linea, mas),
  seleccion(id, 3, 'Menos de', linea, menos),
]));

export const siNo = (evento, tipo, nombre, si, no) => mercado(evento, tipo, nombre, (id) => [
  seleccion(id, 1, 'Sí', null, si),
  seleccion(id, 3, 'No', null, no),
]);

/** 1X2: local (Side 1), empate (Side 2) y visita (Side 3). */
export const unoEquisDos = (evento, local, empate, visita) => mercado(evento, 'ML0', 'Resultado del partido (1X2)', (id) => [
  seleccion(id, 2, 'Empate', null, empate),
  seleccion(id, 1, 'Leones', null, local),
  seleccion(id, 3, 'Halcones', null, visita),
]);
