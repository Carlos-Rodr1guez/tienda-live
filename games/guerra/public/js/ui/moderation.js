// Moderación del narrador (NM-11, KIT-11, KIT-13): ocultar a un donante con Alt+clic sobre su etiqueta, deshacerlo con Alt+Z
// (una pila) y ocultar todos los nombres con `N`. Todo vive en el registro del kit (en memoria): nada se escribe en el
// navegador ni en disco, y los avisos nunca llevan el nombre. Cada cambio avisa a la interfaz (`onChange`) para que las
// pantallas de resultados, que son una foto, se vuelvan a armar con el nombre enmascarado.

import { hitLabel } from '../render/labels.js';

/**
 * @param {{
 *   registry: {hide: (k: string) => void, unhide: (k: string) => void, allNamesHidden: () => boolean,
 *     setAllNamesHidden: (b: boolean) => void},
 *   rects: () => {key: string, x: number, y: number, w: number, h: number}[],
 *   onChange?: () => void
 * }} o `rects`: las pastillas con que responde el clic, también las que se están apagando
 */
export function createModeration({ registry, rects, onChange = () => {} }) {
  /** @type {string[]} */
  const stack = [];
  return {
    get size() {
      return stack.length;
    },
    /** Oculta al donante cuya etiqueta está bajo el punto (px del lienzo). Devuelve su clave o `null`. */
    hideAt(point) {
      const key = hitLabel(rects(), point);
      if (key === null) return null;
      // quien ya estaba oculto (p. ej. restaurado de la copia de la sesión) no se apila: Alt+Z no lo mostraría
      if (!stack.includes(key) && registry.get?.(key)?.hidden !== true) {
        registry.hide(key);
        stack.push(key);
      }
      onChange();
      return key;
    },
    /** Alt+Z: el último ocultamiento vuelve a mostrarse. */
    undo() {
      const key = stack.pop();
      if (key === undefined) return 'empty';
      registry.unhide(key);
      onChange();
      return 'undone';
    },
    /** `N`: oculta o muestra todos los nombres. Devuelve si quedan ocultos. */
    toggleNames() {
      const on = !registry.allNamesHidden();
      registry.setAllNamesHidden(on);
      onChange();
      return on;
    },
    /** "Nuevo en vivo": el registro ya olvidó lo oculto; la pila también. */
    reset() {
      stack.length = 0;
    },
  };
}
