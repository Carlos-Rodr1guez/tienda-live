// Traduce eventos del directo (regalos, comentarios, likes, follows, shares)
// en unidades dentro del mundo. Mantiene equipos y ranking de donadores.
//
// Formato de evento (igual desde TikTok o desde el simulador):
//   { type: 'gift', userId, uniqueId, nickname, avatar, giftName, coins, count }
//   { type: 'chat', userId, nickname, avatar, text }
//   { type: 'like', userId, nickname, count }
//   { type: 'follow' | 'share' | 'member', userId, nickname, avatar }

import { TEAM, UNITS, isBig, resolveKind } from './units.js';

export function normWord(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export class ViewerRouter {
  constructor(world, config, ui = {}, rng = Math.random) {
    this.world = world;
    this.cfg = config;
    this.ui = ui;
    this.rng = rng;
    this.users = new Map();
    this.likes = [0, 0];
    this.energy = [0, 0];
    this.round = world.roundNumber;
    this.words = new Map();
    const jw = config.teams.joinWords || {};
    for (const w of jw.defensores || []) this.words.set(normWord(w), TEAM.DEF);
    for (const w of jw.invasores || []) this.words.set(normWord(w), TEAM.INV);
    this.overrides = new Map();
    for (const [name, v] of Object.entries(config.giftOverrides || {})) this.overrides.set(normWord(name), v);
    this.sortedTiers = [...config.tiers].sort((a, b) => a.minCoins - b.minCoins);
  }

  handle(evt) {
    if (!evt || !evt.type) return;
    this.syncRound();
    switch (evt.type) {
      case 'chat':
        return this.onChat(evt);
      case 'gift':
        return this.onGift(evt);
      case 'like':
        return this.onLike(evt);
      case 'follow':
        return this.onSocial(evt, 'follow');
      case 'share':
        return this.onSocial(evt, 'share');
      default:
        return undefined;
    }
  }

  syncRound() {
    if (this.world.roundNumber === this.round) return;
    this.round = this.world.roundNumber;
    for (const u of this.users.values()) u.roundCoins = 0;
    this.likes = [0, 0];
    this.energy = [0, 0];
  }

  keyOf(evt) {
    return String(evt.userId || evt.uniqueId || evt.nickname || 'anon');
  }

  user(evt) {
    const key = this.keyOf(evt);
    let u = this.users.get(key);
    if (!u) {
      u = {
        key,
        nickname: 'anónimo',
        avatar: '',
        team: null,
        coins: 0,
        roundCoins: 0,
        joinedRound: 0,
        lastSwitch: -999,
        lastEnergy: -999,
      };
      this.users.set(key, u);
    }
    const nick = evt.nickname || evt.uniqueId;
    if (nick) u.nickname = String(nick).slice(0, 24);
    if (evt.avatar) u.avatar = evt.avatar;
    return u;
  }

  owner(u) {
    return { id: u.key, nickname: u.nickname, avatar: u.avatar };
  }

  teamSizes() {
    const c = [0, 0];
    for (const u of this.users.values()) if (u.team !== null) c[u.team]++;
    return c;
  }

  resolveTeam(u) {
    if (u.team !== null) return u.team;
    const mode = this.cfg.teams.defaultTeam;
    let team;
    if (mode === 'defensores') team = TEAM.DEF;
    else if (mode === 'invasores') team = TEAM.INV;
    else {
      const c = this.teamSizes();
      team = c[0] === c[1] ? (this.rng() < 0.5 ? TEAM.DEF : TEAM.INV) : c[0] < c[1] ? TEAM.DEF : TEAM.INV;
    }
    u.team = team;
    this.ui.feed?.({ kind: 'join', team, nickname: u.nickname, auto: true });
    return team;
  }

  // Equipo que pide un comentario, o undefined. La primera palabra puede ser
  // cualquiera de la lista; en el resto solo cuentan las palabras, no los números,
  // así "quiero defender" funciona pero "tengo 2 gatos" no cambia de bando.
  teamFromText(text) {
    const words = String(text || '')
      .trim()
      .split(/\s+/)
      .map(normWord)
      .filter(Boolean);
    if (!words.length) return undefined;
    if (this.words.has(words[0])) return this.words.get(words[0]);
    for (const w of words.slice(1)) {
      if (!/^\d+$/.test(w) && this.words.has(w)) return this.words.get(w);
    }
    return undefined;
  }

  onChat(evt) {
    const team = this.teamFromText(evt.text);
    if (team === undefined) {
      // comentario común: solo carga energía si quien comenta ya eligió bando
      if (this.users.get(this.keyOf(evt))?.team != null) this.addEnergy(this.user(evt));
      return;
    }
    const u = this.user(evt);
    const now = this.world.time;
    if (u.team !== team) {
      if (u.team !== null && (!this.cfg.teams.allowSwitch || now - u.lastSwitch < 15)) return;
      u.team = team;
      u.lastSwitch = now;
      this.ui.feed?.({ kind: 'join', team, nickname: u.nickname });
    }
    const js = this.cfg.joinSpawn;
    if (js && js.enabled && u.joinedRound !== this.world.roundNumber) {
      u.joinedRound = this.world.roundNumber;
      this.world.queueSpawn({ kind: js.unit, team, owner: this.owner(u) }, js.count);
    }
    this.addEnergy(u);
  }

  // Energía por comentarios: cada comentario suma 1 a la barra del equipo de quien comenta
  // (como mucho uno cada userCooldown segundos por persona). Al llenarse, bombardeo de equipo.
  addEnergy(u) {
    const c = this.cfg.energy;
    if (!c || !c.enabled || !(c.perCharge > 0) || u.team === null) return;
    if (this.world.state !== 'battle') return;
    const now = this.world.time;
    if (now - (u.lastEnergy ?? -999) < (c.userCooldown ?? 3)) return;
    u.lastEnergy = now;
    const team = u.team;
    this.energy[team]++;
    if (this.energy[team] < c.perCharge) return;
    this.energy[team] = 0;
    if (!this.world.teamStrike?.(team, c.strike)) return;
    this.ui.feed?.({ kind: 'energy', team, nickname: u.nickname });
    this.ui.banner?.({ type: 'energy', team, nickname: u.nickname, avatar: u.avatar });
  }

  energyProgress(team) {
    const per = this.cfg.energy?.perCharge || 1;
    return Math.min(1, this.energy[team] / per);
  }

  unitsForGift(giftName, coins) {
    const ov = this.overrides.get(normWord(giftName));
    if (ov && UNITS[resolveKind(ov.unit)]) return { unit: resolveKind(ov.unit), perGift: Math.max(1, ov.count || 1) };
    let tier = this.sortedTiers[0];
    for (const t of this.sortedTiers) if (coins >= t.minCoins) tier = t;
    const per = Math.floor(coins / (tier.coinsPerUnit || tier.minCoins || 1));
    return { unit: resolveKind(tier.unit), perGift: Math.max(1, Math.min(tier.maxPerGift || 99, per)) };
  }

  onGift(evt) {
    const u = this.user(evt);
    const team = this.resolveTeam(u);
    const count = Math.max(1, Math.floor(Number(evt.count) || 1));
    const each = Math.max(1, Number(evt.coins) || 1);
    const coins = each * count;
    u.coins += coins;
    u.roundCoins += coins;
    const { unit, perGift } = this.unitsForGift(evt.giftName, each);
    const total = Math.min(perGift * count, 400);
    this.world.queueSpawn({ kind: unit, team, owner: this.owner(u), gift: true }, total);
    this.ui.feed?.({
      kind: 'gift',
      team,
      nickname: u.nickname,
      giftName: evt.giftName || 'Regalo',
      count,
      unit,
      total,
      coins,
    });
    if (isBig(unit)) this.ui.banner?.({ team, unit, nickname: u.nickname, avatar: u.avatar, total });
  }

  onLike(evt) {
    const cfg = this.cfg.likes;
    if (!cfg || !cfg.perReinforcement) return;
    const u = this.user(evt);
    const team = u.team ?? TEAM.DEF;
    this.likes[team] += Math.max(1, Number(evt.count) || 1);
    while (this.likes[team] >= cfg.perReinforcement) {
      this.likes[team] -= cfg.perReinforcement;
      this.world.queueSpawn({ kind: cfg.unit, team, owner: { id: 'likes', nickname: 'Likes', avatar: '' } }, cfg.count);
      this.ui.feed?.({ kind: 'likes', team, unit: resolveKind(cfg.unit), total: cfg.count });
    }
  }

  onSocial(evt, type) {
    const c = this.cfg[type];
    if (!c || !c.count) return;
    const u = this.user(evt);
    const team = u.team ?? TEAM.DEF;
    this.world.queueSpawn({ kind: c.unit, team, owner: this.owner(u) }, c.count);
    this.ui.feed?.({ kind: type, team, nickname: u.nickname, unit: resolveKind(c.unit), total: c.count });
  }

  topDonors(team, n = 3) {
    const out = [];
    for (const u of this.users.values()) if (u.team === team && u.roundCoins > 0) out.push(u);
    out.sort((a, b) => b.roundCoins - a.roundCoins);
    return out.slice(0, n);
  }

  likeProgress(team) {
    const per = this.cfg.likes?.perReinforcement || 1;
    return Math.min(1, this.likes[team] / per);
  }
}
