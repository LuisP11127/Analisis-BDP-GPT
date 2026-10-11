# Instrucciones para Claude

- Las decisiones del proyecto están en `docs/ESPECIFICACION.md`. Léelo antes de proponer o construir cualquier cosa y respeta lo acordado ahí.
- Si el usuario cambia un criterio, actualiza `docs/ESPECIFICACION.md` en el mismo cambio.
- No construyas un paso del orden de construcción sin que el usuario lo pida.
- No programes extractores sin muestras reales de las respuestas de cada sitio. No subas las muestras (HAR) ni respuestas copiadas de los sitios. Lo que se sabe de cada sitio va en `docs/FUENTES.md`.
- El formato de los datos está en `docs/FORMATO_DATOS.md` y en `esquemas/`. Si cambias un esquema o una regla de `comun/`, actualiza ese documento.
- La página funciona solo con datos reales, leídos con la extensión. El usuario pidió quitar los datos de prueba y las pruebas automáticas: no los vuelvas a agregar; él avisa si algo falla.
- Si agregas o quitas archivos de datos, ejecuta `npm run indice` para actualizar los `indice.json`.
- Antes de subir cambios ejecuta `npm run validar`. Si cambias la página, revísala en un navegador (`npm run pagina`).
- Escribe en español, con lenguaje claro y sin exagerar.
