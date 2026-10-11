# Página web

Publicada en https://luisp11127.github.io/Analisis-BDP-GPT/web/ con GitHub Actions (`.github/workflows/publicar.yml`).

Los partidos y las cuotas se leen con la extensión de Brave (`extension/README.md`). Por ahora solo fútbol. Sin la extensión, la página muestra cómo instalarla y deja ver el historial.

Tiene tres secciones:

- **Partidos del día:** arriba, la fecha (‹ › y **Hoy**), cuántos partidos hay marcados y los botones **Análisis estadístico**, **Análisis red neuronal** y **Ambos análisis**. Al abrir la página se leen solas las ligas del día y los partidos de las ligas fijas de Sofascore para Perú, y quedan marcados los partidos de las ligas analizadas la última vez. Los partidos de otra liga se leen al abrirla o al marcarla. Se puede buscar por liga, país o equipo, ver solo los partidos por jugar, abrir o cerrar todas las ligas, quitar las marcas y volver a leer (↻) sin perder las marcas.
- **Resultado:** lo del método elegido. Mientras se leen los datos, una ventana muestra el avance y permite cancelar. Cada partido muestra los datos leídos de Sofascore (tabla, árbitro, bajas, alineación y los últimos 10 partidos de cada equipo), el partido encontrado en cada casa y, por mercado, la línea candidata con el detalle de cuotas. Cuando existan el análisis estadístico (paso 5) y la red neuronal (paso 9), mostrará también el lado recomendado con su nivel de confianza, la predicción de la red y el desacuerdo, y permitirá registrar la apuesta. Lo leído se puede descargar.
- **Historial:** lista por deporte con filtros por fecha, liga y mercado, nivel de confianza de cada registro y resumen de acierto y ganancia por mercado y por nivel de confianza.

Los análisis y apuestas hechos en la página duran solo mientras está abierta; el guardado en el repositorio es el paso 6.

## Archivos

| Archivo | Contenido |
|---|---|
| `index.html`, `estilos.css` | Estructura y estilos, con tema claro y oscuro |
| `js/app.js` | Estado, eventos y vistas |
| `js/analisis.js` | Arma el resultado y los registros a partir de la extracción |
| `js/real.js` | Qué partidos se pueden elegir, extracción del día y resumen de los últimos partidos |
| `js/extension.js` | Comunicación con la extensión de Brave |
| `js/fuentes/sofascore.js` | Pedidos a Sofascore y conversión de sus respuestas al formato del proyecto (`docs/FUENTES.md`) |
| `js/fuentes/betano.js` | Cuotas de Betano y emparejamiento de sus partidos con los de Sofascore |
| `js/fuentes/apuestatotal.js` | Partidos y cuotas de Apuesta Total |
| `js/emparejamiento.js` | Cómo se encuentra en una casa la liga y el partido de Sofascore |
| `js/equivalencias.js` | Nombres de ligas y equipos en cada casa, con el formato de `esquemas/equivalencias.schema.json` |
| `js/historial.js` | Filtros, acierto, resultado de las apuestas y resumen |
| `js/formato.js` | Textos: fechas en hora de Lima, porcentajes, montos y nombres de los lados |
| `js/datos.js` | Lectura de la configuración y del historial guardado |
| `js/vista.js` | Plantillas HTML con escape automático |

## Verla en la computadora

```
npm run pagina
```

y abrir http://localhost:8080/web/. Abrir `index.html` directamente desde la carpeta no funciona, porque el navegador bloquea la lectura de los archivos de datos. La extensión también funciona con la página local.
