// Color de los equipos (CB-3, diseño D26): distancia CIEDE2000, simulación de daltonismo de Machado, contraste
// y elección del color de cada país en un par.
//
// EXENCIÓN DE AISLAMIENTO (Duda 6 del desglose): este es el único módulo de `sim/` que usa funciones
// trascendentes (`pow`, `sin`, `cos`, `atan2`, `exp`): la potencia del gamma y CIEDE2000 las necesitan. D14 las
// prohíbe en las reglas del juego porque pueden dar resultados distintos entre motores. Aquí no importa: solo se
// usa al ELEGIR el par (antes de la partida, nunca dentro del paso del sim) y los umbrales dejan margen de
// sobra. `test/isolation.test.js` lo exime por nombre de esa sola regla; todas las demás le siguen valiendo.

import { ConfigError } from '@tienda/kit/sim/config.js';
import { PALETA } from '../data/paleta.js';

/** Distancia mínima entre los dos colores con visión normal y con cada tipo de daltonismo. */
export const THRESHOLDS = Object.freeze({ normal: 25, protan: 20, deutan: 20, tritan: 20 });
const KINDS = /** @type {const} */ (['normal', 'protan', 'deutan', 'tritan']);

/** Matrices de Machado, Oliveira y Fernandes (2009), severidad 1,0, para RGB lineal. */
export const MACHADO = Object.freeze({
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
});

// ---------- conversiones ----------

/** @param {string} hex '#RRGGBB' @returns {[number, number, number]} sRGB en [0, 1] */
export function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** @param {[number, number, number]} rgb01 sRGB @returns {[number, number, number]} CIE Lab, blanco D65 */
export function rgb01ToLab(rgb01) {
  const [r, g, b] = rgb01.map(toLinear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** @param {string} hex */
export const hexToLab = (hex) => rgb01ToLab(hexToRgb01(hex));

/**
 * Cómo ve un color alguien con daltonismo: matriz de Machado en RGB lineal, recortada a [0, 1].
 * @param {[number, number, number]} rgb01
 * @param {'protan'|'deutan'|'tritan'} kind
 * @returns {[number, number, number]}
 */
export function simulateRgb01(rgb01, kind) {
  const m = MACHADO[kind];
  if (!m) throw new TypeError(`tipo de daltonismo desconocido: "${kind}"`);
  const lin = rgb01.map(toLinear);
  return /** @type {[number, number, number]} */ (
    m.map((row) => toSrgb(Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))))
  );
}

// ---------- CIEDE2000 (Sharma, Wu y Dalal, 2005) ----------

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const POW25_7 = 25 ** 7;

/** @param {number[]} lab1 @param {number[]} lab2 @returns {number} */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const hue = (b, ap) => (b === 0 && ap === 0 ? 0 : (deg(Math.atan2(b, ap)) + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const chroma0 = C1p * C2p === 0;
  let dhp = 0;
  if (!chroma0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (!chroma0) {
    if (Math.abs(h1p - h2p) <= 180) hbp /= 2;
    else hbp = (hbp < 360 ? hbp + 360 : hbp - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  const x = dLp / Sl;
  const y = dCp / Sc;
  const z = dHp / Sh;
  return Math.sqrt(x * x + y * y + z * z + Rt * y * z);
}

const distCache = new Map();

/**
 * Distancia entre dos colores con visión normal y con cada simulación.
 * @param {string} hexA @param {string} hexB
 * @returns {{normal:number, protan:number, deutan:number, tritan:number}}
 */
export function distances(hexA, hexB) {
  const key = `${hexA}|${hexB}`;
  let d = distCache.get(key);
  if (!d) {
    const a = hexToRgb01(hexA);
    const b = hexToRgb01(hexB);
    d = { normal: deltaE2000(rgb01ToLab(a), rgb01ToLab(b)) };
    for (const k of KINDS.slice(1)) {
      d[k] = deltaE2000(
        rgb01ToLab(simulateRgb01(a, /** @type {any} */ (k))),
        rgb01ToLab(simulateRgb01(b, /** @type {any} */ (k))),
      );
    }
    distCache.set(key, d);
  }
  return d;
}

// ---------- contraste (WCAG) ----------

/** Luminancia relativa de un color '#RRGGBB'. @param {string} hex */
export function luminance(hex) {
  const [r, g, b] = hexToRgb01(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores '#RRGGBB'. */
export function contrast(hexA, hexB) {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- elección por par ----------

/** Clave del override de un par: los dos ids ordenados por punto de código, separados por guion. */
export const pairKey = (idA, idB) => (idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`);

const passes = (d) => KINDS.every((k) => d[k] >= THRESHOLDS[k]);
const minOf = (d) => Math.min(...KINDS.map((k) => d[k]));

/**
 * Elige el color de cada país del par entre sus candidatos, sin depender del orden en que se pasan (el de la
 * izquierda no tiene ventaja). Criterios, en orden: solo preferidos (si ninguna combinación pasa, se agrega el resto
 * de la paleta como respaldo); menor suma de rangos; mayor ΔE mínimo; menor rango para el id que ordena primero.
 * Un par sin combinación es un error de datos: lanza ConfigError, nunca se retira.
 * @param {{id:string, colors:readonly string[]}} a
 * @param {{id:string, colors:readonly string[]}} b
 * @param {{pairColors?: Record<string, string[]>, palette?: readonly {id:string, hex:string}[]}} [opts]
 * @returns {{colors: Record<string,string>, min:number, deltas: object, fallback:boolean, override:boolean}}
 */
export function pickColors(a, b, { pairColors, palette = PALETA.colors } = {}) {
  const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
  const hexOf = new Map(palette.map((c) => [c.id, c.hex]));
  const result = (cLo, cHi, d, fallback, override) => ({
    colors: { [lo.id]: cLo, [hi.id]: cHi },
    min: minOf(d),
    deltas: d,
    fallback,
    override,
  });

  const forced = pairColors?.[pairKey(a.id, b.id)];
  if (forced !== undefined) {
    const par = `${lo.id}-${hi.id}`;
    if (!Array.isArray(forced) || forced.length !== 2)
      throw new ConfigError(`pairColors["${par}"] debe ser [colorDe${lo.id}, colorDe${hi.id}]`);
    const [cLo, cHi] = forced;
    for (const c of forced)
      if (!hexOf.has(c)) throw new ConfigError(`pairColors["${par}"]: el color "${c}" no está en la paleta`);
    if (cLo === cHi) throw new ConfigError(`pairColors["${par}"]: los dos países no pueden tener el mismo color`);
    const d = distances(hexOf.get(cLo), hexOf.get(cHi));
    if (!passes(d)) {
      throw new ConfigError(
        `pairColors["${par}"] (${cLo}, ${cHi}) no cumple la distancia mínima: ` +
          KINDS.map((k) => `${k} ${d[k].toFixed(1)}/${THRESHOLDS[k]}`).join(', '),
      );
    }
    return result(cLo, cHi, d, false, true);
  }

  for (const fallback of [false, true]) {
    const extend = (c) =>
      fallback ? [...c.colors, ...palette.map((p) => p.id).filter((id) => !c.colors.includes(id))] : [...c.colors];
    const listLo = extend(lo).filter((id) => hexOf.has(id));
    const listHi = extend(hi).filter((id) => hexOf.has(id));
    const options = [];
    listLo.forEach((cLo, rLo) =>
      listHi.forEach((cHi, rHi) => {
        if (cLo === cHi) return;
        const d = distances(hexOf.get(cLo), hexOf.get(cHi));
        if (passes(d)) options.push({ cLo, cHi, rLo, rHi, d, min: minOf(d) });
      }),
    );
    if (!options.length) continue;
    options.sort(
      (x, y) =>
        x.rLo + x.rHi - (y.rLo + y.rHi) ||
        y.min - x.min ||
        x.rLo - y.rLo ||
        (x.cLo < y.cLo ? -1 : x.cLo > y.cLo ? 1 : 0) ||
        (x.cHi < y.cHi ? -1 : x.cHi > y.cHi ? 1 : 0),
    );
    return result(options[0].cLo, options[0].cHi, options[0].d, fallback, false);
  }
  throw new ConfigError(
    `el par ${lo.id}-${hi.id} no tiene ninguna combinación de colores que cumpla la distancia mínima`,
  );
}
