// @ts-check
// Códigos de error de la API (campo `error` del cuerpo) y su estado HTTP habitual.
// `solicitud_invalida` también se responde con 415 (tipo de contenido) y `demasiado_grande` siempre con 413.
// Los mensajes en español de cada código están en i18n (`respuestas`).

export const ERROR_STATUS = Object.freeze(
  /** @type {const} */ ({
    campos_invalidos: 400,
    solicitud_invalida: 400,
    enlace_invalido: 400,
    demasiado_grande: 413,
    verificacion_fallida: 403,
    origen_no_permitido: 403,
    no_disponible: 503,
    no_encontrado: 404,
    error_interno: 500,
  }),
);

/** @typedef {keyof typeof ERROR_STATUS} ErrorCode */

export const ERROR_CODES = Object.freeze(/** @type {ErrorCode[]} */ (Object.keys(ERROR_STATUS)));
