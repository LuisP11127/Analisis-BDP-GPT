// Genera los datos ficticios de ejemplos/:
// - ejemplos/datos: partidos guardados (con estadísticas) e historial de análisis de días anteriores.
// - ejemplos/extraccion: una extracción del día de prueba, como la que entregará la extensión.
// Los equipos, cuotas y resultados son inventados. Los valores calculados (línea candidata, lado ganador)
// salen de comun/reglas.js, así que los ejemplos cumplen las mismas reglas que los datos reales.
// Uso: npm run ejemplos (también regenera los índices).

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { calcularCandidata, idRegistro, ladoGanador, redondear } from '../comun/reglas.js';
import { fechaLocal, rutaHistorial, rutaPartidos } from '../comun/rutas.js';
import { RAIZ } from './cargar.mjs';

const CARPETA_DATOS = path.join(RAIZ, 'ejemplos', 'datos');
const CARPETA_EXTRACCION = path.join(RAIZ, 'ejemplos', 'extraccion');
const PRIORIDAD = ['betano', 'apuesta_total', 'te_apuesto'];
const HOY = '2026-10-11';
const ANALIZADOS_DESDE = '2026-10-04';
const MARGENES = { betano: 0.055, apuesta_total: 0.065, te_apuesto: 0.07 };
const CON_RED = new Set(['futbol_goles', 'futbol_corners', 'basquet_puntos', 'beisbol_ganador', 'beisbol_total']);

// ---------------------------------------------------------------- azar con semilla (mulberry32)

function crearAzar(semilla) {
  let estado = semilla | 0;
  function uniforme() {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    uniforme,
    entre: (min, max) => min + (max - min) * uniforme(),
    entero: (min, max) => min + Math.floor((max - min + 1) * uniforme()),
    elegir: (lista) => lista[Math.floor(uniforme() * lista.length)],
    probabilidad: (p) => uniforme() < p,
    normal(media, desv) {
      const u = 1 - uniforme();
      return media + desv * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniforme());
    },
    poisson(lambda) {
      if (lambda <= 0) return 0;
      const limite = Math.exp(-lambda);
      let k = 0;
      let p = uniforme();
      while (p > limite) {
        k += 1;
        p *= uniforme();
      }
      return k;
    },
    binomial(n, p) {
      let k = 0;
      for (let i = 0; i < n; i += 1) if (uniforme() < p) k += 1;
      return k;
    },
    mezclar(lista) {
      const copia = [...lista];
      for (let i = copia.length - 1; i > 0; i -= 1) {
        const j = Math.floor(uniforme() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
      }
      return copia;
    },
  };
}

const azar = crearAzar(20261011);

// ---------------------------------------------------------------- probabilidades

function probMasPoisson(linea, lambda) {
  if (linea < 0) return 1;
  let acumulada = 0;
  let termino = Math.exp(-lambda);
  for (let i = 0; i <= Math.floor(linea); i += 1) {
    if (i > 0) termino *= lambda / i;
    acumulada += termino;
  }
  return 1 - acumulada;
}

function normalAcumulada(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

const probMasNormal = (linea, media, desv) => 1 - normalAcumulada((linea - media) / desv);
const acotar = (valor, min, max) => Math.min(max, Math.max(min, valor));
const suma = (valores) => valores.reduce((total, v) => total + (v ?? 0), 0);

function cuotasDesde(probA, margen) {
  const cuotaA = 1 / (probA * (1 + margen));
  const cuotaB = 1 / ((1 - probA) * (1 + margen));
  return [Math.max(1.01, redondear(cuotaA, 2)), Math.max(1.01, redondear(cuotaB, 2))];
}

// ---------------------------------------------------------------- fechas

function horaLima(fecha, hora) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const [h, m] = hora.split(':').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia, h + 5, m)).toISOString().replace('.000Z', 'Z');
}

const sumarMinutos = (iso, minutos) => new Date(new Date(iso).getTime() + minutos * 60000).toISOString().replace('.000Z', 'Z');

function fechasCada(desde, hasta, dias) {
  const fechas = [];
  for (let t = new Date(`${desde}T12:00:00Z`); t <= new Date(`${hasta}T12:00:00Z`); t = new Date(t.getTime() + dias * 86400000)) {
    fechas.push(t.toISOString().slice(0, 10));
  }
  return fechas;
}

const slug = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------- ligas y equipos

const NOMBRES = ['Mateo', 'Santiago', 'Sebastián', 'Diego', 'Nicolás', 'Gabriel', 'Tomás', 'Joaquín', 'Emiliano', 'Bruno', 'Thiago', 'Lucas'];
const APELLIDOS = ['Quispe', 'Ramos', 'Flores', 'Torres', 'Vargas', 'Castro', 'Rojas', 'Mendoza', 'Silva', 'Paredes', 'Huamán', 'Salazar'];

const LIGAS = [
  {
    deporte: 'futbol', codigo: 'liga-futbol', nombre: 'Liga de Ejemplo',
    temporada: { id: 'ejemplo:temporada-2026', nombre: '2026' },
    equipos: ['Deportivo Ejemplo', 'Atlético Muestra', 'Unión Prueba', 'Sporting Demo', 'Real Ficticio', 'Club Simulado'],
    jornadas: fechasCada('2026-09-20', '2026-10-08', 3), horas: ['13:00', '15:30', '19:30'],
    casas: {
      betano: 'todos',
      apuesta_total: ['futbol_goles', 'futbol_ambos_anotan', 'futbol_corners', 'futbol_tarjetas'],
      te_apuesto: ['futbol_goles', 'futbol_tarjetas'],
    },
    arbitros: ['Martín Silbato', 'Ricardo Tarjeta', 'Ernesto Reglamento'],
    alineaciones: true,
  },
  {
    deporte: 'futbol', codigo: 'liga-futbol-b', nombre: 'Liga Muestra',
    temporada: { id: 'ejemplo:temporada-2026', nombre: '2026' },
    equipos: ['Racing Modelo', 'Juventud Prototipo', 'Estrella Borrador', 'Defensor Maqueta', 'Social Boceto', 'Central Ensayo'],
    jornadas: fechasCada('2026-09-21', '2026-10-09', 3), horas: ['12:00', '16:00', '20:00'],
    casas: {
      betano: ['futbol_goles', 'futbol_ambos_anotan', 'futbol_corners', 'futbol_tarjetas', 'futbol_corners_1t'],
      apuesta_total: ['futbol_goles', 'futbol_corners'],
    },
    arbitros: ['Fabián Pito', 'Gustavo Línea', 'Sergio Banderín'],
    sinXg: true,
  },
  {
    // Solo aparece en la extracción del día, sin cuotas ni datos previos.
    deporte: 'futbol', codigo: 'copa-futbol', nombre: 'Copa de Ejemplo',
    temporada: { id: 'ejemplo:temporada-2026', nombre: '2026' },
    equipos: ['Atlético Sorteo', 'Deportivo Azar', 'Unión Dado', 'Club Moneda'],
    jornadas: [], horas: ['14:00', '18:30'], casas: {}, soloHoy: true,
  },
  {
    deporte: 'basquet', codigo: 'liga-basquet', nombre: 'Liga de Básquet de Ejemplo', formato: 'cuartos',
    temporada: { id: 'ejemplo:temporada-2026-27', nombre: '2026/27' },
    equipos: ['Halcones Ejemplo', 'Toros Muestra', 'Linces Prueba', 'Cóndores Demo', 'Pumas Ficticio', 'Osos Simulado'],
    jornadas: fechasCada('2026-09-25', '2026-10-09', 2), horas: ['19:00', '20:00', '21:30'],
    casas: {
      betano: ['basquet_puntos', 'basquet_handicap', 'basquet_handicap_1t', 'basquet_puntos_1t', 'props:puntos', 'props:puntos_rebotes_asistencias'],
      apuesta_total: ['basquet_puntos', 'basquet_handicap', 'props:puntos', 'props:rebotes', 'props:asistencias', 'props:triples'],
    },
    jugadores: true,
  },
  {
    deporte: 'basquet', codigo: 'liga-basquet-b', nombre: 'Liga Universitaria de Ejemplo', formato: 'mitades',
    temporada: { id: 'ejemplo:temporada-2026-27', nombre: '2026/27' },
    equipos: ['Águilas Modelo', 'Lobos Prototipo', 'Delfines Borrador', 'Zorros Maqueta'],
    jornadas: fechasCada('2026-09-26', '2026-10-08', 3), horas: ['17:00', '19:00'],
    casas: { betano: ['basquet_puntos', 'basquet_handicap', 'basquet_puntos_1t'] },
  },
  {
    deporte: 'beisbol', codigo: 'liga-beisbol', nombre: 'Liga de Béisbol de Ejemplo',
    temporada: { id: 'ejemplo:temporada-2026', nombre: '2026' },
    equipos: ['Piratas Ejemplo', 'Leones Muestra', 'Tigres Prueba', 'Navegantes Demo', 'Caribes Ficticio', 'Cardenales Simulado'],
    jornadas: fechasCada('2026-10-01', '2026-10-10', 1), horas: ['13:05', '18:10', '19:05'],
    casas: { betano: 'todos', te_apuesto: ['beisbol_ganador', 'beisbol_total'] },
    // El segundo partido de este día se suspende: sus registros quedan anulados.
    suspendido: { fecha: '2026-10-07', indice: 1 },
  },
];

const PERFILES_JUGADOR = ['rebotes', 'asistencias', 'triples'];
let numeroJugador = 0;

function crearEquipo(liga, nombre, i) {
  const equipo = { id: `ejemplo:${liga.deporte === 'futbol' ? '' : `${liga.deporte}-`}${slug(nombre)}`, nombre };
  if (liga.deporte === 'futbol') {
    equipo.param = {
      ataque: azar.entre(0.9, 1.7), defensa: azar.entre(0.8, 1.6),
      cornersA: azar.entre(4, 6.5), cornersC: azar.entre(4, 6.5),
      amarillas: azar.entre(1.4, 2.8), roja: azar.entre(0.04, 0.1),
      arco: azar.entre(3.2, 5.5), remates: azar.entre(9, 14.5),
    };
    equipo.plantel = Array.from({ length: 3 }, (_, j) => ({
      id: `ejemplo:jf-${slug(nombre)}-${j + 1}`,
      nombre: `${NOMBRES[(i * 3 + j) % NOMBRES.length]} ${APELLIDOS[(i * 5 + j * 7) % APELLIDOS.length]}`,
    }));
  } else if (liga.deporte === 'basquet') {
    const [min, max] = liga.formato === 'cuartos' ? [100, 116] : [64, 80];
    equipo.param = { ofensa: azar.entre(min, max), defensa: azar.entre(min, max) };
    if (liga.jugadores) {
      equipo.figuras = Array.from({ length: 2 }, () => {
        numeroJugador += 1;
        const nombreJugador = `${NOMBRES[numeroJugador % NOMBRES.length]} ${APELLIDOS[(numeroJugador * 5) % APELLIDOS.length]}`;
        return {
          id: `ejemplo:jb-${numeroJugador}`, nombre: nombreJugador,
          perfil: PERFILES_JUGADOR[numeroJugador % PERFILES_JUGADOR.length],
          medias: {
            puntos: azar.entre(14, 27), rebotes: azar.entre(3, 10), asistencias: azar.entre(2, 8), triples: azar.entre(0.8, 3.2),
            robos: azar.entre(0.5, 1.8), tapones: azar.entre(0.2, 1.5), perdidas: azar.entre(1.2, 3.2), minutos: azar.entre(28, 36),
          },
        };
      });
    }
  } else {
    equipo.param = { carreras: azar.entre(3.6, 5.4), permitidas: azar.entre(3.6, 5.4) };
    equipo.rotacion = Array.from({ length: 3 }, (_, j) => ({
      id: `ejemplo:lanzador-${slug(nombre)}-${j + 1}`,
      nombre: `${NOMBRES[(i * 2 + j * 5) % NOMBRES.length]} ${APELLIDOS[(i * 3 + j * 4 + 1) % APELLIDOS.length]}`,
      mano: azar.probabilidad(0.3) ? 'zurda' : 'derecha',
      calidad: azar.entre(0.85, 1.15),
    }));
    equipo.juegos = 0;
  }
  return equipo;
}

for (const liga of LIGAS) {
  liga.id = `ejemplo:${liga.codigo}`;
  liga.equiposCreados = liga.equipos.map((nombre, i) => crearEquipo(liga, nombre, i));
}

// ---------------------------------------------------------------- simulación de partidos

function simularFutbol(liga, local, visitante, analizado) {
  const L = local.param;
  const V = visitante.param;
  const esperado = {
    goles: [((L.ataque + V.defensa) / 2) * 1.08, ((V.ataque + L.defensa) / 2) * 0.94],
    corners: [((L.cornersA + V.cornersC) / 2) * 1.05, ((V.cornersA + L.cornersC) / 2) * 0.95],
    amarillas: [L.amarillas, V.amarillas],
    rojas: [L.roja, V.roja],
    arco: [L.arco * 1.05, V.arco * 0.95],
    remates: [L.remates * 1.05, V.remates * 0.95],
  };
  const equipo = (i) => {
    const goles = azar.poisson(esperado.goles[i]);
    const rojas = azar.probabilidad(esperado.rojas[i]) ? 1 : 0;
    // En los partidos analizados no hay dobles amarillas, para que el total de tarjetas no dependa de esa regla.
    const dobles = !analizado && rojas === 1 && azar.probabilidad(0.4) ? 1 : 0;
    const amarillas = dobles ? Math.max(2, azar.poisson(esperado.amarillas[i])) : azar.poisson(esperado.amarillas[i]);
    const tiros = Math.max(goles, azar.poisson(esperado.arco[i]));
    return {
      goles,
      corners: azar.poisson(esperado.corners[i]),
      amarillas,
      rojas,
      dobles_amarillas: dobles,
      tiros_al_arco: tiros,
      remates: tiros + azar.poisson(Math.max(2, esperado.remates[i] - esperado.arco[i])),
      faltas: azar.poisson(12.5),
      fueras_de_juego: azar.poisson(2),
      posesion: null,
      xg: liga.sinXg ? null : redondear(Math.max(0.1, esperado.goles[i] + azar.normal(0, 0.3)), 1),
    };
  };
  const completo = { local: equipo(0), visitante: equipo(1) };
  completo.local.posesion = Math.round(azar.entre(42, 60));
  completo.visitante.posesion = 100 - completo.local.posesion;
  const mitad = (e) => {
    const goles = azar.binomial(e.goles, 0.45);
    const tiros = Math.max(goles, azar.binomial(e.tiros_al_arco, 0.45));
    return {
      goles,
      corners: azar.binomial(e.corners, 0.45),
      amarillas: azar.binomial(e.amarillas - e.dobles_amarillas, 0.35),
      rojas: e.rojas && !e.dobles_amarillas && azar.probabilidad(0.3) ? 1 : 0,
      tiros_al_arco: tiros,
      remates: tiros + azar.binomial(e.remates - e.tiros_al_arco, 0.45),
      faltas: azar.binomial(e.faltas, 0.47),
    };
  };
  const primerTiempo = { local: mitad(completo.local), visitante: mitad(completo.visitante) };
  return { esperado, completo, primerTiempo, marcador: { local: completo.local.goles, visitante: completo.visitante.goles } };
}

function esperadoBasquet(liga, local, visitante) {
  return [
    (local.param.ofensa + visitante.param.defensa) / 2 + 1.5,
    (visitante.param.ofensa + local.param.defensa) / 2 - 1.5,
  ];
}

function estadisticasEquipoBasquet(puntos) {
  const triples = Math.min(Math.floor(puntos / 3), azar.poisson(12));
  let libres = Math.min(puntos - 3 * triples, azar.poisson(16));
  if ((puntos - 3 * triples - libres) % 2 !== 0) libres += libres > 0 ? -1 : 1;
  const anotados = (puntos - 3 * triples - libres) / 2 + triples;
  const ofensivos = azar.poisson(10);
  const defensivos = azar.poisson(33);
  return {
    tiros_campo_anotados: anotados,
    tiros_campo_intentados: Math.round(anotados / azar.entre(0.43, 0.5)),
    triples_anotados: triples,
    triples_intentados: Math.round(triples / azar.entre(0.32, 0.4)),
    tiros_libres_anotados: libres,
    tiros_libres_intentados: Math.round(libres / azar.entre(0.72, 0.85)),
    rebotes_ofensivos: ofensivos,
    rebotes_defensivos: defensivos,
    rebotes: ofensivos + defensivos,
    asistencias: azar.poisson(24),
    robos: azar.poisson(7),
    tapones: azar.poisson(4.5),
    perdidas: azar.poisson(13),
    faltas: azar.poisson(19),
  };
}

function lineaJugador(figura, equipo) {
  if (!azar.probabilidad(0.93)) {
    return { jugador: { id: figura.id, nombre: figura.nombre }, equipo, titular: false, jugo: false, minutos: null };
  }
  const m = figura.medias;
  const puntos = Math.max(0, Math.round(azar.normal(m.puntos, 5.5)));
  return {
    jugador: { id: figura.id, nombre: figura.nombre },
    equipo,
    titular: true,
    jugo: true,
    minutos: redondear(acotar(azar.normal(m.minutos, 3), 12, 48), 1),
    puntos,
    rebotes: azar.poisson(m.rebotes),
    asistencias: azar.poisson(m.asistencias),
    triples: Math.min(Math.floor(puntos / 3), azar.poisson(m.triples)),
    robos: azar.poisson(m.robos),
    tapones: azar.poisson(m.tapones),
    perdidas: azar.poisson(m.perdidas),
  };
}

function simularBasquet(liga, local, visitante) {
  const media = esperadoBasquet(liga, local, visitante);
  const partes = liga.formato === 'cuartos' ? 4 : 2;
  const minutos = partes === 4 ? 48 : 40;
  const periodos = media.map((m) => Array.from(
    { length: partes },
    () => Math.max(partes === 4 ? 10 : 22, Math.round(azar.normal(m / partes, partes === 4 ? 3.5 : 5))),
  ));
  const prorrogas = [[], []];
  let totalLocal = suma(periodos[0]);
  let totalVisitante = suma(periodos[1]);
  while (totalLocal === totalVisitante) {
    let local5 = Math.max(3, Math.round(azar.normal((media[0] * 5) / minutos, 2.5)));
    const visitante5 = Math.max(3, Math.round(azar.normal((media[1] * 5) / minutos, 2.5)));
    if (prorrogas[0].length >= 3 && local5 === visitante5) local5 += 1;
    prorrogas[0].push(local5);
    prorrogas[1].push(visitante5);
    totalLocal += local5;
    totalVisitante += visitante5;
  }
  const jugadores = liga.jugadores
    ? [...local.figuras.map((f) => lineaJugador(f, 'local')), ...visitante.figuras.map((f) => lineaJugador(f, 'visitante'))]
    : null;
  return {
    media,
    periodos: { local: periodos[0], visitante: periodos[1] },
    prorrogas: prorrogas[0].length > 0 ? { local: prorrogas[0], visitante: prorrogas[1] } : null,
    equipos: liga.jugadores
      ? { local: estadisticasEquipoBasquet(totalLocal), visitante: estadisticasEquipoBasquet(totalVisitante) }
      : null,
    jugadores,
    marcador: { local: totalLocal, visitante: totalVisitante },
  };
}

function esperadoBeisbol(local, visitante, abridorLocal, abridorVisitante) {
  return [
    ((local.param.carreras + visitante.param.permitidas * abridorVisitante.calidad) / 2) * 1.03,
    ((visitante.param.carreras + local.param.permitidas * abridorLocal.calidad) / 2) * 0.97,
  ];
}

function lineaLanzador(abridor, equipo, carrerasRival) {
  const outs = azar.entero(12, 21);
  const carreras = azar.binomial(carrerasRival, Math.min(1, (outs / 27) * 1.05));
  return {
    jugador: { id: abridor.id, nombre: abridor.nombre },
    equipo,
    abridor: true,
    outs,
    hits: azar.poisson((outs / 27) * 8),
    carreras,
    carreras_limpias: carreras > 0 && azar.probabilidad(0.15) ? carreras - 1 : carreras,
    bases_por_bolas: azar.poisson((outs / 27) * 3),
    ponches: azar.poisson(((outs / 27) * 8.5) / abridor.calidad),
  };
}

function simularBeisbol(local, visitante, abridorLocal, abridorVisitante) {
  const media = esperadoBeisbol(local, visitante, abridorLocal, abridorVisitante);
  const porEntrada = media.map((m) => m / 9);
  const vis = [];
  const loc = [];
  for (let entrada = 1; entrada <= 9; entrada += 1) {
    vis.push(azar.poisson(porEntrada[1]));
    if (entrada === 9 && suma(loc) > suma(vis)) loc.push(null);
    else loc.push(azar.poisson(porEntrada[0]));
  }
  let extras = 0;
  while (suma(loc) === suma(vis)) {
    extras += 1;
    vis.push(azar.poisson(porEntrada[1] + 0.3));
    let carreras = azar.poisson(porEntrada[0] + 0.3);
    if (extras >= 5 && suma(loc) + carreras === suma(vis)) carreras += 1;
    loc.push(carreras);
  }
  const marcador = { local: suma(loc), visitante: suma(vis) };
  const equipo = (carreras) => ({
    hits: carreras + azar.poisson(4),
    errores: azar.poisson(0.6),
    home_runs: Math.min(carreras, azar.poisson(1)),
    bases_por_bolas: azar.poisson(3.2),
    ponches: azar.poisson(8.5),
  });
  return {
    media,
    carreras: { local: loc, visitante: vis },
    equipos: { local: equipo(marcador.local), visitante: equipo(marcador.visitante) },
    lanzadores: [
      lineaLanzador(abridorLocal, 'local', marcador.visitante),
      lineaLanzador(abridorVisitante, 'visitante', marcador.local),
    ],
    marcador,
  };
}

// ---------------------------------------------------------------- datos previos

function tablaAntesDe(liga, jugados, inicio) {
  const filas = new Map(liga.equiposCreados.map((e) => [e.id, { id: e.id, nombre: e.nombre, pj: 0, g: 0, e: 0, p: 0, puntos: 0, dif: 0 }]));
  for (const s of jugados) {
    if (s.partido.estado !== 'finalizado' || !(new Date(s.partido.inicio) < new Date(inicio))) continue;
    const { local, visitante } = s.partido.marcador;
    const fl = filas.get(s.partido.local.id);
    const fv = filas.get(s.partido.visitante.id);
    fl.pj += 1;
    fv.pj += 1;
    fl.dif += local - visitante;
    fv.dif += visitante - local;
    if (local > visitante) { fl.g += 1; fv.p += 1; fl.puntos += 3; }
    else if (local < visitante) { fv.g += 1; fl.p += 1; fv.puntos += 3; }
    else { fl.e += 1; fv.e += 1; fl.puntos += 1; fv.puntos += 1; }
  }
  const futbol = liga.deporte === 'futbol';
  const orden = [...filas.values()].sort((a, b) => {
    if (futbol) return b.puntos - a.puntos || b.dif - a.dif || a.nombre.localeCompare(b.nombre);
    const pa = a.pj ? a.g / a.pj : 0;
    const pb = b.pj ? b.g / b.pj : 0;
    return pb - pa || b.dif - a.dif || a.nombre.localeCompare(b.nombre);
  });
  const fila = (id) => {
    const f = filas.get(id);
    const base = { posicion: orden.indexOf(f) + 1, partidos_jugados: f.pj, ganados: f.g, perdidos: f.p };
    return futbol ? { ...base, puntos: f.puntos, empatados: f.e } : base;
  };
  return fila;
}

function ultimosPartidos(jugados, equipoId, inicio, cantidad = 5) {
  return jugados
    .filter((s) => s.partido.estado === 'finalizado' && new Date(s.partido.inicio) < new Date(inicio)
      && (s.partido.local.id === equipoId || s.partido.visitante.id === equipoId))
    .sort((a, b) => new Date(b.partido.inicio) - new Date(a.partido.inicio))
    .slice(0, cantidad)
    .map((s) => s.partido.id);
}

function crearPrevia(liga, jugados, local, visitante, inicio, extraidoEn, extras = {}) {
  const fila = tablaAntesDe(liga, jugados, inicio);
  const previa = { extraido_en: extraidoEn, fuentes: ['sofascore'] };
  if (liga.deporte === 'futbol' && azar.probabilidad(0.3)) {
    const lado = azar.elegir(['local', 'visitante']);
    const equipo = lado === 'local' ? local : visitante;
    previa.fuentes.push('flashscore');
    previa.bajas = [{
      equipo: lado,
      jugador: { nombre: azar.elegir(equipo.plantel).nombre },
      motivo: azar.elegir(['lesion', 'sancion', 'duda']),
      fuente: 'flashscore',
    }];
  }
  if (extras.alineaciones) {
    previa.alineaciones_probables = {
      confirmadas: false,
      fuente: 'sofascore',
      local: local.plantel.map(({ id, nombre }) => ({ id, nombre })),
      visitante: visitante.plantel.map(({ id, nombre }) => ({ id, nombre })),
    };
  }
  previa.tabla = { local: fila(local.id), visitante: fila(visitante.id) };
  if (liga.deporte === 'futbol') {
    previa.arbitro = {
      nombre: azar.elegir(liga.arbitros),
      estadisticas: {
        partidos: azar.entero(6, 14),
        amarillas_por_partido: redondear(azar.entre(3.6, 5.6), 1),
        rojas_por_partido: redondear(azar.entre(0.1, 0.35), 2),
      },
    };
  }
  if (extras.abridores) {
    const describir = (a) => ({
      jugador: { id: a.id, nombre: a.nombre },
      mano: a.mano,
      estadisticas: {
        era: redondear(4.1 * a.calidad + azar.normal(0, 0.2), 2),
        whip: redondear(1.25 * Math.sqrt(a.calidad) + azar.normal(0, 0.04), 2),
        ponches_por_9: redondear(8.6 / a.calidad + azar.normal(0, 0.3), 1),
      },
    });
    previa.abridores = { local: describir(extras.abridores[0]), visitante: describir(extras.abridores[1]) };
  }
  previa.ultimos_partidos = {
    local: ultimosPartidos(jugados, local.id, inicio),
    visitante: ultimosPartidos(jugados, visitante.id, inicio),
  };
  return previa;
}

// ---------------------------------------------------------------- mercados

function lineasAlrededor(base, pasos, probA, minimo = 0) {
  const lineas = pasos.map((d) => base + d).filter((l) => l > minimo);
  const utiles = lineas.filter((l) => probA(l) > 0.12 && probA(l) < 0.88);
  return utiles.length > 0 ? utiles : [base];
}

const baseTotal = (centro) => Math.floor(centro) + 0.5;
const baseHandicap = (diferenciaEsperada) => Math.floor(-diferenciaEsperada) + 0.5;

function mercadoMasMenosPoisson(lambda, pasos, valor) {
  const probA = (l) => probMasPoisson(l, lambda);
  return { centro: lambda, lineas: lineasAlrededor(baseTotal(lambda), pasos, probA), probA, valor };
}

function mercadoMasMenosNormal(media, desv, pasos, valor) {
  const probA = (l) => probMasNormal(l, media, desv);
  return { centro: media, lineas: lineasAlrededor(baseTotal(media), pasos, probA), probA, valor };
}

function mercadoHandicapNormal(diferencia, desv, pasos, valor) {
  // Gana el local con handicap h si diferencia + h > 0.
  const probA = (h) => probMasNormal(-h, diferencia, desv);
  return { centro: diferencia, lineas: lineasAlrededor(baseHandicap(diferencia), pasos, probA, -Infinity), probA, valor };
}

function mercadosFutbol(sim) {
  const e = sim.esperado;
  const real = sim.real;
  const ambos = (1 - Math.exp(-e.goles[0])) * (1 - Math.exp(-e.goles[1]));
  const lambdaAmarillas = e.amarillas[0] + e.amarillas[1];
  const [pl, pv] = e.rojas;
  const probRojas = [(1 - pl) * (1 - pv), pl * (1 - pv) + pv * (1 - pl), pl * pv];
  const probTarjetas = (l) => probRojas.reduce((total, p, r) => total + p * probMasPoisson(l - 2 * r, lambdaAmarillas), 0);
  const centroTarjetas = lambdaAmarillas + 2 * (pl + pv);
  return {
    futbol_goles: mercadoMasMenosPoisson(e.goles[0] + e.goles[1], [-1, 0, 1], () => real?.goles),
    futbol_ambos_anotan: { centro: ambos, lineas: [null], probA: () => ambos, valor: () => real?.ambos },
    futbol_corners: mercadoMasMenosPoisson(e.corners[0] + e.corners[1], [-1, 0, 1], () => real?.corners),
    futbol_tarjetas: {
      centro: centroTarjetas,
      lineas: lineasAlrededor(baseTotal(centroTarjetas), [-1, 0, 1], probTarjetas),
      probA: probTarjetas,
      valor: () => real?.tarjetas,
      probRoja: 1 - probRojas[0],
    },
    futbol_tiros_arco: mercadoMasMenosPoisson(e.arco[0] + e.arco[1], [-1, 0, 1], () => real?.tiros),
    futbol_remates: mercadoMasMenosPoisson(e.remates[0] + e.remates[1], [-1, 0, 1], () => real?.remates),
    futbol_corners_1t: mercadoMasMenosPoisson(0.45 * (e.corners[0] + e.corners[1]), [-1, 0, 1], () => real?.corners1t),
  };
}

function mercadosBasquet(sim) {
  const [ml, mv] = sim.media;
  const real = sim.real;
  return {
    basquet_puntos: mercadoMasMenosNormal(ml + mv, 13, [-2, -1, 0, 1, 2], () => real?.total),
    basquet_handicap: mercadoHandicapNormal(ml - mv, 12, [-1, 0, 1], () => real?.diferencia),
    basquet_handicap_1t: mercadoHandicapNormal((ml - mv) / 2, 8, [-1, 0, 1], () => real?.diferencia1t),
    basquet_puntos_1t: mercadoMasMenosNormal((ml + mv) / 2, 9, [-1, 0, 1], () => real?.total1t),
  };
}

function mercadosBeisbol(sim) {
  const [ml, mv] = sim.media;
  const real = sim.real;
  const diferencia = ml - mv;
  const desv = Math.sqrt(ml + mv);
  const ganaPorUnoOMas = 1 - normalAcumulada((0.5 - diferencia) / desv);
  const empate = normalAcumulada((0.5 - diferencia) / desv) - normalAcumulada((-0.5 - diferencia) / desv);
  const probLocal = ganaPorUnoOMas + empate / 2;
  const probHandicap = (h) => probMasNormal(-h, diferencia, desv);
  return {
    beisbol_ganador: { centro: probLocal, lineas: [null], probA: () => probLocal, valor: () => real?.diferencia },
    beisbol_handicap: { centro: diferencia, lineas: [-1.5, 1.5], probA: probHandicap, valor: () => real?.diferencia },
    beisbol_total: mercadoMasMenosPoisson(ml + mv, [-1, 0, 1], () => real?.total),
  };
}

function mercadosProps(sim, figura, equipo) {
  const m = figura.medias;
  const linea = sim.jugadores?.find((j) => j.jugador.id === figura.id);
  const valor = (componentes) => () => {
    if (!linea) return undefined;
    if (!linea.jugo) return { anulado: 'El jugador no jugó' };
    return componentes.reduce((total, c) => total + linea[c], 0);
  };
  const unaLinea = (centro, probA, componentes) => ({ centro, lineas: [baseTotal(centro)], probA, valor: valor(componentes) });
  const props = {
    puntos: unaLinea(m.puntos, (l) => probMasNormal(l, m.puntos, 5.5), ['puntos']),
    puntos_rebotes_asistencias: unaLinea(
      m.puntos + m.rebotes + m.asistencias,
      (l) => probMasNormal(l, m.puntos + m.rebotes + m.asistencias, 7),
      ['puntos', 'rebotes', 'asistencias'],
    ),
  };
  props[figura.perfil] = unaLinea(m[figura.perfil], (l) => probMasPoisson(l, m[figura.perfil]), [figura.perfil]);
  return Object.entries(props).map(([estadistica, mercado]) => ({
    clave: `props:${estadistica}`,
    codigo: 'basquet_jugador',
    jugador: { id: figura.id, nombre: figura.nombre, equipo },
    estadistica,
    mercado,
  }));
}

function mercadosDe(liga, sim) {
  let lista;
  if (liga.deporte === 'futbol') lista = Object.entries(mercadosFutbol(sim)).map(([codigo, mercado]) => ({ clave: codigo, codigo, mercado }));
  else if (liga.deporte === 'beisbol') lista = Object.entries(mercadosBeisbol(sim)).map(([codigo, mercado]) => ({ clave: codigo, codigo, mercado }));
  else {
    lista = Object.entries(mercadosBasquet(sim)).map(([codigo, mercado]) => ({ clave: codigo, codigo, mercado }));
    if (liga.jugadores) {
      for (const figura of sim.localEquipo.figuras) lista.push(...mercadosProps(sim, figura, 'local'));
      for (const figura of sim.visitanteEquipo.figuras) lista.push(...mercadosProps(sim, figura, 'visitante'));
    }
  }
  return lista;
}

function ofertasPara(liga, item, extraidoEn) {
  const ofertas = [];
  for (const casa of PRIORIDAD) {
    const cubre = liga.casas[casa];
    if (!cubre || (cubre !== 'todos' && !cubre.includes(item.clave))) continue;
    const { lineas, probA } = item.mercado;
    const centrales = lineas.length > 1 ? lineas.slice(Math.floor((lineas.length - 1) / 2), Math.floor(lineas.length / 2) + 1) : lineas;
    const propias = casa === 'betano' ? lineas : centrales;
    ofertas.push({
      casa,
      extraido_en: extraidoEn,
      lineas: propias.map((linea) => {
        const [cuotaA, cuotaB] = cuotasDesde(acotar(probA(linea) + azar.normal(0, 0.015), 0.05, 0.95), MARGENES[casa]);
        return { linea, cuota_a: cuotaA, cuota_b: cuotaB };
      }),
    });
  }
  return ofertas;
}

const FACTORES = {
  futbol: ['forma_reciente', 'rival_concede', 'localia', 'promedio_liga'],
  futbol_tarjetas: ['arbitro', 'forma_reciente', 'rival_concede', 'rivalidad'],
  basquet: ['ritmo_juego', 'ataque_local', 'defensa_rival', 'descanso'],
  basquet_jugador: ['promedio_jugador', 'minutos', 'rival_concede'],
  beisbol: ['abridor_rival', 'ofensiva', 'bullpen', 'localia'],
};

function explicacionDe(codigo, deporte, probA) {
  const factores = azar.mezclar(FACTORES[codigo] ?? FACTORES[deporte]).slice(0, 3);
  const pesos = factores.map(() => azar.entre(0.2, 1));
  const total = suma(pesos);
  return factores.map((factor, i) => ({
    factor,
    impacto: redondear(acotar(((probA - 0.5) * pesos[i]) / total + azar.normal(0, 0.01), -1, 1), 2),
  }));
}

function prediccionesDe(item, candidata, deporte) {
  const probReal = item.mercado.probA(candidata.linea);
  const probEst = redondear(acotar(probReal + azar.normal(0, 0.05), 0.04, 0.96), 3);
  const estadistico = { version: 'ejemplo-estadistico-1', prob_a: probEst, lado: probEst >= 0.5 ? 'a' : 'b' };
  estadistico.explicacion = explicacionDe(item.codigo, deporte, probEst);
  if (item.codigo === 'futbol_tarjetas') {
    estadistico.prob_roja = redondear(acotar(item.mercado.probRoja + azar.normal(0, 0.03), 0.02, 0.9), 3);
  }
  let red = null;
  let entradaRed = null;
  if (CON_RED.has(item.codigo)) {
    const probRed = redondear(acotar(probReal + azar.normal(0, 0.06), 0.04, 0.96), 3);
    red = { version: `ejemplo-red-${item.codigo}-1`, prob_a: probRed, lado: probRed >= 0.5 ? 'a' : 'b' };
    entradaRed = {
      version: 'ejemplo-variables-1',
      valores: {
        linea: candidata.linea,
        cuota_a: candidata.cuota_a,
        cuota_b: candidata.cuota_b,
        esperado: redondear(item.mercado.centro, 2),
        forma_local: redondear(azar.entre(-1, 1), 2),
        forma_visitante: redondear(azar.entre(-1, 1), 2),
      },
    };
  }
  return { estadistico, red, entrada_red: entradaRed };
}

function resultadoDe(item, sim, candidata) {
  if (sim.partido.estado === 'suspendido') {
    return { estado: 'anulado', valor_real: null, lado_ganador: null, motivo: 'Partido suspendido', actualizado_en: sumarMinutos(sim.partido.inicio, 120) };
  }
  const valor = item.mercado.valor();
  if (valor?.anulado) {
    return { estado: 'anulado', valor_real: null, lado_ganador: null, motivo: valor.anulado, actualizado_en: sumarMinutos(sim.partido.inicio, 180) };
  }
  return {
    estado: 'resuelto',
    valor_real: valor,
    lado_ganador: ladoGanador(TIPOS[item.codigo], candidata.linea, valor),
    fuente: 'sofascore',
    actualizado_en: sumarMinutos(sim.partido.inicio, 180),
  };
}

const TIPOS = {
  futbol_goles: 'mas_menos', futbol_ambos_anotan: 'si_no', futbol_corners: 'mas_menos', futbol_tarjetas: 'mas_menos',
  futbol_tiros_arco: 'mas_menos', futbol_remates: 'mas_menos', futbol_corners_1t: 'mas_menos',
  basquet_puntos: 'mas_menos', basquet_handicap: 'handicap', basquet_jugador: 'mas_menos',
  basquet_handicap_1t: 'handicap', basquet_puntos_1t: 'mas_menos',
  beisbol_ganador: 'ganador', beisbol_handicap: 'handicap', beisbol_total: 'mas_menos',
};

function apuestaPara(registro, ofertas) {
  const { estadistico, candidata } = registro;
  const probLado = estadistico.lado === 'a' ? estadistico.prob_a : 1 - estadistico.prob_a;
  if (probLado < 0.56 || !azar.probabilidad(0.45)) return null;
  let linea = candidata.linea;
  let cuotas = [candidata.cuota_a, candidata.cuota_b];
  const oferta = ofertas.find((o) => o.casa === candidata.casa);
  const otras = oferta.lineas.filter((l) => l.linea !== candidata.linea);
  if (otras.length > 0 && azar.probabilidad(0.15)) {
    const otra = azar.elegir(otras);
    linea = otra.linea;
    cuotas = [otra.cuota_a, otra.cuota_b];
  }
  return {
    casa: candidata.casa,
    linea,
    lado: estadistico.lado,
    cuota: estadistico.lado === 'a' ? cuotas[0] : cuotas[1],
    monto: azar.elegir([10, 15, 20, 25, 30]),
    moneda: 'PEN',
    registrada_en: sumarMinutos(registro.analizado_en, 10),
  };
}

// ---------------------------------------------------------------- armado

function partidoBase(liga, numero, local, visitante, inicio, estado) {
  return {
    id: `ejemplo:${{ futbol: 'fut', basquet: 'bas', beisbol: 'beis' }[liga.deporte]}-${String(numero).padStart(3, '0')}`,
    deporte: liga.deporte,
    liga: { id: liga.id, nombre: liga.nombre },
    temporada: liga.temporada,
    inicio,
    fecha_local: fechaLocal(inicio),
    local: { id: local.id, nombre: local.nombre },
    visitante: { id: visitante.id, nombre: visitante.nombre },
    estado,
  };
}

function valoresReales(liga, sim) {
  if (liga.deporte === 'futbol') {
    const { local: l, visitante: v } = sim.completo;
    const t = sim.primerTiempo;
    return {
      goles: l.goles + v.goles,
      ambos: l.goles > 0 && v.goles > 0 ? 1 : 0,
      corners: l.corners + v.corners,
      corners1t: t.local.corners + t.visitante.corners,
      tarjetas: l.amarillas + v.amarillas + 2 * (l.rojas + v.rojas),
      tiros: l.tiros_al_arco + v.tiros_al_arco,
      remates: l.remates + v.remates,
    };
  }
  if (liga.deporte === 'basquet') {
    const parte1 = (lado) => (liga.formato === 'cuartos' ? sim.periodos[lado][0] + sim.periodos[lado][1] : sim.periodos[lado][0]);
    return {
      total: sim.marcador.local + sim.marcador.visitante,
      diferencia: sim.marcador.local - sim.marcador.visitante,
      total1t: parte1('local') + parte1('visitante'),
      diferencia1t: parte1('local') - parte1('visitante'),
    };
  }
  return { total: sim.marcador.local + sim.marcador.visitante, diferencia: sim.marcador.local - sim.marcador.visitante };
}

function estadisticasDe(liga, sim) {
  const extraidoEn = sumarMinutos(sim.partido.inicio, 150);
  if (liga.deporte === 'futbol') {
    return { fuente: 'sofascore', extraido_en: extraidoEn, completo: sim.completo, primer_tiempo: sim.primerTiempo };
  }
  if (liga.deporte === 'basquet') {
    const est = { fuente: 'sofascore', extraido_en: extraidoEn, formato_periodos: liga.formato, periodos: sim.periodos };
    if (sim.prorrogas) est.prorrogas = sim.prorrogas;
    if (sim.equipos) est.equipos = sim.equipos;
    if (sim.jugadores) est.jugadores = sim.jugadores;
    return est;
  }
  return {
    fuente: 'sofascore', extraido_en: extraidoEn, carreras_por_entrada: sim.carreras, equipos: sim.equipos, lanzadores: sim.lanzadores,
  };
}

const partidosGuardados = [];
const registros = [];
const extraccion = {
  version_formato: 1,
  fecha_local: HOY,
  generado_en: `${HOY}T13:10:00Z`,
  partidos: [],
  mercados: [],
};
const contadores = { futbol: 0, basquet: 0, beisbol: 0 };

function abridoresDe(local, visitante) {
  const abridores = [local.rotacion[local.juegos % 3], visitante.rotacion[visitante.juegos % 3]];
  local.juegos += 1;
  visitante.juegos += 1;
  return abridores;
}

function simular(liga, local, visitante, analizado, abridores) {
  if (liga.deporte === 'futbol') return simularFutbol(liga, local, visitante, analizado);
  if (liga.deporte === 'basquet') return simularBasquet(liga, local, visitante);
  return simularBeisbol(local, visitante, ...abridores);
}

function esperadoSinJugar(liga, local, visitante, abridores) {
  if (liga.deporte === 'futbol') return { esperado: simularFutbol(liga, local, visitante, true).esperado };
  if (liga.deporte === 'basquet') return { media: esperadoBasquet(liga, local, visitante) };
  return { media: esperadoBeisbol(local, visitante, ...abridores) };
}

for (const liga of LIGAS) {
  const jugados = [];
  const fechas = [...liga.jornadas, HOY];
  for (const fecha of fechas) {
    const esHoy = fecha === HOY;
    const orden = azar.mezclar(liga.equiposCreados);
    const cruces = [];
    for (let i = 0; i + 1 < orden.length; i += 2) cruces.push([orden[i], orden[i + 1]]);
    cruces.forEach(([local, visitante], indice) => {
      const inicio = horaLima(fecha, liga.horas[indice % liga.horas.length]);
      contadores[liga.deporte] += 1;
      const numero = contadores[liga.deporte];
      const abridores = liga.deporte === 'beisbol' ? abridoresDe(local, visitante) : null;

      if (esHoy) {
        const partido = partidoBase(liga, numero, local, visitante, inicio, 'programado');
        extraccion.partidos.push(partido);
        if (liga.soloHoy) return;
        partido.ids_externos = { betano: String(900000 + numero), flashscore: `ej${numero}${liga.deporte.slice(0, 3)}` };
        partido.previa = crearPrevia(liga, jugados, local, visitante, inicio, `${HOY}T13:00:00Z`, {
          alineaciones: liga.alineaciones,
          abridores,
        });
        const sim = { ...esperadoSinJugar(liga, local, visitante, abridores), partido, localEquipo: local, visitanteEquipo: visitante, real: null };
        if (liga.jugadores) sim.jugadores = null;
        const sinDatos = liga.codigo === 'liga-futbol-b' && indice === 0 ? 'futbol_corners_1t' : null;
        for (const item of mercadosDe(liga, sim)) {
          const ofertas = ofertasPara(liga, item, `${HOY}T13:05:00Z`);
          if (ofertas.length === 0) continue;
          const entrada = { partido_id: partido.id, mercado: item.codigo };
          if (item.jugador) Object.assign(entrada, { jugador: item.jugador, estadistica_jugador: item.estadistica });
          entrada.ofertas = ofertas;
          const candidata = calcularCandidata(ofertas, PRIORIDAD);
          entrada.prediccion_ejemplo = item.codigo === sinDatos
            ? { estadistico: null, red: null, entrada_red: null }
            : prediccionesDe(item, candidata, liga.deporte);
          extraccion.mercados.push(entrada);
        }
        return;
      }

      const analizado = fecha >= ANALIZADOS_DESDE;
      const suspendido = liga.suspendido?.fecha === fecha && liga.suspendido.indice === indice;
      const partido = partidoBase(liga, numero, local, visitante, inicio, suspendido ? 'suspendido' : 'finalizado');
      if (analizado) {
        partido.ids_externos = { betano: String(900000 + numero) };
        partido.previa = crearPrevia(liga, jugados, local, visitante, inicio, sumarMinutos(inicio, -360), { abridores });
      }
      const sim = { ...simular(liga, local, visitante, analizado, abridores), partido, localEquipo: local, visitanteEquipo: visitante };
      if (!suspendido) {
        partido.marcador = sim.marcador;
        partido.estadisticas = estadisticasDe(liga, sim);
        sim.real = valoresReales(liga, sim);
      }
      jugados.push(sim);
      partidosGuardados.push(partido);

      if (!analizado) return;
      const extraidoEn = sumarMinutos(partido.previa.extraido_en, 5);
      const analizadoEn = sumarMinutos(partido.previa.extraido_en, 10);
      for (const item of mercadosDe(liga, sim)) {
        const ofertas = ofertasPara(liga, item, extraidoEn);
        if (ofertas.length === 0) continue;
        const candidata = calcularCandidata(ofertas, PRIORIDAD);
        const registro = {
          id: null,
          partido_id: partido.id,
          deporte: partido.deporte,
          liga: partido.liga,
          inicio: partido.inicio,
          fecha_local: partido.fecha_local,
          local: partido.local,
          visitante: partido.visitante,
          mercado: item.codigo,
          ...(item.jugador ? { jugador: item.jugador, estadistica_jugador: item.estadistica } : {}),
          analizado_en: analizadoEn,
          ofertas,
          candidata,
          ...prediccionesDe(item, candidata, liga.deporte),
          apuesta: null,
          resultado: null,
        };
        registro.id = idRegistro(registro);
        registro.apuesta = apuestaPara(registro, ofertas);
        registro.resultado = resultadoDe(item, sim, candidata);
        registros.push(registro);
      }
    });
  }
}

// ---------------------------------------------------------------- equivalencias

const ligaFutbol = LIGAS[0];
const ligaBasquet = LIGAS[3];
const abreviar = (nombre) => {
  const [primera, ...resto] = nombre.split(' ');
  return `${primera.slice(0, 3)}. ${resto.join(' ')}`;
};
const equivalencias = {
  'equivalencias/futbol.json': {
    version_formato: 1,
    ligas: [{ id: ligaFutbol.id, nombre: ligaFutbol.nombre, alias: { betano: ['Ejemplo - Liga'], flashscore: ['LIGA DE EJEMPLO'] } }],
    equipos: ligaFutbol.equiposCreados.map((e) => ({
      id: e.id, nombre: e.nombre, alias: { betano: [abreviar(e.nombre)] }, confirmado_en: '2026-10-05T12:00:00Z',
    })),
    jugadores: [],
  },
  'equivalencias/basquet.json': {
    version_formato: 1,
    ligas: [{ id: ligaBasquet.id, nombre: ligaBasquet.nombre, alias: { apuesta_total: ['Liga Ejemplo'] } }],
    equipos: [],
    jugadores: ligaBasquet.equiposCreados.flatMap((e) => e.figuras).map((f) => ({
      id: f.id, nombre: f.nombre, alias: { apuesta_total: [`${f.nombre[0]}. ${f.nombre.split(' ').slice(1).join(' ')}`] },
      confirmado_en: '2026-10-05T12:00:00Z',
    })),
  },
};

// ---------------------------------------------------------------- escritura

const ORDEN_PARTIDO = ['id', 'deporte', 'liga', 'temporada', 'inicio', 'fecha_local', 'local', 'visitante', 'estado', 'ids_externos', 'marcador', 'previa', 'estadisticas'];
const ordenarPartido = (p) => Object.fromEntries(ORDEN_PARTIDO.filter((k) => k in p).map((k) => [k, p[k]]));
const porInicio = (a, b) => new Date(a.inicio) - new Date(b.inicio) || a.id.localeCompare(b.id);

const archivos = new Map();
function agregar(ruta, clave, item) {
  if (!archivos.has(ruta)) archivos.set(ruta, { version_formato: 1, [clave]: [] });
  archivos.get(ruta)[clave].push(item);
}
for (const partido of [...partidosGuardados].sort(porInicio)) agregar(rutaPartidos(partido), 'partidos', ordenarPartido(partido));
for (const registro of [...registros].sort(porInicio)) agregar(rutaHistorial(registro), 'registros', registro);
for (const [ruta, contenido] of Object.entries(equivalencias)) archivos.set(ruta, contenido);

extraccion.partidos = extraccion.partidos.sort(porInicio).map(ordenarPartido);

await rm(CARPETA_DATOS, { recursive: true, force: true });
await rm(CARPETA_EXTRACCION, { recursive: true, force: true });
const escribir = async (destino, contenido) => {
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, `${JSON.stringify(contenido, null, 2)}\n`);
};
for (const [ruta, contenido] of archivos) await escribir(path.join(CARPETA_DATOS, ruta), contenido);
await escribir(path.join(CARPETA_EXTRACCION, `${HOY}.json`), extraccion);

console.log(`ejemplos/datos: ${partidosGuardados.length} partidos y ${registros.length} registros en ${archivos.size} archivos`);
console.log(`ejemplos/extraccion: ${extraccion.partidos.length} partidos y ${extraccion.mercados.length} mercados del ${HOY}`);
