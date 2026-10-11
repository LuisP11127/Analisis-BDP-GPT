// Comunicación con la extensión de Brave. La extensión pone un script (extension/puente.js) dentro de
// esta página: la página le escribe con postMessage y el puente responde de la misma forma.

const A_LA_EXTENSION = 'bdp-extension';
const DE_LA_EXTENSION = 'bdp-pagina';
// Un pedido puede tardar si la extensión tiene que abrir una pestaña del sitio y esperar a que cargue.
const TIEMPO_PEDIDO_MS = 60000;

/**
 * Conexión con la extensión. `ventana` se puede cambiar en las pruebas.
 * - detectar(): { version, sitios } si la extensión está instalada, o null.
 * - pedir(sitio, ruta): { estado, datos }. Un 404 llega como datos null. Los demás errores se lanzan.
 */
export function crearConexion(ventana = window) {
  const pendientes = new Map();
  const alEstarLista = [];
  let contador = 0;
  let version = ventana.document.documentElement.dataset.bdpExtension ?? null;

  ventana.addEventListener('message', (evento) => {
    if (evento.source !== ventana || evento.origin !== ventana.location.origin) return;
    const mensaje = evento.data;
    if (!mensaje || mensaje.destino !== DE_LA_EXTENSION) return;
    if (mensaje.tipo === 'lista') {
      version = mensaje.version;
      alEstarLista.splice(0).forEach((avisar) => avisar());
      return;
    }
    const pendiente = pendientes.get(mensaje.id);
    if (!pendiente) return;
    pendientes.delete(mensaje.id);
    clearTimeout(pendiente.reloj);
    if (mensaje.ok) pendiente.resolver(mensaje);
    else pendiente.rechazar(new Error(mensaje.error ?? 'La extensión devolvió un error.'));
  });

  function enviar(mensaje, tiempo = TIEMPO_PEDIDO_MS) {
    contador += 1;
    const id = `p${contador}`;
    return new Promise((resolver, rechazar) => {
      const reloj = setTimeout(() => {
        pendientes.delete(id);
        rechazar(new Error('La extensión no respondió a tiempo.'));
      }, tiempo);
      pendientes.set(id, { resolver, rechazar, reloj });
      ventana.postMessage({ destino: A_LA_EXTENSION, id, ...mensaje }, ventana.location.origin);
    });
  }

  return {
    async detectar(espera = 1500) {
      if (!version) await new Promise((avisar) => { alEstarLista.push(avisar); setTimeout(avisar, espera); });
      if (!version) return null;
      try {
        const estado = await enviar({ tipo: 'estado' }, 5000);
        return { version: estado.version, sitios: estado.sitios };
      } catch {
        return null;
      }
    },
    async pedir(sitio, ruta) {
      const respuesta = await enviar({ tipo: 'pedir', sitio, ruta });
      return { estado: respuesta.estado, datos: respuesta.datos ?? null };
    },
  };
}

/**
 * Función para pedir rutas de un sitio de a una, con memoria opcional durante la sesión.
 * `guardar(ruta)` dice qué respuestas se pueden recordar (por ejemplo, las de partidos ya terminados).
 */
export function crearLector(conexion, sitio, { guardar = () => false } = {}) {
  const memoria = new Map();
  let cola = Promise.resolve();
  return function obtener(ruta) {
    if (memoria.has(ruta)) return memoria.get(ruta);
    const resultado = cola.then(() => conexion.pedir(sitio, ruta));
    cola = resultado.catch(() => {});
    if (guardar(ruta)) {
      memoria.set(ruta, resultado);
      resultado.catch(() => memoria.delete(ruta));
    }
    return resultado;
  };
}
