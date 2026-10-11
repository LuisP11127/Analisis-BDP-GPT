# Analisis-BDP-GPT

Página web y extensión de navegador para analizar mercados de apuestas deportivas de dos resultados en fútbol, básquet y béisbol.

- Página: https://luisp11127.github.io/Analisis-BDP-GPT/web/
- [docs/ESPECIFICACION.md](docs/ESPECIFICACION.md): decisiones acordadas y orden de construcción.
- [docs/FORMATO_DATOS.md](docs/FORMATO_DATOS.md): cómo se guardan los partidos, las cuotas, los análisis y el historial.

## Estado

- Paso 1 terminado: formato de los datos, catálogo de mercados, reglas de la línea candidata y validador.
- Paso 2 terminado: página con datos de prueba (partidos del día, resultado e historial) publicada con GitHub Actions.

Todavía no hay extensión, análisis estadístico real ni red neuronal. La página funciona con datos ficticios.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `web/` | La página |
| `config/` | Catálogo de mercados y casas de apuestas |
| `esquemas/` | JSON Schema de cada tipo de archivo |
| `comun/` | Reglas y validación en JavaScript, compartidas por la página y las herramientas |
| `datos/` | Datos reales (vacío por ahora) |
| `ejemplos/` | Datos ficticios para pruebas y para la página |
| `herramientas/` | Validador, generador de ejemplos, índices, servidor local y armado del sitio |
| `pruebas/` | Pruebas automáticas |
| `extension/`, `entrenamiento/` | Pasos siguientes |

## Comandos

Requiere Node.js 22 o superior.

```
npm install
npm run pagina    # sirve la página en http://localhost:8080/web/
npm test          # pruebas automáticas
npm run validar   # revisa datos, ejemplos e índices
npm run ejemplos  # vuelve a generar los datos de ejemplo
npm run indice    # vuelve a escribir los indice.json
```
