// HUD en HTML: marcador, vida de la base, leyenda de regalos, feed, banners y mensajes de ronda.
// Todo texto que viene del público se inserta con textContent (nunca innerHTML).

import { TEAM, TEAM_LABEL, UNITS, unitLabel, resolveKind } from '../sim/units.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtCoins(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '')}k` : String(n);
}

export class Hud {
  constructor(cfg, world, router) {
    this.cfg = cfg;
    this.world = world;
    this.router = router;
    this.acc = 0;
    this.slowAcc = 0;
    this.bannerQueue = [];
    this.bannerBusy = false;
    this.lastBaseHp = world.base.hp;
    this.centerMode = '';

    this.e = {
      cnt: [$('cnt0'), $('cnt1')],
      time: $('time'),
      clock: $('time').parentElement,
      round: $('roundLbl'),
      score: $('score'),
      pow0: $('pow0'),
      baseBar: $('baseBar'),
      basePct: $('basePct'),
      baseBox: $('baseBar').closest('.basehp'),
      kings: [$('king0'), $('king1')],
      likes: [$('like0'), $('like1')],
      energy: [$('energy0'), $('energy1')],
      feed: $('feed'),
      banner: $('banner'),
      center: $('center'),
      cmdHp: $('cmdHp'),
      cmdKills: $('cmdKills'),
      skStrike: $('skStrike'),
      skDash: $('skDash'),
      cmdDown: $('cmdDown'),
      conn: $('conn'),
      safe: $('safe'),
      hud: $('hud'),
      giftList: $('giftList'),
      camFrame: $('camFrame'),
      camGuide: $('camGuide'),
    };
    this.buildGifts();
    const cam = cfg.camera || {};
    this.e.camFrame.classList.toggle('off', !cam.enabled);
    if (Number(cam.size) > 0) this.e.camFrame.style.width = `${8.5 * Number(cam.size)}em`;
  }

  toggleCam() {
    this.e.camFrame.classList.toggle('off');
    this.updateCamGuide();
  }

  // Con F3, el marco muestra dónde poner la cámara en el lienzo 1080×1920 de LIVE Studio.
  updateCamGuide() {
    const on = this.e.safe.classList.contains('on');
    const frame = this.e.camFrame;
    frame.classList.toggle('guide', on);
    if (!on || frame.classList.contains('off')) return;
    const g = $('game').getBoundingClientRect();
    const s = frame.querySelector('.cf-screen').getBoundingClientRect();
    const k = 1080 / g.width;
    const r = (v) => Math.round(v * k);
    this.e.camGuide.textContent = `CÁMARA AQUÍ\nLIVE Studio 1080×1920\nX ${r(s.left - g.left)} · Y ${r(s.top - g.top)}\n${r(s.width)} × ${r(s.height)}`;
  }

  buildGifts(thumbs = {}) {
    const list = this.e.giftList;
    list.textContent = '';
    const tiers = [...this.cfg.tiers].sort((a, b) => a.minCoins - b.minCoins);
    for (const t of tiers) {
      const unit = resolveKind(t.unit);
      const row = el('div', 'gift');
      const th = el('div', 'thumb');
      if (thumbs[unit]) th.style.backgroundImage = `url(${thumbs[unit]})`;
      const info = el('div');
      const cost = el('div', 'cost');
      cost.append(el('i', 'coin'), document.createTextNode(`${fmtCoins(t.minCoins)}`));
      info.append(el('strong', '', UNITS[unit]?.name || unit), cost);
      if (t.example) info.append(el('small', '', t.example));
      row.append(th, info);
      list.append(row);
    }
  }

  setThumbs(thumbs) {
    this.buildGifts(thumbs);
  }

  setConn(state, text) {
    const c = this.e.conn;
    c.className = `conn ${state || ''}`;
    c.querySelector('span').textContent = text;
  }

  toggleSafe() {
    this.e.safe.classList.toggle('on');
    this.updateCamGuide();
  }

  toggleHud() {
    this.e.hud.classList.toggle('hidden');
  }

  // ---------------------------------------------------------------- feed

  feed(m) {
    const line = el('div', `msg t${m.team ?? 0}`);
    const name = (n) => el('b', '', n);
    const units = (k, n) => el('span', 'u', `${n} ${unitLabel(k, n)}`);
    switch (m.kind) {
      case 'gift':
        line.append(name(m.nickname), document.createTextNode(` ${m.giftName}${m.count > 1 ? ` ×${m.count}` : ''} → `), units(m.unit, m.total));
        break;
      case 'join':
        line.append(name(m.nickname), document.createTextNode(m.auto ? ' va con los ' : ' se unió a los '), el('b', '', TEAM_LABEL[m.team].toUpperCase()));
        break;
      case 'likes':
        line.append(document.createTextNode('❤ Likes → '), units(m.unit, m.total), document.createTextNode(` para ${TEAM_LABEL[m.team]}`));
        break;
      case 'follow':
        line.append(name(m.nickname), document.createTextNode(' siguió → '), units(m.unit, m.total));
        break;
      case 'share':
        line.append(name(m.nickname), document.createTextNode(' compartió → '), units(m.unit, m.total));
        break;
      case 'energy':
        line.append(document.createTextNode('⚡ '), name(m.nickname), document.createTextNode(' completó la energía → '), el('span', 'u', '¡bombardeo!'));
        break;
      default:
        return;
    }
    const feed = this.e.feed;
    feed.prepend(line);
    while (feed.children.length > 6) feed.lastChild.remove();
    setTimeout(() => line.classList.add('old'), 7000);
    setTimeout(() => line.remove(), 7700);
  }

  // ---------------------------------------------------------------- banners

  banner(info) {
    if (this.bannerQueue.length > 6) this.bannerQueue.shift();
    this.bannerQueue.push(info);
    if (!this.bannerBusy) this.nextBanner();
  }

  nextBanner() {
    const info = this.bannerQueue.shift();
    if (!info) { this.bannerBusy = false; return; }
    this.bannerBusy = true;
    const b = el('div', `b t${info.team}`);
    if (info.avatar) {
      const img = el('img');
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      img.src = info.avatar;
      img.onerror = () => img.replaceWith(el('div', 'noav'));
      b.append(img);
    } else b.append(el('div', 'noav'));
    const txt = el('div');
    if (info.type === 'energy') {
      txt.append(
        el('small', '', `⚡ ENERGÍA DE LOS ${TEAM_LABEL[info.team].toUpperCase()}`),
        el('strong', '', '¡BOMBARDEO!'),
        el('span', '', `la completó ${info.nickname}`),
      );
    } else {
      const side = info.team === TEAM.DEF ? 'ALIADO' : 'ENEMIGO';
      txt.append(
        el('small', '', `¡LLEGA UN ${UNITS[info.unit].name.toUpperCase()} ${side}!`),
        el('strong', '', info.total > 1 ? `${UNITS[info.unit].plural.toUpperCase()} ×${info.total}` : UNITS[info.unit].name.toUpperCase()),
        el('span', '', `de ${info.nickname}`),
      );
    }
    b.append(txt);
    this.e.banner.textContent = '';
    this.e.banner.append(b);
    setTimeout(() => b.classList.add('out'), 2600);
    setTimeout(() => { b.remove(); this.nextBanner(); }, 2950);
  }

  // ---------------------------------------------------------------- toma cinematográfica

  // La cámara se acerca a la unidad de un donador: franjas de cine y tarjeta grande con su nombre.
  cine(state, c) {
    const game = this.e.hud.parentElement;
    if (!this.e.spot) {
      this.e.lb = el('div', 'letterbox');
      this.e.lb.append(el('i'), el('i'));
      this.e.spot = el('div', 'spot');
      this.e.hud.append(this.e.lb, this.e.spot);
    }
    const spot = this.e.spot;
    if (state === 'end') {
      game.classList.remove('cine', 'cine-big');
      spot.classList.remove('on');
      return;
    }
    const big = c.kind === 'acorazado';
    game.classList.add('cine');
    game.classList.toggle('cine-big', big);
    spot.className = `spot t${c.team}`;
    spot.textContent = '';
    const name = c.owner?.nickname || 'Alguien';
    const av = c.owner?.avatar;
    if (av) {
      const img = el('img');
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      img.src = av;
      img.onerror = () => img.replaceWith(el('div', 'noav'));
      spot.append(img);
    } else spot.append(el('div', 'noav'));
    const txt = el('div', 'txt');
    const unitName = UNITS[c.kind].name.toUpperCase();
    txt.append(
      el('small', '', c.team === TEAM.DEF ? '¡REFUERZO PARA LA BASE!' : '¡ATAQUE A LA BASE!'),
      el('strong', '', name),
      el('span', '', `invocó un ${unitName}`),
    );
    spot.append(txt);
    void spot.offsetWidth;
    spot.classList.add('on');
  }

  // ---------------------------------------------------------------- mensajes centrales

  setCenter(mode, build) {
    this.centerMode = mode;
    const c = this.e.center;
    c.textContent = '';
    if (!build) return;
    const m = el('div', 'm');
    build(m);
    c.append(m);
  }

  handleFx(list) {
    for (const e of list) {
      if (e.t === 'round') {
        if (e.state === 'intro') {
          this.setCenter('intro', (m) => {
            m.append(el('div', 'kicker', `RONDA ${e.round}`), el('div', 'big', '¡DEFIENDE LA BASE!'),
              el('div', 'sub', 'Comenta 1 o 2 y envía regalos'), el('div', 'count', ''));
          });
        } else if (e.state === 'battle') {
          this.setCenter('go', (m) => m.append(el('div', 'big', '¡A LA BATALLA!')));
          setTimeout(() => { if (this.centerMode === 'go') this.setCenter('', null); }, 1300);
        } else if (e.state === 'end') {
          this.showEnd(e.winner);
        }
      } else if (e.t === 'baseHit') {
        const box = this.e.baseBox;
        box.classList.remove('hit');
        void box.offsetWidth;
        box.classList.add('hit');
      }
    }
  }

  showEnd(winner) {
    const defWin = winner === TEAM.DEF;
    this.setCenter('end', (m) => {
      const card = el('div', 'card-end');
      card.append(
        el('div', 'kicker', `RONDA ${this.world.roundNumber}`),
        el('div', `big t${winner}`, defWin ? '¡LA BASE RESISTIÓ!' : '¡BASE DESTRUIDA!'),
        el('div', 'sub', `Ganan los ${TEAM_LABEL[winner].toUpperCase()}`),
      );
      const mvps = el('div');
      for (const team of [TEAM.DEF, TEAM.INV]) {
        const top = this.router.topDonors(team, 1)[0];
        if (!top) continue;
        const chip = el('div', `mvp t${team}`);
        chip.append(document.createTextNode('MVP '), el('b', '', top.nickname), document.createTextNode(` · ${fmtCoins(top.roundCoins)} monedas`));
        mvps.append(chip);
      }
      card.append(mvps, el('div', 'sub next', ''));
      m.append(card);
    });
  }

  // ---------------------------------------------------------------- actualización

  update(dt) {
    this.acc += dt;
    this.slowAcc += dt;
    if (this.acc < 1 / 12) return;
    this.acc = 0;
    const w = this.world;
    const e = this.e;

    // contadores (más lo que espera en cola)
    const queued = [0, 0];
    for (const q of w.queue) queued[q.team]++;
    for (const team of [0, 1]) {
      let n = w.aliveCount[team];
      if (team === TEAM.DEF && w.commander && w.commander.alive) n--;
      e.cnt[team].textContent = String(Math.max(0, n));
      if (queued[team] > 0) e.cnt[team].append(el('em', '', `+${queued[team]}`));
    }

    e.time.textContent = fmtTime(w.state === 'intro' ? w.cfg.round.seconds : w.timeLeft);
    e.clock.classList.toggle('hurry', w.state === 'battle' && w.timeLeft <= 15);
    e.round.textContent = `RONDA ${w.roundNumber}`;
    e.score.textContent = `${w.score[0]} · ${w.score[1]}`;

    const p = w.power();
    const total = p[0] + p[1];
    e.pow0.style.width = `${total > 0 ? (p[0] / total) * 100 : 50}%`;

    const k = w.base.hp / w.base.maxHp;
    e.baseBar.style.width = `${k * 100}%`;
    e.basePct.textContent = `${Math.ceil(k * 100)}%`;
    e.baseBox.classList.toggle('low', k < 0.3);

    e.likes[0].style.width = `${this.router.likeProgress(0) * 100}%`;
    e.likes[1].style.width = `${this.router.likeProgress(1) * 100}%`;
    e.energy[0].style.width = `${this.router.energyProgress(0) * 100}%`;
    e.energy[1].style.width = `${this.router.energyProgress(1) * 100}%`;

    // comandante
    const c = w.commander;
    if (c && c.alive) {
      e.cmdHp.style.width = `${(c.hp / c.maxHp) * 100}%`;
      e.cmdDown.textContent = '';
    } else {
      e.cmdHp.style.width = '0%';
      const left = Math.max(0, w.commanderRespawnAt - w.time);
      e.cmdDown.textContent = left > 0 ? `Comandante caído · vuelve en ${Math.ceil(left)}` : '';
    }
    e.cmdKills.textContent = `${w.cmd.kills} bajas`;
    const sCd = w.strikeCooldown(), dCd = w.dashCooldown();
    e.skStrike.classList.toggle('ready', sCd <= 0);
    e.skDash.classList.toggle('ready', dCd <= 0);
    e.skStrike.querySelector('i').style.transform = `scaleX(${sCd / w.cfg.commander.strikeCooldown})`;
    e.skDash.querySelector('i').style.transform = `scaleX(${dCd / w.cfg.commander.dashCooldown})`;

    // cuenta regresiva de intro y de la siguiente ronda
    if (this.centerMode === 'intro') {
      const cnt = e.center.querySelector('.count');
      if (cnt) cnt.textContent = String(Math.max(1, Math.ceil(w.stateTime)));
    } else if (this.centerMode === 'end') {
      const nx = e.center.querySelector('.next');
      if (nx) nx.textContent = `Siguiente ronda en ${Math.max(0, Math.ceil(w.stateTime))}`;
    }

    if (this.slowAcc >= 0.5) {
      this.slowAcc = 0;
      for (const team of [0, 1]) {
        const top = this.router.topDonors(team, 1)[0];
        e.kings[team].textContent = top ? `👑 ${top.nickname} · ${fmtCoins(top.roundCoins)}` : '';
      }
    }
  }
}
