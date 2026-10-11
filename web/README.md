# Página web

Publicada en https://luisp11127.github.io/Analisis-BDP-GPT/web/ con GitHub Actions (`.github/workflows/publicar.yml`).

Tiene tres secciones:

- **Partidos del día:** carga la extracción del día, muestra los partidos por deporte y liga, permite buscar y elegir partidos o ligas completas, y lanza el análisis. Recuerda en el navegador las ligas que analizaste la última vez.
- **Resultado:** deporte → partido → mercados en el orden de `config/mercados.json`. Muestra la línea candidata, el lado recomendado con su nivel de confianza (alta, media o baja y el porcentaje), la predicción de la red, el desacuerdo, la probabilidad de roja en tarjetas, el detalle de cuotas y factores, y permite registrar la apuesta.
- **Historial:** lista por deporte con filtros por fecha, liga y mercado, nivel de confianza de cada registro y resumen de acierto y ganancia por mercado y por nivel de confianza.

Arriba a la derecha se elige la fuente de los datos:

- **De prueba:** los datos ficticios de `ejemplos/`, con cuotas y predicciones de ejemplo.
- **Reales:** los partidos de Sofascore, leídos con la extensión de Brave (`extension/README.md`). Por ahora solo fútbol, y sin cuotas ni análisis: esos son los pasos 4 y 5. En **Resultado** cada partido muestra los datos leídos de Sofascore (tabla, árbitro, bajas, alineación y los últimos 10 partidos de cada equipo) y se pueden descargar.

Los análisis y apuestas hechos en la página duran solo mientras está abierta; el guardado en el repositorio es el paso 6.

## Archivos

| Archivo | Contenido |
|---|---|
| `index.html`, `estilos.css` | Estructura y estilos, con tema claro y oscuro |
| `js/app.js` | Estado, eventos y vistas |
| `js/analisis.js` | Arma el resultado y los registros a partir de la extracción |
| `js/real.js` | Datos reales: qué partidos se pueden elegir, ligas por país, extracción del día y resumen de los últimos partidos |
| `js/extension.js` | Comunicación con la extensión de Brave |
| `js/fuentes/sofascore.js` | Pedidos a Sofascore y conversión de sus respuestas al formato del proyecto (`docs/FUENTES.md`) |
| `js/historial.js` | Filtros, acierto, resultado de las apuestas y resumen |
| `js/formato.js` | Textos: fechas en hora de Lima, porcentajes, montos y nombres de los lados |
| `js/datos.js` | Lectura de archivos |
| `js/vista.js` | Plantillas HTML con escape automático |

## Verla en la computadora

```
npm run pagina
```

y abrir http://localhost:8080/web/. Abrir `index.html` directamente desde la carpeta no funciona, porque el navegador bloquea la lectura de los archivos de datos. La extensión también funciona con la página local.
