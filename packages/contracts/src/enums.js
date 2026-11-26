// @ts-check
// Enumeraciones compartidas. Es la única definición: la web, la API y el esquema de contenido importan de acá.
// Agregar un valor acá cambia a todos los consumidores (en la base de datos exige además una migración, ver ADR-009).

/** Categorías del catálogo, según quién mueve la acción. */
export const CATEGORIES = Object.freeze(/** @type {const} */ (['accion', 'publico', 'relax', 'metas']));

/** Rol del streamer en cada categoría. */
export const STREAMER_ROLES = Object.freeze(/** @type {const} */ (['juega', 'conduce', 'acompana']));

/** Tipo de LIVE que hace quien se anota. */
export const STREAM_TYPES = Object.freeze(/** @type {const} */ (['gaming', 'charla', 'musica', 'estudio']));

/** Cada cuánto hace LIVE quien se anota. */
export const LIVE_FREQUENCY = Object.freeze(
  /** @type {const} */ (['todavia-no', 'ocasional', 'semanal', 'varias-por-semana', 'diario']),
);

/** Rangos de seguidores. */
export const FOLLOWER_RANGES = Object.freeze(/** @type {const} */ (['0-99', '100-999', '1k-9k', '10k-49k', '50k+']));

/** Países (ISO 3166-1 alfa-2) y ZZ para "otro". */
export const COUNTRIES = Object.freeze(
  /** @type {const} */ ([
    'ES',
    'AR',
    'MX',
    'CO',
    'CL',
    'PE',
    'UY',
    'PY',
    'BO',
    'EC',
    'VE',
    'CR',
    'PA',
    'DO',
    'GT',
    'HN',
    'SV',
    'NI',
    'CU',
    'PR',
    'US',
    'BR',
    'ZZ',
  ]),
);

/** Estados de un juego en el catálogo. */
export const GAME_STATES = Object.freeze(/** @type {const} */ (['concepto', 'prototipo', 'beta', 'venta']));
