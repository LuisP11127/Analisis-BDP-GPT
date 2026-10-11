# Instrucciones para Claude

- Las decisiones del proyecto están en `docs/ESPECIFICACION.md`. Léelo antes de proponer o construir cualquier cosa y respeta lo acordado ahí.
- Si el usuario cambia un criterio, actualiza `docs/ESPECIFICACION.md` en el mismo cambio.
- No construyas un paso del orden de construcción sin que el usuario lo pida.
- No programes extractores sin muestras reales de las respuestas de cada sitio.
- El formato de los datos está en `docs/FORMATO_DATOS.md` y en `esquemas/`. Si cambias un esquema o una regla de `comun/`, actualiza ese documento, los ejemplos y las pruebas.
- Los datos de `ejemplos/` se generan con `npm run ejemplos` (`herramientas/generar-ejemplos.mjs`). No los edites a mano: cambia el generador.
- Si agregas o quitas archivos de datos, ejecuta `npm run indice` para actualizar los `indice.json`.
- Antes de subir cambios ejecuta `npm test` y `npm run validar`. Si cambias la página, revísala en un navegador (`npm run pagina`).
- Escribe en español, con lenguaje claro y sin exagerar.
