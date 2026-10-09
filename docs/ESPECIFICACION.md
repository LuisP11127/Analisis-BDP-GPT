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
- Muchas ligas pequeñas no tienen en Sofascore datos de corners, tiros, tarjetas o estadísticas por jugador. En esos casos el análisis de esos mercados queda incompleto o no se hace.

## Arquitectura

- **Extensión de navegador** (Brave, Manifest V3, instalada en modo desarrollador con "Cargar descomprimida"). Lee los datos de Betano, Sofascore y las casas de referencia mientras el usuario tiene abiertas esas páginas, y se los pasa a la página web. Si un sitio cambia su diseño, hay que ajustar su extractor. Si la extensión no consigue un dato, se ingresa a mano.
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
- Pendiente: cómo mostrar el mercado cuando los dos modelos eligen lados distintos.

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
- Contexto: liga, días de descanso, bajas, promedio del árbitro en tarjetas y estadísticas del lanzador abridor en béisbol.

La página guarda en el historial el vector de entrada exacto y también las estadísticas originales, para que el entrenamiento use los mismos datos que el uso diario y se puedan recalcular si se agregan nuevas entradas.

### Arquitectura
- Red pequeña: 2 o 3 capas ocultas de 32 a 64 neuronas, con dropout y parada temprana.
- Un modelo por mercado. Si un mercado tiene pocos datos, puede compartir modelo con otros del mismo deporte.
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

Pendiente: cuántas temporadas y de qué ligas.

### Intuición
Pendiente de definir: si "intuición" se refiere a los patrones que la red encuentra sola al combinar variables, o a registrar la corazonada del usuario en cada mercado.

## Orden de construcción

1. Estructura del repositorio y formato de los datos (partido, mercado, análisis, registro del historial).
2. Página con datos de prueba: carga, filtros, análisis y sección de historial.
3. Extractor de Sofascore: partidos del día, ligas, estadísticas y resultados.
4. Extractor de Betano: mercados y cuotas, y emparejamiento de partidos.
5. Motor de análisis real por deporte.
6. Guardado del historial en el repositorio y publicación con GitHub Actions.
7. Casas de referencia (Apuesta Total y Te Apuesto primero).
8. Carga de temporadas pasadas desde Sofascore.
9. Red neuronal: script de entrenamiento, comparación con el modelo publicado y uso en la página.

## Limitaciones conocidas

- Ningún modelo garantiza ganar. El objetivo es estimar la probabilidad un poco mejor que la casa en algunos partidos.
- Betano y Sofascore no tienen API pública. Extraer sus datos puede ir contra sus términos de uso y los extractores pueden dejar de funcionar sin aviso.
- El repositorio es público: el historial queda visible para cualquiera.
