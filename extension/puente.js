// Puente entre la página del proyecto y la extensión. Corre dentro de la página (GitHub Pages o el
// servidor local): pasa los mensajes de la página al service worker (fondo.js) y le devuelve las respuestas.

(() => {
  const DE_LA_PAGINA = 'bdp-extension';
  const A_LA_PAGINA = 'bdp-pagina';
  const version = chrome.runtime.getManifest().version;

  const responder = (datos) => window.postMessage({ destino: A_LA_PAGINA, ...datos }, location.origin);

  // La página mira este atributo para saber si la extensión está instalada. Al empezar a cargar la página
  // el elemento <html> puede no existir todavía: en ese caso se marca apenas termina de leerse el HTML,
  // antes de que corran los scripts de la página.
  const marcar = () => { document.documentElement.dataset.bdpExtension = version; };
  if (document.documentElement) marcar();
  else document.addEventListener('readystatechange', marcar, { once: true });

  window.addEventListener('message', (evento) => {
    if (evento.source !== window || evento.origin !== location.origin) return;
    const mensaje = evento.data;
    if (!mensaje || mensaje.destino !== DE_LA_PAGINA || typeof mensaje.id !== 'string') return;
    const { id, tipo, sitio, ruta } = mensaje;
    let envio;
    try {
      envio = chrome.runtime.sendMessage({ tipo, sitio, ruta });
    } catch {
      responder({ id, ok: false, error: 'La extensión se actualizó o se desactivó. Recarga la página.' });
      return;
    }
    envio.then(
      (respuesta) => responder({ id, ...(respuesta ?? { ok: false, error: 'La extensión no respondió.' }) }),
      (error) => responder({ id, ok: false, error: String(error?.message ?? error) }),
    );
  });

  responder({ tipo: 'lista', version });
})();
