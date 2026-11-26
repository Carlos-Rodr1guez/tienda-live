// @ts-check
// Lectura del cuerpo con tope de bytes. No alcanza con mirar Content-Length (se puede mentir o no venir): se cuentan
// los bytes que realmente llegan y se corta al pasar el tope.

/**
 * @typedef {{ estado: 'ok', texto: string } | { estado: 'demasiado_grande' } | { estado: 'ilegible' }} LecturaDelCuerpo
 */

/**
 * @param {Request} solicitud
 * @param {number} tope Bytes máximos del cuerpo.
 * @returns {Promise<LecturaDelCuerpo>}
 */
export async function readBody(solicitud, tope) {
  const declarado = solicitud.headers.get('content-length');
  if (declarado !== null && /^\d+$/.test(declarado) && Number(declarado) > tope) {
    return { estado: 'demasiado_grande' };
  }
  if (solicitud.body === null) return { estado: 'ok', texto: '' };

  const lector = solicitud.body.getReader();
  /** @type {Uint8Array[]} */
  const trozos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) {
      await lector.cancel();
      return { estado: 'demasiado_grande' };
    }
    trozos.push(value);
  }

  const bytes = new Uint8Array(total);
  let desde = 0;
  for (const trozo of trozos) {
    bytes.set(trozo, desde);
    desde += trozo.byteLength;
  }
  try {
    return { estado: 'ok', texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { estado: 'ilegible' };
  }
}
