// Panel para simular el público (F1). Envía los mismos eventos que llegarían de TikTok.

const GIFTS = [
  { name: 'Rosa', coins: 1 },
  { name: 'Corazón con los dedos', coins: 5 },
  { name: 'Rosquilla', coins: 30 },
  { name: 'Gorra', coins: 99 },
  { name: 'Corazón con las manos', coins: 100 },
  { name: 'Pistola de dinero', coins: 500 },
  { name: 'Galaxia', coins: 1000 },
  { name: 'León', coins: 29999 },
];

const NAMES = [
  'ana_23', 'lucho.pe', 'mari_q', 'elpepe', 'sofi.x', 'kevin_007', 'gato.loco', 'rocio.lp',
  'jhon.ar', 'vale.cusco', 'tito99', 'meli.pz', 'dany_god', 'pao.tq', 'brayan.x', 'nico.aqp',
  'flor_17', 'gamer.puno', 'cami.v', 'diego.rx',
];

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

export class SimulatorPanel {
  constructor(el, emit, opts = {}) {
    this.el = el;
    this.emit = emit;
    this.team = 'auto';
    this.streak = 1;
    this.autoTimer = null;
    this.floating = !!opts.floating;
    this.fab = document.createElement('button');
    this.fab.type = 'button';
    this.fab.className = 'simfab';
    this.fab.textContent = 'Simular regalos';
    this.fab.addEventListener('click', () => this.show(true));
    document.body.append(this.fab);
    this.build();
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
    hint.textContent = 'Prueba el juego sin TikTok. Cada botón envía el mismo evento que llegaría del directo. Se abre y cierra con F1.';
    el.append(close, h, hint);

    el.append(this.title('EQUIPO DE QUIEN ENVÍA'));
    const seg = document.createElement('div');
    seg.className = 'seg';
    const opts = [['auto', 'Auto'], ['1', 'Defensa'], ['2', 'Invasión']];
    const btns = opts.map(([v, label]) => {
      const b = button(label, '', () => { this.team = v; btns.forEach((x) => x.classList.toggle('on', x === b)); });
      if (v === this.team) b.classList.add('on');
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

    el.append(this.title('REGALOS'));
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const g of GIFTS) grid.append(button(g.name, `${g.coins} ${g.coins === 1 ? 'moneda' : 'monedas'}`, () => this.gift(g, this.streak)));
    el.append(grid);
    const streak = document.createElement('label');
    streak.className = 'chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => { this.streak = cb.checked ? 5 : 1; });
    streak.append(cb, document.createTextNode('Enviar en racha ×5'));
    el.append(streak);

    el.append(this.title('INTERACCIONES'));
    const g2 = document.createElement('div');
    g2.className = 'grid';
    g2.append(
      button('Comentar "1"', 'defender', () => this.chat('1')),
      button('Comentar "2"', 'invadir', () => this.chat('2')),
      button('+100 likes', '', () => this.like(100)),
      button('Seguir', '', () => this.social('follow')),
      button('Compartir', '', () => this.social('share')),
      button('10 personas se unen', '', () => { for (let i = 0; i < 10; i++) this.chat(Math.random() < 0.5 ? '1' : '2', true); }),
      button('Comentan 5', 'energía', () => {
        // cada uno se une a su bando (según "Equipo de quien envía") y comenta
        for (let i = 0; i < 5; i++) {
          const u = this.user(true);
          const side = this.team === 'auto' ? (Math.random() < 0.5 ? '1' : '2') : this.team;
          this.emit({ type: 'chat', ...u, text: side });
        }
      }),
    );
    el.append(g2);

    el.append(this.title('TRÁFICO AUTOMÁTICO'));
    const seg2 = document.createElement('div');
    seg2.className = 'seg';
    const levels = [['off', 'Apagado'], ['low', 'Bajo'], ['mid', 'Medio'], ['high', 'Alto']];
    this.levelBtns = levels.map(([v, label]) => button(label, '', () => this.setAuto(v)));
    seg2.append(...this.levelBtns);
    el.append(seg2);
    this.setAuto('off');
  }

  title(t) {
    const h = document.createElement('h4');
    h.textContent = t;
    return h;
  }

  pickName(random) {
    const typed = this.nameInput.value.trim();
    if (typed && !random) return typed;
    return NAMES[Math.floor(Math.random() * NAMES.length)];
  }

  user(random = false) {
    const nick = this.pickName(random);
    return { userId: `sim_${nick}`, uniqueId: nick, nickname: nick, avatar: '' };
  }

  ensureTeam(u) {
    if (this.team === 'auto') return;
    this.emit({ type: 'chat', ...u, text: this.team });
  }

  gift(g, count = 1, random = false, teamOverride) {
    const u = this.user(random);
    if (teamOverride) this.emit({ type: 'chat', ...u, text: teamOverride });
    else if (!random) this.ensureTeam(u);
    this.emit({ type: 'gift', ...u, giftName: g.name, coins: g.coins, count });
  }

  chat(text, random = false) {
    this.emit({ type: 'chat', ...this.user(random), text });
  }

  like(n) {
    const u = this.user(true);
    this.emit({ type: 'like', ...u, count: n });
  }

  social(type) {
    this.emit({ type, ...this.user(false) });
  }

  setAuto(level) {
    this.levelBtns.forEach((b, i) => b.classList.toggle('on', ['off', 'low', 'mid', 'high'][i] === level));
    clearInterval(this.autoTimer);
    this.autoTimer = null;
    if (level === 'off') return;
    const rate = { low: 0.8, mid: 2.2, high: 5 }[level];
    this.autoTimer = setInterval(() => {
      if (Math.random() > rate / 10) return;
      this.randomEvent();
    }, 100);
  }

  randomEvent() {
    const x = Math.random();
    const side = Math.random() < 0.5 ? '1' : '2';
    if (x < 0.22) this.chat(side, true);
    else if (x < 0.55) this.gift(GIFTS[0], 1 + Math.floor(Math.random() * 6), true, side);
    else if (x < 0.68) this.gift(GIFTS[1], 1, true, side);
    else if (x < 0.8) this.gift(GIFTS[2], 1, true, side);
    else if (x < 0.88) this.like(40 + Math.floor(Math.random() * 120));
    else if (x < 0.95) this.gift(GIFTS[3], 1, true, side);
    else if (x < 0.985) this.gift(GIFTS[4], 1, true, side);
    else this.gift(GIFTS[6], 1, true, side);
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
}
