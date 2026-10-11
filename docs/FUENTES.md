# De dónde sale cada dato

Cómo se leen los datos de cada sitio y cómo se convierten al formato de `docs/FORMATO_DATOS.md`. Cada extractor se construyó con una muestra real (HAR) de las respuestas del sitio. Las muestras no se suben al repositorio: las pruebas usan datos inventados con la misma estructura (`pruebas/datos/`).

## Sofascore (fútbol)

Muestra: HAR de www.sofascore.com del 10 y 11 de octubre de 2026, con la lista de partidos de esos días, un partido por jugar (Universidad Técnica de Cajamarca vs Sporting Cristal) y uno terminado (Universitario 2-2 Melgar). Código: `web/js/fuentes/sofascore.js`.

### Pedidos

| Dato | Ruta de la API |
|---|---|
| Ligas del día | `/api/v1/sport/football/scheduled-tournaments/{fecha}/page/{n}`, página por página |
| Partidos de una liga | `/api/v1/unique-tournament/{liga}/scheduled-events/{fecha}` |
| Detalle del partido (árbitro) | `/api/v1/event/{id}` |
| Alineaciones y bajas | `/api/v1/event/{id}/lineups` |
| Tabla | `/api/v1/tournament/{torneo}/season/{temporada}/standings/total` |
| Últimos partidos de un equipo | `/api/v1/team/{equipo}/events/last/{página}` (30 por página) |
| Estadísticas de un partido | `/api/v1/event/{id}/statistics` |
| Goles y tarjetas con minuto | `/api/v1/event/{id}/incidents` |

Una respuesta 404 significa que el dato no existe (por ejemplo, una liga sin tabla) y se toma como dato no disponible.

### Ligas y partidos del día

- La lista de torneos trae, por cada torneo, cuántos partidos tiene en cada zona horaria. Se usa la de Lima (`-18000`, UTC−5). Se dejan fuera los torneos sin partidos ese día en Lima.
- La liga es el `uniqueTournament` de Sofascore; varios torneos (grupos, fases) de la misma liga se suman en una. El país es la categoría (`category.name`, en inglés, como lo da Sofascore). Las ligas que Sofascore destaca (prioridad mayor que 0) se muestran primero.
- Los torneos sin `uniqueTournament` se dejan fuera, porque la muestra no muestra cómo pedir sus partidos.
- Los partidos de una liga para una fecha incluyen también partidos de los días vecinos: se dejan solo los de la fecha de Lima. En la muestra, un solo pedido por liga trajo todos los partidos del día en Lima.

### Partido

| Campo | Dato de Sofascore |
|---|---|
| `id` | `sofascore:{event.id}` |
| `liga` | `sofascore:{uniqueTournament.id}`, su nombre y el país |
| `temporada` | `sofascore:{season.id}` y `season.name` |
| `inicio` | `startTimestamp` (segundos UTC) |
| `local`, `visitante` | `homeTeam` y `awayTeam`: `sofascore:{id}` y `name` |
| `estado` | `status.type`: `notstarted` → programado, `inprogress` → en_juego, `finished` → finalizado, `postponed` → aplazado, `canceled` → cancelado, `interrupted` → suspendido |
| `marcador` | `homeScore.normaltime` y `awayScore.normaltime` |

En la muestra aparecieron `notstarted`, `finished` y `canceled` (este con la descripción "Abandoned"). Si aparece otro estado, el partido queda como programado o en juego según la hora.

El marcador es el del tiempo reglamentario. `current` no sirve: incluye la prórroga y los penales. En la muestra, un 1-1 de la Copa de la Liga definido por penales tenía `current` 6-5 y `normaltime` 1-1.

### Estadísticas de un partido terminado

Sofascore da las estadísticas del partido (`ALL`), del primer tiempo (`1ST`) y del segundo (`2ND`).

| Campo | Clave de Sofascore |
|---|---|
| `corners` | `cornerKicks` |
| `tiros_al_arco` | `shotsOnGoal` |
| `remates` | `totalShotsOnGoal` (en Sofascore es el total de remates) |
| `faltas` | `fouls` |
| `fueras_de_juego` | `offsides` |
| `posesion` | `ballPossession` |
| `xg` | `expectedGoals` (no apareció en la muestra; si tiene otro nombre, queda sin dato) |
| `goles` | El marcador del tiempo reglamentario; en el primer tiempo, `period1` |

Si hubo prórroga, `ALL` la incluye: los conteos del partido salen de sumar el primer y el segundo tiempo, y la posesión y el xG del partido quedan sin dato.

**Tarjetas.** Salen de las incidencias, no de las estadísticas, porque así se distingue la doble amarilla:

- `yellow`: amarilla.
- `yellowRed`: segunda amarilla. Suma una amarilla, una roja y una doble amarilla.
- `red`: roja directa.
- No se cuentan las tarjetas anuladas (`rescinded`), las que no tienen jugador (entrenadores o cuerpo técnico) ni las de la prórroga (minuto mayor que 90).
- Si aparece una clase de tarjeta desconocida, o el partido no tiene incidencias, las tarjetas quedan sin dato.

En la muestra solo hubo amarillas. Los nombres `yellowRed` y `red` siguen los que Sofascore usa en sus estadísticas (`yellowRedCards`, `redCards`); falta confirmarlos con la muestra de un partido con roja.

**Eventos.** Los goles y las tarjetas del tiempo reglamentario con su minuto. El equipo de cada gol sale de cómo cambia el marcador (las incidencias traen el marcador después de cada gol), así los autogoles quedan bien. Si los goles no cuadran con el marcador, no se guardan eventos. Los corners por minuto vendrán de Flashscore.

### Datos previos

| Campo | Dato de Sofascore |
|---|---|
| `bajas` | `missingPlayers` de las alineaciones. `type: "missing"` con `reason: 1` es lesión (en la muestra venía con descripciones como "Knee Injury"); los demás motivos quedan como desconocidos, con la descripción de Sofascore en `detalle` |
| `alineaciones_probables` | Titulares (`substitute: false`) de las alineaciones; `confirmed` dice si están confirmadas o son probables |
| `tabla` | Fila de cada equipo en la tabla: `position`, `matches`, `points`, `wins`, `draws`, `losses` |
| `arbitro` | `referee` del detalle del partido, con `games`, `yellowCards`, `redCards` y `yellowRedCards` tal como los da Sofascore (en la muestra eran los totales de su carrera). Antes del partido puede no estar designado |
| `ultimos_partidos` | Los últimos 10 partidos terminados de cada equipo en la misma condición: el local, de local; el visitante, de visita. De todas las competiciones |

Sin la respuesta de alineaciones no se sabe si hay bajas y el campo no se guarda. Con la respuesta y sin bajas, queda una lista vacía.

Los partidos anteriores se guardan completos, con sus estadísticas, en `partidos_anteriores` de la extracción del día.

### Cantidad de pedidos

La lista de ligas pide una página por cada 100 torneos. Los partidos, uno por liga elegida. La previa de un partido, unos 45: detalle, alineaciones, tabla, la lista de últimos partidos de cada equipo y las estadísticas e incidencias de 20 partidos anteriores. La extensión hace los pedidos de a uno con 300 ms de pausa, así que cada partido toma unos 15 a 20 segundos. Las estadísticas e incidencias de partidos terminados se recuerdan mientras la página está abierta.

## Betano (fútbol)

Muestra: HAR de www.betano.pe del 11 de octubre de 2026, con la página de la Premier League y el partido Liverpool FC - Manchester City con sus pestañas de mercados. También trae un partido de NBA y uno de MLB, que se usarán cuando estén el básquet y el béisbol. Código: `web/js/fuentes/betano.js`.

### Pedidos

| Dato | Ruta de la API |
|---|---|
| Lista de ligas | Cualquier página de liga trae la lista completa (`dropdownList`). Se usa la de la Premier League: `/api/sport/futbol/inglaterra/premier-league/1r/?req=la,s,stnf,c,mb` |
| Partidos de una liga | `/api{url de la liga}?req=la,s,stnf,c,mb`, por ejemplo `/api/sport/futbol/peru/liga-1/17079/?req=…` |
| Cuotas de un partido | `/api{url del partido}?req=la,s,stnf,c,mb` y, si faltan mercados, sus pestañas: `?bt={id}&req=…` |

En la muestra, la página de la Premier League se pidió como `/1r/`, mientras que la lista de ligas la enlaza como `/1/`. La página del proyecto usa las direcciones de la lista; la página de diagnóstico de la extensión prueba las dos formas.

### Mercados

| Mercado | Tipo en Betano | Nombre en Betano | Pestaña |
|---|---|---|---|
| `futbol_goles` | `HCTG` | Goles totales Más/Menos | Goles |
| `futbol_ambos_anotan` | `BTSC` | Ambos equipos anotan | Goles |
| `futbol_corners` | `CNOU` | Más/Menos Córners | Córners |
| `futbol_tarjetas` | `TCOU` | Tarjetas Totales Más/Menos | Tarjetas |
| `futbol_tiros_arco` | `X002` | Tiros al Arco | Estadísticas |
| `futbol_remates` | `4159` | Remates totales | Estadísticas |
| `futbol_corners_1t` | `COU1` | Córners en Primer Tiempo Más/Menos | Córners |

En la muestra, la pestaña "Populares" (la que llega sin pedir pestaña) traía todos menos tiros al arco y remates, con todas sus líneas. Por eso cada partido necesita dos pedidos: la página y la pestaña de estadísticas. Si a otro partido le falta un mercado en "Populares", se pide la pestaña que corresponde.

Cada línea trae dos selecciones con el mismo `handicap`: "Más de X" (lado A) y "Menos X" (lado B); en ambos anotan, "Sí" (A) y "No" (B). Se guardan solo las líneas .5 con las dos cuotas. Los Más/Menos asiáticos son otros tipos de mercado y no se leen.

### Emparejamiento con Sofascore

1. **Liga.** Se prueba primero la liga de Betano ya confirmada para esa liga de Sofascore. Si no hay, las ligas de Betano del mismo país, de la más a la menos parecida por nombre. El país se compara por código: Betano usa en `regionCode` el mismo código en inglés que Sofascore en sus categorías ("england", "peru"); en las dos muestras solo cambiaban `czechia` (Sofascore: `czech-republic`) y `turkiye` (`turkey`). Las competiciones internacionales no tienen país en común y se buscan por nombre en toda la lista. Se acepta la primera liga, de hasta 6, en la que aparece alguno de los partidos.
2. **Partido.** En los partidos de esa liga se buscan los que empiezan a la misma hora, con 15 minutos de margen (en la muestra coincidían al segundo), y se elige el de nombres más parecidos. El parecido cuenta las palabras en común sin tildes ni palabras como "FC" o "Club", y reconoce siglas ("UTC" y "Universidad Técnica de Cajamarca"). El emparejamiento es seguro si el parecido llega a 0.5 y supera en 0.25 al segundo candidato.
3. **Si no es seguro** o no hay partido a esa hora, la página muestra los partidos de esa liga en Betano para elegir el que corresponde.

Las ligas y equipos emparejados se guardan como equivalencias (`esquemas/equivalencias.schema.json`): la liga con el nombre "Región - Liga" de Betano y cada equipo con su nombre en Betano. Por ahora quedan en el navegador; en el paso 6 se guardarán en `datos/equivalencias/futbol.json`. El partido de Betano queda en `ids_externos.betano` del partido.

### Básquet y béisbol

La muestra trae sus mercados, pero no se leen todavía porque falta la muestra de Sofascore de esos deportes. En básquet, el hándicap (`FHOT`) y el total de puntos (`FTPO`) vienen en una tabla (`tableLayout`) en lugar de la lista de selecciones del fútbol.

## Pendientes

- **Sofascore, básquet y béisbol:** falta una muestra de cada deporte (un partido terminado y uno por jugar).
- **Flashscore:** muestra recibida, extractor por construir.
- **Apuesta Total y Te Apuesto:** falta su muestra.
