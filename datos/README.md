# Datos reales

Aquí se guardan los partidos, el historial y las equivalencias de nombres. El formato está en [docs/FORMATO_DATOS.md](../docs/FORMATO_DATOS.md).

- `partidos/{deporte}/{liga}/{temporada}/{AAAA-MM}.json`
- `historial/{deporte}/{AAAA}/{AAAA-MM-DD}.json`
- `equivalencias/{deporte}.json`

La página escribe estos archivos desde el paso 6. Si se corrige algo a mano, hay que ejecutar `npm run validar` antes de subir el cambio.
