# Instrucciones para Claude

- Las decisiones del proyecto están en `docs/ESPECIFICACION.md`. Léelo antes de proponer o construir cualquier cosa y respeta lo acordado ahí.
- Si el usuario cambia un criterio, actualiza `docs/ESPECIFICACION.md` en el mismo cambio.
- No construyas un paso del orden de construcción sin que el usuario lo pida.
- No programes extractores sin muestras reales de las respuestas de cada sitio.
- El formato de los datos está en `docs/FORMATO_DATOS.md` y en `esquemas/`. Si cambias un esquema o una regla de `comun/`, actualiza ese documento, los ejemplos y las pruebas.
- Antes de subir cambios ejecuta `npm test` y `npm run validar`.
- Escribe en español, con lenguaje claro y sin exagerar.
