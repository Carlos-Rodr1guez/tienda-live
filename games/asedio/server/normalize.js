// Convierte los mensajes de tiktok-live-connector al formato simple que usa el juego.
// Es defensivo: acepta tanto el formato nuevo (v2, proto v3) como el antiguo (legacy).

function firstUrl(img) {
  return img?.urlList?.[0] || img?.url?.[0] || img?.urls?.[0] || '';
}

export function userOf(d = {}) {
  const u = d.user || {};
  const uniqueId = u.uniqueId || u.displayId || d.uniqueId || '';
  const nickname = u.nickname || d.nickname || uniqueId || 'anónimo';
  const userId = String(u.userId || u.id || d.userId || uniqueId || nickname);
  const avatar = u.profilePictureUrl
    || firstUrl(u.avatarThumb) || firstUrl(u.avatarMedium) || firstUrl(u.avatarLarge)
    || firstUrl(u.profilePicture) || d.profilePictureUrl || '';
  return { userId, uniqueId, nickname, avatar };
}

export function createNormalizer({ now = Date.now } = {}) {
  // rachas activas: userId:giftId -> { count, t }
  const streaks = new Map();

  function sweep() {
    const limit = now() - 120000;
    for (const [k, v] of streaks) if (v.t < limit) streaks.delete(k);
  }

  return {
    chat(d) {
      return { type: 'chat', ...userOf(d), text: String(d.content ?? d.comment ?? '') };
    },

    // Devuelve 0 o 1 eventos. En las rachas (giftType 1) emite solo lo nuevo,
    // así cada rosa de una racha aparece al instante y nada se cuenta dos veces.
    gift(d) {
      const gift = d.gift || {};
      const det = d.giftDetails || {};
      const ext = d.extendedGiftInfo || {};
      const user = userOf(d);
      const giftId = String(d.giftId ?? gift.id ?? ext.id ?? '');
      const giftName = gift.name || det.giftName || ext.name || d.giftName || 'Regalo';
      const coins = Number(gift.diamondCount ?? det.diamondCount ?? ext.diamond_count ?? ext.diamondCount ?? d.diamondCount ?? 1) || 1;
      const giftType = Number(gift.type ?? det.giftType ?? ext.type ?? d.giftType ?? 0);
      const repeatCount = Math.max(1, Number(d.repeatCount ?? d.comboCount ?? 1) || 1);
      const repeatEnd = d.repeatEnd === true || Number(d.repeatEnd) === 1;
      const image = firstUrl(gift.image) || firstUrl(gift.icon) || d.giftPictureUrl || '';

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

    like(d) {
      return { type: 'like', ...userOf(d), count: Math.max(1, Number(d.count ?? d.likeCount ?? 1) || 1) };
    },

    social(d, type) {
      return { type, ...userOf(d) };
    },

    member(d) {
      return { type: 'member', ...userOf(d) };
    },
  };
}
