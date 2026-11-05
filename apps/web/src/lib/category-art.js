// @ts-check
// Arte de las cuatro categorías (dirección A), dibujado a mano sobre un lienzo de 200x200. Devuelve el contenido del
// <svg> como texto; el componente CategoryArt le pone el contenedor, el rol y el título.
//
// Nada de style= ni de <style> dentro del SVG: cada forma lleva una clase (kb fondo, k1 y k2 relleno, k1s y k2s trazo)
// y la hoja de estilos del componente las pinta con --kb, --k1 y --k2. Código puro, probado con node:test.

import { CATEGORIES } from '@tienda/contracts/enums';
import { opciones } from '@tienda/contracts/i18n';
import { shipPath } from './ships.js';

/** Las clases de color que puede usar el arte. */
export const ART_CLASSES = Object.freeze(['kb', 'k1', 'k2', 'k1s', 'k2s']);

/** Fondo: un rectángulo enorme, porque el lienzo se centra y deja ver más de lo que mide el viewBox. */
const FONDO = '<rect class="kb" x="-400" y="-400" width="1000" height="1000"/>';

/** @param {string} nombre @param {number} x @param {number} y @param {number} t @param {string} clase @param {number} [angulo] */
const nave = (nombre, x, y, t, clase, angulo = 0) => shipPath(nombre, { x, y, tamano: t, clase, angulo });

/** Acción: el bombardero del Comandante con dos cazas, y tres cazas invasores que disparan en diagonal. */
function accion() {
  return [
    FONDO,
    '<path class="k2s" d="M27 38 50 84M93 32 114 78M153 40 172 84M12 100 24 128" stroke-width="3" stroke-linecap="round" fill="none"/>',
    nave('caza', 14, 6, 26, 'k2', 180),
    nave('caza', 80, 0, 26, 'k2', 180),
    nave('caza', 140, 8, 26, 'k2', 180),
    '<path class="k1s" d="M56 154Q100 92 144 154" stroke-width="4" stroke-linecap="round" fill="none" opacity=".7"/>',
    nave('bombardero', 70, 118, 60, 'k1'),
    nave('caza', 26, 146, 24, 'k1'),
    nave('caza', 150, 146, 24, 'k1'),
  ].join('');
}

/** Público: dos carriles de equipo alimentados por burbujas de chat con un 1 y un 2, y cazas que se enfrentan. */
function publico() {
  return [
    FONDO,
    '<rect class="k1" x="-400" y="-400" width="500" height="1000" opacity=".22"/>',
    '<rect class="k2" x="100" y="-400" width="500" height="1000" opacity=".22"/>',
    '<rect class="k1" x="22" y="26" width="58" height="46" rx="10"/>',
    '<path class="k1" d="M38 72 34 88 52 72Z"/>',
    '<text class="kb" x="51" y="60" text-anchor="middle" font-size="30" font-weight="800">1</text>',
    '<rect class="k2" x="120" y="72" width="58" height="46" rx="10"/>',
    '<path class="k2" d="M162 118 166 134 148 118Z"/>',
    '<text class="kb" x="149" y="106" text-anchor="middle" font-size="30" font-weight="800">2</text>',
    nave('caza', 30, 132, 24, 'k1', 90),
    nave('caza', 52, 156, 24, 'k1', 90),
    nave('caza', 130, 150, 24, 'k2', -90),
    nave('caza', 108, 174, 24, 'k2', -90),
  ].join('');
}

/** Relax: olas en tres capas, dos peces, un sol bajo y tres linternas que suben. */
function relax() {
  return [
    FONDO,
    '<circle class="k2" cx="150" cy="44" r="16" opacity=".9"/>',
    '<g class="k1s" fill="none" stroke-width="3" stroke-linecap="round" opacity=".55">',
    '<path d="M-40 126Q-10 114 20 126T80 126T140 126T200 126T260 126"/>',
    '<path d="M-40 152Q-10 140 20 152T80 152T140 152T200 152T260 152"/>',
    '<path d="M-40 178Q-10 166 20 178T80 178T140 178T200 178T260 178"/>',
    '</g>',
    '<ellipse class="k1" cx="74" cy="104" rx="20" ry="10"/>',
    '<path class="k1" d="M54 104 38 93V115Z"/>',
    '<ellipse class="k2" cx="136" cy="140" rx="15" ry="7.5"/>',
    '<path class="k2" d="M121 140 109 132V148Z"/>',
    '<rect class="k2" x="30" y="36" width="11" height="15" rx="3"/>',
    '<rect class="k2" x="84" y="58" width="11" height="15" rx="3"/>',
    '<rect class="k2" x="112" y="24" width="11" height="15" rx="3"/>',
  ].join('');
}

/** Metas: bloques apilados hacia una meta punteada, y una barra de avance a la derecha. */
function metas() {
  return [
    FONDO,
    '<rect class="k1" x="44" y="150" width="84" height="22"/>',
    '<rect class="k1" x="50" y="126" width="72" height="22"/>',
    '<rect class="k1" x="56" y="102" width="60" height="22"/>',
    '<rect class="k1" x="62" y="78" width="48" height="22"/>',
    '<g class="k2s" fill="none" stroke-width="2.5" stroke-dasharray="5 4">',
    '<rect x="68" y="54" width="36" height="22"/>',
    '<rect x="74" y="30" width="24" height="22"/>',
    '</g>',
    '<rect class="k2" x="152" y="26" width="16" height="146" rx="3" opacity=".3"/>',
    '<rect class="k2" x="152" y="86" width="16" height="86" rx="3"/>',
  ].join('');
}

/** @type {Record<string, () => string>} */
const COMPOSICIONES = { accion, publico, relax, metas };

/**
 * El contenido del SVG de una categoría. Falla si la categoría no existe: nunca se dibuja un panel vacío.
 * @param {unknown} categoria
 * @returns {string}
 */
export function renderArt(categoria) {
  const dibujar =
    typeof categoria === 'string' && /** @type {readonly string[]} */ (CATEGORIES).includes(categoria)
      ? COMPOSICIONES[categoria]
      : null;
  if (!dibujar) throw new Error(`no hay arte para la categoría "${String(categoria)}"`);
  return dibujar();
}

/**
 * El texto alternativo del arte, del diccionario. Falla si la categoría no existe.
 * @param {unknown} categoria
 * @returns {string}
 */
export function artAlt(categoria) {
  const datos =
    typeof categoria === 'string'
      ? /** @type {Record<string, { arteAlt: string }>} */ (opciones.categorias)[categoria]
      : null;
  if (!datos) throw new Error(`no hay texto alternativo para la categoría "${String(categoria)}"`);
  return datos.arteAlt;
}
