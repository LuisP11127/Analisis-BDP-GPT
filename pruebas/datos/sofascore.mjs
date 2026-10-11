// Respuestas de Sofascore inventadas para las pruebas. Copian la estructura de una muestra real
// (HAR de www.sofascore.com), con equipos, ids y números ficticios. Solo tienen los campos que se usan.

const segundos = (iso) => Date.parse(iso) / 1000;

export const categoria = (nombre, id) => ({ name: nombre, slug: nombre.toLowerCase(), id, priority: 0 });

export function torneo({ id, nombre, unico, nombreUnico, pais = 'Inventia', prioridad = 0 }) {
  const t = { id, name: nombre, priority: prioridad, category: categoria(pais, 900) };
  if (unico) t.uniqueTournament = { id: unico, name: nombreUnico ?? nombre, category: categoria(pais, 900) };
  return t;
}

export const LIGA = torneo({ id: 5001, nombre: 'Primera Ficticia, Clausura', unico: 701, nombreUnico: 'Primera Ficticia', prioridad: 300 });
export const COPA = torneo({ id: 5002, nombre: 'Copa Ficticia, Group A', unico: 702, nombreUnico: 'Copa Ficticia' });
export const COPA_B = torneo({ id: 5003, nombre: 'Copa Ficticia, Group B', unico: 702, nombreUnico: 'Copa Ficticia' });

export const TEMPORADA = { id: 8801, name: 'Primera Ficticia 2026', year: '2026' };

export const EQUIPOS = {
  leones: { id: 101, name: 'Leones del Norte', shortName: 'Leones' },
  halcones: { id: 102, name: 'Halcones FC', shortName: 'Halcones' },
  pumas: { id: 103, name: 'Pumas Unidos', shortName: 'Pumas' },
  toros: { id: 104, name: 'Toros de Prueba', shortName: 'Toros' },
};

const ESTADOS = {
  notstarted: { code: 0, description: 'Not started', type: 'notstarted' },
  finished: { code: 100, description: 'Ended', type: 'finished' },
  penales: { code: 120, description: 'AP', type: 'finished' },
  abandoned: { code: 90, description: 'Abandoned', type: 'canceled' },
};

/** Evento como viene en las listas de Sofascore. `marcador`: [local, visitante, local 1T, visitante 1T]. */
export function evento({ id, inicio, local, visitante, estado = 'notstarted', marcador, extra, torneoDe = LIGA, temporada = TEMPORADA }) {
  const e = {
    id,
    tournament: torneoDe,
    season: temporada,
    status: ESTADOS[estado],
    homeTeam: local,
    awayTeam: visitante,
    homeScore: {},
    awayScore: {},
    startTimestamp: segundos(inicio),
  };
  if (marcador) {
    const [l, v, l1, v1] = marcador;
    e.homeScore = { current: l, display: l, period1: l1, period2: l - l1, normaltime: l };
    e.awayScore = { current: v, display: v, period1: v1, period2: v - v1, normaltime: v };
  }
  if (extra) {
    // Empate en los 90 minutos, prórroga sin goles y penales: current suma los penales.
    Object.assign(e.homeScore, { extra1: 0, extra2: 0, overtime: 0, penalties: extra[0], current: e.homeScore.normaltime + extra[0] });
    Object.assign(e.awayScore, { extra1: 0, extra2: 0, overtime: 0, penalties: extra[1], current: e.awayScore.normaltime + extra[1] });
  }
  return e;
}

/** Página de scheduled-tournaments. `-18000` es la cantidad de partidos del día en Lima. */
export function paginaTorneos(filas, siguiente = false) {
  return {
    scheduled: filas.map(([t, lima, otras = 0]) => ({
      tournament: t,
      timezoneEventCount: { 36000: otras + lima, 0: lima, ...(lima > 0 ? { '-18000': lima } : {}) },
    })),
    hasNextPage: siguiente,
  };
}

const item = (key, home, away, extra = {}) => ({ key, homeValue: home, awayValue: away, home: String(home), away: String(away), ...extra });

/** Respuesta de event/{id}/statistics. Cada período: { cornerKicks: [l, v], ... }. */
export function estadisticas(periodos) {
  return {
    statistics: Object.entries(periodos).map(([period, valores]) => ({
      period,
      groups: [
        { groupName: 'Match overview', statisticsItems: Object.entries(valores).map(([clave, [l, v]]) => item(clave, l, v)) },
        // Sofascore repite algunas claves en otro grupo con el mismo valor.
        { groupName: 'Shots', statisticsItems: valores.totalShotsOnGoal ? [item('totalShotsOnGoal', ...valores.totalShotsOnGoal)] : [] },
      ],
    })),
  };
}

export const tarjeta = (time, isHome, incidentClass, extra = {}) => ({
  incidentType: 'card', incidentClass, time, isHome, rescinded: false, player: { id: 9000 + time, name: `Jugador ${time}` }, ...extra,
});
export const gol = (time, isHome, homeScore, awayScore, extra = {}) => ({
  incidentType: 'goal', incidentClass: 'regular', time, isHome, homeScore, awayScore, player: { id: 8000 + time, name: `Goleador ${time}` }, ...extra,
});
export const periodo = (text, time, homeScore, awayScore) => ({ incidentType: 'period', text, time, addedTime: 999, homeScore, awayScore });

export function alineaciones({ confirmadas = false, bajasLocal = [], bajasVisitante = [] } = {}) {
  const jugadores = (base) => Array.from({ length: 14 }, (_, i) => ({
    player: { id: base + i, name: `Jugador ${base + i}`, position: 'M' },
    substitute: i >= 11,
    position: 'M',
  }));
  return {
    confirmed: confirmadas,
    home: { players: jugadores(3000), missingPlayers: bajasLocal, formation: '4-4-2' },
    away: { players: jugadores(4000), missingPlayers: bajasVisitante, formation: '4-3-3' },
  };
}

export function tabla(filas) {
  return {
    standings: [{
      id: 1,
      type: 'total',
      name: 'Primera Ficticia 2026, Clausura',
      rows: filas.map(([equipo, posicion, partidos, ganados, empatados, perdidos, puntos]) => ({
        team: { id: equipo.id, name: equipo.name },
        position: posicion,
        matches: partidos,
        wins: ganados,
        draws: empatados,
        losses: perdidos,
        points: puntos,
        scoresFor: 10,
        scoresAgainst: 8,
      })),
    }],
  };
}
