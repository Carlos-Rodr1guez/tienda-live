// @ts-check
// Reloj real. Las pruebas pasan uno propio para controlar el tiempo.

/** @returns {import('../ports.js').Clock} */
export function createClock() {
  return { now: () => Date.now() };
}
