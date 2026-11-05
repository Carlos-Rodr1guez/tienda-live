// @ts-check
// Acceso a la tabla `waitlist` de D1. Todo el SQL de la lista de espera está acá; las sentencias usan solo ?NNN
// (D1 no admite parámetros con nombre). Ningún valor se arma por concatenación.

/**
 * Lo que se guarda de cada persona (lo que valida contracts, sin el token de Turnstile ni el consentimiento).
 * @typedef {object} Perfil
 * @property {string} email
 * @property {string | null} tiktok_user
 * @property {string} live_frequency
 * @property {string} stream_type
 * @property {readonly string[]} interests  ya ordenados como CATEGORIES
 * @property {string | null} followers_range
 * @property {string | null} country
 * @property {string} consent_version
 */

/**
 * Un token nuevo y los instantes de envío que lo acompañan.
 * @typedef {object} Envio
 * @property {string} tokenHash SHA-256 en hexadecimal; el token en claro no se guarda nunca.
 * @property {string} tokenExpiresAt ISO-8601
 * @property {readonly string[]} recentSends
 */

/**
 * Confirmar: una sola sentencia que a la vez comprueba, consume y sella. Si no cambia ninguna fila, el enlace es
 * inválido (desconocido, usado o vencido) y no se distingue cuál. `?2` es el instante actual en ISO-8601.
 */
export const CONFIRM_SQL =
  'UPDATE waitlist SET confirmed_at=?2, updated_at=?2, token_hash=NULL, token_expires_at=NULL ' +
  'WHERE token_hash=?1 AND confirmed_at IS NULL AND token_expires_at > ?2';

const BUSCAR = 'SELECT id, confirmed_at, recent_sends FROM waitlist WHERE email = ?1';

const INSERTAR =
  'INSERT INTO waitlist (email, live_frequency, stream_type, interests, tiktok_user, followers_range, country, ' +
  'consent_version, consent_at, created_at, updated_at, token_hash, token_expires_at, recent_sends) ' +
  'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?9, ?10, ?11, ?12)';

// Una persona pendiente que vuelve a anotarse: se reemplaza el perfil y el consentimiento y se reinicia la ventana
// de 7 días (created_at). Con `envio`, además, el token nuevo pisa al anterior (el enlace viejo deja de servir).
const ACTUALIZAR_PERFIL =
  'UPDATE waitlist SET live_frequency=?2, stream_type=?3, interests=?4, tiktok_user=?5, followers_range=?6, ' +
  'country=?7, consent_version=?8, consent_at=?9, created_at=?9, updated_at=?9';
const ACTUALIZAR_ENVIO = ', token_hash=?10, token_expires_at=?11, recent_sends=?12';
const SOLO_PENDIENTES = ' WHERE id=?1 AND confirmed_at IS NULL';

const PURGAR = 'DELETE FROM waitlist WHERE confirmed_at IS NULL AND created_at < ?1';

/**
 * @param {Perfil} p
 * @param {string} ahora
 */
function valoresDelPerfil(p, ahora) {
  return [
    p.live_frequency,
    p.stream_type,
    JSON.stringify(p.interests),
    p.tiktok_user,
    p.followers_range,
    p.country,
    p.consent_version,
    ahora,
  ];
}

/**
 * @param {import('../ports.js').Db} db
 * @param {string} email Ya normalizado.
 * @returns {Promise<{ id: number, confirmedAt: string | null, recentSends: string[] } | null>}
 */
export async function findByEmail(db, email) {
  const fila = await db.prepare(BUSCAR).bind(email).first();
  if (!fila) return null;
  return { id: Number(fila.id), confirmedAt: fila.confirmed_at, recentSends: JSON.parse(fila.recent_sends) };
}

/**
 * @param {import('../ports.js').Db} db
 * @param {{ perfil: Perfil, ahora: string } & Envio} datos
 */
export async function insertPending(db, { perfil, ahora, tokenHash, tokenExpiresAt, recentSends }) {
  const [frecuencia, tipo, intereses, usuario, seguidores, pais, version, consentimiento] = valoresDelPerfil(
    perfil,
    ahora,
  );
  await db
    .prepare(INSERTAR)
    .bind(
      perfil.email,
      frecuencia,
      tipo,
      intereses,
      usuario,
      seguidores,
      pais,
      version,
      consentimiento,
      tokenHash,
      tokenExpiresAt,
      JSON.stringify(recentSends),
    )
    .run();
}

/**
 * Actualiza una fila pendiente. Devuelve cuántas filas cambió (0 si ya se había confirmado en el medio).
 * @param {import('../ports.js').Db} db
 * @param {number} id
 * @param {{ perfil: Perfil, ahora: string, envio: Envio | null }} datos
 */
export async function updatePending(db, id, { perfil, ahora, envio }) {
  const valores = [id, ...valoresDelPerfil(perfil, ahora)];
  const sql = envio ? ACTUALIZAR_PERFIL + ACTUALIZAR_ENVIO + SOLO_PENDIENTES : ACTUALIZAR_PERFIL + SOLO_PENDIENTES;
  if (envio) valores.push(envio.tokenHash, envio.tokenExpiresAt, JSON.stringify(envio.recentSends));
  const { meta } = await db
    .prepare(sql)
    .bind(...valores)
    .run();
  return meta.changes;
}

/**
 * @param {import('../ports.js').Db} db
 * @param {string} tokenHash
 * @param {string} ahora ISO-8601
 * @returns {Promise<boolean>} true si confirmó exactamente una fila.
 */
export async function confirmByTokenHash(db, tokenHash, ahora) {
  const { meta } = await db.prepare(CONFIRM_SQL).bind(tokenHash, ahora).run();
  return meta.changes === 1;
}

/**
 * Borra los pendientes creados antes del corte. Los confirmados no se tocan.
 * @param {import('../ports.js').Db} db
 * @param {string} corte ISO-8601
 * @returns {Promise<number>} cuántas filas borró.
 */
export async function purgePending(db, corte) {
  const { meta } = await db.prepare(PURGAR).bind(corte).run();
  return meta.changes;
}
