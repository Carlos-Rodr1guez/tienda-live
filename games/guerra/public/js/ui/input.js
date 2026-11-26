// La entrada del narrador (D25, NM-3, NM-6, NM-8): el ÚNICO que escucha teclado, puntero, rueda y toque. Traduce los eventos
// del navegador a lo que entiende el resto: acciones del mapa (`ui/keys.js` → `ui/shortcuts.js`), gestos de cámara
// (`camera/gestures.js`), el clic en el botón de avance, el clic y Alt+clic sobre etiquetas y el hover. Recibe la ventana y el
// lienzo por argumento: no toca el DOM por su cuenta y el reloj llega inyectado.
//
// Presencia (NM-8): todo evento pasa por la guardia, que solo cuenta los de confianza (`isTrusted`); un `keydown` sintético
// no la reinicia y un `pointerdown` táctil (también el de un pellizco) sí. Mientras el foco esté en un campo de texto (el
// panel F1), ninguna tecla del narrador actúa. La rueda y el menú contextual no hacen scroll ni zoom de la página.
//
// Posiciones: en px de DISPOSITIVO del lienzo (CSS × `canvas.width / ancho CSS`). El umbral de arrastre (4 px, nota 35) se
// mide en esos px: con una densidad de 1,5 son ~2,7 px CSS.

import { createInputFilter, feedInput } from '../sim/presence.js';
import { isEditing, resolveKey } from './keys.js';

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * Alimenta la guardia de presencia con los eventos del DOM, sin reservar memoria por evento (un objeto reutilizado).
 * @param {{guard: any, match: any, now: () => number}} o `now`: reloj de pared en ms
 */
export function createPresenceFeed({ guard, match, now }) {
  const filter = createInputFilter();
  const scratch = { type: '', isTrusted: false, movementX: 0, movementY: 0 };
  return {
    /** @returns {boolean} si contó como entrada */
    feed(type, e) {
      scratch.type = type;
      scratch.isTrusted = e?.isTrusted === true;
      scratch.movementX = e?.movementX;
      scratch.movementY = e?.movementY;
      const pausaDePresencia = match.pause === 'presence';
      const conto = feedInput(guard, match, scratch, now(), filter);
      // 'resumed': esta entrada levantó la pausa de presencia (el mismo keydown no debe volver a pausar)
      return conto && pausaDePresencia && match.pause === null ? 'resumed' : conto;
    },
  };
}

/**
 * @param {{
 *   win: {addEventListener: Function}, canvas: any,
 *   shortcuts: {run: (id: string, e: any) => boolean}, raw?: (e: any) => boolean,
 *   gestures: {down: Function, move: Function, up: Function, cancel: Function, wheel: Function},
 *   presence: {feed: (type: string, e: any) => boolean},
 *   pointer: {advance: (p: {x: number, y: number}) => boolean, click: (p: {x: number, y: number}, e: any) => void,
 *     hover: (p: {x: number, y: number} | null) => void},
 *   arrows: (x: number, y: number) => void, unload: () => boolean, blocked: () => boolean
 * }} o
 *   `raw` ve la tecla ANTES del mapa (el selector usa las flechas y Tab); `blocked`: con un error de config no hay botón de avance
 */
export function createInput({ win, canvas, shortcuts, raw, gestures, presence, pointer, arrows, unload, blocked }) {
  const flechas = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
  const enviarFlechas = () =>
    arrows(Number(flechas.ArrowRight) - Number(flechas.ArrowLeft), Number(flechas.ArrowDown) - Number(flechas.ArrowUp));
  const soltarFlechas = () => {
    let alguna = false;
    for (const k of ARROWS) {
      alguna ||= flechas[k];
      flechas[k] = false;
    }
    if (alguna) enviarFlechas();
  };

  // NM-8: un clic en un botón del DOM (cámara, panel F1) también es entrada del narrador: la ventana lo ve en captura
  for (const type of ['pointerdown', 'wheel', 'pointermove'])
    win.addEventListener(type, (e) => presence.feed(type, e), true);

  win.addEventListener('keydown', (e) => {
    const presencia = presence.feed('keydown', e);
    // en un campo de texto las teclas son de quien escribe; solo F1 sigue abriendo y cerrando el simulador
    if (isEditing(e.target)) {
      if (e.key === 'F1') {
        e.preventDefault();
        shortcuts.run('sim', e);
      }
      return;
    }
    // Enter sobre un botón con foco lo activa el navegador (para quien llega con Tab): no es el Enter del narrador
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.tagName === 'BUTTON') return;
    if (raw?.(e)) {
      e.preventDefault();
      return;
    }
    const id = resolveKey(e);
    if (id === null) return;
    e.preventDefault();
    if (id === 'pan') {
      if (!flechas[e.key]) {
        flechas[e.key] = true;
        enviarFlechas();
      }
      return;
    }
    if (e.repeat) return;
    // la tecla que levantó la pausa de presencia no la vuelve a poner como pausa manual (P)
    if (presencia === 'resumed' && id === 'pause') return;
    shortcuts.run(id, e);
  });
  win.addEventListener('keyup', (e) => {
    if (e.key in flechas && flechas[e.key]) {
      flechas[e.key] = false;
      enviarFlechas();
    }
  });
  // perder el foco con una flecha pulsada no deja la cámara corriendo
  win.addEventListener('blur', soltarFlechas);
  // con usuarios en memoria, cerrar o recargar pide confirmación (D25): se pierden rangos y ocultos si el servidor no los guardó
  win.addEventListener('beforeunload', (e) => {
    if (!unload()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /** Posición del evento en px de dispositivo del lienzo. */
  function enLienzo(e) {
    const r = canvas.getBoundingClientRect();
    const sx = r.width > 0 ? canvas.width / r.width : 1;
    const sy = r.height > 0 ? canvas.height / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }
  const fino = (e) => e.pointerType === 'mouse' || e.pointerType === 'pen';

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = enLienzo(e);
    // el botón de avance de la pantalla (puntero, además de Enter): no es un gesto de cámara
    if (!blocked() && pointer.advance(p)) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // sin captura el arrastre sigue funcionando dentro del lienzo
    }
    gestures.down({ id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp });
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = enLienzo(e);
    gestures.move({ id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp });
    pointer.hover(fino(e) ? p : null); // el hover solo existe con puntero fino
  });
  canvas.addEventListener('pointerup', (e) => {
    const p = enLienzo(e);
    const r = gestures.up({ id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp });
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ya estaba suelto
    }
    // un toque sin arrastre es un clic: seguir o (con Alt) ocultar al donante de la etiqueta, o elegir una fila del selector
    if (r?.tap === true && !blocked()) pointer.click(p, e);
  });
  canvas.addEventListener('pointercancel', (e) => gestures.cancel({ id: e.pointerId }));
  canvas.addEventListener('pointerleave', () => pointer.hover(null));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault(); // ni scroll ni zoom de la página
      gestures.wheel({ dy: e.deltaY, deltaMode: e.deltaMode, ctrl: e.ctrlKey, ...enLienzo(e) });
    },
    { passive: false },
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return { releaseArrows: soltarFlechas };
}
