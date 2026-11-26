// Reglas de código fuente de la vitrina (CSS, componentes .astro y módulos del navegador). Cada función recibe el
// texto y devuelve la lista de problemas encontrados; vacía = cumple. Las usan las pruebas, sobre ejemplos buenos y
// malos y sobre los archivos reales de src/.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sinComentarios } from './css.js';

/** Todos los archivos de un directorio (recursivo) con alguna de las extensiones. */
export function archivos(dir, extensiones) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta, extensiones));
    else if (extensiones.some((e) => nombre.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

/** Ruta legible, relativa a un directorio base y con barras normales. */
export function legible(base, ruta) {
  return relative(base, ruta).split('\\').join('/');
}

/** El CSS de un archivo: el archivo entero si es .css; los bloques <style> si es .astro. */
export function cssDe(ruta, texto) {
  if (ruta.endsWith('.css')) return texto;
  return [...texto.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

/** El marcado de un .astro: sin frontmatter, sin <style> y sin <script>. */
export function marcadoDe(texto) {
  return texto
    .replace(/^---[\s\S]*?\n---/, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
}

/**
 * Selectores con :hover que no están dentro de `@media (hover: hover)`.
 * @param {string} css
 * @returns {string[]}
 */
export function hoverSinCompuerta(css) {
  const problemas = [];
  const pila = [];
  let cabecera = '';
  for (const c of sinComentarios(css)) {
    if (c === '{') {
      pila.push(cabecera.trim());
      cabecera = '';
    } else if (c === '}') {
      const propia = pila.pop() ?? '';
      if (!propia.startsWith('@') && /:hover/.test(propia)) {
        const compuerta = pila.some((h) => /^@media[^{]*\(hover:\s*hover\)/.test(h));
        if (!compuerta) problemas.push(`:hover sin @media (hover: hover): ${propia}`);
      }
      cabecera = '';
    } else if (c === ';') {
      cabecera = '';
    } else {
      cabecera += c;
    }
  }
  return problemas;
}

/**
 * Reglas de CSS: sin transition all, solo transform y opacity animadas, sin 100vh, sin scale(0), sin ease-in,
 * sin recursos externos ni data:, sin desenfoque decorativo, sin texto con degradado y sin franja de color lateral.
 * @param {string} css
 * @returns {string[]}
 */
export function problemasDeCss(css) {
  const limpio = sinComentarios(css);
  const problemas = [...hoverSinCompuerta(limpio)];
  const prohibidos = [
    [/transition(?:-property)?\s*:\s*[^;}]*\ball\b/, 'transition: all'],
    [/\b100vh\b/, '100vh (usa dvh)'],
    [/scale\(\s*0\s*[,)]/, 'scale(0)'],
    [/\bease-in\b(?!-)/, 'ease-in'],
    [/url\(\s*['"]?\s*(?:https?:|\/\/)/, 'url() externa'],
    [/@import\s+(?:url\()?\s*['"]?\s*(?:https?:|\/\/)/, '@import externo'],
    [/url\(\s*['"]?\s*data:/, 'url(data:)'],
    [/backdrop-filter|-webkit-backdrop-filter/, 'desenfoque decorativo'],
    [/(?:-webkit-)?background-clip\s*:\s*text/, 'texto con degradado'],
    [
      /border-(?:left|right|inline-start|inline-end)\s*:\s*(?:[2-9]|\d{2,})(?:\.\d+)?(?:px|rem)/,
      'franja de color lateral',
    ],
  ];
  for (const [regex, nombre] of prohibidos) if (regex.test(limpio)) problemas.push(nombre);
  for (const m of limpio.matchAll(/transition\s*:\s*([^;}]+)/g)) {
    for (const parte of m[1].split(/,(?![^(]*\))/)) {
      const propiedad = parte.trim().split(/\s+/)[0];
      if (propiedad && !['transform', 'opacity'].includes(propiedad)) {
        problemas.push(`transition anima ${propiedad}: solo transform y opacity`);
      }
    }
  }
  return problemas;
}

/**
 * Las declaraciones de un CSS con el contexto (cabeceras de los bloques que las contienen).
 * @param {string} css
 * @returns {{ prop: string, valor: string, contexto: string[] }[]}
 */
export function declaraciones(css) {
  const salida = [];
  const pila = [];
  let pendiente = '';
  const soltar = () => {
    const m = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(pendiente);
    if (m) salida.push({ prop: m[1], valor: m[2], contexto: pila.map((h) => h.replace(/\s+/g, ' ')) });
    pendiente = '';
  };
  for (const c of sinComentarios(css)) {
    if (c === '{') {
      pila.push(pendiente.trim());
      pendiente = '';
    } else if (c === '}') {
      soltar();
      pila.pop();
    } else if (c === ';') {
      soltar();
    } else {
      pendiente += c;
    }
  }
  return salida;
}

/**
 * Reglas del revelado por scroll (la escalera de regalos): anima SOLO transform, nunca la opacidad (un estado a medias
 * con opacidad baja se queda ahí si la persona deja de hacer scroll y no llega a AA), y solo bajo
 * `@supports (animation-timeline: view())` y `prefers-reduced-motion: no-preference`, con el estado final por defecto.
 * @param {string} css
 * @returns {string[]}
 */
export function problemasDeRevelado(css) {
  const problemas = [];
  const decls = declaraciones(css);
  const dentroDe = (d, patron) => d.contexto.some((h) => patron.test(h));
  for (const d of decls) {
    if (dentroDe(d, /^@keyframes\b/) && /opacity/.test(d.prop)) problemas.push('@keyframes anima opacity');
    if (/^(?:animation|transition)/.test(d.prop) && /opacity/.test(d.valor)) {
      problemas.push(`${d.prop} anima opacity: ${d.valor}`);
    }
    if (
      /^animation(?:-name|-timeline|-range|-timing-function|-fill-mode)?$/.test(d.prop) &&
      !dentroDe(d, /^@keyframes/)
    ) {
      if (!dentroDe(d, /^@supports[^{]*animation-timeline:\s*view\(\)/))
        problemas.push(`${d.prop} fuera de @supports (animation-timeline: view())`);
      if (!dentroDe(d, /^@media[^{]*prefers-reduced-motion:\s*no-preference/)) {
        problemas.push(`${d.prop} fuera de @media (prefers-reduced-motion: no-preference)`);
      }
    }
  }
  return [...new Set(problemas)];
}

/**
 * Valores que solo pueden vivir en tokens.css: colores, radios, sombras y curvas de movimiento. Fuera de ese archivo
 * se usan con var(--token). `excepciones` son textos exactos que el diseño fija a mano (se ignoran).
 * @param {string} css
 * @param {string[]} [excepciones]
 * @returns {string[]}
 */
export function problemasDeTokens(css, excepciones = []) {
  let limpio = sinComentarios(css);
  for (const e of excepciones) limpio = limpio.split(e).join('');
  const problemas = [];
  if (/#[0-9a-fA-F]{3,8}\b/.test(limpio)) problemas.push('color hexadecimal escrito a mano');
  if (/\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/.test(limpio)) problemas.push('color funcional escrito a mano');
  if (/cubic-bezier\(/.test(limpio)) problemas.push('curva de movimiento escrita a mano');
  const permitido = (valor) => /^(?:var\([^)]*\)|0|50%|inherit|none)$/.test(valor);
  for (const m of limpio.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
    const partes = m[1].trim().match(/var\([^)]*\)|\S+/g) ?? [];
    if (!partes.every(permitido)) problemas.push(`radio escrito a mano: ${m[1].trim()}`);
  }
  for (const m of limpio.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
    const partes = m[1].trim().match(/var\([^)]*\)|\S+/g) ?? [];
    if (!partes.every(permitido)) problemas.push(`sombra escrita a mano: ${m[1].trim()}`);
  }
  return problemas;
}

/**
 * Reglas de un componente .astro: sin style=, sin is:inline, scripts solo agrupados (sin atributos), sin emoji ni
 * símbolos como iconos y sin fuentes o CDN externos.
 * @param {string} texto
 * @returns {string[]}
 */
export function problemasDeAstro(texto) {
  const problemas = [];
  const marcado = marcadoDe(texto);
  if (/<[A-Za-z][^>]*\sstyle\s*=/.test(marcado)) problemas.push('atributo style=');
  if (/is:inline/.test(texto)) problemas.push('is:inline');
  for (const m of texto.matchAll(/<script([^>]*)>/g)) {
    if (m[1].trim() !== '') problemas.push(`<script${m[1]}> con atributos: solo scripts agrupados sin atributos`);
  }
  if (/<svg\b[^>]*>(?:(?!<\/svg>)[\s\S])*?<style/.test(texto.replace(/^---[\s\S]*?\n---/, ''))) {
    problemas.push('<style> dentro de un SVG');
  }
  if (/[\p{Extended_Pictographic}←→↑↓✓✔✕✖★☆]/u.test(marcado)) problemas.push('emoji o símbolo usado como icono');
  if (/fonts\.(?:googleapis|gstatic)|cdnjs|unpkg|jsdelivr/.test(texto)) problemas.push('fuente o CDN externo');
  problemas.push(...problemasDeCss(cssDe('componente.astro', texto)));
  return problemas;
}

/** Lee un archivo como texto. */
export function leer(ruta) {
  return readFileSync(ruta, 'utf8');
}
