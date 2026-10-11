# Formato de los datos

Este documento explica cómo se guardan los partidos, las cuotas, los análisis y el historial. La definición exacta está en los esquemas de `esquemas/` (JSON Schema 2020-12). El validador revisa esos esquemas y además las reglas que un esquema no puede expresar, como la elección de la línea candidata.

## Carpetas del repositorio

```
config/        catálogo de mercados y lista de casas y fuentes
esquemas/      definición de cada tipo de archivo (JSON Schema)
comun/         reglas y validación en JavaScript, sin dependencias de Node
datos/         datos reales: partidos, historial y equivalencias de nombres
ejemplos/      datos ficticios con el mismo formato, para pruebas y para la página
herramientas/  validador de línea de comandos
pruebas/       pruebas automáticas
web/           página (paso 2)
extension/     extensión de Brave (pasos 3 y 4)
entrenamiento/ red neuronal (paso 9)
docs/          especificación y este documento
```

Los archivos de `comun/` no usan nada propio de Node, para que la página y la extensión puedan usar las mismas reglas.

## Convenciones

- **Ids:** `fuente:id_en_la_fuente`, por ejemplo `sofascore:17`. En los nombres de carpeta el `:` se cambia por `-` (`sofascore-17`), porque Windows no acepta `:` en nombres de archivo.
- **Fechas y horas:** ISO 8601 en UTC, por ejemplo `2026-10-11T21:00:00Z`.
- **`fecha_local`:** fecha del partido en hora de Lima. Define en qué archivo se guarda. Un partido a las 20:30 de Lima del 4 de octubre empieza el 5 de octubre en UTC, pero su `fecha_local` es `2026-10-04`.
- **Dato no disponible:** `null` o campo ausente. Nunca se usa `0` para un dato que no se conoce, porque para la red neuronal no es lo mismo cero corners que no saber cuántos hubo.
- **Lado A y lado B:**

  | Tipo de mercado | Lado A | Lado B | Línea |
  |---|---|---|---|
  | `mas_menos` | Más | Menos | .5 obligatoria |
  | `handicap` | Local | Visitante | .5 obligatoria, vista desde el local |
  | `ganador` | Local | Visitante | sin línea (`null`) |
  | `si_no` | Sí | No | sin línea (`null`) |

- **Handicap:** la línea es el handicap del local. Si Betano muestra "Toros -3.5 / Halcones +3.5" y Toros es local, se guarda `linea: -3.5`.
- **Cuotas** decimales mayores que 1. **Probabilidades** entre 0 y 1. Los valores calculados se redondean a 4 decimales.
- **Moneda** de las apuestas con código de 3 letras: `PEN` para soles.

## Dónde se guarda cada archivo

| Archivo | Ruta | Contenido |
|---|---|---|
| Partidos | `datos/partidos/{deporte}/{liga}/{temporada}/{AAAA-MM}.json` | Partidos de una liga y temporada en un mes |
| Historial | `datos/historial/{deporte}/{AAAA}/{AAAA-MM-DD}.json` | Registros de los partidos de ese día |
| Equivalencias | `datos/equivalencias/{deporte}.json` | Nombres de ligas, equipos y jugadores en cada sitio |

Ejemplo: `datos/partidos/futbol/sofascore-17/sofascore-61627/2026-10.json`.

Los partidos se agrupan por liga y temporada porque así se hace la carga de temporadas pasadas, y porque el rating Elo y los partidos jugados en la temporada se calculan por liga. Dividirlos por mes mantiene los archivos pequeños. El historial va por día porque la página guarda un día de análisis a la vez, y la vista del historial carga solo las fechas filtradas.

Cada archivo tiene `version_formato: 1` y una lista: `partidos`, `registros` o, en equivalencias, `ligas`, `equipos` y `jugadores`.

## Catálogo de mercados

`config/mercados.json` define los mercados de cada deporte en el orden en que se muestran en el resultado.

| Código | Mercado | Tipo | Período |
|---|---|---|---|
| `futbol_goles` | Goles totales Más/Menos | mas_menos | completo |
| `futbol_ambos_anotan` | Ambos equipos anotan | si_no | completo |
| `futbol_corners` | Corners Más/Menos | mas_menos | completo |
| `futbol_tarjetas` | Total de tarjetas | mas_menos | completo |
| `futbol_tiros_arco` | Tiros al arco | mas_menos | completo |
| `futbol_remates` | Remates totales | mas_menos | completo |
| `futbol_corners_1t` | Corners en el primer tiempo | mas_menos | primer_tiempo |
| `basquet_puntos` | Total de puntos | mas_menos | completo |
| `basquet_handicap` | Handicap | handicap | completo |
| `basquet_jugador` | Jugador Más/Menos | mas_menos, por jugador | completo |
| `basquet_handicap_1t` | Primer tiempo: handicap | handicap | primer_tiempo |
| `basquet_puntos_1t` | Primer tiempo: total de puntos | mas_menos | primer_tiempo |
| `beisbol_ganador` | Ganador | ganador | completo |
| `beisbol_handicap` | Handicap | handicap | completo |
| `beisbol_total` | Total de carreras | mas_menos | completo |

Qué significa cada período:

- **Fútbol, completo:** tiempo reglamentario (90 minutos más el descuento), sin prórroga ni penales. Ver "Supuestos por confirmar".
- **Fútbol, primer tiempo:** 45 minutos más el descuento.
- **Básquet, completo:** incluye la prórroga.
- **Básquet, primer tiempo:** cuartos 1 y 2, sin prórroga. En ligas que juegan por mitades, la primera mitad.
- **Béisbol, completo:** incluye las entradas extra.

Las props de jugador tienen una lista inicial de estadísticas: puntos, rebotes, asistencias, triples, robos, tapones y sus combinaciones (puntos + rebotes, puntos + rebotes + asistencias, etc.). Cada una indica qué estadísticas suma. La lista se ajusta cuando lleguen las muestras de Betano y Apuesta Total.

## Casas y fuentes

`config/casas.json` tiene las casas en orden de prioridad (Betano, Apuesta Total, Te Apuesto) y las fuentes de datos (Sofascore, Flashscore). La línea candidata se elige con la primera casa de la lista que ofrezca el mercado. Para agregar una casa basta con sumarla a ese archivo.

## Partido

Un partido se guarda una sola vez, aunque se use para varios análisis.

| Campo | Contenido |
|---|---|
| `id`, `deporte` | Id del partido y deporte |
| `liga`, `temporada` | `{ id, nombre }`; la liga puede tener `pais` |
| `inicio`, `fecha_local` | Hora de inicio en UTC y fecha en Lima |
| `local`, `visitante` | `{ id, nombre }` de cada equipo |
| `estado` | `programado`, `en_juego`, `finalizado`, `aplazado`, `suspendido` o `cancelado` |
| `ids_externos` | Id del mismo partido en otros sitios, por ejemplo `{ "flashscore": "abc123" }` |
| `marcador` | Resultado del período completo; obligatorio si está finalizado |
| `previa` | Datos previos al partido; solo en los partidos analizados |
| `estadisticas` | Estadísticas finales; solo en partidos finalizados |

### Datos previos (`previa`)

Se extraen antes del inicio, y el validador rechaza una `previa` con hora de extracción posterior. Así no se mezclan datos posteriores al partido en el entrenamiento.

- `extraido_en` y `fuentes`.
- `bajas`: jugador, equipo, motivo (`lesion`, `sancion`, `duda`, `otro`, `desconocido`) y fuente.
- `alineaciones_probables`: jugadores de cada equipo y si están confirmadas.
- `tabla`: posición, partidos jugados y puntos de cada equipo.
- `arbitro` (fútbol): nombre y sus estadísticas, como amarillas por partido.
- `abridores` (béisbol): lanzador abridor de cada equipo, su mano y sus estadísticas de la temporada.
- `ultimos_partidos`: ids de los partidos que se usaron para las estadísticas previas de cada equipo. Esos partidos tienen que estar guardados, finalizados, ser anteriores y haber sido jugados por ese equipo.

Las estadísticas previas no se copian en cada registro. Se guardan los partidos anteriores una vez y la `previa` los referencia, así se pueden recalcular las variables de la red sin duplicar datos.

### Estadísticas finales (`estadisticas`)

Todas tienen `fuente` y `extraido_en`.

**Fútbol.** `completo` y `primer_tiempo`, cada uno con `local` y `visitante`: goles, corners, amarillas, rojas, dobles_amarillas, tiros_al_arco, remates, faltas, fueras_de_juego, posesion y xg. Opcionalmente `eventos` con minuto, tipo (gol, corner, amarilla, roja, doble_amarilla) y equipo, para la fase del estilo según el marcador.

Las tarjetas se guardan sin calcular el total: `amarillas` incluye la segunda amarilla de una doble amarilla, `rojas` incluye las que vienen de doble amarilla y `dobles_amarillas` dice cuántas fueron. Con eso se puede aplicar la regla de Betano cuando se confirme, sin volver a extraer nada.

**Básquet.** `formato_periodos` (`cuartos` o `mitades`), `periodos` con los puntos de cada período, `prorrogas`, estadísticas de `equipos` (tiros, triples, libres, rebotes, asistencias, robos, tapones, pérdidas, faltas) y `jugadores` (minutos, si jugó, puntos, rebotes, asistencias, triples, robos, tapones, pérdidas).

**Béisbol.** `carreras_por_entrada` con una posición por entrada, incluidas las extra. El local tiene `null` en la última entrada si no necesitó batear. También `equipos` (hits, errores, home runs, bases por bolas, ponches) y `lanzadores`, con `outs` en lugar de entradas: 6.1 entradas son 19 outs.

## Registro del historial

Hay un registro por partido y mercado. En las props de jugador, uno por partido, jugador y estadística. El id es `partido_id|mercado`, o `partido_id|mercado|jugador_id|estadistica` en las props.

| Campo | Contenido |
|---|---|
| `partido_id`, `deporte`, `liga`, `inicio`, `fecha_local`, `local`, `visitante` | Datos del partido, repetidos para que la vista del historial no tenga que leer los archivos de partidos |
| `mercado` | Código del catálogo |
| `jugador`, `estadistica_jugador` | Solo en props: `{ id, nombre, equipo }` y el código de la estadística |
| `analizado_en` | Hora del análisis; tiene que ser anterior al inicio |
| `ofertas` | Todas las líneas y cuotas de cada casa |
| `candidata` | Línea elegida y sus valores calculados |
| `estadistico` | Predicción del análisis estadístico |
| `red` | Predicción de la red, o `null` si no hay modelo aprobado |
| `entrada_red` | Datos de entrada exactos de la red, o `null` |
| `apuesta` | La apuesta hecha, o `null` |
| `resultado` | Pendiente, resuelto o anulado |

### Ofertas

Una oferta por casa: `casa`, `extraido_en` y `lineas`, cada línea con `linea`, `cuota_a` y `cuota_b`. Los mercados sin línea tienen una sola entrada con `linea: null`.

### Línea candidata

El validador recalcula la candidata a partir de las ofertas y rechaza el registro si no coincide:

1. Se usa la oferta de la primera casa, en orden de prioridad, que tenga el mercado.
2. Se elige la línea con la menor diferencia entre sus dos cuotas.
3. Si hay empate, la de menor margen (`1/cuota_a + 1/cuota_b − 1`).
4. Si también empatan en margen, la línea más baja.

Campos de `candidata`:

- `casa`, `linea`, `cuota_a`, `cuota_b`.
- `diferencia` y `margen`.
- `prob_sin_margen_a`: probabilidad del lado A sin el margen de la casa. La del lado B es 1 menos ese valor.
- `promedio_mercado_a`: promedio de esa misma probabilidad en las otras casas que ofrecen la misma línea, o `null` si ninguna la ofrece.

Ejemplo con Betano (goles, Atlético Muestra vs Deportivo Ejemplo en los datos de ejemplo):

| Línea | Más | Menos | Diferencia | Margen | |
|---|---|---|---|---|---|
| 1.5 | 1.28 | 3.60 | 2.32 | 0.0590 | |
| 2.5 | 1.85 | 1.95 | 0.10 | 0.0534 | candidata |
| 3.5 | 3.10 | 1.36 | 1.74 | 0.0579 | |

### Predicciones

`estadistico` y `red` tienen la misma forma:

- `version`: modelo que hizo la predicción.
- `prob_a`: probabilidad del lado A.
- `lado`: lado recomendado (`a` o `b`), que tiene que coincidir con `prob_a`.
- `explicacion` (opcional): lista de factores con su `impacto` en puntos de probabilidad hacia el lado A. `0.08` significa +8%.

El desacuerdo entre los modelos no se guarda porque se deduce de los dos lados.

### Entrada de la red

`entrada_red` tiene la `version` de la lista de variables y los `valores` por nombre. Queda en `null` hasta que se definan las variables de la red (paso 9). Los registros anteriores se pueden completar después a partir de los partidos guardados. Si un registro tiene predicción de la red, tiene que tener su entrada.

### Apuesta

`casa`, `linea`, `lado`, `cuota`, `monto`, `moneda` y `registrada_en`. La línea apostada puede ser distinta de la candidata.

### Resultado

- `pendiente`: `valor_real` y `lado_ganador` en `null`.
- `resuelto`: `valor_real`, `lado_ganador`, `fuente` y `actualizado_en`.
- `anulado`: `lado_ganador` en `null`, con `motivo` (por ejemplo, el jugador no jugó o el partido se canceló).

Qué se guarda en `valor_real`:

| Tipo | `valor_real` | Gana A si |
|---|---|---|
| `mas_menos` | El total contado (goles, corners, puntos del jugador...) | valor > línea |
| `handicap` | Local menos visitante | valor + línea > 0 |
| `ganador` | Local menos visitante | valor > 0 |
| `si_no` | 1 si pasó, 0 si no | valor = 1 |

Con `valor_real` también se puede resolver una apuesta hecha a otra línea. El acierto de cada modelo y la ganancia de la apuesta se calculan a partir de estos campos, no se guardan.

## Equivalencias

Cada entrada tiene el `id` y el `nombre` de la fuente principal, y en `alias` los nombres con que aparece en cada casa o fuente:

```json
{ "id": "sofascore:35", "nombre": "Manchester United", "alias": { "betano": ["Man Utd"] } }
```

`confirmado_en` indica cuándo se confirmó la equivalencia.

## Validación

```
npm install          # una sola vez
npm run validar      # revisa datos/ y ejemplos/datos/
npm test             # pruebas automáticas
```

Además de los esquemas, el validador revisa:

- Que cada archivo esté en la ruta que le corresponde y que `fecha_local` sea la fecha de Lima.
- Que la candidata cumpla la regla, que las casas y fuentes existan en la configuración y que el mercado pertenezca al deporte.
- Que las líneas sean .5 donde corresponde, sin líneas repetidas en una misma oferta.
- Que la previa, las cuotas y el análisis sean anteriores al inicio del partido.
- Que el lado recomendado coincida con la probabilidad y que el lado ganador coincida con `valor_real` y la línea.
- Que el marcador coincida con los goles, los períodos o las entradas; que haya prórroga solo después de un empate, y que un partido de béisbol finalizado no termine empatado.
- Que cada registro apunte a un partido guardado, con los mismos equipos, liga y hora.

`ejemplos/datos/` tiene datos ficticios (equipos inventados e ids `ejemplo:...`) que cumplen todas estas reglas.

## Supuestos por confirmar

1. **Fútbol, partido completo = tiempo reglamentario.** Es la regla habitual de las casas para goles, corners y tarjetas, pero falta confirmarla en las reglas de Betano.
2. **Doble amarilla.** Sigue pendiente. El formato guarda los datos de forma que sirve para cualquiera de las dos formas de contarla.
3. **Casa de respaldo en todos los mercados.** Lo acordado era usar Apuesta Total en las props que Betano no tenga. En el formato se aplica a todos los mercados: si Betano no ofrece un mercado, se usa Apuesta Total y después Te Apuesto.
4. **Empate total entre líneas.** Si dos líneas tienen la misma diferencia y el mismo margen, se toma la más baja.
5. **Estadísticas de las props.** La lista es inicial hasta ver las muestras de las casas.
