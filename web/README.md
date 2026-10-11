# Página web

Publicada en https://luisp11127.github.io/Analisis-BDP-GPT/web/ con GitHub Actions (`.github/workflows/publicar.yml`).

Tiene tres secciones:

- **Partidos del día:** carga la extracción del día, muestra los partidos por deporte y liga, permite buscar y elegir partidos o ligas completas, y lanza el análisis. Recuerda en el navegador las ligas que analizaste la última vez.
- **Resultado:** deporte → partido → mercados en el orden de `config/mercados.json`. Muestra la línea candidata, la predicción de cada modelo, el desacuerdo, la probabilidad de roja en tarjetas, el detalle de cuotas y factores, y permite registrar la apuesta.
- **Historial:** lista por deporte con filtros por fecha, liga y mercado, y resumen de acierto y ganancia por mercado.

Mientras no estén la extensión (pasos 3 y 4) ni el análisis estadístico (paso 5), funciona con los datos de prueba de `ejemplos/`. Los análisis y apuestas hechos con datos de prueba duran solo mientras la página está abierta; el guardado en el repositorio es el paso 6.

## Archivos

| Archivo | Contenido |
|---|---|
| `index.html`, `estilos.css` | Estructura y estilos, con tema claro y oscuro |
| `js/app.js` | Estado, eventos y vistas |
| `js/analisis.js` | Arma el resultado y los registros a partir de la extracción |
| `js/historial.js` | Filtros, acierto, resultado de las apuestas y resumen |
| `js/formato.js` | Textos: fechas en hora de Lima, porcentajes, montos y nombres de los lados |
| `js/datos.js` | Lectura de archivos |
| `js/vista.js` | Plantillas HTML con escape automático |

## Verla en la computadora

```
npm run pagina
```

y abrir http://localhost:8080/web/. Abrir `index.html` directamente desde la carpeta no funciona, porque el navegador bloquea la lectura de los archivos de datos.
