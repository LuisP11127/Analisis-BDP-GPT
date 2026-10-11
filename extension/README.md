# Extensión de Brave

Lee los datos de los sitios desde tu navegador y se los pasa a la página del proyecto. Por ahora, solo fútbol:

- **Sofascore:** ligas y partidos del día, datos previos de cada partido (tabla, árbitro, bajas, alineación) y las estadísticas de los últimos partidos de cada equipo.
- **Betano:** las cuotas de los 7 mercados de fútbol del proyecto.

Apuesta Total y Flashscore se agregan a medida que se construyen sus extractores.

La página la usa sola: tú eliges ligas y partidos, y la extensión hace los pedidos. No hace falta abrir cada partido en Sofascore ni en Betano.

## Instalación (una sola vez)

1. Descarga el repositorio: en GitHub, rama `main`, **Code → Download ZIP**, y descomprímelo en una carpeta que no vayas a borrar.
2. En Brave abre `brave://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta `extension` del repositorio.
5. Opcional: fíjala en la barra (ícono de pieza de rompecabezas → chincheta).

Para actualizarla cuando cambie el repositorio: reemplaza la carpeta por la nueva, pulsa el botón de recargar (↻) de la extensión en `brave://extensions` y recarga la página del proyecto.

## Uso

1. Abre la página: https://luisp11127.github.io/Analisis-BDP-GPT/web/
2. Arriba a la derecha, en **Datos**, elige **Reales**.
3. Elige la fecha y pulsa **Cargar ligas**. Salen todas las ligas de fútbol que tienen partidos ese día en hora de Lima.
4. Marca las ligas que te interesan y pulsa **Cargar partidos**. La página recuerda las ligas que analizaste la última vez.
5. Elige los partidos y pulsa **Analizar**. Por cada partido se leen hasta unos 65 datos de Sofascore (unos 20 a 30 segundos por partido) y después sus cuotas en Betano.

Solo se pueden analizar partidos que todavía no empiezan. En **Resultado**, cada partido tiene una sección **Datos de Sofascore** con lo leído, una línea con el partido que se encontró en Betano y la línea candidata de cada mercado. Si la página no está segura de cuál es el partido en Betano, te muestra los partidos de esa liga para que elijas; la elección se recuerda para la próxima vez. El botón **Descargar los datos leídos** guarda todo en un archivo JSON.

Si no hay una pestaña de Sofascore o de Betano abierta, la extensión abre una en segundo plano y la cierra sola después de un minuto sin uso (si la estás mirando, la deja abierta).

## Si algo falla

Haz clic en el ícono de la extensión: se abre la página **Diagnóstico de la extensión**.

1. Pulsa **Probar**.
2. Si un sitio falla, ábrelo en una pestaña normal (https://www.sofascore.com/ o https://www.betano.pe/), espera a que cargue y vuelve a probar. Betano puede pedir una verificación la primera vez.
3. Pulsa **Copiar reporte** y compártelo.

Si la página dice "Falta la extensión" aunque está instalada, recarga la página. Si dice que la extensión se actualizó, también.

## Permisos

| Permiso | Para qué |
|---|---|
| `https://www.sofascore.com/*`, `https://www.betano.pe/*` | Hacer los pedidos a cada sitio desde una pestaña del sitio |
| `scripting` | Ejecutar esos pedidos dentro de la pestaña del sitio |
| `webRequest` | Ver la cabecera `x-requested-with` que manda la página de Sofascore a su API, para repetirla en los pedidos de la extensión |
| `storage` | Recordar esa cabecera y las pestañas que abrió la extensión mientras el navegador está abierto |
| `alarms` | Cerrar la pestaña que abrió la extensión cuando lleva un minuto sin uso |

La extensión no lee tus otras pestañas ni otros sitios. Solo responde a la página del proyecto (`luisp11127.github.io/Analisis-BDP-GPT`) y al servidor local (`localhost`), y solo hace pedidos de lectura (GET) a la API de los sitios de `sitios.js`.

## Cómo funciona

```
página del proyecto ──postMessage──► puente.js ──mensaje──► fondo.js ──► pestaña del sitio ──fetch──► API del sitio
```

| Archivo | Contenido |
|---|---|
| `manifest.json` | Permisos y archivos de la extensión (Manifest V3) |
| `sitios.js` | Sitios que se pueden leer, qué rutas acepta cada uno y la pausa entre pedidos |
| `fondo.js` | Service worker: cola de pedidos por sitio (de a uno, con 300 ms de pausa en Sofascore y 400 ms en Betano), pestañas y cabeceras |
| `puente.js` | Corre dentro de la página del proyecto y pasa los mensajes entre la página y `fondo.js` |
| `diagnostico.html`, `.js`, `.css` | Página de diagnóstico |

La extensión no convierte datos: devuelve las respuestas de los sitios tal cual. La conversión al formato del proyecto está en la página (`web/js/fuentes/`), así se puede probar sin la extensión y los cambios de formato no obligan a reinstalarla. De dónde sale cada dato está en `docs/FUENTES.md`.

Para agregar un sitio: hace falta una muestra real de sus respuestas (HAR). Se agrega en `sitios.js`, su origen en `host_permissions` de `manifest.json`, y su convertidor en `web/js/fuentes/`.
