// @ts-check
// Informe del embudo H1 (FM-5, FM-6). Dos piezas puras que `scripts/embudo.mjs` une con Wrangler:
//   buildEmbudoSql(hoy)      la consulta (una sola, con filas clave/valor) que se corre contra D1
//   formatEmbudo(filas, ...) las filas convertidas en el texto en español que se imprime
// Los anotados salen de `waitlist.confirmed_at`, nunca de los eventos. El informe no imprime correos ni usuarios.

import { CATEGORIES, STREAM_TYPES } from '@tienda/contracts/enums';
import { EVENT_NAMES } from '@tienda/contracts/events';

/** Cuántos días UTC (contando hoy) muestra la tabla de eventos. */
export const VENTANA_DIAS = 14;
/** El criterio de éxito del H1: anotados confirmados y, de ellos, con LIVE activo. */
export const CRITERIO_H1 = Object.freeze({ anotados: 50, conLiveActivo: 20 });

const DIA_MS = 24 * 60 * 60 * 1000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La consulta con el marcador {desde} (primer día de la tabla de eventos). Devuelve filas { k, v }:
 *   confirmados · pendientes · con_live · interes:<categoría> · tipo:<tipo> · evento:<día>:<evento>
 * D1 admite como máximo 5 términos en un SELECT compuesto (lo comprobó `wrangler d1 execute`), por eso confirmados y
 * pendientes salen juntos de un solo término agrupado. Un grupo sin filas no aparece y vale 0.
 */
export const EMBUDO_SQL = [
  "SELECT CASE WHEN confirmed_at IS NULL THEN 'pendientes' ELSE 'confirmados' END AS k, COUNT(*) AS v FROM waitlist GROUP BY k",
  "UNION ALL SELECT 'con_live', COUNT(*) FROM waitlist WHERE confirmed_at IS NOT NULL AND live_frequency <> 'todavia-no'",
  "UNION ALL SELECT 'interes:' || j.value, COUNT(*) FROM waitlist AS w, json_each(w.interests) AS j WHERE w.confirmed_at IS NOT NULL GROUP BY j.value",
  "UNION ALL SELECT 'tipo:' || stream_type, COUNT(*) FROM waitlist WHERE confirmed_at IS NOT NULL GROUP BY stream_type",
  "UNION ALL SELECT 'evento:' || day || ':' || event, count FROM funnel_daily WHERE day >= '{desde}'",
].join(' ');

/** @param {string} dia AAAA-MM-DD */
function diaMs(dia) {
  if (!FECHA.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) throw new Error(`fecha inválida: ${dia}`);
  return Date.parse(`${dia}T00:00:00Z`);
}

/** Los 14 días de la tabla, del más viejo a hoy. @param {string} hoy */
function ventana(hoy) {
  const fin = diaMs(hoy);
  return Array.from({ length: VENTANA_DIAS }, (_, i) =>
    new Date(fin - (VENTANA_DIAS - 1 - i) * DIA_MS).toISOString().slice(0, 10),
  );
}

/**
 * @param {string} hoy Día UTC de hoy, AAAA-MM-DD. Solo ese formato: la fecha entra en el SQL como texto.
 */
export function buildEmbudoSql(hoy) {
  return EMBUDO_SQL.replace('{desde}', ventana(hoy)[0]);
}

/**
 * Saca las filas de lo que imprime `wrangler d1 execute --json` (una lista con un resultado por sentencia).
 * @param {unknown} salida
 * @returns {Record<string, any>[]}
 */
export function extractRows(salida) {
  if (Array.isArray(salida)) {
    const primero = salida[0];
    if (primero && typeof primero === 'object' && 'results' in primero) return primero.results;
    return /** @type {Record<string, any>[]} */ (salida);
  }
  if (salida && typeof salida === 'object' && 'results' in salida && Array.isArray(salida.results))
    return salida.results;
  throw new Error('salida de wrangler no reconocida');
}

/** @param {number} n @param {number} meta */
const avance = (n, meta) => (n >= meta ? `${n} de ${meta} (cumplido)` : `${n} de ${meta} (faltan ${meta - n})`);

/** @param {string} etiqueta @param {number} valor @param {number} ancho */
const linea = (etiqueta, valor, ancho) => `  ${etiqueta.padEnd(ancho)}${String(valor).padStart(6)}`;

/**
 * @param {readonly Record<string, any>[]} filas  las filas { k, v } de EMBUDO_SQL
 * @param {{ hoy: string }} opciones  día UTC de hoy, AAAA-MM-DD
 */
export function formatEmbudo(filas, { hoy }) {
  /** @type {Map<string, number>} */
  const valores = new Map();
  for (const fila of filas) valores.set(String(fila.k), Number(fila.v));
  const de = (/** @type {string} */ clave) => valores.get(clave) ?? 0;

  const confirmados = de('confirmados');
  const conLive = de('con_live');
  const dias = ventana(hoy);
  const ancho = Math.max(...CATEGORIES.map((c) => c.length), ...STREAM_TYPES.map((t) => t.length)) + 2;

  const salida = [
    'Embudo H1 (anotados confirmados y eventos del sitio)',
    '',
    `Anotados confirmados: ${confirmados}`,
    `Con LIVE activo (frecuencia distinta de "todavía no"): ${conLive}`,
    `Pendientes de confirmar (aparte, no cuentan como anotados): ${de('pendientes')}`,
    '',
    'Interés por categoría (solo confirmados; cada persona suma una vez por cada categoría que eligió)',
    ...CATEGORIES.map((c) => linea(c, de(`interes:${c}`), ancho)),
    '',
    'Tipo de LIVE (solo confirmados)',
    ...STREAM_TYPES.map((t) => linea(t, de(`tipo:${t}`), ancho)),
    '',
    `Eventos de los últimos ${VENTANA_DIAS} días (días UTC)`,
    `  ${'día'.padEnd(12)}${EVENT_NAMES.map((e) => e.padStart(12)).join('')}`,
    ...dias.map(
      (dia) => `  ${dia.padEnd(12)}${EVENT_NAMES.map((e) => String(de(`evento:${dia}:${e}`)).padStart(12)).join('')}`,
    ),
    '',
    `Criterio H1: ${CRITERIO_H1.anotados} anotados / ${CRITERIO_H1.conLiveActivo} con LIVE activo`,
    `  Anotados: ${avance(confirmados, CRITERIO_H1.anotados)}`,
    `  Con LIVE activo: ${avance(conLive, CRITERIO_H1.conLiveActivo)}`,
  ];
  return salida.join('\n');
}
