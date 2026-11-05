// Capa 2D sobre el 3D: nombres de quien donó, barras de vida y la mira del bombardeo.

import { isBig } from '../sim/units.js';

const TEAM_BG = ['rgba(18,98,190,0.78)', 'rgba(190,30,40,0.78)'];
const TEAM_HP = ['#53b6ff', '#ff5a5a'];
// segundos que se ve el nombre al aparecer en naves que no son de regalo (drones por unirse,
// likes, seguir, compartir). Los grandes y todas las naves de regalo lo llevan siempre.
const LABEL_TIME = { dron: 3.2, caza: 3.2, bombardero: 5 };
const RANK = { dron: 0, caza: 1, bombardero: 2, coloso: 3, acorazado: 4 };

// La nave principal de cada donante: la más fuerte y, entre iguales, la más antigua, para que
// no salte de nave en nave. Su nombre nunca se esconde (si se encima, sube). Si muere, pasa a otra.
export function donorLabelUnits(units) {
  const best = new Map();
  for (const u of units) {
    if (!u.alive || !u.gift || !u.owner || u.controlled) continue;
    const cur = best.get(u.owner.id);
    const r = RANK[u.kind] ?? 0, rc = cur ? RANK[cur.kind] ?? 0 : -1;
    if (r > rc || (r === rc && u.born < cur.born)) best.set(u.owner.id, u);
  }
  return new Set(best.values());
}

// Naves que llevan nombre en este momento, en orden de prioridad: grandes, la principal de cada
// donante, el resto de naves de regalo y por último los nombres pasajeros (lo más nuevo primero).
export function nameCandidates(units, t) {
  const main = donorLabelUnits(units);
  const owned = [];
  for (const u of units) {
    if (!u.alive || !u.owner || u.controlled) continue;
    if (!u.gift && t - u.born > (LABEL_TIME[u.kind] ?? Infinity)) continue;
    owned.push(u);
  }
  owned.sort((a, b) => (isBig(b.kind) - isBig(a.kind)) || (main.has(b) - main.has(a))
    || (b.gift - a.gift) || (b.born - a.born));
  return { owned, main };
}

export class Overlay {
  constructor(canvas, renderer, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.r = renderer;
    this.world = world;
    this.w = 1;
    this.h = 1;
    this.k = 1;
    this.p = { x: 0, y: 0, visible: false };
    this.avatars = new Map();
    this.aim = null;
    this.showNames = true;
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.k = h / 960;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  avatar(url) {
    if (!url) return null;
    let a = this.avatars.get(url);
    if (!a) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      a = { img, ok: false };
      img.onload = () => { a.ok = true; };
      img.src = url;
      this.avatars.set(url, a);
      if (this.avatars.size > 400) this.avatars.delete(this.avatars.keys().next().value);
    }
    return a.ok ? a.img : null;
  }

  pill(text, x, y, size, bg, avatar) {
    const ctx = this.ctx;
    ctx.font = `700 ${size}px Oxanium, "Segoe UI", system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const pad = size * 0.45;
    const av = avatar ? size * 1.5 : 0;
    const w = tw + pad * 2 + (av ? av + pad * 0.4 : 0);
    const h = size * 1.45;
    const x0 = x - w / 2;
    const y0 = y - h;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, h / 2);
    else ctx.rect(x0, y0, w, h);
    ctx.fill();
    if (avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x0 + h / 2, y0 + h / 2, av / 2.2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, x0 + h / 2 - av / 2.2, y0 + h / 2 - av / 2.2, av / 1.1, av / 1.1);
      ctx.restore();
    }
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x0 + pad + (av ? av + pad * 0.4 : 0), y0 + h / 2 + size * 0.04);
    return y0;
  }

  bar(x, y, width, k, color) {
    const ctx = this.ctx;
    const h = Math.max(3, 4 * this.k);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y, width * Math.max(0, Math.min(1, k)), h);
  }

  draw() {
    const ctx = this.ctx;
    const { w, h, k } = this;
    ctx.clearRect(0, 0, w, h);
    const world = this.world;
    const p = this.p;
    const t = world.time;

    // todas las naves de regalo llevan el nombre de su donante; con muchísimas a la vez hay un
    // límite de etiquetas pequeñas para que no se vuelva ilegible (la principal de cada uno va primero)
    const { owned, main: donors } = nameCandidates(world.units, t);
    const smallBudget = owned.length > 120 ? 70 : 999;
    let shown = 0;
    const placed = []; // rectángulos ya dibujados, para no encimar nombres pequeños

    for (const u of world.units) {
      const big = isBig(u.kind);
      const damaged = u.hp < u.maxHp;
      if (!big && !damaged && !u.controlled) continue;
      const top = u.y + u.def.height * (u.kind === 'comandante' ? 1.3 : 1) + (u.def.flying ? 1.6 : 0.35);
      this.r.project(u.x, top, u.z, p);
      if (!p.visible) continue;
      const bw = (big ? 56 : u.kind === 'bombardero' ? 30 : 18) * k;
      const color = u.controlled ? '#ffc23d' : TEAM_HP[u.team];
      this.bar(p.x * w, p.y * h - 6 * k, bw, u.hp / u.maxHp, color);
    }

    if (this.showNames) {
      for (const u of owned) {
        const big = isBig(u.kind);
        if (!big && shown >= smallBudget) continue;
        const top = u.y + u.def.height + (u.def.flying ? 2.2 : 0.55);
        this.r.project(u.x, top, u.z, p);
        if (!p.visible) continue;
        const size = (big ? 15 : u.kind === 'bombardero' ? 11.5 : 9.5) * k;
        const name = u.owner.nickname.length > 14 ? `${u.owner.nickname.slice(0, 13)}…` : u.owner.nickname;
        const cx = p.x * w;
        let cy = p.y * h - 10 * k;
        const hw = (name.length * 0.62 + 1) * size / 2, hh = size * 0.75;
        const hit = (y) => placed.some((r) => Math.abs(r.x - cx) < r.hw + hw && Math.abs(r.y - y) < r.hh + hh);
        if (!big && hit(cy)) {
          // si se encima con otro nombre se saltea en ese momento (vuelve cuando la nave se separa),
          // salvo la nave principal de cada donante: esa sube hasta encontrar lugar
          // (si no hay, se dibuja igual en el último intento)
          if (!donors.has(u)) continue;
          for (let i = 0; i < 4 && hit(cy); i++) cy -= hh * 2.1;
        }
        placed.push({ x: cx, y: cy, hw, hh });
        if (!big) shown++; // el límite cuenta solo los nombres que de verdad se dibujan
        const life = u.gift ? 0 : LABEL_TIME[u.kind];
        this.ctx.globalAlpha = life ? Math.max(0, Math.min(1, (life - (t - u.born)) / 0.6)) : 1;
        this.pill(name, cx, cy, size, TEAM_BG[u.team], big ? this.avatar(u.owner.avatar) : null);
        this.ctx.globalAlpha = 1;
      }
    }

    // comandante
    const c = world.commander;
    if (c && c.alive) {
      this.r.project(c.x, c.y + c.def.height * 1.3 + 0.7, c.z, p);
      if (p.visible) this.pill('COMANDANTE', p.x * w, p.y * h - 12 * k, 10 * k, 'rgba(150,100,10,0.85)');
    }

    // mira del bombardeo
    if (this.aim && c && c.alive && world.state !== 'end') {
      this.r.project(this.aim.x, 0, this.aim.z, p);
      if (p.visible) {
        const ready = world.strikeCooldown() <= 0;
        const x = p.x * w, y = p.y * h;
        const r = 16 * k;
        ctx.strokeStyle = ready ? 'rgba(255,210,80,0.95)' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2 * k;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.4, r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - r * 2, y); ctx.lineTo(x - r * 0.8, y);
        ctx.moveTo(x + r * 0.8, y); ctx.lineTo(x + r * 2, y);
        ctx.stroke();
      }
    }
  }
}
