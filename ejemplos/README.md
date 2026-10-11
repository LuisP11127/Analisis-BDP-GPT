# Datos de ejemplo

Datos ficticios con el mismo formato que los reales: equipos, ligas y jugadores inventados, con ids `ejemplo:...`. Las cuotas, probabilidades y resultados no son reales.

- `datos/`: partidos guardados e historial de análisis de días anteriores.
- `extraccion/`: una extracción del día de prueba, como la que entregará la extensión.

Se generan con `npm run ejemplos` (`herramientas/generar-ejemplos.mjs`) y no se editan a mano. Sirven para las pruebas automáticas y para probar la página. No se usan para entrenar la red.
