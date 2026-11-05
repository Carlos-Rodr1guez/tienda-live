// @ts-check
// Correo "de mentira" para desarrollo: en vez de enviar, imprime el asunto y el enlace en la consola de `wrangler dev`.
// Es el único lugar donde un enlace de confirmación se imprime. No imprime el correo de la persona.

import { confirmationMessage } from '../waitlist/mail.js';

/**
 * @param {{ log(linea: string): void }} [sink]
 * @returns {import('../ports.js').Mailer}
 */
export function createConsoleMailer(sink = console) {
  return {
    async sendConfirmation({ link }) {
      const { asunto } = confirmationMessage(link);
      sink.log(`[correo de desarrollo] ${asunto}\n[correo de desarrollo] Enlace de confirmación: ${link}`);
    },
  };
}
