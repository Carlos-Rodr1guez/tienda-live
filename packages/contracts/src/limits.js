// @ts-check
// Límites compartidos (especificación, sección 0). La base de datos los repite en sus CHECK y la API en los topes de cuerpo.

export const LIMITS = Object.freeze({
  email: Object.freeze({ max: 254 }),
  tiktokUser: Object.freeze({ min: 2, max: 24 }),
  interests: Object.freeze({ min: 1, max: 4 }),
  turnstileToken: Object.freeze({ max: 2048 }),
});

/** Tope de bytes realmente leídos del cuerpo, por ruta. */
export const BODY_CAPS = Object.freeze({ waitlist: 4096, confirm: 512, events: 256 });

/** Un token de confirmación son 32 bytes en base64url: 43 caracteres. */
export const CONFIRM_TOKEN_LENGTH = 43;

/** Tope diario por evento: el contador se satura acá y la API sigue respondiendo 204. */
export const FUNNEL_COUNT_CAP = 100000;
