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

## Pendientes

- **Sofascore, básquet y béisbol:** falta una muestra de cada deporte (un partido terminado y uno por jugar).
- **Betano y Flashscore:** muestras recibidas, extractores por construir.
- **Apuesta Total y Te Apuesto:** falta su muestra.
