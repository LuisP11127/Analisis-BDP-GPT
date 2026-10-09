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

Primero se usa un modelo estadístico. La red neuronal viene después, cuando haya suficiente historial (se necesitan miles de registros por mercado).

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
- Por cada mercado se muestra la línea candidata, el lado recomendado y solo su probabilidad. Ejemplo: `Under 2.5 — 58%`.

## Historial

Se guarda todo lo analizado, se haya apostado o no. Por cada partido y mercado:

- Estadísticas disponibles **antes** del partido, tal como se usaron en el análisis (no deben mezclarse datos posteriores, para no contaminar el entrenamiento de la red neuronal).
- Todas las líneas y cuotas de Betano y de las casas de referencia, con la hora de extracción.
- Línea candidata, probabilidad calculada por el modelo y lado recomendado.
- Probabilidad implícita de la cuota (sin margen) y promedio del mercado.
- Si se apostó, el monto y la cuota tomada.
- Resultado real del mercado y si se ganó o se perdió.

Actualización de resultados: al abrir Sofascore después del partido, la extensión lee los resultados de los partidos pendientes y los marca automáticamente.

Vista del historial: una lista general por deporte, con filtros por fecha, liga y mercado, y un resumen del porcentaje de acierto por mercado.

## Orden de construcción

1. Estructura del repositorio y formato de los datos (partido, mercado, análisis, registro del historial).
2. Página con datos de prueba: carga, filtros, análisis y sección de historial.
3. Extractor de Sofascore: partidos del día, ligas, estadísticas y resultados.
4. Extractor de Betano: mercados y cuotas, y emparejamiento de partidos.
5. Motor de análisis real por deporte.
6. Guardado del historial en el repositorio y publicación con GitHub Actions.
7. Casas de referencia (Apuesta Total y Te Apuesto primero).
8. Red neuronal, cuando haya suficiente historial.

## Limitaciones conocidas

- Ningún modelo garantiza ganar. El objetivo es estimar la probabilidad un poco mejor que la casa en algunos partidos.
- Betano y Sofascore no tienen API pública. Extraer sus datos puede ir contra sus términos de uso y los extractores pueden dejar de funcionar sin aviso.
- El repositorio es público: el historial queda visible para cualquiera.
