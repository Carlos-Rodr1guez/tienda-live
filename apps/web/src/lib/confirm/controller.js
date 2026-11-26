// @ts-check
// Pegamento de la página /confirmar con el DOM. La lógica está en model.js (pura y probada); acá solo se leen los
// elementos, se limpia la barra de direcciones y se manda el pedido. Sin scripts de terceros y sin eventos de medición.

import { CLEAN_PATH, buildConfirmRequest, initialConfirmState, reduceConfirm, viewFor } from './model.js';

/**
 * Lo que el controlador necesita de la página. Los elementos reales del DOM cumplen esta forma.
 * @typedef {object} ElementosConfirmar
 * @property {{ textContent: string | null, dataset: Record<string, string | undefined>, focus: () => void }} mensaje  región de estado
 * @property {{ hidden: boolean | string, disabled: boolean, textContent: string | null, focus: () => void, addEventListener: (tipo: 'click', f: () => unknown) => void }} boton
 * @property {{ hidden: boolean | string }} volver  enlace de vuelta al inicio
 */

/**
 * @param {{
 *   hash: string,
 *   history: { replaceState: (estado: unknown, titulo: string, url: string) => void },
 *   elementos: ElementosConfirmar,
 *   fetchFn: (url: string, init: RequestInit) => Promise<{ status: number }>,
 *   timeoutMs?: number,
 * }} entrada  `timeoutMs`: tiempo máximo del pedido (por defecto 15 s); pasado, sigue el camino de "sin conexión"
 */
export function mountConfirm({ hash, history, elementos, fetchFn, timeoutMs }) {
  // Lo primero: el token sale de la barra y del historial, pase lo que pase después.
  history.replaceState(null, '', CLEAN_PATH);

  let estado = initialConfirmState(hash);

  function dibujar() {
    const vista = viewFor(estado);
    elementos.mensaje.textContent = vista.mensaje;
    elementos.mensaje.dataset.tono = vista.tono;
    elementos.boton.hidden = !vista.boton.visible;
    elementos.boton.disabled = vista.boton.deshabilitado;
    elementos.boton.textContent = vista.boton.texto;
    elementos.volver.hidden = !vista.volver;
  }

  async function confirmar() {
    const enviando = reduceConfirm(estado, { type: 'confirmar' });
    // Si el modelo no cambia de estado (sin enlace, ya enviando, ya terminado) no hay nada que mandar.
    if (enviando === estado) return;
    const token = /** @type {string} */ (enviando.token);
    estado = enviando;
    dibujar();

    const { url, init } = buildConfirmRequest(token, { timeoutMs });
    try {
      const respuesta = await fetchFn(url, init);
      estado = reduceConfirm(estado, { type: 'respuesta', status: respuesta.status });
    } catch {
      estado = reduceConfirm(estado, { type: 'falloRed' });
    }
    dibujar();
    // Un resultado definitivo se anuncia llevando el foco al mensaje. Si queda un botón activo para reintentar (error
    // de red, tiempo vencido, 429), el foco va al botón: al deshabilitarse mientras envía lo perdió y habría caído al body.
    const vista = viewFor(estado);
    if (vista.boton.visible && !vista.boton.deshabilitado) elementos.boton.focus();
    else if (estado.fase === 'confirmado' || estado.fase === 'invalido') elementos.mensaje.focus();
  }

  elementos.boton.addEventListener('click', confirmar);
  dibujar();

  return { confirmar, getState: () => estado };
}

/**
 * Arranca la página real: busca los elementos por id y usa el hash, el historial y el fetch del navegador.
 * @param {Document} [doc]
 * @param {Window} [win]
 */
export function initConfirmPage(doc = document, win = window) {
  /** @param {string} id */
  const porId = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`falta el elemento #${id} en la página de confirmación`);
    return el;
  };
  return mountConfirm({
    hash: win.location.hash,
    history: win.history,
    elementos: {
      mensaje: porId('confirmar-mensaje'),
      boton: /** @type {HTMLButtonElement} */ (porId('confirmar-boton')),
      volver: porId('confirmar-volver'),
    },
    fetchFn: (url, init) => win.fetch(url, init),
  });
}
