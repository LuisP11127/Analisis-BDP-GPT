# Formato de los datos

Este documento explica cómo se guardan los partidos, las cuotas, los análisis y el historial. La definición exacta está en los esquemas de `esquemas/` (JSON Schema 2020-12). El validador revisa esos esquemas y además las reglas que un esquema no puede expresar, como la elección de la línea candidata.

## Carpetas del repositorio

```
config/        catálogo de mercados y lista de casas y fuentes
esquemas/      definición de cada tipo de archivo (JSON Schema)
comun/         reglas y validación en JavaScript, sin dependencias de Node
datos/         datos reales: partidos, historial y equivalencias de nombres
ejemplos/      datos ficticios con el mismo formato, para pruebas y para la página
herramientas/  validador, generador de ejemplos, índices, servidor local y armado del sitio
pruebas/       pruebas automáticas
web/           página
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

### Índice de cada carpeta

GitHub Pages no permite listar carpetas, así que cada carpeta de datos tiene un `indice.json` con la lista de sus archivos en orden alfabético:

```json
{ "version_formato": 1, "archivos": ["equivalencias/futbol.json", "historial/futbol/2026/2026-10-10.json"] }
```

`npm run indice` lo vuelve a escribir. El validador rechaza un índice que no coincida con los archivos que hay. Cuando la página guarde datos (paso 6), actualizará el índice en el mismo cambio.

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

- **Fútbol, completo:** tiempo reglamentario (90 minutos más el descuento), sin prórroga ni penales.
- **Fútbol, primer tiempo:** 45 minutos más el descuento.
- **Básquet, completo:** incluye la prórroga.
- **Básquet, primer tiempo:** cuartos 1 y 2, sin prórroga. En ligas que juegan por mitades, la primera mitad.
- **Béisbol, completo:** incluye las entradas extra.

Las props de jugador de básquet usan estas estadísticas: puntos, rebotes, asistencias, triples, robos, tapones y sus combinaciones (puntos + rebotes, puntos + asistencias, rebotes + asistencias, puntos + rebotes + asistencias, robos + tapones). Cada una indica qué estadísticas suma. Si una casa ofrece otra, se agrega al catálogo.

## Casas y fuentes

`config/casas.json` tiene las casas en orden de prioridad (Betano, Apuesta Total, Te Apuesto) y las fuentes de datos (Sofascore, Flashscore). En todos los mercados, la línea candidata se elige con la primera casa de la lista que ofrezca el mercado. Para agregar una casa basta con sumarla a ese archivo.

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
- `prob_roja` (solo en `futbol_tarjetas`): probabilidad de que haya al menos una roja en el partido. La página la muestra como "Tarjeta roja en el partido: Sí o No" con su probabilidad. Si hubo roja se sabe por las estadísticas del partido, así que no se guarda aparte en el resultado.

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

## Extracción del día

Es lo que la extensión le entregará a la página: los partidos del día de todas las ligas y las cuotas de sus mercados (`esquemas/extraccion.schema.json`). No se guarda en `datos/`: con ella la página arma los registros del historial de los partidos elegidos.

| Campo | Contenido |
|---|---|
| `fecha_local` | Día de la extracción; el archivo se llama `AAAA-MM-DD.json` |
| `generado_en` | Hora en que se armó la extracción |
| `partidos` | Partidos del día con el formato de partido; los que se pueden analizar traen `previa` |
| `mercados` | Por partido y mercado (y jugador y estadística en las props): `partido_id`, `mercado` y `ofertas` |

Las ofertas tienen el mismo formato que en el historial. Las cuotas y la previa tienen que extraerse antes del inicio del partido, y los partidos de `previa.ultimos_partidos` tienen que estar guardados en `datos/`.

En `ejemplos/extraccion/` hay una extracción de prueba. Sus mercados traen además `prediccion_ejemplo`, con predicciones ficticias que la página muestra mientras no exista el análisis estadístico (paso 5). La extensión nunca envía ese campo. Si `prediccion_ejemplo.estadistico` es `null`, el mercado se muestra como "sin datos suficientes" y no genera registro.

## Datos de ejemplo

`npm run ejemplos` genera `ejemplos/datos/` y `ejemplos/extraccion/` con `herramientas/generar-ejemplos.mjs` y vuelve a escribir los índices. Los ejemplos no se editan a mano: si cambia el formato, se cambia el generador.

Los datos se simulan con equipos inventados y una semilla fija, así que cada ejecución produce los mismos archivos. Incluyen:

- Seis ligas: dos de fútbol, una copa de fútbol solo con partidos del día y sin cuotas, dos de básquet (una por cuartos y otra por mitades) y una de béisbol.
- Partidos guardados desde el 20 de setiembre de 2026, con estadísticas, y registros del historial del 4 al 10 de octubre con resultados, apuestas, props anuladas porque el jugador no jugó y un partido de béisbol suspendido.
- La extracción del 11 de octubre de 2026, con mercados que no ofrece ninguna casa y uno sin datos suficientes.

En los partidos analizados de ejemplo no hay dobles amarillas, para que el total de tarjetas no dependa de esa regla pendiente.

## Validación

```
npm install          # una sola vez
npm run validar      # revisa datos/, ejemplos/datos/, ejemplos/extraccion/ y sus índices
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
- Que `prob_roja` aparezca solo en el mercado de tarjetas.
- En las extracciones: que los partidos sean del día del archivo, que cada mercado sea de un partido de la extracción y que las cuotas sean anteriores al inicio.
- Que cada `indice.json` liste exactamente los archivos de su carpeta.

Los datos de ejemplo cumplen todas estas reglas.

## Pendiente

**Doble amarilla.** Está confirmado que en Betano la roja vale como 2 amarillas. Falta confirmar con un ejemplo cuánto suma una doble amarilla (amarilla, segunda amarilla y roja): 3 (la primera amarilla más la roja) o 2. El formato guarda amarillas, rojas y dobles amarillas por separado, así que sirve para las dos formas.
