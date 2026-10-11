# Analisis-BDP-GPT

Página web y extensión de navegador para analizar mercados de apuestas deportivas de dos resultados en fútbol, básquet y béisbol.

- [docs/ESPECIFICACION.md](docs/ESPECIFICACION.md): decisiones acordadas y orden de construcción.
- [docs/FORMATO_DATOS.md](docs/FORMATO_DATOS.md): cómo se guardan los partidos, las cuotas, los análisis y el historial.

## Estado

Paso 1 terminado: estructura del repositorio, catálogo de mercados, esquemas del formato de datos, reglas de la línea candidata, validador, datos de ejemplo y pruebas. Todavía no hay página, extensión ni modelos.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `config/` | Catálogo de mercados y casas de apuestas |
| `esquemas/` | JSON Schema de cada tipo de archivo |
| `comun/` | Reglas y validación en JavaScript, para la página y la extensión |
| `datos/` | Datos reales (vacío por ahora) |
| `ejemplos/` | Datos ficticios para pruebas |
| `herramientas/` | Validador de línea de comandos |
| `pruebas/` | Pruebas automáticas |
| `web/`, `extension/`, `entrenamiento/` | Pasos siguientes |

## Comandos

Requiere Node.js 22 o superior.

```
npm install
npm run validar   # revisa datos/ y ejemplos/datos/
npm test          # pruebas automáticas
```
