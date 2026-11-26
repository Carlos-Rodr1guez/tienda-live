// @ts-check
// Purga programada (WL-10): borra a quienes se anotaron y no confirmaron en 7 días. Los confirmados se quedan hasta
// que pidan su borrado (runbook en el README). Corre desde el Cron Trigger, dentro de waitUntil (ver app.js).

import { purgePending } from './repository.js';

export const RETENCION_PENDIENTES_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {import('../ports.js').AppPorts} ports
 * @returns {Promise<number>} cuántas filas borró.
 */
export async function purgeStale(ports) {
  const corte = new Date(ports.clock.now() - RETENCION_PENDIENTES_MS).toISOString();
  const cantidad = await purgePending(ports.db, corte);
  ports.logger.info('purga', { cantidad });
  return cantidad;
}
