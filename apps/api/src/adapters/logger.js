// @ts-check
// Registro en líneas JSON. Solo escribe los campos de una lista cerrada: no hay forma de que un correo, un token,
// un cuerpo o una IP lleguen al registro por descuido, porque cualquier otra clave se descarta.

/** Los únicos campos que se escriben. */
export const CAMPOS_PERMITIDOS = Object.freeze(['ruta', 'resultado', 'codigo', 'estado', 'cantidad', 'ms']);

/**
 * @param {{ log(linea: string): void, warn(linea: string): void, error(linea: string): void }} [sink]
 * @returns {import('../ports.js').Logger}
 */
export function createLogger(sink = console) {
  /**
   * @param {'info' | 'warn' | 'error'} nivel
   * @param {'log' | 'warn' | 'error'} canal
   * @returns {import('../ports.js').LogFn}
   */
  const escribir =
    (nivel, canal) =>
    (evento, campos = {}) => {
      /** @type {Record<string, string | number>} */
      const linea = { nivel, evento };
      for (const clave of CAMPOS_PERMITIDOS) {
        const valor = campos[clave];
        if (typeof valor === 'string' || (typeof valor === 'number' && Number.isFinite(valor))) linea[clave] = valor;
      }
      sink[canal](JSON.stringify(linea));
    };

  return {
    info: escribir('info', 'log'),
    warn: escribir('warn', 'warn'),
    error: escribir('error', 'error'),
  };
}
