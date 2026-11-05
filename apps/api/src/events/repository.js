// @ts-check
// Contadores del embudo en D1: una fila por (día UTC, evento). Solo se guarda eso.

import { FUNNEL_COUNT_CAP } from '@tienda/contracts/limits';

// El WHERE del DO UPDATE es lo que satura el contador: pasado el tope no cambia nada y tampoco falla.
const SUMAR =
  'INSERT INTO funnel_daily (day, event, count) VALUES (?1, ?2, 1) ' +
  'ON CONFLICT (day, event) DO UPDATE SET count = count + 1 WHERE count < ?3';

/**
 * El día UTC (AAAA-MM-DD) de un instante, sin importar la zona horaria de quien corre.
 * @param {number} ms
 */
export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Suma 1 al contador del día y del evento. Devuelve false si ya estaba en el tope.
 * @param {import('../ports.js').Db} db
 * @param {string} day
 * @param {string} event
 */
export async function incrementEvent(db, day, event) {
  const { meta } = await db.prepare(SUMAR).bind(day, event, FUNNEL_COUNT_CAP).run();
  return meta.changes > 0;
}
