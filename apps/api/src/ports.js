// @ts-check
// Puertos de la API (arquitectura hexagonal): lo que el núcleo necesita del mundo exterior. Solo tipos (JSDoc).
// Los adaptadores reales están en src/adapters; las pruebas pasan dobles. Los tipos del Worker se declaran acá,
// mínimos, para no mezclar la librería DOM con la del Worker bajo el TypeScript de la raíz.

/**
 * Una sentencia preparada de D1 (subconjunto).
 * @typedef {object} Stmt
 * @property {(...valores: (string | number | boolean | null)[]) => Stmt} bind Devuelve otra sentencia, no muta esta.
 * @property {() => Promise<{ results: any[], meta: { changes: number } }>} run
 * @property {() => Promise<{ results: any[] }>} all
 * @property {(columna?: string) => Promise<any>} first
 */

/**
 * Base de datos: el subconjunto de D1Database que usa la API. `env.DB` ya lo cumple.
 * @typedef {object} Db
 * @property {(sql: string) => Stmt} prepare
 * @property {(sentencias: Stmt[]) => Promise<unknown[]>} batch
 */

/**
 * @typedef {{ ok: true } | { ok: false, reason: 'rechazado' | 'no_disponible' }} TurnstileResult
 * @typedef {{ verify(token: string): Promise<TurnstileResult> }} TurnstileVerifier
 */

/**
 * El mensaje lleva `validezMs`: lo que le queda de verdad al enlace (puede ser menos de 48 h en un reenvío cerca de
 * los 7 días del alta). El correo lo dice con `confirmationMessage(link, validezMs)`.
 * @typedef {{ sendConfirmation(mensaje: { to: string, link: string, validezMs: number }): Promise<void> }} Mailer
 */

/** @typedef {{ now(): number }} Clock Milisegundos desde la época. */

/** @typedef {{ bytes(n: number): Uint8Array }} Random */

/**
 * Registro sin datos personales: solo se escriben los campos permitidos (ver adapters/logger.js).
 * @typedef {(evento: string, campos?: Record<string, unknown>) => void} LogFn
 * @typedef {{ info: LogFn, warn: LogFn, error: LogFn }} Logger
 */

/**
 * @typedef {object} AppConfig
 * @property {'development' | 'production'} environment
 * @property {string} siteUrl Origen del sitio, sin barra final. Vacío si en producción SITE_URL no es válido.
 * @property {readonly string[]} allowedOrigins Orígenes que pueden hacer POST a /v1.
 * @property {readonly string[]} problems Códigos de lo que impide usar la configuración (hoy solo `site_url`, en
 *   producción). Si no está vacía, todo /v1 responde 503 `no_disponible` y la purga diaria sigue corriendo.
 * @property {{ secret: string, expectedHostname: string | null, expectedAction: string }} turnstile
 */

/**
 * Todo lo que recibe `createApp`. `mailer: null` significa "sin proveedor de correo": la inscripción responde 503.
 * @typedef {object} AppPorts
 * @property {Db} db
 * @property {Clock} clock
 * @property {Random} random
 * @property {Logger} logger
 * @property {AppConfig} config
 * @property {TurnstileVerifier} turnstile
 * @property {Mailer | null} mailer
 */

/**
 * Lo mínimo del contexto de ejecución del Worker.
 * @typedef {{ waitUntil(promesa: Promise<unknown>): void }} Ctx
 */

export {};
