// @ts-check
// Elige el correo según el entorno. Todavía no hay un proveedor real (fuera del alcance del H1): en desarrollo se
// usa el de consola y en producción devuelve null, que la ruta de inscripción convierte en un 503 sin escribir nada.

import { createConsoleMailer } from './mailer-console.js';

/**
 * @param {import('../ports.js').AppConfig} config
 * @param {{ sink?: { log(linea: string): void } }} [opciones] Para las pruebas: dónde imprime el de consola.
 * @returns {import('../ports.js').Mailer | null}
 */
export function selectMailer(config, { sink } = {}) {
  return config.environment === 'development' ? createConsoleMailer(sink) : null;
}
