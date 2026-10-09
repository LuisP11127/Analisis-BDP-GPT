# Especificación del proyecto

Documento con las decisiones acordadas antes de empezar a construir. Cualquier cambio de criterio debe actualizarse aquí.

## Objetivo

Página web interactiva para analizar mercados de apuestas deportivas de dos resultados en fútbol, básquet y béisbol. Para cada mercado, el análisis indica cuál de los dos resultados es más probable y con qué probabilidad.

La idea de partida: en cada mercado elegido solo hay dos opciones posibles (Más/Menos, Sí/No, Equipo A/Equipo B), y una de las dos tiene que salir.

## Deportes y mercados

El orden de esta lista es el orden en que se muestran los mercados en el resultado del análisis.

### Fútbol
1. Goles totales Más/Menos
2. Ambos equipos anotan
3. Corners Más/Menos
4. Total de tarjetas
5. Tiros al arco
6. Remates totales
7. Corners en el primer tiempo Más/Menos

### Básquet
1. Total de puntos
2. Handicap
3. Jugador: mercados Más/Menos
4. Primer tiempo: handicap
5. Primer tiempo: total de puntos

### Béisbol
1. Ganador
2. Handicap
3. Total

## Reglas de los mercados

- Solo se usan líneas terminadas en .5. Se descartan las líneas enteras (pueden devolver el dinero) y los handicaps asiáticos (.25 / .75).
- **Tarjetas:** se cuentan como en Betano: amarilla = 1, roja = 2, con líneas .5.
  - Pendiente de verificar en las reglas de Betano: cómo cuenta la doble amarilla que termina en roja (algunas casas suman 3 y otras 2).
- **Básquet, primer tiempo:** 1.er y 2.º cuarto. No incluye prórroga.
- **Básquet, tiempo completo:** incluye prórroga.
- **Béisbol:** el ganador no tiene empate (hay entradas extra). El total incluye entradas extra.
- **Props de jugador (básquet):** se analizan las que ofrece Betano y se complementan con las de Apuesta Total. Si el jugador no juega, la apuesta normalmente se anula.

## Regla para elegir la línea candidata

- No hay un rango de cuotas mínimo o máximo.
- En un mercado con varias líneas .5, la candidata es la línea cuyas dos cuotas están más cerca entre sí. No hay una diferencia máxima: aunque sea grande, la línea más pareja sigue siendo candidata.
- Si hay empate en la diferencia, gana la línea con menos margen de la casa.
- En mercados con una sola línea (ganador en béisbol, ambos anotan y la mayoría de props de jugador) no se elige línea: el análisis decide directamente cuál de los dos resultados es más probable.

Ejemplo (goles Más/Menos):

| Línea | Más | Menos | Diferencia | Estado |
|---|---|---|---|---|
| 2.5 | 1.75 | 1.80 | 0.05 | Candidata |
| 3.5 | 1.90 | 2.05 | 0.15 | Descartada |

Margen de la casa de una línea: `1/cuota_A + 1/cuota_B - 1`.

## Fuentes de datos

- **Casa principal:** Betano Perú (betano.pe).
- **Casas de referencia:** Apuesta Total y Te Apuesto para empezar. Las demás se agregan cuando esas dos funcionen bien.
- **Partidos, ligas, estadísticas y resultados:** Sofascore. En la página se cargan todas las ligas que aparecen en Sofascore para cada deporte, y el usuario elige cuáles analizar.
- **Fuente complementaria de estadísticas:** Flashscore. Completa los datos que falten en Sofascore (bajas, alineaciones probables, estadísticas) y su sección de comentarios tiene el minuto de cada corner.
- Muchas ligas pequeñas no tienen en Sofascore datos de corners, tiros, tarjetas o estadísticas por jugador. En esos casos se busca en Flashscore; si tampoco hay, el análisis de esos mercados queda incompleto o no se hace.

## Arquitectura

- **Extensión de navegador** (Brave, Manifest V3, instalada en modo desarrollador con "Cargar descomprimida"). Lee los datos de Betano, Sofascore, Flashscore y las casas de referencia mientras el usuario tiene abiertas esas páginas, y se los pasa a la página web. Si un sitio cambia su diseño, hay que ajustar su extractor. Si la extensión no consigue un dato, se ingresa a mano.
- **Página web** publicada en GitHub Pages. Carga los partidos del día, permite filtrar por deporte y liga, seleccionar partidos y lanzar el análisis. El análisis se ejecuta en el navegador. Tiene una sección separada para el historial.
- **Repositorio** (público): guarda el historial en archivos de datos. La página escribe en el repositorio con un token de GitHub de alcance limitado a este repositorio. El token se guarda solo en el navegador, nunca en el repositorio.
- **GitHub Actions:** publica la página cuando hay cambios y, más adelante, entrena la red neuronal con el historial. No se usa para extraer datos, porque no tiene acceso al navegador y los sitios suelen bloquear conexiones desde servidores.
- La extracción solo funciona en la computadora (las extensiones no funcionan en el navegador del celular). Desde el celular se pueden ver los resultados y el historial.

### Emparejamiento de partidos

Cada sitio escribe los nombres de los equipos de forma distinta (por ejemplo "Manchester United" y "Man Utd"). La página relaciona los partidos por fecha, hora y parecido de los nombres. Cuando no esté segura, pide confirmación y guarda la equivalencia para usarla después.

### Muestras para construir los extractores

Desde el entorno de desarrollo no se puede abrir Betano ni Sofascore. Para construir cada extractor, el usuario abre las herramientas de desarrollador de Brave (F12), pestaña "Red", carga un partido y guarda las respuestas. No se programan extractores adivinando el formato de los datos.

## Método de análisis

Esta sección describe el análisis estadístico. La red neuronal es un modelo aparte, independiente de este (ver la sección "Red neuronal").

### Fútbol (goles, corners, corners del primer tiempo, tarjetas, tiros al arco, remates)
1. Últimos 10 partidos de cada equipo, separados en local y visitante, con más peso para los más recientes.
2. Valor esperado de cada equipo a partir de lo que produce y de lo que concede el rival. Ejemplo: corners esperados del local = corners que saca de local combinados con los que concede el visitante de visita.
3. Se suma lo esperado de ambos equipos y se calcula la probabilidad de Más y de Menos sobre la línea:
   - Goles y corners: distribución de Poisson.
   - Tarjetas y remates: binomial negativa (varían más entre partidos).
4. Tarjetas: se incluye el promedio del árbitro si Sofascore lo muestra.
5. Ambos anotan: P(anota local) × P(anota visitante), con P(anota) = 1 − e^(−goles esperados).

### Básquet
1. Total y handicap: puntos esperados de cada equipo según su ataque, la defensa del rival y el ritmo de juego. El total y la diferencia se modelan con distribución normal, con la variación observada en partidos anteriores.
2. Primer tiempo: el mismo método con los puntos del 1.er y 2.º cuarto.
3. Props de jugador: promedio y variación del jugador en sus últimos partidos, ajustados por minutos jugados y por lo que concede el rival en esa estadística.
4. Se consideran partidos en días consecutivos y las bajas que aparezcan en Sofascore.

### Béisbol
1. Carreras esperadas de cada equipo según el lanzador abridor rival, el bullpen y la ofensiva propia.
2. Simulación del partido para obtener la probabilidad del ganador, del run line ±1.5 y del total.

### Uso de las cuotas
- A las cuotas de Betano se les quita el margen para obtener la probabilidad implícita.
- Con las casas de referencia se calcula un promedio del mercado.
- Estos valores se guardan en el historial, pero no se muestran en el resultado.

## Resultado del análisis

- Orden: deporte → partido → mercados en el orden de la lista de arriba.
- Por cada mercado se muestra la línea candidata, el lado recomendado y la probabilidad de cada modelo, una al lado de la otra. Ejemplo: `Under 2.5 — Estadístico 58% · Red 61%`.
- Si la red no tiene un modelo aprobado para ese mercado, se muestra "Red: sin modelo todavía".
- Si los dos modelos eligen lados distintos, no se oculta nada: se muestra el lado y la probabilidad de cada uno y se marca el mercado como en desacuerdo. Ejemplo: `Estadístico: Under 2.5 58% · Red: Over 2.5 55% ⚠️`.

## Historial

La página muestra todos los partidos extraídos de Sofascore, pero solo se analizan los partidos que el usuario selecciona. Todos los seleccionados se analizan y se guardan, se haya apostado o no. Los que solo aparecen en la página y no se seleccionan no se guardan.

Por cada partido y mercado:

- Estadísticas disponibles **antes** del partido, tal como se usaron en el análisis (no deben mezclarse datos posteriores, para no contaminar el entrenamiento de la red neuronal).
- Todas las líneas y cuotas de Betano y de las casas de referencia, con la hora de extracción.
- Línea candidata, probabilidad del análisis estadístico y lado recomendado.
- Probabilidad de la red neuronal y versión del modelo que la calculó.
- Vector de datos de entrada exacto que recibió la red.
- Probabilidad implícita de la cuota (sin margen) y promedio del mercado.
- Si se apostó, el monto y la cuota tomada.
- Resultado real del mercado y si se ganó o se perdió.

Actualización de resultados: al abrir Sofascore después del partido, la extensión lee los resultados de los partidos pendientes y los marca automáticamente.

Vista del historial: una lista general por deporte, con filtros por fecha, liga y mercado, y un resumen del porcentaje de acierto por mercado.

## Red neuronal

Modelo separado del análisis estadístico. No recibe la probabilidad del análisis estadístico: aprende sola a partir de los datos, y así se puede comparar cuál de los dos acierta más.

### Qué aprende
Cada registro es un partido con un mercado y su línea candidata. La red recibe los datos previos al partido y predice la probabilidad de que salga el lado A (Más, Sí o Local).

### Datos de entrada (solo información previa al partido)
- Estadísticas de los equipos: promedios de los últimos 5 y 10 partidos, separados en local y visitante, de lo que producen y conceden en la estadística del mercado.
- La línea.
- Cuotas: las dos de Betano, su probabilidad sin margen, el margen, el promedio de las casas de referencia y la diferencia entre Betano y ese promedio.
- Contexto: liga, días de descanso, bajas y alineaciones probables (de Sofascore o Flashscore), promedio del árbitro en tarjetas y estadísticas del lanzador abridor en béisbol.
- Partidos jugados por cada equipo en la temporada actual. A comienzos de temporada los promedios de los últimos 5 o 10 partidos incluyen partidos de la temporada anterior; con este dato la red puede aprender a confiar menos en esos promedios al inicio.
- Nivel de los equipos y rendimiento relativo (ver "Nivel de los equipos y sorpresas").

La página guarda en el historial el vector de entrada exacto y también las estadísticas originales, para que el entrenamiento use los mismos datos que el uso diario y se puedan recalcular si se agregan nuevas entradas.

### Arquitectura
- Red pequeña: 2 o 3 capas ocultas de 32 a 64 neuronas, con dropout y parada temprana.
- Un modelo especializado por mercado, siguiendo la lista de mercados de este documento. No hay una red única para los tres deportes:
  - Fútbol: goles, ambos anotan, corners, tarjetas, tiros al arco, remates, corners del 1T.
  - Básquet: total de puntos, handicap, props de jugador, handicap 1T, total 1T.
  - Béisbol: ganador, handicap, total.
- Los mercados del primer tiempo tienen su propio modelo y usan estadísticas del primer tiempo cuando existen (cuartos 1 y 2 en básquet, estadísticas por período en fútbol).
- Si un mercado tiene pocos datos, puede compartir modelo con otros del mismo deporte.
- Especialización por liga: solo cuando una liga tenga historial suficiente. Antes de eso, la liga entra como variable en el modelo general del mercado. Un modelo de liga solo reemplaza al general si le gana en la prueba (misma regla de reemplazo de abajo).
- No hay meta-modelo al inicio (ver "Fases posteriores").
- Como comparación se entrena también una regresión logística. Si la red no le gana, el problema está en los datos y no en la arquitectura.

### Entrenamiento
- Se ejecuta de forma manual en GitHub Actions, con un script en Python que lee el historial del repositorio.
- Separación por fecha: se entrena con los partidos más antiguos y se evalúa con los más recientes. Nunca se mezclan al azar.
- Un mercado no se entrena hasta que tenga al menos 1,000 registros con resultado (punto de partida, se puede ajustar).

### Reemplazo del modelo: solo si el nuevo es mejor
En cada ejecución, por cada mercado:
1. Se apartan los registros más recientes como conjunto de prueba. El modelo nuevo no los usa para entrenar.
2. Se entrena el modelo nuevo con el resto.
3. El modelo nuevo y el modelo publicado se evalúan con el mismo conjunto de prueba.
4. Si el nuevo tiene mejor log loss, reemplaza al publicado. Si es igual o peor, se queda el anterior.
5. La decisión es independiente por mercado: el nuevo puede reemplazar al de goles y no al de corners.
6. Cada ejecución guarda un informe con las métricas de los dos modelos y la decisión tomada. Los modelos anteriores se conservan para poder volver a ellos.

### Evaluación
- Porcentaje de acierto.
- Calibración: si la red dice 60%, el resultado debería salir alrededor de 6 de cada 10 veces.
- Log loss y Brier.
- Referencias a superar: la probabilidad de Betano sin margen y el análisis estadístico.
- La predicción de la red solo se muestra en los mercados donde supera a la probabilidad de Betano sin margen.

### Uso en la página
El entrenamiento guarda los pesos del modelo en un archivo del repositorio, con su fecha y sus métricas. La página carga ese archivo y calcula la predicción en el navegador.

### Datos históricos
Se cargan temporadas pasadas desde Sofascore para tener más datos desde el inicio. Esos partidos no tienen cuotas históricas de Betano, así que sirven para un modelo que usa solo estadísticas, que después se ajusta con los registros que sí tienen cuotas. Las estadísticas de cada partido histórico se calculan solo con los partidos anteriores a él.

Se cargan las 2 últimas temporadas de las ligas que más se analizan. No se usan más temporadas porque cada temporada trae cambios en los equipos y en el nivel. La extensión hace la carga de a pocos para que Sofascore no la bloquee.

### Intuición
La "intuición" de la red son los patrones que encuentra sola al combinar las variables de entrada (por ejemplo, local con pocos días de descanso contra un rival que concede muchos corners). No se agrega ningún dato extra para esto. La red solo puede encontrar patrones que existan en los datos que recibe.

### Nivel de los equipos y sorpresas
En fútbol, NBA y otras ligas pasa que el último de la tabla le da pelea al primero o a los de arriba. Para que la red pueda detectarlo:
- Cada equipo tiene un rating tipo Elo, calculado con sus resultados. Se puede calcular para las temporadas históricas porque solo necesita resultados, no cuotas.
- Variables de rendimiento relativo: cuánto rinde el equipo por encima o por debajo de lo que su rating anticipaba, y cómo le va contra rivales de rating alto (por ejemplo, si pierde por márgenes pequeños contra los primeros).

## Explicabilidad

- Debajo de cada mercado del resultado hay una sección desplegable con las variables que más empujaron la predicción.
- **Análisis estadístico:** se calcula cuánto cambia la probabilidad si un factor se reemplaza por el promedio de la liga. Se muestra como impacto aproximado (por ejemplo: forma reciente +8%, localía +4%, rival concede corners +6%, árbitro 0%), porque con Poisson las contribuciones no se suman exactamente.
- **Red neuronal:** se usa SHAP o una técnica parecida para mostrar sus variables principales.
- La explicación dice qué movió al modelo, no qué causa el resultado en la cancha.
- En el dashboard se muestra qué variables pesan más en cada modelo. Un patrón concreto (por ejemplo, "equipos de abajo contra el líder") solo se muestra si se repite en los datos de prueba, junto con la cantidad de casos que lo respaldan.

## Fases posteriores

Se hacen después de que la red base funcione:

- **Meta-modelo** que combine el análisis estadístico y la red para un mismo mercado. Solo cuando los dos tengan varios meses de historial y se pueda medir si combinarlos mejora la predicción.
- **Noticias convertidas en variables.** Se clasifican en categorías fijas (jugador_clave_ausente, rotacion_probable, cambio_entrenador, fatiga, motivacion_competitiva, etc.) con intensidad y fiabilidad de la fuente. Por cada variable se guarda el enlace, el titular, la fuente, la fecha y hora de publicación y la clasificación asignada, para poder auditarla. Condiciones:
  - Solo cuentan noticias publicadas antes de extraer las cuotas.
  - No hay noticias para las temporadas históricas: la red aprende de estas variables desde que se empiecen a recolectar.
  - Clasificar con una IA tiene costo por uso y requiere una clave de API que no puede guardarse en el repositorio público.
  - La fiabilidad de cada fuente se define en una lista calificada por el usuario.
- **Estilo del equipo según el marcador (fútbol).** Cómo cambian sus corners cuando va ganando, empatando o perdiendo. El minuto de cada corner sale de los comentarios de Flashscore y el marcador en ese minuto, de los goles del partido. Requiere abrir más páginas por partido, lo que aumenta el riesgo de bloqueo.

## Orden de construcción

1. Estructura del repositorio y formato de los datos (partido, mercado, análisis, registro del historial).
2. Página con datos de prueba: carga, filtros, análisis y sección de historial.
3. Extractor de Sofascore: partidos del día, ligas, estadísticas y resultados. Después, extractor de Flashscore para completar datos.
4. Extractor de Betano: mercados y cuotas, y emparejamiento de partidos.
5. Motor de análisis real por deporte.
6. Guardado del historial en el repositorio y publicación con GitHub Actions.
7. Casas de referencia (Apuesta Total y Te Apuesto primero).
8. Carga de temporadas pasadas desde Sofascore.
9. Red neuronal: script de entrenamiento, comparación con el modelo publicado, uso en la página y explicabilidad.
10. Fases posteriores, en el orden que se decida.

## Limitaciones conocidas

- Ningún modelo garantiza ganar. El objetivo es estimar la probabilidad un poco mejor que la casa en algunos partidos.
- Betano, Sofascore y Flashscore no tienen API pública. Extraer sus datos puede ir contra sus términos de uso y los extractores pueden dejar de funcionar sin aviso.
- El repositorio es público: el historial queda visible para cualquiera.
