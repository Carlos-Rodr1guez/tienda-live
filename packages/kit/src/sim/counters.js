// Contadores por equipo (KIT-19): likes que juntan refuerzos y comentarios que cargan la barra de energía.
// Los equipos se numeran 1..N, igual que en el registro. Quien no tiene equipo (null) se ignora por completo:
// no cuenta, no se guarda nada para después (KIT-9). El reloj llega por argumento.

/**
 * @param {number} n cantidad de equipos
 * @param {{likes?: {perReinforcement?: number}, energy?: {enabled?: boolean, perCharge?: number, userCooldown?: number}}} cfg
 */
export function createTeamCounters(n, { likes, energy } = {}) {
  const perLikes = Number(likes?.perReinforcement) > 0 ? Number(likes.perReinforcement) : 0;
  const perEnergy = energy?.enabled && Number(energy.perCharge) > 0 ? Number(energy.perCharge) : 0;
  const userCooldown = Number.isFinite(energy?.userCooldown) ? Number(energy.userCooldown) : 3;
  const likeBars = Array.from({ length: n }, () => 0);
  const energyBars = Array.from({ length: n }, () => 0);
  /** @type {Map<string, number>} */
  const lastCharge = new Map();

  const valid = (team) => Number.isInteger(team) && team >= 1 && team <= n;

  return {
    /**
     * Suma likes de un usuario con equipo. Devuelve cuántos refuerzos se completaron.
     * @param {number|null|undefined} team
     * @param {number} count
     * @returns {number}
     */
    addLikes(team, count) {
      if (!perLikes || !valid(team)) return 0;
      const t = /** @type {number} */ (team) - 1;
      likeBars[t] += Math.max(1, Math.floor(Number(count) || 1));
      let reinforcements = 0;
      while (likeBars[t] >= perLikes) {
        likeBars[t] -= perLikes;
        reinforcements++;
      }
      return reinforcements;
    },

    /**
     * Una carga por usuario cada `userCooldown` segundos, solo con equipo y en batalla.
     * Devuelve true cuando la barra se llena (y se vacía): es el pedido de bombardeo de equipo.
     * @param {number|null|undefined} team
     * @param {string} key
     * @param {number} now
     * @param {boolean} inBattle
     * @returns {boolean}
     */
    chargeEnergy(team, key, now, inBattle) {
      if (!perEnergy || !inBattle || !valid(team)) return false;
      if (now - (lastCharge.get(key) ?? -Infinity) < userCooldown) return false;
      lastCharge.set(key, now);
      const t = /** @type {number} */ (team) - 1;
      energyBars[t]++;
      if (energyBars[t] < perEnergy) return false;
      energyBars[t] = 0;
      return true;
    },

    likeProgress: (team) => (perLikes && valid(team) ? Math.min(1, likeBars[team - 1] / perLikes) : 0),
    energyProgress: (team) => (perEnergy && valid(team) ? Math.min(1, energyBars[team - 1] / perEnergy) : 0),

    /** Todo se reinicia al empezar cada ronda. */
    resetRound() {
      likeBars.fill(0);
      energyBars.fill(0);
      lastCharge.clear();
    },
  };
}
