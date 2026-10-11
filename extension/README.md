# Extensión de Brave

Lee los datos de los sitios desde tu navegador y se los pasa a la página del proyecto. Por ahora, solo fútbol:

- **Sofascore:** ligas y partidos del día, datos previos de cada partido (tabla, árbitro, bajas, alineación) y las estadísticas de los últimos partidos de cada equipo.
- **Betano:** las cuotas de los 7 mercados de fútbol del proyecto.
- **Apuesta Total:** la lista de sus partidos y las cuotas de los mismos 7 mercados.

Flashscore se agrega cuando esté su extractor.

La página la usa sola: tú eliges ligas y partidos, y la extensión hace los pedidos. No hace falta abrir cada partido en Sofascore ni en las casas.

## Instalación (una sola vez)

1. Descarga el repositorio: en GitHub, rama `main`, **Code → Download ZIP**, y descomprímelo en una carpeta que no vayas a borrar.
2. En Brave abre `brave://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta `extension` del repositorio.
5. Opcional: fíjala en la barra (ícono de pieza de rompecabezas → chincheta).

Para actualizarla cuando cambie el repositorio: reemplaza la carpeta por la nueva, pulsa el botón de recargar (↻) de la extensión en `brave://extensions` y recarga la página del proyecto.

## Uso

1. Abre la página: https://luisp11127.github.io/Analisis-BDP-GPT/web/
2. Las ligas de fútbol del día (hora de Lima) y los partidos de las principales se cargan solos. Los partidos de las ligas que analizaste la última vez quedan marcados. Para ver otra liga, ábrela o márcala. Si cambias la fecha, todo se vuelve a cargar solo.
3. Marca ligas completas o partidos sueltos y pulsa **Análisis estadístico**, **Análisis red neuronal** o **Ambos análisis**. Por cada partido se leen hasta unos 65 datos de Sofascore (unos 20 a 30 segundos por partido) y después sus cuotas en Betano y en Apuesta Total. Una ventana muestra el avance; puedes cancelar.

Solo se pueden analizar partidos que todavía no empiezan. En **Resultado**, cada partido tiene una sección **Datos de Sofascore** con lo leído, una línea por casa con el partido que se encontró y la línea candidata de cada mercado: sale de Betano y, si Betano no tiene ese mercado, de Apuesta Total. Si la página no está segura de cuál es el partido en una casa, te muestra los partidos de esa liga para que elijas; la elección se recuerda para la próxima vez. El botón **Descargar los datos leídos** guarda todo en un archivo JSON.

Si no hay una pestaña del sitio abierta, la extensión abre una en segundo plano y la cierra sola después de un minuto sin uso (si la estás mirando, la deja abierta). Para Apuesta Total abre la página de apuestas deportivas (https://www.apuestatotal.com/apuestas-deportivas/), porque sus partidos y cuotas están en un marco de su proveedor (`prod20392.kmianko.com`).

## Si algo falla

Haz clic en el ícono de la extensión: se abre la página **Diagnóstico de la extensión**.

1. Pulsa **Probar**.
2. Si un sitio falla, ábrelo en una pestaña normal (https://www.sofascore.com/, https://www.betano.pe/ o https://www.apuestatotal.com/apuestas-deportivas/), espera a que cargue y vuelve a probar. Betano puede pedir una verificación la primera vez.
3. Pulsa **Copiar reporte** y compártelo.

En la misma página, **Guardar una muestra** pide una ruta de la API de un sitio y guarda la respuesta en un archivo de tu carpeta de descargas. Sirve cuando hace falta una muestra para construir o ajustar un extractor: eliges el sitio, pegas la ruta y pulsas **Pedir y guardar**. Solo acepta las rutas que la extensión puede leer.

Si la página dice "Falta la extensión" aunque está instalada, recarga la página. Si dice que la extensión se actualizó, también.

## Permisos

| Permiso | Para qué |
|---|---|
| `https://www.sofascore.com/*`, `https://www.betano.pe/*` | Hacer los pedidos a cada sitio desde una pestaña del sitio |
| `https://www.apuestatotal.com/*`, `https://prod20392.kmianko.com/*` | Encontrar la pestaña de apuestas deportivas de Apuesta Total y hacer los pedidos dentro del marco de su proveedor |
| `scripting` | Ejecutar esos pedidos dentro de la pestaña del sitio |
| `webRequest` | Ver las cabeceras que mandan las páginas a su API (`x-requested-with` en Sofascore, `session` en Apuesta Total), para repetirlas en los pedidos de la extensión |
| `storage` | Recordar esas cabeceras y las pestañas que abrió la extensión mientras el navegador está abierto |
| `alarms` | Cerrar la pestaña que abrió la extensión cuando lleva un minuto sin uso |

La extensión no lee tus otras pestañas ni otros sitios. Solo responde a la página del proyecto (`luisp11127.github.io/Analisis-BDP-GPT`) y al servidor local (`localhost`), y solo hace pedidos de lectura (GET) a la API de los sitios de `sitios.js`.

La cabecera `session` de Apuesta Total es la sesión de su proveedor de apuestas: si tienes tu cuenta abierta en ese navegador, es la de tu cuenta. La extensión la usa solo para pedir la lista de partidos y las cuotas, igual que la página de Apuesta Total, y se borra al cerrar el navegador. No puede apostar ni ver tu saldo: esas rutas no están en `sitios.js`.

## Cómo funciona

```
página del proyecto ──postMessage──► puente.js ──mensaje──► fondo.js ──► pestaña del sitio ──fetch──► API del sitio
```

| Archivo | Contenido |
|---|---|
| `manifest.json` | Permisos y archivos de la extensión (Manifest V3) |
| `sitios.js` | Sitios que se pueden leer, qué rutas acepta cada uno y la pausa entre pedidos |
| `fondo.js` | Service worker: cola de pedidos por sitio (de a uno, con 300 ms de pausa en Sofascore y 400 ms en Betano y Apuesta Total), pestañas, marcos y cabeceras |
| `puente.js` | Corre dentro de la página del proyecto y pasa los mensajes entre la página y `fondo.js` |
| `diagnostico.html`, `.js`, `.css` | Página de diagnóstico |

La extensión no convierte datos: devuelve las respuestas de los sitios tal cual. La conversión al formato del proyecto está en la página (`web/js/fuentes/`), así se puede probar sin la extensión y los cambios de formato no obligan a reinstalarla. De dónde sale cada dato está en `docs/FUENTES.md`.

Para agregar un sitio: hace falta una muestra real de sus respuestas (HAR). Se agrega en `sitios.js`, su origen en `host_permissions` de `manifest.json` (si la API está en un marco, también el de la página que lo contiene) y su convertidor en `web/js/fuentes/`.
