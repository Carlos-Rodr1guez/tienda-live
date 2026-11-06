// @ts-check
// Convierte los mensajes de tiktok-live-connector al formato simple que usa el juego.
// Es defensivo: acepta tanto el formato nuevo (v2, proto v3) como el antiguo (legacy).

/**
 * Mensaje tal como llega de tiktok-live-connector. Su forma cambia entre versiones,
 * por eso se lee campo por campo y siempre con un valor por defecto.
 * @typedef {Record<string, any>} RawMessage
 */

/**
 * Quién generó el evento. Todos los eventos lo traen.
 * @typedef {object} LiveUser
 * @property {string} userId
 * @property {string} uniqueId
 * @property {string} nickname
 * @property {string} avatar
 */

/** @typedef {LiveUser & { type: 'chat', text: string }} ChatEvent */

/**
 * @typedef {LiveUser & {
 *   type: 'gift', giftId: string, giftName: string, coins: number, count: number, image: string
 * }} GiftEvent
 */

/** @typedef {LiveUser & { type: 'like', count: number }} LikeEvent */

/** @typedef {LiveUser & { type: 'follow' | 'share' | 'member' }} UserEvent */

/**
 * Evento normalizado que el servidor le reenvía al juego por WebSocket.
 * @typedef {ChatEvent | GiftEvent | LikeEvent | UserEvent} LiveEvent
 */

/**
 * @param {any} img
 * @returns {string}
 */
function firstUrl(img) {
  return img?.urlList?.[0] || img?.url?.[0] || img?.urls?.[0] || '';
}

/**
 * @param {RawMessage} [d]
 * @returns {LiveUser}
 */
export function userOf(d = {}) {
  const u = d.user || {};
  const uniqueId = u.uniqueId || u.displayId || d.uniqueId || '';
  const nickname = u.nickname || d.nickname || uniqueId || 'anónimo';
  const userId = String(u.userId || u.id || d.userId || uniqueId || nickname);
  const avatar =
    u.profilePictureUrl ||
    firstUrl(u.avatarThumb) ||
    firstUrl(u.avatarMedium) ||
    firstUrl(u.avatarLarge) ||
    firstUrl(u.profilePicture) ||
    d.profilePictureUrl ||
    '';
  return { userId, uniqueId, nickname, avatar };
}

/**
 * @param {{ now?: () => number }} [options] `now` es el reloj en milisegundos; las pruebas lo reemplazan.
 */
export function createNormalizer({ now = Date.now } = {}) {
  // rachas activas: userId:giftId -> { count, t }
  /** @type {Map<string, { count: number, t: number }>} */
  const streaks = new Map();

  function sweep() {
    const limit = now() - 120000;
    for (const [k, v] of streaks) if (v.t < limit) streaks.delete(k);
  }

  return {
    /**
     * @param {RawMessage} d
     * @returns {ChatEvent}
     */
    chat(d) {
      return { type: 'chat', ...userOf(d), text: String(d.content ?? d.comment ?? '') };
    },

    /**
     * Devuelve 0 o 1 eventos. En las rachas (giftType 1) emite solo lo nuevo,
     * así cada rosa de una racha aparece al instante y nada se cuenta dos veces.
     * @param {RawMessage} d
     * @returns {GiftEvent[]}
     */
    gift(d) {
      const gift = d.gift || {};
      const det = d.giftDetails || {};
      const ext = d.extendedGiftInfo || {};
      const user = userOf(d);
      const giftId = String(d.giftId ?? gift.id ?? ext.id ?? '');
      const giftName = gift.name || det.giftName || ext.name || d.giftName || 'Regalo';
      const coins =
        Number(gift.diamondCount ?? det.diamondCount ?? ext.diamond_count ?? ext.diamondCount ?? d.diamondCount ?? 1) ||
        1;
      const giftType = Number(gift.type ?? det.giftType ?? ext.type ?? d.giftType ?? 0);
      const repeatCount = Math.max(1, Number(d.repeatCount ?? d.comboCount ?? 1) || 1);
      const repeatEnd = d.repeatEnd === true || Number(d.repeatEnd) === 1;
      const image = firstUrl(gift.image) || firstUrl(gift.icon) || d.giftPictureUrl || '';

      /** @type {number} */
      let count;
      if (giftType !== 1) {
        count = repeatCount;
      } else {
        const key = `${user.userId}:${giftId}`;
        const prev = streaks.get(key);
        count = repeatCount - (prev ? prev.count : 0);
        if (count < 0) count = repeatCount; // empezó otra racha sin cierre de la anterior
        if (repeatEnd) streaks.delete(key);
        else streaks.set(key, { count: repeatCount, t: now() });
      }
      if (streaks.size > 500) sweep();
      if (count <= 0) return [];
      return [{ type: 'gift', ...user, giftId, giftName, coins, count, image }];
    },

    /**
     * @param {RawMessage} d
     * @returns {LikeEvent}
     */
    like(d) {
      return { type: 'like', ...userOf(d), count: Math.max(1, Number(d.count ?? d.likeCount ?? 1) || 1) };
    },

    /**
     * @param {RawMessage} d
     * @param {'follow' | 'share'} type
     * @returns {UserEvent}
     */
    social(d, type) {
      return { type, ...userOf(d) };
    },

    /**
     * @param {RawMessage} d
     * @returns {UserEvent}
     */
    member(d) {
      return { type: 'member', ...userOf(d) };
    },
  };
}
