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
- Tampoco las de jugadores en el banco. Quién estaba en la cancha sale de la alineación del partido (titulares: `substitute: false`) y de los cambios de las incidencias (`substitution`, con `playerIn`, `playerOut` y el minuto): los titulares desde el inicio y los suplentes desde que entraron, hasta que salieron. Si el cambio y la tarjeta son del mismo minuto, se toma que el jugador estaba en la cancha. La alineación se pide solo para los partidos con tarjetas a jugadores; si Sofascore no la tiene, se cuentan todas las tarjetas a jugadores.
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

La lista de ligas pide una página por cada 100 torneos. Los partidos, uno por liga elegida. La previa de un partido, hasta unos 65: detalle, alineaciones, tabla, la lista de últimos partidos de cada equipo y las estadísticas, incidencias y alineación de 20 partidos anteriores. La extensión hace los pedidos de a uno con 300 ms de pausa, así que cada partido toma unos 20 a 30 segundos. Las estadísticas e incidencias de partidos terminados se recuerdan mientras la página está abierta.

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

## Apuesta Total (cuotas de fútbol; falta la lista de partidos)

Muestra: HAR de www.apuestatotal.com del 11 de octubre de 2026, con la lista de fútbol, Como vs AS Roma, un partido de básquet (Houston Rockets vs Dallas Mavericks) y uno de béisbol (Milwaukee Brewers vs Los Angeles Dodgers). Código: `web/js/fuentes/apuestatotal.js`, por ahora solo la conversión de las cuotas de fútbol.

Las apuestas deportivas de Apuesta Total están en un marco (iframe) de un proveedor externo, `prod20392.kmianko.com`, y los pedidos van a la API de ese dominio.

### Pedidos

| Dato | Ruta de la API | Formato |
|---|---|---|
| Mercados de varios partidos | `/api/eventlist/eu/markets/all?markets={id}\|{id}:{tipo}\|{tipo}` (con `\|` y `:` codificados) | JSON con nombres de campos |
| Todos los mercados de un partido | `/api/eventpage/events/{id}?hideX25X75Selections=false` | JSON por posiciones (listas sin nombres de campos), de 130 KB a 2,4 MB por partido |
| Cambios de los partidos | `/api/pulse/stream/events/RVMtUEUuaFBObA/poll?cursor=…` | Texto con eventos `insert`, `update` y `delete` |

El proyecto usa el primero: pide solo los tipos de mercado que necesita y admite varios partidos en un pedido.

Los pedidos a la API llevan la cabecera `session`, que pone la página del proveedor. En la muestra es una sesión sin cuenta (las páginas tienen `operatorToken=logout`). Falta saber si la API responde sin esa cabecera.

**Falta la lista de partidos.** La muestra no trae ningún pedido con todos los partidos de fútbol: la página ya los tenía cuando empezó la grabación. Solo aparecen unos 50 partidos destacados y los que se agregan durante la grabación. Sin esa lista no se puede buscar en Apuesta Total un partido de Sofascore. El proyecto Analisis-BDP la lee de `/api/pulse/snapshot/events?lang=ES-PE&t=hPNl` (el flujo `RVMtUEUuaFBObA` es `ES-PE.hPNl` en base64); hace falta una muestra de esa respuesta.

Cada partido, en los destacados y en los que se agregan: `_id`, `EventName` ("Como vs AS Roma"), `StartEventDate` (milisegundos en los cambios, texto ISO en los destacados), `SportId` (`"1"` es fútbol), `LeagueName`, `RegionName` (en español: "Inglaterra"), `RegionCode` ("EN"), `IsLive` y `Participants`, con `Name` y `VenueRole` (`Home` o `Away`).

### Mercados de fútbol

| Mercado | Tipo | Nombre en Apuesta Total |
|---|---|---|
| `futbol_goles` | `OU200` | Total de goles |
| `futbol_ambos_anotan` | `QA158` | Ambos equipos anotan |
| `futbol_corners` | `OU615` | Total tiros de esquina |
| `futbol_tarjetas` | `OU10` u `OU6010`, por definir | Total de tarjetas |
| `futbol_tiros_arco` | `OU121` | Disparos a puerta totales |
| `futbol_remates` | `OU2083` | Disparos totales |
| `futbol_corners_1t` | `OU14` | 1ra mitad: Total de tiros de esquina |

- En cada selección, `Side` 1 es "Más de" o "Sí" (lado A) y `Side` 3 es "Menos de" o "No" (lado B). La línea viene en `Points` y la cuota en `DisplayOdds.Decimal` (igual a `TrueOdds` en las 965 selecciones de la muestra). Se saltan las selecciones desactivadas (`IsDisabled`) y los mercados suspendidos, y se guardan solo las líneas .5 con las dos cuotas.
- No se usan `OU0` (total de goles asiático, con líneas .25 y .75), `OU619` (córners asiático) ni `OU621` (córners con tres opciones: más, exactamente y menos).
- **Tarjetas:** hay dos mercados llamados "Total de tarjetas" con cuotas distintas: `OU10` (líneas 3.5, 4 y 4.5 en la muestra) y `OU6010` (de 2.5 a 5.5). Falta saber cuál cuenta la roja como 2, igual que Betano. Mientras tanto no se leen.
- En la lista de mercados de la muestra solo aparecen `OU200`, `QA158` y `OU615`. `OU121`, `OU2083` y `OU14` se revisaron en la página de Como vs AS Roma, que trae los mismos mercados (con los mismos ids) en el formato por posiciones.

Con la muestra, Como vs AS Roma da goles 2.5 a 1.61 y 2.32, córners 8.5 a 1.68 y 2.06, tiros al arco 9.5 a 1.81 y 1.87 y remates 29.5 a 1.87 y 1.81. Los córners del primer tiempo solo tenían la línea 4, así que no hay oferta.

### Básquet y béisbol

La muestra trae sus mercados, que se usarán cuando estén esos deportes en Sofascore. Básquet: `OU0` total de puntos con prórroga, `HC0` hándicap y, para el primer tiempo, `OU623` (en la muestra, con una línea entera) y `HC623`; no había props de jugador. Béisbol: `ML0` ganador, `HC0` hándicap y `OU0` total de carreras con entradas extra.

## Flashscore (muestra recibida, extractor por construir)

Muestra: HAR de www.flashscore.pe del 11 de octubre de 2026, con la portada y el partido Augsburgo 2-2 Bayern Múnich (id `nyUApYI6`). Lo que trae:

| Dato | Pedido | Formato |
|---|---|---|
| Partidos del día, todas las ligas, en hora de Lima | `global.flashscore.ninja/203/x/feed/f_1_0_-5_es-pe_1` (`f_1_-1_…` es el día anterior) | Texto propio: registros separados por `~`, campos por `¬` y clave÷valor |
| Resumen: goles y tarjetas con minuto | `…/feed/df_sui_1_{id}` | Texto propio |
| Comentarios del partido | `…/feed/df_lc_1_{id}` | Texto propio. Cada córner tiene `MC÷corner`, el minuto (`MB÷62'`) y la hora exacta (`MK÷61:21`); el equipo solo aparece en el texto del comentario |
| Últimos partidos de cada equipo y enfrentamientos | `…/feed/df_hh_1_{id}` | Texto propio |
| Estadísticas del partido | `global.ds.lsapp.eu/pq_graphql?_hash=dts&eventId={id}&providerId=101` | JSON. Cada dato (`corner_kicks`, `yellow_cards`, `shots_on_goal`…) viene por equipo y por etapa: 12 primer tiempo, 13 segundo tiempo, 74 partido |
| Alineaciones | `global.ds.lsapp.eu/pq_graphql?_hash=dlie2&eventId={id}&projectId=203` | JSON |
| Cuotas de varias casas de Perú | `global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&eventId={id}&projectId=203&geoIpCode=PE…` | JSON |

Los pedidos a `flashscore.ninja` llevan la cabecera `x-fsign: SW9D1eZo`, que la página de Flashscore manda siempre con el mismo valor.

En la muestra, los comentarios tienen 12 entradas marcadas como córner, pero las estadísticas dan 14 córners (5 y 9). Los comentarios no traen todos los córners, así que para el minuto de cada córner habrá que usarlos con cuidado (por ejemplo, solo en partidos donde coincidan con el total).

## Pendientes

- **Sofascore, básquet y béisbol:** falta una muestra de cada deporte (un partido terminado y uno por jugar).
- **Flashscore:** construir el extractor con la muestra de arriba.
- **Apuesta Total:** falta una muestra de la lista de partidos y saber cuál de sus dos mercados de tarjetas cuenta como Betano.
- **Te Apuesto:** falta su muestra.
