// Panel del simulador de público (F1). Envía los mismos eventos que llegarían de TikTok: por POST a
// /api/simulate en modo servidor, o llamando a `onEvent` en modo demo (sin red).
// Todo el DOM se arma con textContent: un nombre de espectador nunca se interpreta como HTML (KIT-11).
// Los clics reales en sus botones cuentan como entrada del streamer; los eventos que genera no llevan marca (NM-8).

import { mulberry32 } from '../sim/rng.js';
import {
  DEFAULT_NAMES,
  autoCount,
  buildChat,
  buildGift,
  buildLike,
  buildSocial,
  buildUser,
  panelModel,
  pickAuto,
} from './simulator-events.js';

/**
 * @param {string} label
 * @param {string} sub texto pequeño bajo la etiqueta (opcional)
 * @param {() => void} onClick
 */
function button(label, sub, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    b.append(s);
  }
  b.addEventListener('click', onClick);
  return b;
}

function title(text) {
  const h = document.createElement('h4');
  h.textContent = text;
  return h;
}

export class SimulatorPanel {
  /**
   * @param {HTMLElement} el contenedor del panel
   * @param {{
   *   config?: object, onEvent?: (evt: object) => void, endpoint?: string, seed?: number,
   *   floating?: boolean, fab?: boolean, hotkey?: boolean
   * }} [opts] `config` es la del juego (equipos, simulator.gifts, giftOverrides). Con `onEvent` es modo demo.
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.onEvent = opts.onEvent;
    this.endpoint = opts.endpoint ?? '/api/simulate';
    this.floating = Boolean(opts.floating);
    this.rng = mulberry32(opts.seed ?? 1);
    this.model = panelModel(opts.config);
    this.names = opts.config?.simulator?.names?.length ? opts.config.simulator.names : DEFAULT_NAMES;
    this.team = 0; // 0 = automático; 1..N = el equipo de quien envía
    this.streak = 1;
    this.autoTimer = null;
    if (opts.fab !== false) {
      this.fab = button('Simular regalos', '', () => this.show(true));
      this.fab.className = 'simfab';
      document.body.append(this.fab);
    }
    if (opts.hotkey !== false) {
      this.onKey = (e) => {
        if (e.key !== 'F1') return;
        e.preventDefault();
        this.toggle();
      };
      document.addEventListener('keydown', this.onKey);
    }
    this.build();
  }

  /** Manda un evento: a la demo o al servidor. Un fallo de red no rompe el panel. */
  emit(evt) {
    if (this.onEvent) {
      this.onEvent(evt);
      return;
    }
    fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
    }).catch(() => {});
  }

  build() {
    const el = this.el;
    el.textContent = '';
    const close = button('×', '', () => this.show(false));
    close.className = 'close';
    const h = document.createElement('h2');
    h.textContent = 'Simulador de público';
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Prueba el juego sin TikTok. Cada botón envía el mismo evento que llegaría de la transmisión en vivo. Se abre y cierra con F1.';
    el.append(close, h, hint);

    // equipo de quien envía
    el.append(title('EQUIPO DE QUIEN ENVÍA'));
    const seg = document.createElement('div');
    seg.className = 'seg';
    const choices = [[0, 'Auto'], ...this.model.teams.map((t) => [t.team, t.label])];
    const btns = choices.map(([value, label]) => {
      const b = button(label, '', () => {
        this.team = value;
        btns.forEach((x) => x.classList.toggle('on', x === b));
      });
      if (value === this.team) b.classList.add('on');
      return b;
    });
    seg.append(...btns);
    el.append(seg);

    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'Nombre (vacío = al azar)';
    name.maxLength = 24;
    name.style.marginTop = '8px';
    this.nameInput = name;
    el.append(name);

    // se unen a un equipo, con la palabra de la config
    el.append(title('SE UNEN AL EQUIPO'));
    const joins = document.createElement('div');
    joins.className = 'grid';
    for (const t of this.model.teams) joins.append(button(t.label, '', () => this.join(t)));
    el.append(joins);

    // regalos de la config
    el.append(title('REGALOS'));
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const g of this.model.gifts) {
      grid.append(
        button(g.name, `${g.coins} ${g.coins === 1 ? 'moneda' : 'monedas'}`, () => this.gift(g, this.streak)),
      );
    }
    el.append(grid);
    const streak = document.createElement('label');
    streak.className = 'chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => {
      this.streak = cb.checked ? 5 : 1;
    });
    streak.append(cb, document.createTextNode('Enviar en racha ×5'));
    el.append(streak);

    el.append(title('INTERACCIONES'));
    const g2 = document.createElement('div');
    g2.className = 'grid';
    g2.append(
      button('+100 likes', '', () => this.like(100)),
      button('Seguir', '', () => this.social('follow')),
      button('Compartir', '', () => this.social('share')),
      button('10 personas se unen', '', () => {
        for (let i = 0; i < 10; i++) this.join(this.pickTeam(), true);
      }),
      button('Comentan 5', 'energía', () => {
        // cada uno se une a su equipo (según "Equipo de quien envía") y comenta
        for (let i = 0; i < 5; i++) this.join(this.team ? this.model.teams[this.team - 1] : this.pickTeam(), true);
      }),
    );
    el.append(g2);

    el.append(title('TRÁFICO AUTOMÁTICO'));
    const seg2 = document.createElement('div');
    seg2.className = 'seg';
    this.levelBtns = this.model.auto.map((l) => button(l.label, '', () => this.setAuto(l.id)));
    seg2.append(...this.levelBtns);
    el.append(seg2);
    this.setAuto('off');
  }

  /** Equipo al azar con el generador del panel (null si la config no tiene equipos). */
  pickTeam() {
    const t = this.model.teams;
    return t.length ? t[Math.floor(this.rng() * t.length)] : null;
  }

  /** Quien envía: el nombre escrito, o uno al azar. */
  user(random = false) {
    const typed = this.nameInput.value.trim();
    const nick = typed && !random ? typed : this.names[Math.floor(this.rng() * this.names.length)];
    return buildUser(nick);
  }

  /** Alguien dice la palabra de unión de un equipo. */
  join(team, random = false) {
    if (!team) return;
    this.emit(buildChat(this.user(random), team.word));
  }

  gift(g, count = 1) {
    const u = this.user(false);
    // con un equipo elegido, primero se une a él (si es "Auto" no hay palabra y el kit lo asigna)
    if (this.team) this.emit(buildChat(u, this.model.teams[this.team - 1].word));
    this.emit(buildGift(u, g, count));
  }

  like(n) {
    this.emit(buildLike(this.user(true), n));
  }

  social(type) {
    this.emit(buildSocial(this.user(false), type));
  }

  setAuto(level) {
    this.levelBtns.forEach((b, i) => b.classList.toggle('on', this.model.auto[i].id === level));
    clearInterval(this.autoTimer);
    this.autoTimer = null;
    if (level === 'off') return;
    const cfg = { teams: this.model.teams, gifts: this.model.gifts, names: this.names, level };
    this.autoTimer = setInterval(() => {
      const n = autoCount(this.rng, level);
      for (let i = 0; i < n; i++) for (const evt of pickAuto(this.rng, cfg)) this.emit(evt);
    }, 100);
  }

  show(on) {
    const visible = on ?? !this.el.classList.contains('on');
    this.el.classList.toggle('on', visible);
    this.el.classList.toggle('floating', this.floating);
    this.onToggle?.(visible);
  }

  toggle() {
    this.show(!this.el.classList.contains('on'));
  }

  /** Apaga el tráfico automático y suelta el teclado. */
  destroy() {
    clearInterval(this.autoTimer);
    this.autoTimer = null;
    if (this.onKey) document.removeEventListener('keydown', this.onKey);
    this.fab?.remove();
  }
}
