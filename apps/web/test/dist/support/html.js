// Ayudas para las pruebas de dist (CI): leer el HTML construido con parse5 y aplicar las reglas globales de la
// vitrina. Las reglas son funciones puras sobre texto, así que también se prueban en test/unit con páginas de ejemplo
// buenas y malas, sin construir nada.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

/** Carpeta de la construcción (apps/web/dist). */
export const DIST = fileURLToPath(new URL('../../../dist/', import.meta.url));

/** Páginas que no existen a propósito: la portada es la única vitrina (no hay índice de juegos ni de categorías). */
export const PREFIJOS_AUSENTES = ['/juegos', '/categorias', '/como-funciona'];

/** @param {string} html */
export function parsear(html) {
  return parse(html);
}

/**
 * Todos los elementos del árbol, en orden de documento.
 * @param {any} nodo
 * @returns {any[]}
 */
export function elementos(nodo) {
  const salida = [];
  for (const hijo of nodo.childNodes ?? []) {
    if (hijo.tagName) salida.push(hijo);
    salida.push(...elementos(hijo));
  }
  if (nodo.content) salida.push(...elementos(nodo.content));
  return salida;
}

/**
 * Los elementos con esa etiqueta.
 * @param {any} nodo
 * @param {string} etiqueta
 */
export function buscar(nodo, etiqueta) {
  return elementos(nodo).filter((e) => e.tagName === etiqueta);
}

/**
 * El valor de un atributo, o null si no está.
 * @param {any} elemento
 * @param {string} nombre
 * @returns {string | null}
 */
export function atributo(elemento, nombre) {
  return elemento.attrs?.find((a) => a.name === nombre)?.value ?? null;
}

/**
 * El texto visible de un nodo, con los espacios juntados.
 * @param {any} nodo
 * @returns {string}
 */
export function texto(nodo) {
  const partes = [];
  const recorrer = (n) => {
    if (n.nodeName === '#text') partes.push(n.value);
    for (const h of n.childNodes ?? []) recorrer(h);
  };
  recorrer(nodo);
  return partes.join('').replace(/\s+/g, ' ').trim();
}

/** Una URL absoluta o relativa al protocolo, es decir, de otro origen. */
const esExterna = (url) => /^(?:https?:)?\/\//i.test(url ?? '');

const RELACIONES_DE_RECURSO = [
  'stylesheet',
  'preload',
  'preconnect',
  'dns-prefetch',
  'prefetch',
  'modulepreload',
  'icon',
];
const TIPOS_SIN_ETIQUETA = ['hidden', 'submit', 'button', 'reset', 'image'];

/**
 * Reglas globales de la vitrina sobre una página construida. Devuelve la lista de problemas (vacía = cumple).
 * @param {string} html
 * @param {{ aviso: string }} opciones  `aviso` es el texto de no afiliación que tiene que estar en el pie
 * @returns {string[]}
 */
export function reglasGlobales(html, { aviso }) {
  const doc = parsear(html);
  const todos = elementos(doc);
  const problemas = [];

  const raiz = todos.find((e) => e.tagName === 'html');
  if (atributo(raiz, 'lang') !== 'es') problemas.push(`lang debería ser "es" y es ${atributo(raiz, 'lang')}`);

  const h1 = todos.filter((e) => e.tagName === 'h1').length;
  if (h1 !== 1) problemas.push(`debería haber exactamente un h1 y hay ${h1}`);

  for (const img of todos.filter((e) => e.tagName === 'img')) {
    if (atributo(img, 'alt') === null) problemas.push(`img sin alt: ${atributo(img, 'src')}`);
  }

  // Controles con nombre: label[for], label que envuelve, aria-label o aria-labelledby
  const etiquetasPorId = new Set(
    buscar(doc, 'label')
      .map((l) => atributo(l, 'for'))
      .filter(Boolean),
  );
  const dentroDeLabel = new Set();
  for (const label of buscar(doc, 'label')) for (const hijo of elementos(label)) dentroDeLabel.add(hijo);
  for (const control of todos.filter((e) => ['input', 'select', 'textarea'].includes(e.tagName))) {
    if (control.tagName === 'input' && TIPOS_SIN_ETIQUETA.includes((atributo(control, 'type') ?? 'text').toLowerCase()))
      continue;
    const id = atributo(control, 'id');
    const tieneNombre =
      atributo(control, 'aria-label') !== null ||
      atributo(control, 'aria-labelledby') !== null ||
      (id !== null && etiquetasPorId.has(id)) ||
      dentroDeLabel.has(control);
    if (!tieneNombre) problemas.push(`control sin nombre: <${control.tagName} id=${id}>`);
  }

  // Enlace para saltar: el primer <a> del cuerpo, hacia un id que existe
  const cuerpo = todos.find((e) => e.tagName === 'body');
  const primerEnlace = cuerpo ? elementos(cuerpo).find((e) => e.tagName === 'a') : undefined;
  const destino = primerEnlace ? atributo(primerEnlace, 'href') : null;
  if (!destino || !destino.startsWith('#') || !todos.some((e) => atributo(e, 'id') === destino.slice(1))) {
    problemas.push('falta el enlace para saltar al contenido como primer enlace del cuerpo');
  }

  // Nada en línea
  for (const s of todos.filter((e) => e.tagName === 'script')) {
    if (atributo(s, 'src') === null) problemas.push('script en línea');
  }
  if (todos.some((e) => e.tagName === 'style')) problemas.push('etiqueta <style> en línea');
  for (const e of todos) if (atributo(e, 'style') !== null) problemas.push(`atributo style= en <${e.tagName}>`);

  // Nada de otro origen cargado por la página
  for (const e of todos) {
    const recurso =
      (e.tagName === 'link' && RELACIONES_DE_RECURSO.some((r) => (atributo(e, 'rel') ?? '').split(/\s+/).includes(r))
        ? atributo(e, 'href')
        : null) ??
      (['script', 'img', 'iframe', 'source', 'video', 'audio', 'embed'].includes(e.tagName)
        ? atributo(e, 'src')
        : null);
    if (esExterna(recurso)) problemas.push(`recurso externo en <${e.tagName}>: ${recurso}`);
  }

  // Aviso de no afiliación dentro del pie
  const pies = todos.filter((e) => e.tagName === 'footer');
  if (!pies.some((p) => texto(p).includes(aviso))) problemas.push('el pie no lleva el aviso de no afiliación');

  // Enlaces a páginas que no existen
  for (const a of todos.filter((e) => e.tagName === 'a')) {
    const href = (atributo(a, 'href') ?? '').split(/[?#]/)[0];
    if (PREFIJOS_AUSENTES.some((p) => href === p || (href.startsWith(`${p}/`) && p !== '/juegos'))) {
      problemas.push(`enlace a una ruta que no existe: ${href}`);
    }
  }

  return problemas;
}

/**
 * Páginas de la construcción que no deberían existir.
 * @param {string[]} rutas  rutas relativas a dist, con barras normales
 * @returns {string[]}
 */
export function rutasProhibidasEnDist(rutas) {
  return rutas.filter((ruta) => {
    const sinExtension = `/${ruta.replace(/\.html$/, '').replace(/\/index$/, '')}`;
    return PREFIJOS_AUSENTES.some((p) => sinExtension === p || (p !== '/juegos' && sinExtension.startsWith(`${p}/`)));
  });
}

/** Rutas relativas (con barras normales) de todos los .html de dist. */
export function paginasDeDist() {
  if (!existsSync(DIST)) {
    throw new Error(
      'no existe apps/web/dist: construye antes con `npm run build -w @tienda/web` (en CI lo hace el flujo)',
    );
  }
  const salida = [];
  const recorrer = (dir, prefijo) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta, `${prefijo}${nombre}/`);
      else if (nombre.endsWith('.html')) salida.push(`${prefijo}${nombre}`);
    }
  };
  recorrer(DIST, '');
  return salida.sort();
}

/**
 * Lee un archivo de dist.
 * @param {string} ruta  relativa a dist, con barras normales
 */
export function leerDist(ruta) {
  const completa = join(DIST, ruta);
  if (!existsSync(completa)) throw new Error(`dist no tiene ${ruta}: ¿se construyó la web?`);
  return readFileSync(completa, 'utf8');
}
