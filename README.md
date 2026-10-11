# Analisis-BDP-GPT

Página web y extensión de navegador para analizar mercados de apuestas deportivas de dos resultados en fútbol, básquet y béisbol.

- Página: https://luisp11127.github.io/Analisis-BDP-GPT/web/
- [docs/ESPECIFICACION.md](docs/ESPECIFICACION.md): decisiones acordadas y orden de construcción.
- [docs/FORMATO_DATOS.md](docs/FORMATO_DATOS.md): cómo se guardan los partidos, las cuotas, los análisis y el historial.

## Estado

- Paso 1 terminado: formato de los datos, catálogo de mercados, reglas de la línea candidata y validador.
- Paso 2 terminado: página (partidos del día, resultado e historial) publicada con GitHub Actions.
- Pasos 3, 4 y 7 en curso: la extensión de Brave lee el fútbol de Sofascore, Betano y Apuesta Total. Falta Flashscore.

Todavía no están el análisis estadístico (paso 5), el guardado del historial (paso 6) ni la red neuronal (paso 9). La página funciona solo con datos reales leídos con la extensión.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `web/` | La página |
| `config/` | Catálogo de mercados y casas de apuestas |
| `esquemas/` | JSON Schema de cada tipo de archivo |
| `comun/` | Reglas y validación en JavaScript, compartidas por la página y las herramientas |
| `datos/` | Datos guardados: partidos, historial y equivalencias (vacío hasta el paso 6) |
| `extension/` | Extensión de Brave que lee los sitios ([instrucciones](extension/README.md)) |
| `herramientas/` | Validador, índices, servidor local y armado del sitio |
| `entrenamiento/` | Red neuronal (paso 9) |
| `docs/` | Especificación, formato de los datos y de dónde sale cada dato |

## Comandos

Requiere Node.js 22 o superior.

```
npm install
npm run pagina    # sirve la página en http://localhost:8080/web/
npm run validar   # revisa datos/ y sus índices
npm run indice    # vuelve a escribir los indice.json
npm run sitio     # arma en _sitio/ lo que se publica
```
