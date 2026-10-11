// Respuestas de Betano inventadas para las pruebas. Copian la estructura de una muestra real (HAR de
// www.betano.pe), con ligas, equipos, ids y cuotas ficticios. Solo tienen los campos que se usan.

const ms = (iso) => Date.parse(iso);

/** Lista de regiones y ligas que trae cada página de liga (dropdownList). */
export const REGIONES = [
  {
    id: '900',
    name: 'Inventia',
    regionCode: 'inventia',
    url: '/sport/futbol/campeonatos/inventia/900/',
    leagues: [
      { id: '9001', text: 'Primera Ficticia', url: '/sport/futbol/inventia/primera-ficticia/9001/' },
      { id: '9002', text: 'Segunda Ficticia', url: '/sport/futbol/inventia/segunda-ficticia/9002/' },
      { id: '9003', text: 'Copa', url: '/sport/futbol/inventia/copa/9003/' },
    ],
  },
  {
    id: '910',
    name: 'Copa Continental',
    regionCode: 'copa-continental',
    url: '/sport/futbol/campeonatos/copa-continental/910/',
    leagues: [{ id: '9101', text: 'Copa Continental', url: '/sport/futbol/copa-continental/copa-continental/9101/' }],
  },
];

/** Partido como viene en una página de liga. */
export const evento = ({ id, local, visitante, inicio, slug = `partido-${id}` }) => ({
  id,
  name: `${local} - ${visitante}`,
  startTime: ms(inicio),
  url: `/cuotas-de-partido/${slug}/${id}/`,
  participants: [{ id: `${id}1`, name: local }, { id: `${id}2`, name: visitante }],
  markets: [{ type: 'MRES', selections: [] }],
});

export const paginaDeLiga = (nombre, eventos) => ({
  data: {
    dropdownList: REGIONES,
    blocks: [{ name: nombre, id: '1', url: '/sport/futbol/x/1/', events: eventos }],
  },
});

/** Mercado Más/Menos con sus líneas: [[línea, más, menos], ...]. */
export const masMenos = (type, name, lineas) => ({
  id: `${type}-1`,
  name,
  type,
  handicap: lineas[0]?.[0] ?? 0,
  selections: lineas.flatMap(([linea, mas, menos]) => [
    { name: `Más de ${linea}`, price: mas, handicap: linea, columnIndex: 0 },
    { name: `Menos ${linea}`, price: menos, handicap: linea, columnIndex: 1 },
  ]),
});

export const siNo = (type, name, si, no) => ({
  id: `${type}-1`,
  name,
  type,
  handicap: 0,
  selections: [{ name: 'Sí', price: si, handicap: 0, columnIndex: 0 }, { name: 'No', price: no, handicap: 0, columnIndex: 1 }],
});

export const PESTANAS = [
  { id: '0', name: 'Populares', type: 'popular' },
  { id: '1', name: 'Goles', type: 'goals' },
  { id: '4', name: 'Córners', type: 'cornerkicks' },
  { id: '5', name: 'Tarjetas', type: 'cards' },
  { id: '6', name: 'Estadísticas', type: 'statistics' },
];

/** Página de un partido con su lista de pestañas y los mercados dados. */
export const paginaDePartido = (id, mercados) => ({ data: { event: { id, markets: mercados }, markets: PESTANAS } });
