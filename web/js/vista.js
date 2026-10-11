// Plantillas HTML con escape automático: todo valor interpolado se escapa salvo que venga de html``.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class Html {
  constructor(texto) {
    this.texto = texto;
  }

  toString() {
    return this.texto;
  }
}

function escapar(valor) {
  if (valor === null || valor === undefined || valor === false) return '';
  if (valor instanceof Html) return valor.texto;
  if (Array.isArray(valor)) return valor.map(escapar).join('');
  return String(valor).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function html(partes, ...valores) {
  let salida = partes[0];
  valores.forEach((valor, i) => {
    salida += escapar(valor) + partes[i + 1];
  });
  return new Html(salida);
}

/** Reemplaza el contenido de un elemento. Acepta html``, listas de html`` y texto (que se escapa). */
export function pintar(elemento, contenido) {
  elemento.innerHTML = escapar(contenido);
}
